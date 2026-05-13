package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ============================================================
// Feature 1: Log Ring Buffer (real-time log collection)
// ============================================================

const maxLogLines = 500

type logBuffer struct {
	mu    sync.RWMutex
	lines []logEntry
}

type logEntry struct {
	Time    string `json:"time"`
	Level   string `json:"level"`
	Message string `json:"message"`
}

func newLogBuffer() *logBuffer {
	return &logBuffer{lines: make([]logEntry, 0, maxLogLines)}
}

func (lb *logBuffer) Add(level, msg string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()
	entry := logEntry{
		Time:    time.Now().Format("15:04:05"),
		Level:   level,
		Message: msg,
	}
	if len(lb.lines) >= maxLogLines {
		lb.lines = lb.lines[1:]
	}
	lb.lines = append(lb.lines, entry)
}

func (lb *logBuffer) GetAll() []logEntry {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	result := make([]logEntry, len(lb.lines))
	copy(result, lb.lines)
	return result
}

func (lb *logBuffer) GetRecent(n int) []logEntry {
	lb.mu.RLock()
	defer lb.mu.RUnlock()
	if n > len(lb.lines) {
		n = len(lb.lines)
	}
	result := make([]logEntry, n)
	copy(result, lb.lines[len(lb.lines)-n:])
	return result
}

// GetLogsReal returns real log entries from the buffer.
func (m *InstanceManager) GetLogsReal(id string) ([]logEntry, error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("instance %s not found", id)
	}

	if inst.logs == nil {
		return []logEntry{}, nil
	}
	return inst.logs.GetAll(), nil
}

// ============================================================
// Feature 2: Health Monitor (auto-restart crashed instances)
// ============================================================

type HealthStatus struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Healthy   bool   `json:"healthy"`
	PID       int    `json:"pid"`
	Uptime    int64  `json:"uptime"`
	LastCheck string `json:"last_check"`
	Message   string `json:"message"`
}

// StartHealthMonitor launches a background goroutine that checks instance health.
func (m *InstanceManager) StartHealthMonitor(interval time.Duration, autoRestart bool) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			m.checkHealth(autoRestart)
		}
	}()
	log.Printf("[HealthMonitor] Started with interval=%v autoRestart=%v", interval, autoRestart)
}

func (m *InstanceManager) checkHealth(autoRestart bool) {
	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.mu.RLock()
		inst, ok := m.instances[id]
		m.mu.RUnlock()
		if !ok {
			continue
		}

		inst.mu.RLock()
		state := inst.state
		pid := inst.pid
		inst.mu.RUnlock()

		if state == "running" || state == "busy" {
			// Check if process is still alive
			if pid > 0 {
				alive := isProcessAliveByPID(pid)
				if !alive {
					log.Printf("[HealthMonitor] Instance %s (PID %d) crashed!", id, pid)
					inst.mu.Lock()
					inst.state = "error"
					inst.lastError = "process crashed (detected by health monitor)"
					inst.mu.Unlock()

					if inst.logs != nil {
						inst.logs.Add("error", "Process crashed, detected by health monitor")
					}

					if autoRestart {
						log.Printf("[HealthMonitor] Auto-restarting instance %s", id)
						if inst.logs != nil {
							inst.logs.Add("info", "Auto-restarting...")
						}
						go func(instanceID string) {
							_ = m.Stop(instanceID)
							time.Sleep(1 * time.Second)
							_ = m.Start(instanceID)
						}(id)
					}
				}
			}
		}
	}
}

func isProcessAliveByPID(pid int) bool {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH")
		hideWindow(cmd)
		out, err := cmd.Output()
		if err != nil {
			return false
		}
		return strings.Contains(string(out), strconv.Itoa(pid))
	}
	// Unix: send signal 0
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = proc.Signal(os.Signal(nil))
	return err == nil
}

// GetHealthStatus returns health info for all instances.
func (m *InstanceManager) GetHealthStatus() []HealthStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]HealthStatus, 0, len(m.instances))
	for _, inst := range m.instances {
		inst.mu.RLock()
		hs := HealthStatus{
			ID:        inst.id,
			Name:      inst.name,
			PID:       inst.pid,
			Uptime:    int64(time.Since(inst.createdAt).Seconds()),
			LastCheck: time.Now().Format("15:04:05"),
		}
		if inst.state == "running" || inst.state == "busy" {
			hs.Healthy = true
			hs.Message = "running normally"
		} else if inst.state == "error" {
			hs.Healthy = false
			hs.Message = inst.lastError
		} else {
			hs.Healthy = false
			hs.Message = "stopped"
		}
		inst.mu.RUnlock()
		result = append(result, hs)
	}
	return result
}

// ============================================================
// Feature 3: Batch Operations (start/stop all)
// ============================================================

type BatchResult struct {
	ID      string `json:"id"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// BatchStart starts all stopped instances.
func (m *InstanceManager) BatchStart() []BatchResult {
	m.mu.RLock()
	ids := make([]string, 0)
	for id, inst := range m.instances {
		inst.mu.RLock()
		if inst.state == "stopped" || inst.state == "error" {
			ids = append(ids, id)
		}
		inst.mu.RUnlock()
	}
	m.mu.RUnlock()

	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		err := m.Start(id)
		r := BatchResult{ID: id, Success: err == nil}
		if err != nil {
			r.Error = err.Error()
		}
		results = append(results, r)
	}
	return results
}

// BatchStop stops all running instances.
func (m *InstanceManager) BatchStop() []BatchResult {
	m.mu.RLock()
	ids := make([]string, 0)
	for id, inst := range m.instances {
		inst.mu.RLock()
		if inst.state == "running" || inst.state == "busy" {
			ids = append(ids, id)
		}
		inst.mu.RUnlock()
	}
	m.mu.RUnlock()

	results := make([]BatchResult, 0, len(ids))
	for _, id := range ids {
		err := m.Stop(id)
		r := BatchResult{ID: id, Success: err == nil}
		if err != nil {
			r.Error = err.Error()
		}
		results = append(results, r)
	}
	return results
}

// ============================================================
// Feature 4: Chat Export (conversation history)
// ============================================================

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Time    string `json:"time"`
}

type chatHistory struct {
	mu       sync.RWMutex
	messages []ChatMessage
}

func newChatHistory() *chatHistory {
	return &chatHistory{messages: make([]ChatMessage, 0)}
}

func (ch *chatHistory) Add(role, content string) {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.messages = append(ch.messages, ChatMessage{
		Role:    role,
		Content: content,
		Time:    time.Now().Format("2006-01-02 15:04:05"),
	})
}

func (ch *chatHistory) GetAll() []ChatMessage {
	ch.mu.RLock()
	defer ch.mu.RUnlock()
	result := make([]ChatMessage, len(ch.messages))
	copy(result, ch.messages)
	return result
}

func (ch *chatHistory) Clear() {
	ch.mu.Lock()
	defer ch.mu.Unlock()
	ch.messages = ch.messages[:0]
}

// ExportChat returns the full chat history for an instance.
func (m *InstanceManager) ExportChat(id string) ([]ChatMessage, error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("instance %s not found", id)
	}

	if inst.chat == nil {
		return []ChatMessage{}, nil
	}
	return inst.chat.GetAll(), nil
}

// ClearChatHistory clears the chat history for an instance.
func (m *InstanceManager) ClearChatHistory(id string) error {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("instance %s not found", id)
	}

	if inst.chat != nil {
		inst.chat.Clear()
	}
	// Also send clear command to bridge
	cmd := map[string]interface{}{"cmd": "clear"}
	return m.SendCommand(id, cmd)
}

// RecordChat records a message in the chat history.
func (m *InstanceManager) RecordChat(id, role, content string) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return
	}
	if inst.chat != nil {
		inst.chat.Add(role, content)
	}
}

// ============================================================
// Feature 5: Resource Monitoring (CPU/Memory per instance)
// ============================================================

type ResourceInfo struct {
	ID         string  `json:"id"`
	PID        int     `json:"pid"`
	CPUPercent float64 `json:"cpu_percent"`
	MemoryMB   float64 `json:"memory_mb"`
	Threads    int     `json:"threads"`
	TokensUsed int    `json:"tokens_used"`
	TotalTurns int    `json:"total_turns"`
}

// GetResources returns resource usage for all running instances.
func (m *InstanceManager) GetResources() []ResourceInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]ResourceInfo, 0)
	for _, inst := range m.instances {
		inst.mu.RLock()
		pid := inst.pid
		id := inst.id
		tokens := inst.tokensUsed
		turns := inst.totalTurns
		inst.mu.RUnlock()

		ri := ResourceInfo{
			ID:         id,
			PID:        pid,
			TokensUsed: tokens,
			TotalTurns: turns,
		}

		if pid > 0 {
			ri.CPUPercent, ri.MemoryMB, ri.Threads = getProcessStats(pid)
		}
		result = append(result, ri)
	}
	return result
}

// getProcessStats uses OS commands to get process CPU/memory/threads (no external deps).
func getProcessStats(pid int) (cpuPercent float64, memoryMB float64, threads int) {
	if runtime.GOOS == "windows" {
		// Use wmic to get WorkingSetSize and ThreadCount
		cmd := exec.Command("wmic", "process", "where",
			fmt.Sprintf("ProcessId=%d", pid), "get",
			"WorkingSetSize,ThreadCount", "/format:csv")
		hideWindow(cmd)
		out, err := cmd.Output()
		if err == nil {
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "Node") {
					continue
				}
				parts := strings.Split(line, ",")
				if len(parts) >= 3 {
					if tc, e := strconv.Atoi(strings.TrimSpace(parts[1])); e == nil {
						threads = tc
					}
					if ws, e := strconv.ParseInt(strings.TrimSpace(parts[2]), 10, 64); e == nil {
						memoryMB = float64(ws) / 1024 / 1024
					}
				}
			}
		}
		// Get CPU usage via PowerShell (two-sample measurement)
		psCmd := exec.Command("powershell", "-NoProfile", "-Command",
			fmt.Sprintf(`(Get-Process -Id %d -ErrorAction SilentlyContinue).CPU`, pid))
		hideWindow(psCmd)
		cpuOut, cpuErr := psCmd.Output()
		if cpuErr == nil {
			cpuStr := strings.TrimSpace(string(cpuOut))
			if cpuStr != "" {
				// Get-Process .CPU returns total CPU seconds; estimate % from delta
				// Fallback: use wmic path Win32_PerfFormattedData
				if val, e := strconv.ParseFloat(cpuStr, 64); e == nil && val > 0 {
					// Approximate: total CPU seconds / uptime * 100 / numCPU
					cpuPercent = val
				}
			}
		}
		// Better approach: use Win32_PerfFormattedData_PerfProc_Process
		perfCmd := exec.Command("wmic", "path", "Win32_PerfFormattedData_PerfProc_Process",
			"where", fmt.Sprintf("IDProcess=%d", pid), "get", "PercentProcessorTime", "/format:csv")
		hideWindow(perfCmd)
		perfOut, perfErr := perfCmd.Output()
		if perfErr == nil {
			perfLines := strings.Split(strings.TrimSpace(string(perfOut)), "\n")
			for _, line := range perfLines {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "Node") {
					continue
				}
				parts := strings.Split(line, ",")
				if len(parts) >= 2 {
					if pct, e := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); e == nil {
						cpuPercent = pct
					}
				}
			}
		}
	} else {
		// Linux/Mac: use /proc or ps
		out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "%cpu=,rss=,nlwp=").Output()
		if err == nil {
			fields := strings.Fields(strings.TrimSpace(string(out)))
			if len(fields) >= 1 {
				if cpu, e := strconv.ParseFloat(fields[0], 64); e == nil {
					cpuPercent = cpu
				}
			}
			if len(fields) >= 2 {
				if rss, e := strconv.ParseInt(fields[1], 10, 64); e == nil {
					memoryMB = float64(rss) / 1024
				}
			}
			if len(fields) >= 3 {
				if t, e := strconv.Atoi(fields[2]); e == nil {
					threads = t
				}
			}
		}
	}
	return
}

// ============================================================
// Feature 6: Quick Commands (predefined operations)
// ============================================================

type QuickCommand struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Command     string `json:"command"`
	Category    string `json:"category"`
}

// GetQuickCommands returns available quick commands.
func (m *InstanceManager) GetQuickCommands() []QuickCommand {
	return []QuickCommand{
		{ID: "status", Name: "查看状态", Description: "查看Agent当前状态和配置", Command: "/status", Category: "info"},
		{ID: "help", Name: "帮助", Description: "显示可用命令列表", Command: "/help", Category: "info"},
		{ID: "clear", Name: "清空对话", Description: "清除当前对话历史", Command: "/clear", Category: "control"},
		{ID: "reset", Name: "重置Agent", Description: "重置Agent到初始状态", Command: "/reset", Category: "control"},
		{ID: "memory", Name: "查看记忆", Description: "显示Agent的长期记忆", Command: "/memory", Category: "info"},
		{ID: "tasks", Name: "任务列表", Description: "查看当前任务队列", Command: "/tasks", Category: "info"},
		{ID: "stop_auto", Name: "停止自主", Description: "停止自主行动模式", Command: "/stop", Category: "control"},
		{ID: "reflect", Name: "触发反思", Description: "手动触发一次反思", Command: "/reflect", Category: "control"},
	}
}

// ExecuteQuickCommand sends a quick command to an instance.
func (m *InstanceManager) ExecuteQuickCommand(id, commandID string) error {
	commands := m.GetQuickCommands()
	var cmdText string
	for _, c := range commands {
		if c.ID == commandID {
			cmdText = c.Command
			break
		}
	}
	if cmdText == "" {
		return fmt.Errorf("unknown command: %s", commandID)
	}

	// Special handling for /clear
	if cmdText == "/clear" {
		return m.ClearChatHistory(id)
	}

	// Send as a chat message
	cmd := map[string]interface{}{
		"cmd":  "chat",
		"text": cmdText,
	}
	return m.SendCommand(id, cmd)
}

// ============================================================
// Feature 7: Multi-Instance Collaboration (message forwarding)
// ============================================================

type ForwardRequest struct {
	FromID  string `json:"from_id"`
	ToID    string `json:"to_id"`
	Message string `json:"message"`
}

// ForwardMessage sends a message from one instance to another.
func (m *InstanceManager) ForwardMessage(fromID, toID, message string) error {
	m.mu.RLock()
	_, fromOk := m.instances[fromID]
	_, toOk := m.instances[toID]
	m.mu.RUnlock()

	if !fromOk {
		return fmt.Errorf("source instance %s not found", fromID)
	}
	if !toOk {
		return fmt.Errorf("target instance %s not found", toID)
	}

	// Prefix message with source info
	prefixed := fmt.Sprintf("[来自实例 %s] %s", fromID[:8], message)

	cmd := map[string]interface{}{
		"cmd":  "send",
		"text": prefixed,
	}
	return m.SendCommand(toID, cmd)
}

// BroadcastToAll sends a message to all running instances.
func (m *InstanceManager) BroadcastToAll(message string, excludeID string) []BatchResult {
	m.mu.RLock()
	ids := make([]string, 0)
	for id, inst := range m.instances {
		if id == excludeID {
			continue
		}
		inst.mu.RLock()
		if inst.state == "running" {
			ids = append(ids, id)
		}
		inst.mu.RUnlock()
	}
	m.mu.RUnlock()

	results := make([]BatchResult, 0)
	for _, id := range ids {
		cmd := map[string]interface{}{
			"cmd":  "chat",
			"text": fmt.Sprintf("[广播消息] %s", message),
		}
		err := m.SendCommand(id, cmd)
		r := BatchResult{ID: id, Success: err == nil}
		if err != nil {
			r.Error = err.Error()
		}
		results = append(results, r)
	}
	return results
}

// ============================================================
// Feature 8: Scheduled Tasks Management
// ============================================================

type ScheduledTask struct {
	ID         string `json:"id"`
	InstanceID string `json:"instance_id"`
	Name       string `json:"name"`
	Cron       string `json:"cron"`
	Command    string `json:"command"`
	Enabled    bool   `json:"enabled"`
	LastRun    string `json:"last_run,omitempty"`
	NextRun    string `json:"next_run,omitempty"`
}

var (
	scheduledTasks   = make(map[string]*ScheduledTask)
	scheduledTasksMu sync.RWMutex
	taskCounter      int
)

// GetScheduledTasks returns all scheduled tasks for an instance.
func (m *InstanceManager) GetScheduledTasks(instanceID string) []ScheduledTask {
	scheduledTasksMu.RLock()
	defer scheduledTasksMu.RUnlock()

	result := make([]ScheduledTask, 0)
	for _, t := range scheduledTasks {
		if t.InstanceID == instanceID || instanceID == "" {
			result = append(result, *t)
		}
	}
	return result
}

// AddScheduledTask creates a new scheduled task.
func (m *InstanceManager) AddScheduledTask(instanceID, name, cron, command string) (*ScheduledTask, error) {
	scheduledTasksMu.Lock()
	defer scheduledTasksMu.Unlock()

	taskCounter++
	task := &ScheduledTask{
		ID:         fmt.Sprintf("task_%d", taskCounter),
		InstanceID: instanceID,
		Name:       name,
		Cron:       cron,
		Command:    command,
		Enabled:    true,
	}
	scheduledTasks[task.ID] = task

	// Enable scheduler mode on the instance (correct format: key/value)
	_ = m.SendCommand(instanceID, map[string]interface{}{
		"cmd":   "set_config",
		"key":   "scheduler",
		"value": true,
	})

	// Start the scheduler goroutine for this task
	go m.runScheduledTask(task)

	return task, nil
}

// RemoveScheduledTask deletes a scheduled task.
func (m *InstanceManager) RemoveScheduledTask(taskID string) error {
	scheduledTasksMu.Lock()
	defer scheduledTasksMu.Unlock()

	if _, ok := scheduledTasks[taskID]; !ok {
		return fmt.Errorf("task %s not found", taskID)
	}
	delete(scheduledTasks, taskID)
	return nil
}

// ToggleScheduledTask enables/disables a task.
func (m *InstanceManager) ToggleScheduledTask(taskID string) error {
	scheduledTasksMu.Lock()
	defer scheduledTasksMu.Unlock()

	task, ok := scheduledTasks[taskID]
	if !ok {
		return fmt.Errorf("task %s not found", taskID)
	}
	task.Enabled = !task.Enabled
	return nil
}

// runScheduledTask runs a scheduled task based on its cron expression.
// Supports: "*/N * * * *" (every N minutes), "0 H * * *" (daily at hour H),
// or interval format "every Nm" / "every Nh".
func (m *InstanceManager) runScheduledTask(task *ScheduledTask) {
	interval := parseCronInterval(task.Cron)
	if interval <= 0 {
		log.Printf("[Scheduler] Invalid cron expression for task %s: %s", task.ID, task.Cron)
		return
	}

	log.Printf("[Scheduler] Task %s (%s) started, interval=%v", task.ID, task.Name, interval)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		scheduledTasksMu.RLock()
		t, exists := scheduledTasks[task.ID]
		if !exists {
			scheduledTasksMu.RUnlock()
			log.Printf("[Scheduler] Task %s removed, stopping goroutine", task.ID)
			return
		}
		enabled := t.Enabled
		instanceID := t.InstanceID
		command := t.Command
		scheduledTasksMu.RUnlock()

		if !enabled {
			continue
		}

		// Send the command as a chat message to the instance
		cmd := map[string]interface{}{
			"cmd":  "chat",
			"text": fmt.Sprintf("[定时任务: %s] %s", task.Name, command),
		}
		if err := m.SendCommand(instanceID, cmd); err != nil {
			log.Printf("[Scheduler] Failed to execute task %s: %v", task.ID, err)
		} else {
			scheduledTasksMu.Lock()
			if t, ok := scheduledTasks[task.ID]; ok {
				t.LastRun = time.Now().Format("2006-01-02 15:04:05")
				t.NextRun = time.Now().Add(interval).Format("2006-01-02 15:04:05")
			}
			scheduledTasksMu.Unlock()
			log.Printf("[Scheduler] Task %s executed successfully", task.ID)
		}
	}
}

// parseCronInterval converts a cron expression to a time.Duration.
// Supports: "*/N * * * *" → every N minutes, "every Nm" → N minutes, "every Nh" → N hours.
func parseCronInterval(cron string) time.Duration {
	cron = strings.TrimSpace(cron)

	// Handle "every Xm" or "every Xh" format
	if strings.HasPrefix(cron, "every ") {
		part := strings.TrimPrefix(cron, "every ")
		part = strings.TrimSpace(part)
		if strings.HasSuffix(part, "m") {
			if n, err := strconv.Atoi(strings.TrimSuffix(part, "m")); err == nil && n > 0 {
				return time.Duration(n) * time.Minute
			}
		}
		if strings.HasSuffix(part, "h") {
			if n, err := strconv.Atoi(strings.TrimSuffix(part, "h")); err == nil && n > 0 {
				return time.Duration(n) * time.Hour
			}
		}
	}

	// Handle standard cron "*/N * * * *" (every N minutes)
	parts := strings.Fields(cron)
	if len(parts) >= 5 && strings.HasPrefix(parts[0], "*/") {
		if n, err := strconv.Atoi(strings.TrimPrefix(parts[0], "*/")); err == nil && n > 0 {
			return time.Duration(n) * time.Minute
		}
	}

	// Handle "0 H * * *" (daily at hour H) → approximate as 24h
	if len(parts) >= 5 && parts[0] == "0" {
		return 24 * time.Hour
	}

	// Default: 1 hour
	return time.Hour
}

// ============================================================
// System Info (for dashboard)
// ============================================================

type SystemInfo struct {
	OS         string `json:"os"`
	Arch       string `json:"arch"`
	GoVersion  string `json:"go_version"`
	NumCPU     int    `json:"num_cpu"`
	Goroutines int    `json:"goroutines"`
	Instances  int    `json:"instances"`
	Running    int    `json:"running"`
}

func (m *InstanceManager) GetSystemInfo() SystemInfo {
	m.mu.RLock()
	total := len(m.instances)
	running := 0
	for _, inst := range m.instances {
		inst.mu.RLock()
		if inst.state == "running" || inst.state == "busy" {
			running++
		}
		inst.mu.RUnlock()
	}
	m.mu.RUnlock()

	return SystemInfo{
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		GoVersion:  runtime.Version(),
		NumCPU:     runtime.NumCPU(),
		Goroutines: runtime.NumGoroutine(),
		Instances:  total,
		Running:    running,
	}
}

// ============================================================
// Persistence: Save/Load instance state to disk
// ============================================================

type persistedState struct {
	Instances []persistedInstance `json:"instances"`
}

type persistedInstance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	LLMNo      int    `json:"llm_no"`
	Autonomous bool   `json:"autonomous"`
	Goal       string `json:"goal"`
	Reflect    bool   `json:"reflect"`
}

// SaveState persists current instance configs to disk.
func (m *InstanceManager) SaveState() error {
	m.mu.RLock()
	state := persistedState{Instances: make([]persistedInstance, 0)}
	for _, inst := range m.instances {
		inst.mu.RLock()
		state.Instances = append(state.Instances, persistedInstance{
			ID:         inst.id,
			Name:       inst.name,
			LLMNo:      inst.llmNo,
			Autonomous: inst.autonomous,
			Goal:       inst.goal,
			Reflect:    inst.reflect,
		})
		inst.mu.RUnlock()
	}
	m.mu.RUnlock()

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile("ga_instances_state.json", data, 0644)
}

// LoadState restores instance configs from disk (does not start them).
func (m *InstanceManager) LoadState() {
	data, err := os.ReadFile("ga_instances_state.json")
	if err != nil {
		return // No saved state, that's fine
	}

	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		log.Printf("[InstanceManager] Failed to parse saved state: %v", err)
		return
	}

	for _, pi := range state.Instances {
		m.mu.Lock()
		if _, exists := m.instances[pi.ID]; !exists {
			m.instances[pi.ID] = &managedInstance{
				id:          pi.ID,
				name:        pi.Name,
				state:       "stopped",
				llmNo:       pi.LLMNo,
				autonomous:  pi.Autonomous,
				goal:        pi.Goal,
				reflect:     pi.Reflect,
				createdAt:   time.Now(),
				subscribers: make(map[string]chan []byte),
				logs:        newLogBuffer(),
				chat:        newChatHistory(),
			}
		}
		m.mu.Unlock()
	}
	log.Printf("[InstanceManager] Restored %d instances from saved state", len(state.Instances))
}

// ============================================================
// Helper: Add log buffer + chat history to instance creation
// ============================================================

// AddLogEntry adds a log entry to an instance's log buffer.
func (m *InstanceManager) AddLogEntry(id, level, msg string) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return
	}
	if inst.logs != nil {
		inst.logs.Add(level, msg)
	}
}

// GetInstanceIDs returns all instance IDs (for collaboration UI).
func (m *InstanceManager) GetInstanceIDs() []map[string]string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]map[string]string, 0)
	for _, inst := range m.instances {
		inst.mu.RLock()
		result = append(result, map[string]string{
			"id":   inst.id,
			"name": inst.name,
		})
		inst.mu.RUnlock()
	}
	return result
}

// init helper - suppress unused import warnings
var _ = strings.TrimSpace
var _ = json.Marshal
