package services

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"ga_manager/models"
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
		lastErr := inst.lastError
		inst.mu.RUnlock()

		// Only auto-restart instances that are in error state
		// (set by waitForExit when process actually exits unexpectedly)
		if state == models.StateError && autoRestart && lastErr != "" {
			log.Printf("[HealthMonitor] Instance %s in error state: %s", id, lastErr)
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

// isProcessAliveByPID checks if a process is still running (Unix only, used as fallback).
func isProcessAliveByPID(pid int) bool {
	if pid <= 0 {
		return false
	}
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// Only works reliably on Unix
	if runtime.GOOS != "windows" {
		err = proc.Signal(os.Signal(nil))
		return err == nil
	}
	_ = proc
	return true
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

// getProcessStats returns approximate resource usage.
// On Windows: returns zeros (avoids calling wmic/tasklist which trigger antivirus).
// On Unix: uses ps command.
func getProcessStats(pid int) (cpuPercent float64, memoryMB float64, threads int) {
	if runtime.GOOS != "windows" {
		out, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "%cpu=,rss=,nlwp=").Output()
		if err == nil {
			fields := strings.Fields(strings.TrimSpace(string(out)))
			if len(fields) >= 1 {
				cpuPercent, _ = strconv.ParseFloat(fields[0], 64)
			}
			if len(fields) >= 2 {
				rss, _ := strconv.ParseInt(fields[1], 10, 64)
				memoryMB = float64(rss) / 1024
			}
			if len(fields) >= 3 {
				threads, _ = strconv.Atoi(fields[2])
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
// Persistence: Save/Load instance state to disk (moved to persistence.go)
// ============================================================

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

// ============================================================
// Feature 9: Token Statistics
// ============================================================

const maxTokenHistory = 100

type tokenStats struct {
	mu           sync.RWMutex
	InputTokens  int64
	OutputTokens int64
	CacheCreated int64
	CacheRead    int64
	History      []models.TokenRecord
}

func newTokenStats() *tokenStats {
	return &tokenStats{History: make([]models.TokenRecord, 0, maxTokenHistory)}
}

func (ts *tokenStats) Record(input, output, cacheCreated, cacheRead int64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	ts.InputTokens += input
	ts.OutputTokens += output
	ts.CacheCreated += cacheCreated
	ts.CacheRead += cacheRead
	rec := models.TokenRecord{
		Timestamp:    time.Now(),
		InputTokens:  input,
		OutputTokens: output,
		CacheCreated: cacheCreated,
		CacheRead:    cacheRead,
	}
	if len(ts.History) >= maxTokenHistory {
		ts.History = ts.History[1:]
	}
	ts.History = append(ts.History, rec)
}

func (ts *tokenStats) GetStats(totalTurns int) models.TokenStats {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	hitRate := 0.0
	if ts.InputTokens > 0 {
		hitRate = float64(ts.CacheRead) / float64(ts.InputTokens) * 100
	}
	hist := make([]models.TokenRecord, len(ts.History))
	copy(hist, ts.History)
	return models.TokenStats{
		InputTokens:  ts.InputTokens,
		OutputTokens: ts.OutputTokens,
		CacheCreated: ts.CacheCreated,
		CacheRead:    ts.CacheRead,
		TotalTurns:   totalTurns,
		CacheHitRate: hitRate,
		History:      hist,
	}
}

// GetTokenStats returns token usage statistics for an instance.
func (m *InstanceManager) GetTokenStats(id string) (*models.TokenStats, error) {
	m.mu.RLock()
	inst, ok := m.instances[id]
	m.mu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("instance %s not found", id)
	}
	inst.mu.RLock()
	ts := inst.tokenStats
	turns := inst.totalTurns
	inst.mu.RUnlock()
	if ts == nil {
		empty := models.TokenStats{History: []models.TokenRecord{}}
		return &empty, nil
	}
	stats := ts.GetStats(turns)
	return &stats, nil
}

// ParseTokenLog parses a bridge log line for token information.
// Formats: "[Cache] input=X creation=Y read=Z" or "[Output] tokens=X"
func ParseTokenLog(msg string) (input, output, cacheCreated, cacheRead int64, found bool) {
	if strings.Contains(msg, "[Cache]") {
		found = true
		parts := strings.Fields(msg)
		for _, p := range parts {
			if strings.HasPrefix(p, "input=") {
				v, _ := strconv.ParseInt(strings.TrimPrefix(p, "input="), 10, 64)
				input = v
			} else if strings.HasPrefix(p, "creation=") {
				v, _ := strconv.ParseInt(strings.TrimPrefix(p, "creation="), 10, 64)
				cacheCreated = v
			} else if strings.HasPrefix(p, "read=") {
				v, _ := strconv.ParseInt(strings.TrimPrefix(p, "read="), 10, 64)
				cacheRead = v
			} else if strings.HasPrefix(p, "cached=") {
				v, _ := strconv.ParseInt(strings.TrimPrefix(p, "cached="), 10, 64)
				cacheRead = v
			}
		}
	}
	if strings.Contains(msg, "[Output]") {
		found = true
		parts := strings.Fields(msg)
		for _, p := range parts {
			if strings.HasPrefix(p, "tokens=") {
				v, _ := strconv.ParseInt(strings.TrimPrefix(p, "tokens="), 10, 64)
				output = v
			}
		}
	}
	return
}

// ============================================================
// Feature 10: Memory Directory Watcher
// ============================================================

// StartMemoryWatcher monitors the GA memory/ directory for SOP changes.
func (m *InstanceManager) StartMemoryWatcher(gaRoot string) {
	memDir := filepath.Join(gaRoot, "memory")
	if _, err := os.Stat(memDir); err != nil {
		log.Printf("[MemoryWatcher] memory dir not found: %s", memDir)
		return
	}

	go func() {
		known := make(map[string]time.Time)
		// Initial scan
		entries, _ := os.ReadDir(memDir)
		for _, e := range entries {
			if info, err := e.Info(); err == nil {
				known[e.Name()] = info.ModTime()
			}
		}

		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			entries, err := os.ReadDir(memDir)
			if err != nil {
				continue
			}
			current := make(map[string]time.Time)
			for _, e := range entries {
				if info, err := e.Info(); err == nil {
					current[e.Name()] = info.ModTime()
				}
			}
			// Detect new files
			for name, modTime := range current {
				if _, existed := known[name]; !existed {
					m.broadcastAll([]byte(fmt.Sprintf(
						`{"event":"sop_created","file":"%s","time":"%s"}`,
						name, modTime.Format("15:04:05"))))
				} else if known[name] != modTime {
					m.broadcastAll([]byte(fmt.Sprintf(
						`{"event":"sop_updated","file":"%s","time":"%s"}`,
						name, modTime.Format("15:04:05"))))
				}
			}
			known = current
		}
	}()
	log.Printf("[MemoryWatcher] Started watching %s", memDir)
}

// broadcastAll sends an event to all subscribers of all instances.
func (m *InstanceManager) broadcastAll(data []byte) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, inst := range m.instances {
		m.broadcast(inst, data)
	}
}
