package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"ga_manager/models"

	"github.com/google/uuid"
)

// safeBuffer is a thread-safe wrapper around bytes.Buffer for capturing stderr.
type safeBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (sb *safeBuffer) Write(p []byte) (n int, err error) {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return sb.buf.Write(p)
}

func (sb *safeBuffer) String() string {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return sb.buf.String()
}

// InstanceManager manages the lifecycle of all GA bridge instances.
type InstanceManager struct {
	mu        sync.RWMutex
	instances map[string]*managedInstance
	config    *models.AppConfig
}

// managedInstance is internal state for a running bridge subprocess.
type managedInstance struct {
	mu sync.RWMutex

	id        string
	name      string
	state     models.InstanceState
	pid       int
	llmNo     int
	createdAt time.Time

	autonomous bool
	goal       string
	reflect    bool

	totalTurns int
	tokensUsed int
	lastError  string

	// Subprocess management
	cmd       *exec.Cmd
	cancel    context.CancelFunc
	stdin     io.WriteCloser
	stderrBuf *safeBuffer

	// Event subscribers (WS clients listening to this instance)
	subsMu      sync.RWMutex
	subscribers map[string]chan []byte // subscriberID -> channel

	// Log buffer and chat history (managed by features.go)
	logs *logBuffer
	chat *chatHistory
}

// toDTO converts internal state to the public API model (caller must hold inst.mu.RLock).
func (inst *managedInstance) toDTO() models.Instance {
	return models.Instance{
		ID:         inst.id,
		Name:       inst.name,
		State:      inst.state,
		PID:        inst.pid,
		LLMNo:     inst.llmNo,
		CreatedAt:  inst.createdAt,
		Uptime:     int64(time.Since(inst.createdAt).Seconds()),
		Autonomous: inst.autonomous,
		Goal:       inst.goal,
		Reflect:    inst.reflect,
		TotalTurns: inst.totalTurns,
		TokensUsed: inst.tokensUsed,
		LastError:  inst.lastError,
	}
}

// NewInstanceManager creates a new manager.
func NewInstanceManager(cfg *models.AppConfig) *InstanceManager {
	return &InstanceManager{
		instances: make(map[string]*managedInstance),
		config:    cfg,
	}
}

// UpdateConfig updates the manager's config reference (e.g. after GA root change).
func (m *InstanceManager) UpdateConfig(cfg *models.AppConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.config = cfg
}

// Subscribe registers a WS client to receive events from an instance.
// Returns a channel and an unsubscribe function.
func (m *InstanceManager) Subscribe(id string) (string, <-chan []byte, func(), error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return "", nil, nil, fmt.Errorf("instance %s not found", id)
	}

	subID := uuid.New().String()[:8]
	ch := make(chan []byte, 64)

	inst.subsMu.Lock()
	inst.subscribers[subID] = ch
	inst.subsMu.Unlock()

	unsub := func() {
		inst.subsMu.Lock()
		delete(inst.subscribers, subID)
		close(ch)
		inst.subsMu.Unlock()
	}

	return subID, ch, unsub, nil
}

// SendCommand writes a JSON command to the bridge's stdin.
func (m *InstanceManager) SendCommand(id string, cmd map[string]interface{}) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	inst.mu.RLock()
	state := inst.state
	stdinPipe := inst.stdin
	inst.mu.RUnlock()

	if state != models.StateRunning {
		return fmt.Errorf("instance %s is not running (state=%s)", id, state)
	}
	if stdinPipe == nil {
		return fmt.Errorf("instance %s stdin not available", id)
	}

	data, err := json.Marshal(cmd)
	if err != nil {
		return fmt.Errorf("failed to marshal command: %w", err)
	}

	// Write JSON line to stdin (newline-terminated)
	line := append(data, '\n')
	if _, err := stdinPipe.Write(line); err != nil {
		return fmt.Errorf("failed to write to bridge stdin: %w", err)
	}

	return nil
}

// Create spawns a new bridge subprocess and waits for the "ready" event.
func (m *InstanceManager) Create(req models.CreateInstanceRequest) (*models.Instance, error) {
	m.mu.RLock()
	count := len(m.instances)
	m.mu.RUnlock()

	if count >= m.config.MaxInstances {
		return nil, fmt.Errorf("max instances (%d) reached", m.config.MaxInstances)
	}

	id := uuid.New().String()[:8]
	name := req.Name
	if name == "" {
		name = fmt.Sprintf("GA-%s", id[:4])
	}

	ctx, cancel := context.WithCancel(context.Background())

	bridgePath := filepath.Join(getBridgeDir(), "bridge.py")
	pythonPath := m.config.PythonPath
	if pythonPath == "" {
		pythonPath = "python"
	}

	args := []string{"-u", bridgePath,
		"--ga-root", m.config.GARoot,
		"--llm-no", strconv.Itoa(req.LLMNo),
	}
	if req.Autonomous {
		args = append(args, "--autonomous")
	}
	if req.Goal != "" {
		args = append(args, "--goal", req.Goal)
	}

	cmd := exec.CommandContext(ctx, pythonPath, args...)
	cmd.Dir = m.config.GARoot
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
	hideWindow(cmd)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	// Capture stderr for diagnostics instead of discarding to os.Stderr
	var stderrBuf safeBuffer
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		cancel()
		stderrOut := stderrBuf.String()
		return nil, fmt.Errorf("failed to start bridge: %w\nstderr: %s", err, stderrOut)
	}

	inst := &managedInstance{
		id:          id,
		name:        name,
		state:       models.StateStarting,
		pid:         cmd.Process.Pid,
		llmNo:       req.LLMNo,
		createdAt:   time.Now(),
		autonomous:  req.Autonomous,
		goal:        req.Goal,
		cmd:         cmd,
		cancel:      cancel,
		stdin:       stdinPipe,
		stderrBuf:   &stderrBuf,
		subscribers: make(map[string]chan []byte),
		logs:        newLogBuffer(),
		chat:        newChatHistory(),
	}

	m.mu.Lock()
	m.instances[id] = inst
	m.mu.Unlock()

	// Start stdout reader goroutine
	readyCh := make(chan struct{})
	go m.readBridgeOutput(inst, stdoutPipe, readyCh)

	// Wait for ready signal with timeout
	select {
	case <-readyCh:
		log.Printf("[InstanceManager] Instance %s ready (pid=%d)", inst.id, inst.pid)
	case <-time.After(30 * time.Second):
		inst.mu.Lock()
		inst.state = models.StateError
		inst.lastError = "bridge startup timeout (30s)"
		inst.mu.Unlock()
		log.Printf("[InstanceManager] Instance %s startup timeout", inst.id)
	}

	// Wait for process exit in background to update state
	go m.waitForExit(inst)

	inst.mu.RLock()
	dto := inst.toDTO()
	inst.mu.RUnlock()
	return &dto, nil
}

// readBridgeOutput reads JSON lines from bridge stdout and dispatches events.
func (m *InstanceManager) readBridgeOutput(inst *managedInstance, stdout io.Reader, readyCh chan struct{}) {
	svcLog("READ_BRIDGE_OUTPUT STARTED instance=%s", inst.id)
	scanner := bufio.NewScanner(stdout)
	// Increase buffer for large responses
	scanner.Buffer(make([]byte, 0, 256*1024), 1024*1024)

	readyClosed := false

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		svcLog("READ_LINE instance=%s line=%s", inst.id, string(line[:min(len(line), 200)]))

		// Parse the event
		var event map[string]interface{}
		if err := json.Unmarshal(line, &event); err != nil {
			log.Printf("[Bridge %s] non-JSON output: %s", inst.id, string(line))
			continue
		}

		eventType, _ := event["event"].(string)

		switch eventType {
		case "ready":
			inst.mu.Lock()
			inst.state = models.StateRunning
			inst.mu.Unlock()
			if !readyClosed {
				close(readyCh)
				readyClosed = true
			}

		case "next":
			// Streaming chunk from LLM
			inst.mu.Lock()
			inst.state = models.StateBusy
			inst.mu.Unlock()
			m.broadcast(inst, line)

		case "done":
			inst.mu.Lock()
			inst.state = models.StateRunning
			inst.totalTurns++
			// Use bridge-reported token count if available, else fallback estimate
			if tokensVal, ok := event["tokens"].(float64); ok && tokensVal > 0 {
				inst.tokensUsed += int(tokensVal)
			} else if text, ok := event["text"].(string); ok {
				estimated := len(text) * 10 / 13 // ~1.3 chars per token
				if estimated < 10 {
					estimated = 10
				}
				inst.tokensUsed += estimated
			} else {
				inst.tokensUsed += 50
			}
			inst.mu.Unlock()
			m.broadcast(inst, line)

		case "error":
			errMsg, _ := event["msg"].(string)
			inst.mu.Lock()
			inst.lastError = errMsg
			inst.mu.Unlock()
			m.broadcast(inst, line)

		case "log":
			// Internal log from bridge, broadcast for log panel
			m.broadcast(inst, line)

		case "status":
			m.broadcast(inst, line)

		case "pong", "ack":
			m.broadcast(inst, line)

		default:
			// Unknown event, still broadcast
			m.broadcast(inst, line)
		}
	}

	// Scanner finished = process stdout closed
	if !readyClosed {
		close(readyCh)
	}

	log.Printf("[InstanceManager] Instance %s stdout closed", inst.id)
}

// svcLog writes debug info to ws_debug.log (same file as handlers for easy reading)
func svcLog(format string, args ...interface{}) {
	f, _ := os.OpenFile("ws_debug.log", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if f != nil {
		defer f.Close()
		msg := fmt.Sprintf(format, args...)
		fmt.Fprintf(f, "[%s] %s\n", time.Now().Format("15:04:05"), msg)
	}
}

// broadcast sends raw JSON bytes to all subscribers of an instance.
func (m *InstanceManager) broadcast(inst *managedInstance, data []byte) {
	inst.subsMu.RLock()
	defer inst.subsMu.RUnlock()

	numSubs := len(inst.subscribers)
	preview := string(data)
	if len(preview) > 200 {
		preview = preview[:200]
	}
	svcLog("BROADCAST instance=%s subs=%d data=%s", inst.id, numSubs, preview)

	for subID, ch := range inst.subscribers {
		select {
		case ch <- data:
			svcLog("BROADCAST SENT sub=%s", subID)
		default:
			svcLog("BROADCAST DROPPED sub=%s (channel full)", subID)
		}
	}
}

// waitForExit waits for the bridge process to exit and updates state.
func (m *InstanceManager) waitForExit(inst *managedInstance) {
	if inst.cmd == nil {
		return
	}
	svcLog("WAIT_FOR_EXIT STARTED instance=%s", inst.id)
	err := inst.cmd.Wait()
	svcLog("WAIT_FOR_EXIT DONE instance=%s err=%v", inst.id, err)

	inst.mu.Lock()
	if inst.state != models.StateStopped {
		if err != nil {
			stderrOut := ""
			if inst.stderrBuf != nil {
				stderrOut = inst.stderrBuf.String()
			}
			if stderrOut != "" {
				inst.lastError = fmt.Sprintf("process exited: %v\nstderr: %s", err, stderrOut)
			} else {
				inst.lastError = fmt.Sprintf("process exited: %v", err)
			}
			inst.state = models.StateError
		} else {
			inst.state = models.StateStopped
		}
	}
	inst.mu.Unlock()

	log.Printf("[InstanceManager] Instance %s process exited", inst.id)
}

// List returns all instances as DTOs.
func (m *InstanceManager) List() []models.Instance {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]models.Instance, 0, len(m.instances))
	for _, inst := range m.instances {
		inst.mu.RLock()
		result = append(result, inst.toDTO())
		inst.mu.RUnlock()
	}
	return result
}

// Get returns a single instance by ID.
func (m *InstanceManager) Get(id string) (*models.Instance, error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("instance %s not found", id)
	}

	inst.mu.RLock()
	dto := inst.toDTO()
	inst.mu.RUnlock()
	return &dto, nil
}

// UpdateLLMNo updates the LLM number for an instance and notifies bridge.
func (m *InstanceManager) UpdateLLMNo(id string, llmNo int) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	inst.mu.Lock()
	inst.llmNo = llmNo
	inst.mu.Unlock()

	// Notify bridge of LLM change
	_ = m.SendCommand(id, map[string]interface{}{
		"cmd":   "switch_llm",
		"llm_no": llmNo,
	})

	return nil
}

// Start re-launches a stopped instance.
func (m *InstanceManager) Start(id string) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	inst.mu.RLock()
	state := inst.state
	inst.mu.RUnlock()

	if state == models.StateRunning || state == models.StateBusy {
		return fmt.Errorf("instance %s is already running", id)
	}

	ctx, cancel := context.WithCancel(context.Background())

	bridgePath := filepath.Join(getBridgeDir(), "bridge.py")
	pythonPath := m.config.PythonPath
	if pythonPath == "" {
		pythonPath = "python"
	}

	args := []string{"-u", bridgePath,
		"--ga-root", m.config.GARoot,
		"--llm-no", strconv.Itoa(inst.llmNo),
	}
	if inst.autonomous {
		args = append(args, "--autonomous")
	}
	if inst.goal != "" {
		args = append(args, "--goal", inst.goal)
	}

	cmd := exec.CommandContext(ctx, pythonPath, args...)
	cmd.Dir = m.config.GARoot
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")
	hideWindow(cmd)

	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create stdin pipe: %w", err)
	}

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("failed to start bridge: %w", err)
	}

	inst.mu.Lock()
	inst.cmd = cmd
	inst.cancel = cancel
	inst.stdin = stdinPipe
	inst.pid = cmd.Process.Pid
	inst.state = models.StateStarting
	inst.lastError = ""
	inst.mu.Unlock()

	readyCh := make(chan struct{})
	go m.readBridgeOutput(inst, stdoutPipe, readyCh)

	// Wait for ready with timeout (non-blocking for caller)
	go func() {
		select {
		case <-readyCh:
			log.Printf("[InstanceManager] Instance %s restarted (pid=%d)", id, inst.pid)
		case <-time.After(30 * time.Second):
			inst.mu.Lock()
			inst.state = models.StateError
			inst.lastError = "bridge restart timeout (30s)"
			inst.mu.Unlock()
		}
	}()

	go m.waitForExit(inst)

	return nil
}

// Stop terminates a bridge process.
func (m *InstanceManager) Stop(id string) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	inst.mu.Lock()
	inst.state = models.StateStopped
	inst.mu.Unlock()

	// Close stdin first (graceful signal)
	if inst.stdin != nil {
		_ = inst.stdin.Close()
	}

	// Then cancel context (force kill if needed)
	if inst.cancel != nil {
		inst.cancel()
	}

	if inst.cmd != nil {
		_ = inst.cmd.Wait()
	}

	return nil
}

// Remove stops and removes an instance from the registry.
func (m *InstanceManager) Remove(id string) error {
	_ = m.Stop(id)

	m.mu.Lock()
	delete(m.instances, id)
	m.mu.Unlock()
	return nil
}

// StopAll terminates all instances (for graceful shutdown).
func (m *InstanceManager) StopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		_ = m.Stop(id)
	}
}

func getBridgeDir() string {
	// Try relative to working directory first (if run from project root)
	if info, err := os.Stat("./bridge/bridge.py"); err == nil && !info.IsDir() {
		abs, _ := filepath.Abs("./bridge")
		return abs
	}
	// Try parent of working directory (exe runs from backend/)
	if info, err := os.Stat("../bridge/bridge.py"); err == nil && !info.IsDir() {
		abs, _ := filepath.Abs("../bridge")
		return abs
	}
	// Fallback: parent of executable directory (exe is in backend/)
	exe, _ := os.Executable()
	parentDir := filepath.Dir(filepath.Dir(exe))
	return filepath.Join(parentDir, "bridge")
}

// GetConfig returns the runtime config JSON for an instance.
func (m *InstanceManager) GetConfig(id string) (string, error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("instance %s not found", id)
	}

	inst.mu.RLock()
	defer inst.mu.RUnlock()

	cfg := map[string]interface{}{
		"llm_no":     inst.llmNo,
		"autonomous": inst.autonomous,
		"goal":       inst.goal,
		"reflect":    inst.reflect,
	}
	data, _ := json.Marshal(cfg)
	return string(data), nil
}

// SaveConfig updates the runtime config for an instance.
func (m *InstanceManager) SaveConfig(id string, configJSON string) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return fmt.Errorf("invalid config JSON: %w", err)
	}

	inst.mu.Lock()
	if v, ok := cfg["llm_no"].(float64); ok {
		inst.llmNo = int(v)
	}
	if v, ok := cfg["autonomous"].(bool); ok {
		inst.autonomous = v
	}
	if v, ok := cfg["goal"].(string); ok {
		inst.goal = v
	}
	if v, ok := cfg["reflect"].(bool); ok {
		inst.reflect = v
	}
	inst.mu.Unlock()

	// Forward config to bridge subprocess
	cmd := map[string]interface{}{
		"cmd":    "set_config",
		"config": cfg,
	}
	_ = m.SendCommand(id, cmd)
	return nil
}

// GetLogs returns recent log events (placeholder - could read from file or memory buffer).
func (m *InstanceManager) GetLogs(id string) ([]string, error) {
	m.mu.RLock()
	_, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("instance %s not found", id)
	}

	// TODO: implement log buffer per instance
	return []string{"[log collection via event stream]"}, nil
}
