# Hive v2 Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the BBS-based Hive mode with a Task Graph engine + MCP server that bridges GA Agents (research/design) and Claude Code (implement/verify), with full observability, persistence, and multi-project support.

**Architecture:** Go backend adds a Task Engine (DAG scheduler with file-based persistence), Context Store (Markdown+JSON), File Tracker (fsnotify), and an MCP stdio server. GA Workers use a new reflect script that polls the Task Engine API. Frontend is rewritten from a message-stream view to a project list + 3-column task-board layout.

**Tech Stack:** Go 1.26, React 18 + TypeScript + Vite + Zustand, MCP protocol (JSON-RPC over stdio), fsnotify, YAML (gopkg.in/yaml.v3)

## Global Constraints

- Go module: `ga_manager` — all new Go code lives under `backend/`
- Frontend: React 18, Zustand for state, Vite build, no new UI framework (existing uses custom CSS + some antd)
- File storage only — no SQLite, no external DB
- All file names must be human-readable and semantic (no opaque IDs in filenames)
- MCP server uses stdio transport (spawned as subprocess by Claude Code)
- Backwards-compatible: old `hive_history` records remain readable but old BBS flow is removed
- Python reflect scripts go into `reflect/` directory of GA root (not this repo — produce them as standalone files the user drops in)

---

## File Structure

### Backend (Go) — New Files

| File | Responsibility |
|------|---------------|
| `backend/hive2/types.go` | All Hive v2 type definitions (Project, Task, ContextEntry, FileChange, Template, WebhookConfig) |
| `backend/hive2/project.go` | Project CRUD — create, load, list, update, delete projects on disk |
| `backend/hive2/taskengine.go` | DAG scheduler — resolve dependencies, dispatch tasks, handle timeouts/stalls |
| `backend/hive2/contextstore.go` | Context Store — read/write Markdown entries with frontmatter, manage _index.json |
| `backend/hive2/filetracker.go` | File Tracker — fsnotify watcher on artifacts/, record changes, attribute to tasks |
| `backend/hive2/templates.go` | Template library — parse YAML templates, instantiate into task DAGs |
| `backend/hive2/webhooks.go` | Webhook/notification system — event bus, HTTP dispatch, IM integration |
| `backend/hive2/workerpool.go` | Worker pool — manage GA worker processes, multi-project scheduling |
| `backend/hive2/events.go` | Event bus — pub/sub for internal events (task state changes, file changes) |
| `backend/handlers/hive2.go` | HTTP handler — all `/api/hive2/` endpoints |
| `backend/mcp/server.go` | MCP stdio server — JSON-RPC protocol, tool dispatch |
| `backend/mcp/tools.go` | MCP tool implementations (hive_task_list, hive_context_read, etc.) |
| `backend/mcp/resources.go` | MCP resource handlers (hive://project/summary, etc.) |

### Frontend (React) — New/Modified Files

| File | Responsibility |
|------|---------------|
| `frontend/src/pages/HivePage.tsx` | Rewrite — project list + create dialog + template selector |
| `frontend/src/pages/HiveProjectPage.tsx` | New — 3-column execution view for a single project |
| `frontend/src/components/hive/TaskList.tsx` | Left panel — task DAG as vertical list with status icons |
| `frontend/src/components/hive/TaskDetail.tsx` | Center panel — selected task info, logs, context refs |
| `frontend/src/components/hive/ArtifactPanel.tsx` | Right panel — file list + preview |
| `frontend/src/components/hive/ContextBar.tsx` | Bottom bar — context entry summary |
| `frontend/src/components/hive/FilePreview.tsx` | File content preview (markdown/code/image) |
| `frontend/src/components/hive/NewProjectDialog.tsx` | Create project form with template selection |
| `frontend/src/store/hive.ts` | Zustand slice for Hive v2 state |

### Python — New Files (produced as artifacts for GA root)

| File | Responsibility |
|------|---------------|
| `hive_v2_worker.py` | New reflect script — polls Task Engine, structured task execution |

---

### Task 1: Hive v2 Types & Project Storage

**Files:**
- Create: `backend/hive2/types.go`
- Create: `backend/hive2/project.go`
- Test: `backend/hive2/project_test.go`

**Interfaces:**
- Consumes: nothing (foundation)
- Produces:
  - `type Project struct` — full project metadata
  - `type Task struct` — task node with all fields from spec
  - `type ContextEntry struct` — context index entry
  - `type FileChange struct` — file change record
  - `type WebhookConfig struct` — webhook configuration
  - `type Template struct` — template definition
  - `func NewProjectStore(baseDir string) *ProjectStore`
  - `func (ps *ProjectStore) Create(name, objective string, config ExecutorConfig) (*Project, error)`
  - `func (ps *ProjectStore) Load(id string) (*Project, error)`
  - `func (ps *ProjectStore) List() ([]*Project, error)`
  - `func (ps *ProjectStore) Update(p *Project) error`
  - `func (ps *ProjectStore) AddTask(projectID string, t *Task) error`
  - `func (ps *ProjectStore) UpdateTask(projectID, taskID string, updates map[string]interface{}) error`
  - `func (ps *ProjectStore) GetTasks(projectID string) ([]*Task, error)`

- [ ] **Step 1: Create types.go with all Hive v2 type definitions**

```go
// backend/hive2/types.go
package hive2

import "time"

type TaskType string

const (
	TaskResearch  TaskType = "research"
	TaskDesign    TaskType = "design"
	TaskImplement TaskType = "implement"
	TaskVerify    TaskType = "verify"
)

type TaskStatus string

const (
	StatusPending TaskStatus = "pending"
	StatusBlocked TaskStatus = "blocked"
	StatusRunning TaskStatus = "running"
	StatusDone    TaskStatus = "done"
	StatusFailed  TaskStatus = "failed"
	StatusStalled TaskStatus = "stalled"
)

type ExecutorType string

const (
	ExecutorGA    ExecutorType = "ga"
	ExecutorClaude ExecutorType = "claude_code"
	ExecutorHuman ExecutorType = "human"
)

type ProjectStatus string

const (
	ProjectRunning   ProjectStatus = "running"
	ProjectPaused    ProjectStatus = "paused"
	ProjectCompleted ProjectStatus = "completed"
	ProjectFailed    ProjectStatus = "failed"
)

type Priority string

const (
	PriorityHigh   Priority = "high"
	PriorityNormal Priority = "normal"
	PriorityLow    Priority = "low"
)

type Task struct {
	ID            string       `json:"id"`
	Type          TaskType     `json:"type"`
	Title         string       `json:"title"`
	Status        TaskStatus   `json:"status"`
	Executor      ExecutorType `json:"executor"`
	DependsOn     []string     `json:"depends_on"`
	Inputs        TaskInputs   `json:"inputs"`
	Outputs       TaskOutputs  `json:"outputs"`
	AssignedTo    string       `json:"assigned_to,omitempty"`
	StartedAt     *time.Time   `json:"started_at,omitempty"`
	FinishedAt    *time.Time   `json:"finished_at,omitempty"`
	BudgetMinutes int          `json:"budget_minutes,omitempty"`
	LogFile       string       `json:"log_file,omitempty"`
	Error         string       `json:"error,omitempty"`
	RequiresApproval bool     `json:"requires_approval,omitempty"`
}

type TaskInputs struct {
	ContextRefs []string `json:"context_refs,omitempty"`
}

type TaskOutputs struct {
	ContextKeys []string `json:"context_keys,omitempty"`
	Files       []string `json:"files,omitempty"`
}

type ExecutorConfig struct {
	GALlmNo          int  `json:"ga_llm_no"`
	GAWorkers        int  `json:"ga_workers"`
	ClaudeCodeEnabled bool `json:"claude_code_enabled"`
}

type AutomationConfig struct {
	AutoDispatchGA                bool `json:"auto_dispatch_ga"`
	AutoDispatchClaude            bool `json:"auto_dispatch_claude"`
	RequireApprovalBeforeImplement bool `json:"require_approval_before_implement"`
	RequireApprovalBeforeVerify    bool `json:"require_approval_before_verify"`
}

type TaskCount struct {
	Total   int `json:"total"`
	Done    int `json:"done"`
	Running int `json:"running"`
	Pending int `json:"pending"`
	Failed  int `json:"failed"`
}

type Project struct {
	ID             string           `json:"id"`
	Name           string           `json:"name"`
	Objective      string           `json:"objective"`
	Status         ProjectStatus    `json:"status"`
	Priority       Priority         `json:"priority"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
	BudgetMinutes  int              `json:"budget_minutes"`
	ElapsedMinutes int              `json:"elapsed_minutes"`
	ExecutorConfig ExecutorConfig   `json:"executor_config"`
	Automation     AutomationConfig `json:"automation"`
	TaskCount      TaskCount        `json:"task_count"`
	Webhooks       []WebhookConfig  `json:"webhooks,omitempty"`
}

type ContextEntry struct {
	Key        string   `json:"key"`
	File       string   `json:"file"`
	Type       string   `json:"type"` // finding, decision, summary, requirement
	SourceTask string   `json:"source_task"`
	Tags       []string `json:"tags"`
	CreatedAt  time.Time `json:"created_at"`
}

type FileChange struct {
	File      string    `json:"file"`
	Action    string    `json:"action"` // created, modified, deleted
	TaskID    string    `json:"task_id"`
	Timestamp time.Time `json:"timestamp"`
	SizeBytes int64     `json:"size_bytes"`
}

type WebhookConfig struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Format string   `json:"format"` // json, slack
}

type HiveGlobalConfig struct {
	MaxConcurrentProjects int  `json:"max_concurrent_projects"`
	MaxGAWorkersTotal     int  `json:"max_ga_workers_total"`
	MaxClaudeSessionsTotal int `json:"max_claude_sessions_total"`
	WorkerPoolShared      bool `json:"worker_pool_shared"`
}
```

- [ ] **Step 2: Create project.go with ProjectStore**

```go
// backend/hive2/project.go
package hive2

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type ProjectStore struct {
	baseDir string
	mu      sync.RWMutex
}

func NewProjectStore(baseDir string) *ProjectStore {
	os.MkdirAll(baseDir, 0755)
	return &ProjectStore{baseDir: baseDir}
}

func (ps *ProjectStore) projectDir(id string) string {
	return filepath.Join(ps.baseDir, id)
}

func (ps *ProjectStore) Create(name, objective string, budget int, config ExecutorConfig) (*Project, error) {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	now := time.Now()
	id := fmt.Sprintf("%s_%s", now.Format("20060102"), sanitizeFilename(name))

	dir := ps.projectDir(id)
	if _, err := os.Stat(dir); err == nil {
		return nil, fmt.Errorf("project directory already exists: %s", id)
	}

	for _, sub := range []string{"tasks", "context", "artifacts", "logs"} {
		os.MkdirAll(filepath.Join(dir, sub), 0755)
	}

	// Write empty context index
	os.WriteFile(filepath.Join(dir, "context", "_index.json"), []byte("[]"), 0644)

	p := &Project{
		ID:             id,
		Name:           name,
		Objective:      objective,
		Status:         ProjectRunning,
		Priority:       PriorityNormal,
		CreatedAt:      now,
		UpdatedAt:      now,
		BudgetMinutes:  budget,
		ExecutorConfig: config,
		Automation: AutomationConfig{
			AutoDispatchGA:     true,
			AutoDispatchClaude: true,
		},
	}

	data, _ := json.MarshalIndent(p, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "project.json"), data, 0644); err != nil {
		return nil, err
	}
	return p, nil
}

func (ps *ProjectStore) Load(id string) (*Project, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	data, err := os.ReadFile(filepath.Join(ps.projectDir(id), "project.json"))
	if err != nil {
		return nil, err
	}
	var p Project
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (ps *ProjectStore) List() ([]*Project, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	entries, err := os.ReadDir(ps.baseDir)
	if err != nil {
		return []*Project{}, nil
	}

	var projects []*Project
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(ps.baseDir, e.Name(), "project.json"))
		if err != nil {
			continue
		}
		var p Project
		if json.Unmarshal(data, &p) == nil {
			projects = append(projects, &p)
		}
	}

	sort.Slice(projects, func(i, j int) bool {
		return projects[i].UpdatedAt.After(projects[j].UpdatedAt)
	})
	return projects, nil
}

func (ps *ProjectStore) Update(p *Project) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	p.UpdatedAt = time.Now()
	data, _ := json.MarshalIndent(p, "", "  ")
	return os.WriteFile(filepath.Join(ps.projectDir(p.ID), "project.json"), data, 0644)
}

func (ps *ProjectStore) AddTask(projectID string, t *Task) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	filename := fmt.Sprintf("%s_%s_%s.json", t.ID, t.Type, sanitizeFilename(t.Title))
	data, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(filepath.Join(ps.projectDir(projectID), "tasks", filename), data, 0644)
}

func (ps *ProjectStore) UpdateTask(projectID, taskID string, t *Task) error {
	ps.mu.Lock()
	defer ps.mu.Unlock()

	// Find existing task file
	tasksDir := filepath.Join(ps.projectDir(projectID), "tasks")
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return err
	}

	for _, e := range entries {
		if strings.HasPrefix(e.Name(), taskID+"_") {
			data, _ := json.MarshalIndent(t, "", "  ")
			return os.WriteFile(filepath.Join(tasksDir, e.Name()), data, 0644)
		}
	}
	return fmt.Errorf("task %s not found in project %s", taskID, projectID)
}

func (ps *ProjectStore) GetTasks(projectID string) ([]*Task, error) {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	tasksDir := filepath.Join(ps.projectDir(projectID), "tasks")
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return []*Task{}, nil
	}

	var tasks []*Task
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(tasksDir, e.Name()))
		if err != nil {
			continue
		}
		var t Task
		if json.Unmarshal(data, &t) == nil {
			tasks = append(tasks, &t)
		}
	}

	// Sort by ID (which has numeric prefix)
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].ID < tasks[j].ID
	})
	return tasks, nil
}

func sanitizeFilename(s string) string {
	// Replace path-unsafe chars, keep CJK and alphanumeric
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	result := replacer.Replace(s)
	if len(result) > 60 {
		result = result[:60]
	}
	return result
}
```

- [ ] **Step 3: Write project_test.go**

```go
// backend/hive2/project_test.go
package hive2

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectCreateAndLoad(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	cfg := ExecutorConfig{GALlmNo: 2, GAWorkers: 2, ClaudeCodeEnabled: true}
	p, err := store.Create("支付系统接入", "调研并接入Stripe", 60, cfg)
	if err != nil {
		t.Fatalf("Create failed: %v", err)
	}

	if p.Name != "支付系统接入" {
		t.Errorf("Name = %q, want %q", p.Name, "支付系统接入")
	}
	if p.Status != ProjectRunning {
		t.Errorf("Status = %q, want %q", p.Status, ProjectRunning)
	}

	// Verify directory structure
	for _, sub := range []string{"tasks", "context", "artifacts", "logs"} {
		path := filepath.Join(dir, p.ID, sub)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			t.Errorf("subdirectory %s not created", sub)
		}
	}

	// Load it back
	loaded, err := store.Load(p.ID)
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if loaded.Objective != "调研并接入Stripe" {
		t.Errorf("Objective = %q, want %q", loaded.Objective, "调研并接入Stripe")
	}
}

func TestProjectList(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1, ClaudeCodeEnabled: false}
	store.Create("项目A", "目标A", 30, cfg)
	store.Create("项目B", "目标B", 60, cfg)

	list, err := store.List()
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(list) != 2 {
		t.Errorf("List returned %d projects, want 2", len(list))
	}
}

func TestTaskAddAndGet(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1, ClaudeCodeEnabled: true}
	p, _ := store.Create("测试项目", "测试", 30, cfg)

	task := &Task{
		ID:       "01",
		Type:     TaskResearch,
		Title:    "调研支付SDK",
		Status:   StatusPending,
		Executor: ExecutorGA,
	}
	if err := store.AddTask(p.ID, task); err != nil {
		t.Fatalf("AddTask failed: %v", err)
	}

	tasks, err := store.GetTasks(p.ID)
	if err != nil {
		t.Fatalf("GetTasks failed: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("GetTasks returned %d tasks, want 1", len(tasks))
	}
	if tasks[0].Title != "调研支付SDK" {
		t.Errorf("Title = %q, want %q", tasks[0].Title, "调研支付SDK")
	}
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./hive2/ -v`
Expected: All 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add backend/hive2/types.go backend/hive2/project.go backend/hive2/project_test.go
git commit -m "feat(hive2): add type definitions and project storage layer"
```

---

### Task 2: Task Engine — DAG Scheduler

**Files:**
- Create: `backend/hive2/taskengine.go`
- Create: `backend/hive2/taskengine_test.go`

**Interfaces:**
- Consumes: `ProjectStore` from Task 1, all types from `types.go`
- Produces:
  - `func NewTaskEngine(store *ProjectStore, eventBus *EventBus) *TaskEngine`
  - `func (te *TaskEngine) ResolvePending(projectID string) ([]*Task, error)` — find tasks whose deps are all done
  - `func (te *TaskEngine) ClaimTask(projectID, taskID, assignee string) error` — mark as running
  - `func (te *TaskEngine) CompleteTask(projectID, taskID, summary string, outputs TaskOutputs) error`
  - `func (te *TaskEngine) FailTask(projectID, taskID, errorMsg string) error`
  - `func (te *TaskEngine) CheckTimeouts(projectID string) error` — mark stalled tasks
  - `func (te *TaskEngine) GetNextTask(projectID string, executor ExecutorType) (*Task, error)` — get highest priority pending task for executor type
  - `func (te *TaskEngine) AddTasks(projectID string, tasks []*Task) error` — bulk add tasks (from template or decomposition)

- [ ] **Step 1: Write taskengine.go**

```go
// backend/hive2/taskengine.go
package hive2

import (
	"fmt"
	"time"
)

type TaskEngine struct {
	store    *ProjectStore
	eventBus *EventBus
}

func NewTaskEngine(store *ProjectStore, eventBus *EventBus) *TaskEngine {
	return &TaskEngine{store: store, eventBus: eventBus}
}

// ResolvePending finds tasks whose dependencies are all done
func (te *TaskEngine) ResolvePending(projectID string) ([]*Task, error) {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return nil, err
	}

	doneSet := make(map[string]bool)
	for _, t := range tasks {
		if t.Status == StatusDone {
			doneSet[t.ID] = true
		}
	}

	var ready []*Task
	for _, t := range tasks {
		if t.Status != StatusBlocked {
			continue
		}
		allDone := true
		for _, dep := range t.DependsOn {
			if !doneSet[dep] {
				allDone = false
				break
			}
		}
		if allDone {
			t.Status = StatusPending
			te.store.UpdateTask(projectID, t.ID, t)
			ready = append(ready, t)
		}
	}
	return ready, nil
}

// GetNextTask returns the highest priority pending task for an executor type
func (te *TaskEngine) GetNextTask(projectID string, executor ExecutorType) (*Task, error) {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return nil, err
	}

	for _, t := range tasks {
		if t.Status == StatusPending && t.Executor == executor {
			return t, nil
		}
	}
	return nil, nil
}

// ClaimTask marks a task as running
func (te *TaskEngine) ClaimTask(projectID, taskID, assignee string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	for _, t := range tasks {
		if t.ID == taskID {
			if t.Status != StatusPending {
				return fmt.Errorf("task %s is not pending (status: %s)", taskID, t.Status)
			}
			now := time.Now()
			t.Status = StatusRunning
			t.AssignedTo = assignee
			t.StartedAt = &now
			te.store.UpdateTask(projectID, taskID, t)
			te.eventBus.Publish(Event{Type: "task.claimed", ProjectID: projectID, TaskID: taskID})
			return nil
		}
	}
	return fmt.Errorf("task %s not found", taskID)
}

// CompleteTask marks a task as done and triggers downstream resolution
func (te *TaskEngine) CompleteTask(projectID, taskID, summary string, outputs TaskOutputs) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	for _, t := range tasks {
		if t.ID == taskID {
			now := time.Now()
			t.Status = StatusDone
			t.FinishedAt = &now
			t.Outputs = outputs
			te.store.UpdateTask(projectID, taskID, t)

			te.eventBus.Publish(Event{Type: "task.completed", ProjectID: projectID, TaskID: taskID})

			// Resolve newly unblocked tasks
			te.ResolvePending(projectID)

			// Check if project is complete
			te.checkProjectCompletion(projectID)
			return nil
		}
	}
	return fmt.Errorf("task %s not found", taskID)
}

// FailTask marks a task as failed
func (te *TaskEngine) FailTask(projectID, taskID, errorMsg string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	for _, t := range tasks {
		if t.ID == taskID {
			now := time.Now()
			t.Status = StatusFailed
			t.FinishedAt = &now
			t.Error = errorMsg
			te.store.UpdateTask(projectID, taskID, t)
			te.eventBus.Publish(Event{Type: "task.failed", ProjectID: projectID, TaskID: taskID})
			return nil
		}
	}
	return fmt.Errorf("task %s not found", taskID)
}

// CheckTimeouts marks running tasks that exceeded budget as stalled
func (te *TaskEngine) CheckTimeouts(projectID string) error {
	tasks, err := te.store.GetTasks(projectID)
	if err != nil {
		return err
	}

	now := time.Now()
	for _, t := range tasks {
		if t.Status == StatusRunning && t.BudgetMinutes > 0 && t.StartedAt != nil {
			elapsed := now.Sub(*t.StartedAt)
			if elapsed > time.Duration(t.BudgetMinutes)*time.Minute {
				t.Status = StatusStalled
				te.store.UpdateTask(projectID, t.ID, t)
				te.eventBus.Publish(Event{Type: "task.stalled", ProjectID: projectID, TaskID: t.ID})
			}
		}
	}
	return nil
}

// AddTasks bulk-adds tasks to a project (from template or decomposition)
func (te *TaskEngine) AddTasks(projectID string, tasks []*Task) error {
	for _, t := range tasks {
		// Set initial status based on dependencies
		if len(t.DependsOn) == 0 {
			t.Status = StatusPending
		} else {
			t.Status = StatusBlocked
		}
		if err := te.store.AddTask(projectID, t); err != nil {
			return err
		}
	}
	// Resolve any that are already unblocked
	te.ResolvePending(projectID)

	// Update project task count
	te.updateTaskCount(projectID)
	return nil
}

func (te *TaskEngine) checkProjectCompletion(projectID string) {
	tasks, _ := te.store.GetTasks(projectID)
	allDone := true
	for _, t := range tasks {
		if t.Status != StatusDone && t.Status != StatusFailed {
			allDone = false
			break
		}
	}
	if allDone && len(tasks) > 0 {
		p, _ := te.store.Load(projectID)
		if p != nil {
			p.Status = ProjectCompleted
			te.store.Update(p)
			te.eventBus.Publish(Event{Type: "project.completed", ProjectID: projectID})
		}
	}
}

func (te *TaskEngine) updateTaskCount(projectID string) {
	tasks, _ := te.store.GetTasks(projectID)
	p, _ := te.store.Load(projectID)
	if p == nil {
		return
	}
	p.TaskCount = TaskCount{Total: len(tasks)}
	for _, t := range tasks {
		switch t.Status {
		case StatusDone:
			p.TaskCount.Done++
		case StatusRunning:
			p.TaskCount.Running++
		case StatusPending:
			p.TaskCount.Pending++
		case StatusFailed:
			p.TaskCount.Failed++
		}
	}
	te.store.Update(p)
}
```

- [ ] **Step 2: Write taskengine_test.go**

```go
// backend/hive2/taskengine_test.go
package hive2

import (
	"testing"
)

func setupEngine(t *testing.T) (*TaskEngine, *ProjectStore, string) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1, ClaudeCodeEnabled: true}
	p, err := store.Create("测试", "测试目标", 60, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return engine, store, p.ID
}

func TestResolvePending(t *testing.T) {
	engine, _, projID := setupEngine(t)

	tasks := []*Task{
		{ID: "01", Type: TaskResearch, Title: "调研", Executor: ExecutorGA},
		{ID: "02", Type: TaskDesign, Title: "设计", Executor: ExecutorGA, DependsOn: []string{"01"}},
		{ID: "03", Type: TaskImplement, Title: "实现", Executor: ExecutorClaude, DependsOn: []string{"02"}},
	}
	engine.AddTasks(projID, tasks)

	// Only task 01 should be pending (no deps)
	next, _ := engine.GetNextTask(projID, ExecutorGA)
	if next == nil || next.ID != "01" {
		t.Fatalf("expected task 01, got %v", next)
	}

	// Complete task 01 -> task 02 should become pending
	engine.ClaimTask(projID, "01", "Worker-Alpha")
	engine.CompleteTask(projID, "01", "done", TaskOutputs{})

	next, _ = engine.GetNextTask(projID, ExecutorGA)
	if next == nil || next.ID != "02" {
		t.Fatalf("expected task 02 after resolving, got %v", next)
	}
}

func TestClaimTaskNotPending(t *testing.T) {
	engine, _, projID := setupEngine(t)

	tasks := []*Task{
		{ID: "01", Type: TaskResearch, Title: "调研", Executor: ExecutorGA},
	}
	engine.AddTasks(projID, tasks)
	engine.ClaimTask(projID, "01", "Worker-Alpha")

	// Try to claim again — should fail
	err := engine.ClaimTask(projID, "01", "Worker-Beta")
	if err == nil {
		t.Error("expected error claiming already-running task")
	}
}

func TestProjectCompletion(t *testing.T) {
	engine, store, projID := setupEngine(t)

	tasks := []*Task{
		{ID: "01", Type: TaskResearch, Title: "唯一任务", Executor: ExecutorGA},
	}
	engine.AddTasks(projID, tasks)
	engine.ClaimTask(projID, "01", "Worker")
	engine.CompleteTask(projID, "01", "搞定", TaskOutputs{})

	p, _ := store.Load(projID)
	if p.Status != ProjectCompleted {
		t.Errorf("project status = %s, want completed", p.Status)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestResolve\|TestClaim\|TestProject`
Expected: All 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/hive2/taskengine.go backend/hive2/taskengine_test.go
git commit -m "feat(hive2): add Task Engine with DAG scheduling"
```

---

### Task 3: Event Bus & Context Store

**Files:**
- Create: `backend/hive2/events.go`
- Create: `backend/hive2/contextstore.go`
- Create: `backend/hive2/contextstore_test.go`

**Interfaces:**
- Consumes: `ProjectStore` from Task 1
- Produces:
  - `func NewEventBus() *EventBus`
  - `func (eb *EventBus) Publish(event Event)`
  - `func (eb *EventBus) Subscribe(eventType string, handler func(Event))`
  - `type Event struct { Type, ProjectID, TaskID string; Data map[string]interface{} }`
  - `func NewContextStore(store *ProjectStore) *ContextStore`
  - `func (cs *ContextStore) Write(projectID, key, contentType, content string, sourceTask string, tags []string) error`
  - `func (cs *ContextStore) Read(projectID, key string) (string, error)` — returns full markdown content
  - `func (cs *ContextStore) List(projectID string) ([]ContextEntry, error)`
  - `func (cs *ContextStore) Search(projectID string, tags []string) ([]ContextEntry, error)`

- [ ] **Step 1: Create events.go with pub/sub EventBus**

```go
// backend/hive2/events.go
package hive2

import "sync"

type Event struct {
	Type      string                 `json:"type"`
	ProjectID string                 `json:"project_id"`
	TaskID    string                 `json:"task_id,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type EventHandler func(Event)

type EventBus struct {
	mu       sync.RWMutex
	handlers map[string][]EventHandler
}

func NewEventBus() *EventBus {
	return &EventBus{handlers: make(map[string][]EventHandler)}
}

func (eb *EventBus) Subscribe(eventType string, handler EventHandler) {
	eb.mu.Lock()
	defer eb.mu.Unlock()
	eb.handlers[eventType] = append(eb.handlers[eventType], handler)
}

func (eb *EventBus) Publish(event Event) {
	eb.mu.RLock()
	defer eb.mu.RUnlock()

	// Notify exact match subscribers
	for _, h := range eb.handlers[event.Type] {
		go h(event)
	}
	// Notify wildcard subscribers
	for _, h := range eb.handlers["*"] {
		go h(event)
	}
}
```

- [ ] **Step 2: Create contextstore.go**

```go
// backend/hive2/contextstore.go
package hive2

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ContextStore struct {
	store *ProjectStore
}

func NewContextStore(store *ProjectStore) *ContextStore {
	return &ContextStore{store: store}
}

// Write stores a context entry as a markdown file with YAML frontmatter
func (cs *ContextStore) Write(projectID, key, contentType, content, sourceTask string, tags []string) error {
	cs.store.mu.Lock()
	defer cs.store.mu.Unlock()

	contextDir := filepath.Join(cs.store.projectDir(projectID), "context")
	filename := sanitizeFilename(key) + ".md"

	// Build markdown with YAML frontmatter
	var sb strings.Builder
	sb.WriteString("---\n")
	sb.WriteString(fmt.Sprintf("key: %s\n", key))
	sb.WriteString(fmt.Sprintf("type: %s\n", contentType))
	sb.WriteString(fmt.Sprintf("source_task: %s\n", sourceTask))
	sb.WriteString(fmt.Sprintf("tags: [%s]\n", strings.Join(tags, ", ")))
	sb.WriteString(fmt.Sprintf("created_at: %s\n", time.Now().Format(time.RFC3339)))
	sb.WriteString("---\n\n")
	sb.WriteString(content)

	if err := os.WriteFile(filepath.Join(contextDir, filename), []byte(sb.String()), 0644); err != nil {
		return err
	}

	// Update _index.json
	return cs.updateIndex(projectID, ContextEntry{
		Key:        key,
		File:       filename,
		Type:       contentType,
		SourceTask: sourceTask,
		Tags:       tags,
		CreatedAt:  time.Now(),
	})
}

// Read returns the full markdown content of a context entry
func (cs *ContextStore) Read(projectID, key string) (string, error) {
	cs.store.mu.RLock()
	defer cs.store.mu.RUnlock()

	entries, err := cs.loadIndex(projectID)
	if err != nil {
		return "", err
	}

	for _, e := range entries {
		if e.Key == key {
			contextDir := filepath.Join(cs.store.projectDir(projectID), "context")
			data, err := os.ReadFile(filepath.Join(contextDir, e.File))
			if err != nil {
				return "", err
			}
			return string(data), nil
		}
	}
	return "", fmt.Errorf("context key %q not found", key)
}

// List returns all context entries from _index.json
func (cs *ContextStore) List(projectID string) ([]ContextEntry, error) {
	cs.store.mu.RLock()
	defer cs.store.mu.RUnlock()
	return cs.loadIndex(projectID)
}

// Search returns context entries matching any of the given tags
func (cs *ContextStore) Search(projectID string, tags []string) ([]ContextEntry, error) {
	cs.store.mu.RLock()
	defer cs.store.mu.RUnlock()

	entries, err := cs.loadIndex(projectID)
	if err != nil {
		return nil, err
	}

	tagSet := make(map[string]bool)
	for _, t := range tags {
		tagSet[t] = true
	}

	var results []ContextEntry
	for _, e := range entries {
		for _, et := range e.Tags {
			if tagSet[et] {
				results = append(results, e)
				break
			}
		}
	}
	return results, nil
}

func (cs *ContextStore) loadIndex(projectID string) ([]ContextEntry, error) {
	indexPath := filepath.Join(cs.store.projectDir(projectID), "context", "_index.json")
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return []ContextEntry{}, nil
	}
	var entries []ContextEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return []ContextEntry{}, nil
	}
	return entries, nil
}

func (cs *ContextStore) updateIndex(projectID string, entry ContextEntry) error {
	indexPath := filepath.Join(cs.store.projectDir(projectID), "context", "_index.json")
	entries, _ := cs.loadIndex(projectID)

	// Replace existing or append
	found := false
	for i, e := range entries {
		if e.Key == entry.Key {
			entries[i] = entry
			found = true
			break
		}
	}
	if !found {
		entries = append(entries, entry)
	}

	data, _ := json.MarshalIndent(entries, "", "  ")
	return os.WriteFile(indexPath, data, 0644)
}
```

- [ ] **Step 3: Write contextstore_test.go**

```go
// backend/hive2/contextstore_test.go
package hive2

import (
	"strings"
	"testing"
)

func TestContextWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cs := NewContextStore(store)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("ctx测试", "测试上下文", 30, cfg)

	err := cs.Write(p.ID, "stripe-api-research", "finding",
		"# Stripe API Research\n\nStripe supports PaymentIntents for async flows.",
		"01", []string{"payment", "api"})
	if err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	content, err := cs.Read(p.ID, "stripe-api-research")
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if !strings.Contains(content, "PaymentIntents") {
		t.Error("content does not contain expected text")
	}
	if !strings.Contains(content, "type: finding") {
		t.Error("frontmatter missing type field")
	}
}

func TestContextListAndSearch(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	cs := NewContextStore(store)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("search测试", "测试搜索", 30, cfg)

	cs.Write(p.ID, "finding-1", "finding", "Finding 1 content", "01", []string{"api", "auth"})
	cs.Write(p.ID, "decision-1", "decision", "Decision 1 content", "02", []string{"arch", "auth"})
	cs.Write(p.ID, "finding-2", "finding", "Finding 2 content", "01", []string{"api", "perf"})

	// List all
	entries, err := cs.List(p.ID)
	if err != nil {
		t.Fatalf("List failed: %v", err)
	}
	if len(entries) != 3 {
		t.Errorf("List returned %d entries, want 3", len(entries))
	}

	// Search by tag
	results, err := cs.Search(p.ID, []string{"auth"})
	if err != nil {
		t.Fatalf("Search failed: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("Search returned %d results, want 2", len(results))
	}

	// Search non-matching tag
	results, _ = cs.Search(p.ID, []string{"nonexistent"})
	if len(results) != 0 {
		t.Errorf("Search returned %d results for nonexistent tag, want 0", len(results))
	}
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestContext`
Expected: Both TestContextWriteAndRead and TestContextListAndSearch pass

- [ ] **Step 5: Commit**

```bash
git add backend/hive2/events.go backend/hive2/contextstore.go backend/hive2/contextstore_test.go
git commit -m "feat(hive2): add Event Bus and Context Store"
```

---

### Task 4: File Tracker

**Files:**
- Create: `backend/hive2/filetracker.go`
- Create: `backend/hive2/filetracker_test.go`

**Interfaces:**
- Consumes: `ProjectStore` from Task 1, `EventBus` from Task 3
- Produces:
  - `func NewFileTracker(store *ProjectStore, eventBus *EventBus) *FileTracker`
  - `func (ft *FileTracker) Start(projectID string) error` — begin watching artifacts/ dir
  - `func (ft *FileTracker) Stop(projectID string)`
  - `func (ft *FileTracker) GetChanges(projectID string) ([]FileChange, error)`
  - `func (ft *FileTracker) SetActiveTask(projectID, taskID string)` — attribute subsequent changes to this task

- [ ] **Step 1: Create filetracker.go with fsnotify watcher**

```go
// backend/hive2/filetracker.go
package hive2

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

type FileTracker struct {
	store      *ProjectStore
	eventBus   *EventBus
	mu         sync.RWMutex
	watchers   map[string]*fsnotify.Watcher
	activeTasks map[string]string // projectID -> current taskID
}

func NewFileTracker(store *ProjectStore, eventBus *EventBus) *FileTracker {
	return &FileTracker{
		store:       store,
		eventBus:    eventBus,
		watchers:    make(map[string]*fsnotify.Watcher),
		activeTasks: make(map[string]string),
	}
}

func (ft *FileTracker) SetActiveTask(projectID, taskID string) {
	ft.mu.Lock()
	defer ft.mu.Unlock()
	ft.activeTasks[projectID] = taskID
}

func (ft *FileTracker) Start(projectID string) error {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	artifactsDir := filepath.Join(ft.store.projectDir(projectID), "artifacts")
	os.MkdirAll(artifactsDir, 0755)

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}

	if err := watcher.Add(artifactsDir); err != nil {
		watcher.Close()
		return err
	}

	ft.watchers[projectID] = watcher

	go ft.watchLoop(projectID, watcher, artifactsDir)
	return nil
}

func (ft *FileTracker) Stop(projectID string) {
	ft.mu.Lock()
	defer ft.mu.Unlock()

	if w, ok := ft.watchers[projectID]; ok {
		w.Close()
		delete(ft.watchers, projectID)
	}
}

func (ft *FileTracker) GetChanges(projectID string) ([]FileChange, error) {
	changesFile := filepath.Join(ft.store.projectDir(projectID), "artifacts", "_changes.json")
	data, err := os.ReadFile(changesFile)
	if err != nil {
		return []FileChange{}, nil
	}
	var changes []FileChange
	json.Unmarshal(data, &changes)
	return changes, nil
}

func (ft *FileTracker) watchLoop(projectID string, watcher *fsnotify.Watcher, artifactsDir string) {
	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			if filepath.Base(event.Name) == "_changes.json" {
				continue
			}

			var action string
			switch {
			case event.Op&fsnotify.Create != 0:
				action = "created"
			case event.Op&fsnotify.Write != 0:
				action = "modified"
			case event.Op&fsnotify.Remove != 0:
				action = "deleted"
			default:
				continue
			}

			ft.mu.RLock()
			taskID := ft.activeTasks[projectID]
			ft.mu.RUnlock()

			relPath, _ := filepath.Rel(artifactsDir, event.Name)
			var sizeBytes int64
			if info, err := os.Stat(event.Name); err == nil {
				sizeBytes = info.Size()
			}

			change := FileChange{
				File:      relPath,
				Action:    action,
				TaskID:    taskID,
				Timestamp: time.Now(),
				SizeBytes: sizeBytes,
			}

			ft.recordChange(projectID, change)
			ft.eventBus.Publish(Event{
				Type:      "file.changed",
				ProjectID: projectID,
				TaskID:    taskID,
				Data:      map[string]interface{}{"file": relPath, "action": action},
			})

		case _, ok := <-watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

func (ft *FileTracker) recordChange(projectID string, change FileChange) {
	changesFile := filepath.Join(ft.store.projectDir(projectID), "artifacts", "_changes.json")

	var changes []FileChange
	if data, err := os.ReadFile(changesFile); err == nil {
		json.Unmarshal(data, &changes)
	}

	changes = append(changes, change)
	data, _ := json.MarshalIndent(changes, "", "  ")
	os.WriteFile(changesFile, data, 0644)
}
```

- [ ] **Step 2: Write filetracker_test.go**

```go
// backend/hive2/filetracker_test.go
package hive2

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFileTrackerRecordsChanges(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	tracker := NewFileTracker(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("tracker测试", "测试文件追踪", 30, cfg)

	// Start tracking
	if err := tracker.Start(p.ID); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	defer tracker.Stop(p.ID)

	// Set active task
	tracker.SetActiveTask(p.ID, "01")

	// Create a file in artifacts/
	artifactsDir := filepath.Join(dir, p.ID, "artifacts")
	testFile := filepath.Join(artifactsDir, "output.md")
	os.WriteFile(testFile, []byte("# Result\nHello"), 0644)

	// Wait for fsnotify to pick it up
	time.Sleep(200 * time.Millisecond)

	changes, err := tracker.GetChanges(p.ID)
	if err != nil {
		t.Fatalf("GetChanges failed: %v", err)
	}
	if len(changes) == 0 {
		t.Fatal("expected at least one change, got none")
	}

	found := false
	for _, c := range changes {
		if c.File == "output.md" && c.TaskID == "01" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected change for output.md with taskID 01, got: %+v", changes)
	}
}

func TestFileTrackerStopCleansUp(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	tracker := NewFileTracker(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("stop测试", "测试停止", 30, cfg)

	tracker.Start(p.ID)
	tracker.Stop(p.ID)

	// Verify watcher is removed
	if _, ok := tracker.watchers[p.ID]; ok {
		t.Error("watcher not cleaned up after Stop")
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestFileTracker`
Expected: Both tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/hive2/filetracker.go backend/hive2/filetracker_test.go
git commit -m "feat(hive2): add File Tracker with fsnotify watching"
```

---

### Task 5: Template Library

**Files:**
- Create: `backend/hive2/templates.go`
- Create: `backend/hive2/templates_test.go`

**Interfaces:**
- Consumes: `Task` type from Task 1
- Produces:
  - `func NewTemplateLibrary(templateDir string) *TemplateLibrary`
  - `func (tl *TemplateLibrary) List() []Template`
  - `func (tl *TemplateLibrary) Get(name string) (*Template, error)`
  - `func (tl *TemplateLibrary) Instantiate(name string, vars map[string]string) ([]*Task, error)` — variable substitution, for_each expansion, glob deps

- [ ] **Step 1: Create templates.go with built-in templates and YAML parsing**

```go
// backend/hive2/templates.go
package hive2

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type TemplateTask struct {
	ID        string   `yaml:"id"`
	Type      string   `yaml:"type"`
	Title     string   `yaml:"title"`
	Executor  string   `yaml:"executor"`
	DependsOn []string `yaml:"depends_on,omitempty"`
	Budget    int      `yaml:"budget_minutes,omitempty"`
	ForEach   string   `yaml:"for_each,omitempty"` // variable to expand over
}

type TemplateDefinition struct {
	Name        string            `yaml:"name"`
	Description string            `yaml:"description"`
	Variables   map[string]string `yaml:"variables"` // var name -> description
	Tasks       []TemplateTask    `yaml:"tasks"`
}

type TemplateLibrary struct {
	templateDir string
	builtins    map[string]TemplateDefinition
}

// Built-in templates as embedded YAML
var builtinTemplates = map[string]string{
	"research-implement": `
name: research-implement
description: "Research a topic, design a solution, implement and verify"
variables:
  topic: "What to research"
  target: "Implementation target"
tasks:
  - id: "01"
    type: research
    title: "Research {{topic}}"
    executor: ga
    budget_minutes: 15
  - id: "02"
    type: design
    title: "Design solution for {{target}}"
    executor: ga
    depends_on: ["01"]
    budget_minutes: 10
  - id: "03"
    type: implement
    title: "Implement {{target}}"
    executor: claude_code
    depends_on: ["02"]
    budget_minutes: 30
  - id: "04"
    type: verify
    title: "Verify {{target}} implementation"
    executor: claude_code
    depends_on: ["03"]
    budget_minutes: 10
`,
	"multi-research": `
name: multi-research
description: "Research multiple topics then synthesize findings"
variables:
  topics: "Comma-separated list of research topics"
  objective: "Final synthesis objective"
tasks:
  - id: "01"
    type: research
    title: "Research {{item}}"
    executor: ga
    for_each: topics
    budget_minutes: 15
  - id: "02"
    type: design
    title: "Synthesize findings for {{objective}}"
    executor: ga
    depends_on: ["01*"]
    budget_minutes: 15
`,
	"api-integration": `
name: api-integration
description: "Research an API, design integration, implement and test"
variables:
  api_name: "Name of the API to integrate"
  feature: "Feature being built"
tasks:
  - id: "01"
    type: research
    title: "Research {{api_name}} documentation"
    executor: ga
    budget_minutes: 15
  - id: "02"
    type: research
    title: "Find {{api_name}} integration examples"
    executor: ga
    budget_minutes: 10
  - id: "03"
    type: design
    title: "Design {{feature}} architecture"
    executor: ga
    depends_on: ["01", "02"]
    budget_minutes: 10
  - id: "04"
    type: implement
    title: "Implement {{feature}} with {{api_name}}"
    executor: claude_code
    depends_on: ["03"]
    budget_minutes: 30
  - id: "05"
    type: implement
    title: "Write tests for {{feature}}"
    executor: claude_code
    depends_on: ["04"]
    budget_minutes: 15
  - id: "06"
    type: verify
    title: "Integration test {{feature}}"
    executor: claude_code
    depends_on: ["05"]
    budget_minutes: 10
`,
	"bug-investigation": `
name: bug-investigation
description: "Investigate a bug, identify root cause, fix and verify"
variables:
  bug_description: "Description of the bug"
  component: "Affected component"
tasks:
  - id: "01"
    type: research
    title: "Investigate: {{bug_description}}"
    executor: ga
    budget_minutes: 15
  - id: "02"
    type: design
    title: "Identify root cause in {{component}}"
    executor: ga
    depends_on: ["01"]
    budget_minutes: 10
  - id: "03"
    type: implement
    title: "Fix {{bug_description}}"
    executor: claude_code
    depends_on: ["02"]
    budget_minutes: 20
  - id: "04"
    type: verify
    title: "Verify fix and add regression test"
    executor: claude_code
    depends_on: ["03"]
    budget_minutes: 10
`,
	"documentation": `
name: documentation
description: "Research existing code, design doc structure, write documentation"
variables:
  subject: "What to document"
  audience: "Target audience"
tasks:
  - id: "01"
    type: research
    title: "Analyze {{subject}} codebase"
    executor: ga
    budget_minutes: 15
  - id: "02"
    type: design
    title: "Design doc structure for {{audience}}"
    executor: ga
    depends_on: ["01"]
    budget_minutes: 10
  - id: "03"
    type: implement
    title: "Write {{subject}} documentation"
    executor: claude_code
    depends_on: ["02"]
    budget_minutes: 20
`,
	"refactor": `
name: refactor
description: "Analyze code, design refactoring plan, implement incrementally, verify"
variables:
  target: "Code to refactor"
  goal: "Refactoring objective"
tasks:
  - id: "01"
    type: research
    title: "Analyze current {{target}} structure"
    executor: ga
    budget_minutes: 10
  - id: "02"
    type: design
    title: "Plan refactoring for {{goal}}"
    executor: ga
    depends_on: ["01"]
    budget_minutes: 10
  - id: "03"
    type: implement
    title: "Refactor {{target}} step 1: extract"
    executor: claude_code
    depends_on: ["02"]
    budget_minutes: 20
  - id: "04"
    type: verify
    title: "Run tests after refactoring"
    executor: claude_code
    depends_on: ["03"]
    budget_minutes: 10
  - id: "05"
    type: implement
    title: "Refactor {{target}} step 2: restructure"
    executor: claude_code
    depends_on: ["04"]
    budget_minutes: 20
  - id: "06"
    type: verify
    title: "Final verification of {{goal}}"
    executor: claude_code
    depends_on: ["05"]
    budget_minutes: 10
`,
}

func NewTemplateLibrary(templateDir string) *TemplateLibrary {
	tl := &TemplateLibrary{
		templateDir: templateDir,
		builtins:    make(map[string]TemplateDefinition),
	}

	// Parse built-in templates
	for name, yamlStr := range builtinTemplates {
		var def TemplateDefinition
		if yaml.Unmarshal([]byte(yamlStr), &def) == nil {
			tl.builtins[name] = def
		}
	}

	return tl
}

func (tl *TemplateLibrary) List() []Template {
	var templates []Template

	// Add built-ins
	for _, def := range tl.builtins {
		templates = append(templates, Template{
			Name:        def.Name,
			Description: def.Description,
			Builtin:     true,
		})
	}

	// Add user templates from templateDir
	if tl.templateDir != "" {
		entries, _ := os.ReadDir(tl.templateDir)
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".yaml") && !strings.HasSuffix(e.Name(), ".yml") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(tl.templateDir, e.Name()))
			if err != nil {
				continue
			}
			var def TemplateDefinition
			if yaml.Unmarshal(data, &def) == nil {
				templates = append(templates, Template{
					Name:        def.Name,
					Description: def.Description,
					Builtin:     false,
				})
			}
		}
	}

	return templates
}

func (tl *TemplateLibrary) Get(name string) (*TemplateDefinition, error) {
	if def, ok := tl.builtins[name]; ok {
		return &def, nil
	}

	// Try user templates
	if tl.templateDir != "" {
		for _, ext := range []string{".yaml", ".yml"} {
			data, err := os.ReadFile(filepath.Join(tl.templateDir, name+ext))
			if err == nil {
				var def TemplateDefinition
				if yaml.Unmarshal(data, &def) == nil {
					return &def, nil
				}
			}
		}
	}

	return nil, fmt.Errorf("template %q not found", name)
}

// Instantiate creates tasks from a template with variable substitution and for_each expansion
func (tl *TemplateLibrary) Instantiate(name string, vars map[string]string) ([]*Task, error) {
	def, err := tl.Get(name)
	if err != nil {
		return nil, err
	}

	var tasks []*Task
	expandedIDs := make(map[string][]string) // original ID -> expanded IDs

	for _, tmplTask := range def.Tasks {
		if tmplTask.ForEach != "" {
			// for_each expansion: split variable value by comma
			items := strings.Split(vars[tmplTask.ForEach], ",")
			var ids []string
			for i, item := range items {
				item = strings.TrimSpace(item)
				taskVars := copyMap(vars)
				taskVars["item"] = item

				expandedID := fmt.Sprintf("%s_%d", tmplTask.ID, i+1)
				ids = append(ids, expandedID)

				t := &Task{
					ID:            expandedID,
					Type:          TaskType(tmplTask.Type),
					Title:         substituteVars(tmplTask.Title, taskVars),
					Executor:      ExecutorType(tmplTask.Executor),
					DependsOn:     resolveDeps(tmplTask.DependsOn, expandedIDs),
					BudgetMinutes: tmplTask.Budget,
				}
				tasks = append(tasks, t)
			}
			expandedIDs[tmplTask.ID] = ids
		} else {
			t := &Task{
				ID:            tmplTask.ID,
				Type:          TaskType(tmplTask.Type),
				Title:         substituteVars(tmplTask.Title, vars),
				Executor:      ExecutorType(tmplTask.Executor),
				DependsOn:     resolveDeps(tmplTask.DependsOn, expandedIDs),
				BudgetMinutes: tmplTask.Budget,
			}
			tasks = append(tasks, t)
			expandedIDs[tmplTask.ID] = []string{tmplTask.ID}
		}
	}

	return tasks, nil
}

func substituteVars(s string, vars map[string]string) string {
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{{"+k+"}}", v)
	}
	return s
}

// resolveDeps handles glob deps like "01*" which expand to all IDs from for_each
func resolveDeps(deps []string, expandedIDs map[string][]string) []string {
	var resolved []string
	for _, dep := range deps {
		if strings.HasSuffix(dep, "*") {
			base := strings.TrimSuffix(dep, "*")
			if ids, ok := expandedIDs[base]; ok {
				resolved = append(resolved, ids...)
			}
		} else {
			if ids, ok := expandedIDs[dep]; ok {
				resolved = append(resolved, ids...)
			} else {
				resolved = append(resolved, dep)
			}
		}
	}
	return resolved
}

func copyMap(m map[string]string) map[string]string {
	cp := make(map[string]string, len(m))
	for k, v := range m {
		cp[k] = v
	}
	return cp
}

// Template is the public-facing template info (for List API)
type Template struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Builtin     bool   `json:"builtin"`
}
```

- [ ] **Step 2: Write templates_test.go**

```go
// backend/hive2/templates_test.go
package hive2

import (
	"testing"
)

func TestTemplateList(t *testing.T) {
	tl := NewTemplateLibrary("")
	templates := tl.List()
	if len(templates) != 6 {
		t.Errorf("expected 6 built-in templates, got %d", len(templates))
	}
}

func TestTemplateInstantiateSimple(t *testing.T) {
	tl := NewTemplateLibrary("")
	tasks, err := tl.Instantiate("research-implement", map[string]string{
		"topic":  "Stripe API",
		"target": "payment module",
	})
	if err != nil {
		t.Fatalf("Instantiate failed: %v", err)
	}
	if len(tasks) != 4 {
		t.Fatalf("expected 4 tasks, got %d", len(tasks))
	}
	if tasks[0].Title != "Research Stripe API" {
		t.Errorf("task 0 title = %q, want %q", tasks[0].Title, "Research Stripe API")
	}
	if tasks[2].Executor != ExecutorClaude {
		t.Errorf("task 2 executor = %q, want %q", tasks[2].Executor, ExecutorClaude)
	}
}

func TestTemplateInstantiateForEach(t *testing.T) {
	tl := NewTemplateLibrary("")
	tasks, err := tl.Instantiate("multi-research", map[string]string{
		"topics":    "Redis, PostgreSQL, MongoDB",
		"objective": "database selection",
	})
	if err != nil {
		t.Fatalf("Instantiate failed: %v", err)
	}

	// 3 research tasks (for_each) + 1 synthesize task = 4
	if len(tasks) != 4 {
		t.Fatalf("expected 4 tasks, got %d", len(tasks))
	}

	// Verify for_each expansion
	if tasks[0].Title != "Research Redis" {
		t.Errorf("task 0 title = %q, want %q", tasks[0].Title, "Research Redis")
	}
	if tasks[1].Title != "Research PostgreSQL" {
		t.Errorf("task 1 title = %q, want %q", tasks[1].Title, "Research PostgreSQL")
	}

	// Verify glob dep resolution: synthesize depends on all research tasks
	synthTask := tasks[3]
	if len(synthTask.DependsOn) != 3 {
		t.Errorf("synthesize task has %d deps, want 3", len(synthTask.DependsOn))
	}
}

func TestTemplateNotFound(t *testing.T) {
	tl := NewTemplateLibrary("")
	_, err := tl.Instantiate("nonexistent", nil)
	if err == nil {
		t.Error("expected error for nonexistent template")
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestTemplate`
Expected: All 4 tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/hive2/templates.go backend/hive2/templates_test.go
git commit -m "feat(hive2): add Template Library with 6 built-in templates"
```

---

### Task 6: Webhook System

**Files:**
- Create: `backend/hive2/webhooks.go`
- Create: `backend/hive2/webhooks_test.go`

**Interfaces:**
- Consumes: `EventBus` from Task 3, `WebhookConfig` from Task 1
- Produces:
  - `func NewWebhookDispatcher(eventBus *EventBus) *WebhookDispatcher`
  - `func (wd *WebhookDispatcher) Register(projectID string, configs []WebhookConfig)`
  - `func (wd *WebhookDispatcher) Unregister(projectID string)`

- [ ] **Step 1: Create webhooks.go with HTTP dispatch and retry**

```go
// backend/hive2/webhooks.go
package hive2

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type WebhookDispatcher struct {
	eventBus *EventBus
	mu       sync.RWMutex
	configs  map[string][]WebhookConfig // projectID -> configs
	client   *http.Client
}

func NewWebhookDispatcher(eventBus *EventBus) *WebhookDispatcher {
	wd := &WebhookDispatcher{
		eventBus: eventBus,
		configs:  make(map[string][]WebhookConfig),
		client:   &http.Client{Timeout: 10 * time.Second},
	}

	// Subscribe to all events
	eventBus.Subscribe("*", wd.handleEvent)
	return wd
}

func (wd *WebhookDispatcher) Register(projectID string, configs []WebhookConfig) {
	wd.mu.Lock()
	defer wd.mu.Unlock()
	wd.configs[projectID] = configs
}

func (wd *WebhookDispatcher) Unregister(projectID string) {
	wd.mu.Lock()
	defer wd.mu.Unlock()
	delete(wd.configs, projectID)
}

func (wd *WebhookDispatcher) handleEvent(event Event) {
	wd.mu.RLock()
	configs, ok := wd.configs[event.ProjectID]
	wd.mu.RUnlock()

	if !ok {
		return
	}

	for _, cfg := range configs {
		if !wd.eventMatches(event.Type, cfg.Events) {
			continue
		}
		go wd.dispatch(cfg, event)
	}
}

func (wd *WebhookDispatcher) eventMatches(eventType string, filters []string) bool {
	if len(filters) == 0 {
		return true // no filter = all events
	}
	for _, f := range filters {
		if f == "*" || f == eventType {
			return true
		}
	}
	return false
}

func (wd *WebhookDispatcher) dispatch(cfg WebhookConfig, event Event) {
	var body []byte

	switch cfg.Format {
	case "slack":
		body = wd.formatSlack(event)
	default: // "json"
		body = wd.formatJSON(event)
	}

	// Retry up to 3 times with exponential backoff
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequest("POST", cfg.URL, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Hive-Event", event.Type)

		resp, err := wd.client.Do(req)
		if err == nil && resp.StatusCode >= 200 && resp.StatusCode < 300 {
			resp.Body.Close()
			return
		}
		if resp != nil {
			resp.Body.Close()
		}

		// Backoff: 1s, 2s, 4s
		time.Sleep(time.Duration(1<<attempt) * time.Second)
	}
}

func (wd *WebhookDispatcher) formatJSON(event Event) []byte {
	payload := map[string]interface{}{
		"type":       event.Type,
		"project_id": event.ProjectID,
		"task_id":    event.TaskID,
		"data":       event.Data,
		"timestamp":  time.Now().Format(time.RFC3339),
	}
	data, _ := json.Marshal(payload)
	return data
}

func (wd *WebhookDispatcher) formatSlack(event Event) []byte {
	text := fmt.Sprintf("*[Hive]* `%s` — Project: `%s`", event.Type, event.ProjectID)
	if event.TaskID != "" {
		text += fmt.Sprintf(" | Task: `%s`", event.TaskID)
	}
	payload := map[string]string{"text": text}
	data, _ := json.Marshal(payload)
	return data
}
```

- [ ] **Step 2: Write webhooks_test.go**

```go
// backend/hive2/webhooks_test.go
package hive2

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWebhookDispatchJSON(t *testing.T) {
	bus := NewEventBus()

	var mu sync.Mutex
	var received []map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var payload map[string]interface{}
		json.Unmarshal(body, &payload)
		mu.Lock()
		received = append(received, payload)
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	wd := NewWebhookDispatcher(bus)
	wd.Register("proj-1", []WebhookConfig{
		{URL: server.URL, Events: []string{"task.completed"}, Format: "json"},
	})

	bus.Publish(Event{Type: "task.completed", ProjectID: "proj-1", TaskID: "01"})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 webhook call, got %d", len(received))
	}
	if received[0]["type"] != "task.completed" {
		t.Errorf("type = %v, want task.completed", received[0]["type"])
	}
}

func TestWebhookFilterEvents(t *testing.T) {
	bus := NewEventBus()
	callCount := 0
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	wd := NewWebhookDispatcher(bus)
	wd.Register("proj-1", []WebhookConfig{
		{URL: server.URL, Events: []string{"task.completed"}, Format: "json"},
	})

	// Publish non-matching event
	bus.Publish(Event{Type: "task.claimed", ProjectID: "proj-1", TaskID: "01"})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if callCount != 0 {
		t.Errorf("expected 0 webhook calls for non-matching event, got %d", callCount)
	}
}

func TestWebhookSlackFormat(t *testing.T) {
	bus := NewEventBus()

	var receivedBody string
	var mu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		receivedBody = string(body)
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer server.Close()

	wd := NewWebhookDispatcher(bus)
	wd.Register("proj-1", []WebhookConfig{
		{URL: server.URL, Events: []string{"*"}, Format: "slack"},
	})

	bus.Publish(Event{Type: "project.completed", ProjectID: "proj-1"})
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	var payload map[string]string
	json.Unmarshal([]byte(receivedBody), &payload)
	if payload["text"] == "" {
		t.Error("slack payload missing text field")
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestWebhook`
Expected: All 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/hive2/webhooks.go backend/hive2/webhooks_test.go
git commit -m "feat(hive2): add Webhook System with retry and Slack format"
```

---

### Task 7: Worker Pool & Multi-Project

**Files:**
- Create: `backend/hive2/workerpool.go`
- Create: `backend/hive2/workerpool_test.go`

**Interfaces:**
- Consumes: `ProjectStore` from Task 1, `TaskEngine` from Task 2, `EventBus` from Task 3
- Produces:
  - `func NewWorkerPool(config HiveGlobalConfig, engine *TaskEngine, eventBus *EventBus) *WorkerPool`
  - `func (wp *WorkerPool) StartProject(projectID string, numWorkers int) error`
  - `func (wp *WorkerPool) StopProject(projectID string) error`
  - `func (wp *WorkerPool) PauseProject(projectID string) error`
  - `func (wp *WorkerPool) ResumeProject(projectID string) error`
  - `func (wp *WorkerPool) GetStatus() map[string]WorkerStatus`
  - `func (wp *WorkerPool) Shutdown()`

- [ ] **Step 1: Create workerpool.go with shared pool and priority scheduling**

```go
// backend/hive2/workerpool.go
package hive2

import (
	"fmt"
	"sync"
	"time"
)

type WorkerState string

const (
	WorkerIdle    WorkerState = "idle"
	WorkerBusy    WorkerState = "busy"
	WorkerStopped WorkerState = "stopped"
)

type WorkerStatus struct {
	ID        string      `json:"id"`
	ProjectID string      `json:"project_id"`
	State     WorkerState `json:"state"`
	TaskID    string      `json:"task_id,omitempty"`
	StartedAt *time.Time  `json:"started_at,omitempty"`
}

type projectControl struct {
	cancel chan struct{}
	paused bool
}

type WorkerPool struct {
	config   HiveGlobalConfig
	engine   *TaskEngine
	eventBus *EventBus
	mu       sync.RWMutex
	workers  map[string]*WorkerStatus
	projects map[string]*projectControl
	nextID   int
}

func NewWorkerPool(config HiveGlobalConfig, engine *TaskEngine, eventBus *EventBus) *WorkerPool {
	return &WorkerPool{
		config:   config,
		engine:   engine,
		eventBus: eventBus,
		workers:  make(map[string]*WorkerStatus),
		projects: make(map[string]*projectControl),
	}
}

func (wp *WorkerPool) StartProject(projectID string, numWorkers int) error {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	if _, exists := wp.projects[projectID]; exists {
		return fmt.Errorf("project %s already has workers running", projectID)
	}

	// Check global limits
	totalWorkers := len(wp.workers)
	if wp.config.MaxGAWorkersTotal > 0 && totalWorkers+numWorkers > wp.config.MaxGAWorkersTotal {
		return fmt.Errorf("would exceed max workers: current=%d, requested=%d, max=%d",
			totalWorkers, numWorkers, wp.config.MaxGAWorkersTotal)
	}

	ctrl := &projectControl{cancel: make(chan struct{})}
	wp.projects[projectID] = ctrl

	for i := 0; i < numWorkers; i++ {
		wp.nextID++
		workerID := fmt.Sprintf("worker-%d", wp.nextID)
		ws := &WorkerStatus{
			ID:        workerID,
			ProjectID: projectID,
			State:     WorkerIdle,
		}
		wp.workers[workerID] = ws

		go wp.workerLoop(workerID, projectID, ctrl)
	}

	wp.eventBus.Publish(Event{
		Type:      "workers.started",
		ProjectID: projectID,
		Data:      map[string]interface{}{"count": numWorkers},
	})
	return nil
}

func (wp *WorkerPool) StopProject(projectID string) error {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	ctrl, exists := wp.projects[projectID]
	if !exists {
		return fmt.Errorf("no workers running for project %s", projectID)
	}

	close(ctrl.cancel)
	delete(wp.projects, projectID)

	// Clean up worker entries
	for id, ws := range wp.workers {
		if ws.ProjectID == projectID {
			ws.State = WorkerStopped
			delete(wp.workers, id)
		}
	}

	wp.eventBus.Publish(Event{Type: "workers.stopped", ProjectID: projectID})
	return nil
}

func (wp *WorkerPool) PauseProject(projectID string) error {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	ctrl, exists := wp.projects[projectID]
	if !exists {
		return fmt.Errorf("no workers running for project %s", projectID)
	}
	ctrl.paused = true
	return nil
}

func (wp *WorkerPool) ResumeProject(projectID string) error {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	ctrl, exists := wp.projects[projectID]
	if !exists {
		return fmt.Errorf("no workers running for project %s", projectID)
	}
	ctrl.paused = false
	return nil
}

func (wp *WorkerPool) GetStatus() map[string]WorkerStatus {
	wp.mu.RLock()
	defer wp.mu.RUnlock()

	result := make(map[string]WorkerStatus, len(wp.workers))
	for id, ws := range wp.workers {
		result[id] = *ws
	}
	return result
}

func (wp *WorkerPool) Shutdown() {
	wp.mu.Lock()
	defer wp.mu.Unlock()

	for _, ctrl := range wp.projects {
		close(ctrl.cancel)
	}
	wp.projects = make(map[string]*projectControl)
	wp.workers = make(map[string]*WorkerStatus)
}

func (wp *WorkerPool) workerLoop(workerID, projectID string, ctrl *projectControl) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctrl.cancel:
			return
		case <-ticker.C:
			if ctrl.paused {
				continue
			}

			// Try to claim next pending task
			task, err := wp.engine.GetNextTask(projectID, ExecutorGA)
			if err != nil || task == nil {
				continue
			}

			wp.mu.Lock()
			if ws, ok := wp.workers[workerID]; ok {
				ws.State = WorkerBusy
				ws.TaskID = task.ID
				now := time.Now()
				ws.StartedAt = &now
			}
			wp.mu.Unlock()

			wp.engine.ClaimTask(projectID, task.ID, workerID)

			wp.eventBus.Publish(Event{
				Type:      "worker.task_claimed",
				ProjectID: projectID,
				TaskID:    task.ID,
				Data:      map[string]interface{}{"worker": workerID},
			})

			// Note: actual task execution is handled externally (GA reflect script polls)
			// Worker just claims and makes it available. Reset to idle.
			wp.mu.Lock()
			if ws, ok := wp.workers[workerID]; ok {
				ws.State = WorkerIdle
				ws.TaskID = ""
			}
			wp.mu.Unlock()
		}
	}
}
```

- [ ] **Step 2: Write workerpool_test.go**

```go
// backend/hive2/workerpool_test.go
package hive2

import (
	"testing"
	"time"
)

func TestWorkerPoolStartStop(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 2}
	p, _ := store.Create("pool测试", "测试工作池", 60, cfg)

	globalCfg := HiveGlobalConfig{MaxGAWorkersTotal: 10}
	pool := NewWorkerPool(globalCfg, engine, bus)
	defer pool.Shutdown()

	// Start workers
	err := pool.StartProject(p.ID, 2)
	if err != nil {
		t.Fatalf("StartProject failed: %v", err)
	}

	status := pool.GetStatus()
	if len(status) != 2 {
		t.Errorf("expected 2 workers, got %d", len(status))
	}

	// Stop workers
	err = pool.StopProject(p.ID)
	if err != nil {
		t.Fatalf("StopProject failed: %v", err)
	}

	status = pool.GetStatus()
	if len(status) != 0 {
		t.Errorf("expected 0 workers after stop, got %d", len(status))
	}
}

func TestWorkerPoolExceedsLimit(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 3}
	p, _ := store.Create("limit测试", "测试限制", 60, cfg)

	globalCfg := HiveGlobalConfig{MaxGAWorkersTotal: 2}
	pool := NewWorkerPool(globalCfg, engine, bus)
	defer pool.Shutdown()

	err := pool.StartProject(p.ID, 3)
	if err == nil {
		t.Error("expected error when exceeding max workers")
	}
}

func TestWorkerPoolPauseResume(t *testing.T) {
	dir := t.TempDir()
	store := NewProjectStore(dir)
	bus := NewEventBus()
	engine := NewTaskEngine(store, bus)

	cfg := ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("pause测试", "测试暂停", 60, cfg)

	globalCfg := HiveGlobalConfig{MaxGAWorkersTotal: 10}
	pool := NewWorkerPool(globalCfg, engine, bus)
	defer pool.Shutdown()

	pool.StartProject(p.ID, 1)
	time.Sleep(100 * time.Millisecond)

	err := pool.PauseProject(p.ID)
	if err != nil {
		t.Fatalf("PauseProject failed: %v", err)
	}

	err = pool.ResumeProject(p.ID)
	if err != nil {
		t.Fatalf("ResumeProject failed: %v", err)
	}
}
```

- [ ] **Step 3: Run tests**

Run: `cd backend && go test ./hive2/ -v -run TestWorkerPool`
Expected: All 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/hive2/workerpool.go backend/hive2/workerpool_test.go
git commit -m "feat(hive2): add Worker Pool with multi-project scheduling"
```

---

### Task 8: MCP Server

**Files:**
- Create: `backend/mcp/server.go`
- Create: `backend/mcp/tools.go`
- Create: `backend/mcp/resources.go`
- Create: `backend/mcp/server_test.go`

**Interfaces:**
- Consumes: `TaskEngine` from Task 2, `ContextStore` from Task 3, `ProjectStore` from Task 1, `FileTracker` from Task 4
- Produces:
  - `func NewMCPServer(engine *TaskEngine, ctx *ContextStore, store *ProjectStore, ft *FileTracker) *MCPServer`
  - `func (s *MCPServer) Run()` — stdio JSON-RPC loop
  - Tools: `hive_task_list`, `hive_task_claim`, `hive_task_update`, `hive_context_read`, `hive_context_write`, `hive_artifact_register`, `hive_project_summary`
  - Resources: `hive://project/summary`, `hive://context/{key}`, `hive://tasks/pending`, `hive://tasks/all`, `hive://artifacts/list`

- [ ] **Step 1: Create backend/mcp/server.go with JSON-RPC 2.0 over stdio**

```go
// backend/mcp/server.go
package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"ga_manager/backend/hive2"
	"io"
	"os"
)

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type MCPServer struct {
	engine   *hive2.TaskEngine
	ctx      *hive2.ContextStore
	store    *hive2.ProjectStore
	ft       *hive2.FileTracker
	tools    map[string]ToolHandler
	reader   io.Reader
	writer   io.Writer
}

type ToolHandler func(params json.RawMessage) (interface{}, error)

func NewMCPServer(engine *hive2.TaskEngine, ctx *hive2.ContextStore, store *hive2.ProjectStore, ft *hive2.FileTracker) *MCPServer {
	s := &MCPServer{
		engine: engine,
		ctx:    ctx,
		store:  store,
		ft:     ft,
		tools:  make(map[string]ToolHandler),
		reader: os.Stdin,
		writer: os.Stdout,
	}
	s.registerTools()
	return s
}

// NewMCPServerWithIO creates server with custom reader/writer (for testing)
func NewMCPServerWithIO(engine *hive2.TaskEngine, ctx *hive2.ContextStore, store *hive2.ProjectStore, ft *hive2.FileTracker, r io.Reader, w io.Writer) *MCPServer {
	s := &MCPServer{
		engine: engine,
		ctx:    ctx,
		store:  store,
		ft:     ft,
		tools:  make(map[string]ToolHandler),
		reader: r,
		writer: w,
	}
	s.registerTools()
	return s
}

func (s *MCPServer) Run() {
	scanner := bufio.NewScanner(s.reader)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			s.sendError(nil, -32700, "Parse error")
			continue
		}

		s.handleRequest(req)
	}
}

func (s *MCPServer) handleRequest(req JSONRPCRequest) {
	switch req.Method {
	case "initialize":
		s.sendResult(req.ID, map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]interface{}{
				"tools":     map[string]interface{}{},
				"resources": map[string]interface{}{"subscribe": true},
			},
			"serverInfo": map[string]interface{}{
				"name":    "hive2-mcp",
				"version": "1.0.0",
			},
		})

	case "tools/list":
		s.handleToolsList(req.ID)

	case "tools/call":
		s.handleToolsCall(req)

	case "resources/list":
		s.handleResourcesList(req.ID)

	case "resources/read":
		s.handleResourcesRead(req)

	case "notifications/initialized":
		// Client acknowledgment, no response needed

	default:
		s.sendError(req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method))
	}
}

func (s *MCPServer) handleToolsList(id interface{}) {
	tools := []map[string]interface{}{
		{"name": "hive_task_list", "description": "List tasks for a project", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "status": map[string]string{"type": "string"}}}},
		{"name": "hive_task_claim", "description": "Claim a pending task", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "task_id": map[string]string{"type": "string"}, "assignee": map[string]string{"type": "string"}}, "required": []string{"project_id", "task_id", "assignee"}}},
		{"name": "hive_task_update", "description": "Update task status (complete or fail)", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "task_id": map[string]string{"type": "string"}, "status": map[string]string{"type": "string"}, "summary": map[string]string{"type": "string"}, "error": map[string]string{"type": "string"}}, "required": []string{"project_id", "task_id", "status"}}},
		{"name": "hive_context_read", "description": "Read a context entry", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "key": map[string]string{"type": "string"}}, "required": []string{"project_id", "key"}}},
		{"name": "hive_context_write", "description": "Write a context entry", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "key": map[string]string{"type": "string"}, "type": map[string]string{"type": "string"}, "content": map[string]string{"type": "string"}, "source_task": map[string]string{"type": "string"}, "tags": map[string]interface{}{"type": "array", "items": map[string]string{"type": "string"}}}, "required": []string{"project_id", "key", "content"}}},
		{"name": "hive_artifact_register", "description": "Register an artifact file for a task", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}, "task_id": map[string]string{"type": "string"}, "file": map[string]string{"type": "string"}}, "required": []string{"project_id", "task_id", "file"}}},
		{"name": "hive_project_summary", "description": "Get project summary with task counts", "inputSchema": map[string]interface{}{"type": "object", "properties": map[string]interface{}{"project_id": map[string]string{"type": "string"}}, "required": []string{"project_id"}}},
	}
	s.sendResult(id, map[string]interface{}{"tools": tools})
}

func (s *MCPServer) handleToolsCall(req JSONRPCRequest) {
	var params struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		s.sendError(req.ID, -32602, "Invalid params")
		return
	}

	handler, ok := s.tools[params.Name]
	if !ok {
		s.sendError(req.ID, -32602, fmt.Sprintf("Unknown tool: %s", params.Name))
		return
	}

	result, err := handler(params.Arguments)
	if err != nil {
		s.sendResult(req.ID, map[string]interface{}{
			"content": []map[string]interface{}{
				{"type": "text", "text": fmt.Sprintf("Error: %s", err.Error())},
			},
			"isError": true,
		})
		return
	}

	text, _ := json.Marshal(result)
	s.sendResult(req.ID, map[string]interface{}{
		"content": []map[string]interface{}{
			{"type": "text", "text": string(text)},
		},
	})
}

func (s *MCPServer) sendResult(id interface{}, result interface{}) {
	resp := JSONRPCResponse{JSONRPC: "2.0", ID: id, Result: result}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(s.writer, "%s\n", data)
}

func (s *MCPServer) sendError(id interface{}, code int, message string) {
	resp := JSONRPCResponse{JSONRPC: "2.0", ID: id, Error: &RPCError{Code: code, Message: message}}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(s.writer, "%s\n", data)
}

// SendNotification sends a JSON-RPC notification (no id) to the client
func (s *MCPServer) SendNotification(method string, params interface{}) {
	msg := map[string]interface{}{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	}
	data, _ := json.Marshal(msg)
	fmt.Fprintf(s.writer, "%s\n", data)
}
```

- [ ] **Step 2: Create backend/mcp/tools.go with tool implementations**

```go
// backend/mcp/tools.go
package mcp

import (
	"encoding/json"
	"fmt"
	"ga_manager/backend/hive2"
)

func (s *MCPServer) registerTools() {
	s.tools["hive_task_list"] = s.toolTaskList
	s.tools["hive_task_claim"] = s.toolTaskClaim
	s.tools["hive_task_update"] = s.toolTaskUpdate
	s.tools["hive_context_read"] = s.toolContextRead
	s.tools["hive_context_write"] = s.toolContextWrite
	s.tools["hive_artifact_register"] = s.toolArtifactRegister
	s.tools["hive_project_summary"] = s.toolProjectSummary
}

func (s *MCPServer) toolTaskList(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		Status    string `json:"status"`
	}
	json.Unmarshal(params, &args)

	tasks, err := s.store.GetTasks(args.ProjectID)
	if err != nil {
		return nil, err
	}

	if args.Status != "" {
		var filtered []*hive2.Task
		for _, t := range tasks {
			if string(t.Status) == args.Status {
				filtered = append(filtered, t)
			}
		}
		return filtered, nil
	}
	return tasks, nil
}

func (s *MCPServer) toolTaskClaim(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		TaskID    string `json:"task_id"`
		Assignee  string `json:"assignee"`
	}
	json.Unmarshal(params, &args)

	err := s.engine.ClaimTask(args.ProjectID, args.TaskID, args.Assignee)
	if err != nil {
		return nil, err
	}
	return map[string]string{"status": "claimed"}, nil
}

func (s *MCPServer) toolTaskUpdate(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		TaskID    string `json:"task_id"`
		Status    string `json:"status"`
		Summary   string `json:"summary"`
		Error     string `json:"error"`
	}
	json.Unmarshal(params, &args)

	switch args.Status {
	case "done":
		return map[string]string{"status": "completed"},
			s.engine.CompleteTask(args.ProjectID, args.TaskID, args.Summary, hive2.TaskOutputs{})
	case "failed":
		return map[string]string{"status": "failed"},
			s.engine.FailTask(args.ProjectID, args.TaskID, args.Error)
	default:
		return nil, fmt.Errorf("unsupported status: %s (use 'done' or 'failed')", args.Status)
	}
}

func (s *MCPServer) toolContextRead(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		Key       string `json:"key"`
	}
	json.Unmarshal(params, &args)

	content, err := s.ctx.Read(args.ProjectID, args.Key)
	if err != nil {
		return nil, err
	}
	return map[string]string{"key": args.Key, "content": content}, nil
}

func (s *MCPServer) toolContextWrite(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID  string   `json:"project_id"`
		Key        string   `json:"key"`
		Type       string   `json:"type"`
		Content    string   `json:"content"`
		SourceTask string   `json:"source_task"`
		Tags       []string `json:"tags"`
	}
	json.Unmarshal(params, &args)

	if args.Type == "" {
		args.Type = "finding"
	}
	err := s.ctx.Write(args.ProjectID, args.Key, args.Type, args.Content, args.SourceTask, args.Tags)
	if err != nil {
		return nil, err
	}
	return map[string]string{"status": "written", "key": args.Key}, nil
}

func (s *MCPServer) toolArtifactRegister(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		TaskID    string `json:"task_id"`
		File      string `json:"file"`
	}
	json.Unmarshal(params, &args)

	// Update task outputs with the new file
	tasks, err := s.store.GetTasks(args.ProjectID)
	if err != nil {
		return nil, err
	}

	for _, t := range tasks {
		if t.ID == args.TaskID {
			t.Outputs.Files = append(t.Outputs.Files, args.File)
			s.store.UpdateTask(args.ProjectID, args.TaskID, t)
			break
		}
	}
	return map[string]string{"status": "registered", "file": args.File}, nil
}

func (s *MCPServer) toolProjectSummary(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
	}
	json.Unmarshal(params, &args)

	p, err := s.store.Load(args.ProjectID)
	if err != nil {
		return nil, err
	}

	tasks, _ := s.store.GetTasks(args.ProjectID)
	contextEntries, _ := s.ctx.List(args.ProjectID)

	return map[string]interface{}{
		"project":         p,
		"task_count":      len(tasks),
		"context_entries": len(contextEntries),
	}, nil
}
```

- [ ] **Step 3: Create backend/mcp/resources.go with resource handlers**

```go
// backend/mcp/resources.go
package mcp

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (s *MCPServer) handleResourcesList(id interface{}) {
	resources := []map[string]interface{}{
		{"uri": "hive://project/summary", "name": "Project Summary", "mimeType": "application/json"},
		{"uri": "hive://context/{key}", "name": "Context Entry", "mimeType": "text/markdown"},
		{"uri": "hive://tasks/pending", "name": "Pending Tasks", "mimeType": "application/json"},
		{"uri": "hive://tasks/all", "name": "All Tasks", "mimeType": "application/json"},
		{"uri": "hive://artifacts/list", "name": "Artifacts List", "mimeType": "application/json"},
	}
	s.sendResult(id, map[string]interface{}{"resources": resources})
}

func (s *MCPServer) handleResourcesRead(req JSONRPCRequest) {
	var params struct {
		URI string `json:"uri"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		s.sendError(req.ID, -32602, "Invalid params")
		return
	}

	// Parse URI: hive://resource/path?project_id=xxx
	uri := params.URI
	var projectID string

	// Extract project_id from query string if present
	if idx := strings.Index(uri, "?"); idx >= 0 {
		query := uri[idx+1:]
		uri = uri[:idx]
		for _, pair := range strings.Split(query, "&") {
			kv := strings.SplitN(pair, "=", 2)
			if len(kv) == 2 && kv[0] == "project_id" {
				projectID = kv[1]
			}
		}
	}

	var content interface{}
	var mimeType string
	var err error

	switch {
	case uri == "hive://project/summary":
		content, err = s.resourceProjectSummary(projectID)
		mimeType = "application/json"

	case strings.HasPrefix(uri, "hive://context/"):
		key := strings.TrimPrefix(uri, "hive://context/")
		var text string
		text, err = s.ctx.Read(projectID, key)
		content = text
		mimeType = "text/markdown"

	case uri == "hive://tasks/pending":
		content, err = s.resourceTasksByStatus(projectID, "pending")
		mimeType = "application/json"

	case uri == "hive://tasks/all":
		tasks, e := s.store.GetTasks(projectID)
		content, err = tasks, e
		mimeType = "application/json"

	case uri == "hive://artifacts/list":
		changes, e := s.ft.GetChanges(projectID)
		content, err = changes, e
		mimeType = "application/json"

	default:
		s.sendError(req.ID, -32602, fmt.Sprintf("Unknown resource: %s", uri))
		return
	}

	if err != nil {
		s.sendError(req.ID, -32603, err.Error())
		return
	}

	var text string
	if mimeType == "text/markdown" {
		text = fmt.Sprintf("%v", content)
	} else {
		data, _ := json.MarshalIndent(content, "", "  ")
		text = string(data)
	}

	s.sendResult(req.ID, map[string]interface{}{
		"contents": []map[string]interface{}{
			{"uri": params.URI, "mimeType": mimeType, "text": text},
		},
	})
}

func (s *MCPServer) resourceProjectSummary(projectID string) (interface{}, error) {
	p, err := s.store.Load(projectID)
	if err != nil {
		return nil, err
	}
	tasks, _ := s.store.GetTasks(projectID)
	contextEntries, _ := s.ctx.List(projectID)
	artifacts, _ := s.ft.GetChanges(projectID)

	return map[string]interface{}{
		"project":    p,
		"tasks":      len(tasks),
		"context":    len(contextEntries),
		"artifacts":  len(artifacts),
	}, nil
}

func (s *MCPServer) resourceTasksByStatus(projectID, status string) (interface{}, error) {
	tasks, err := s.store.GetTasks(projectID)
	if err != nil {
		return nil, err
	}

	var filtered []interface{}
	for _, t := range tasks {
		if string(t.Status) == status {
			filtered = append(filtered, t)
		}
	}
	return filtered, nil
}
```

- [ ] **Step 4: Write backend/mcp/server_test.go**

```go
// backend/mcp/server_test.go
package mcp

import (
	"bytes"
	"encoding/json"
	"ga_manager/backend/hive2"
	"strings"
	"testing"
)

func setupMCPServer(t *testing.T) (*MCPServer, *hive2.ProjectStore, string, *bytes.Buffer) {
	dir := t.TempDir()
	store := hive2.NewProjectStore(dir)
	bus := hive2.NewEventBus()
	engine := hive2.NewTaskEngine(store, bus)
	ctx := hive2.NewContextStore(store)
	ft := hive2.NewFileTracker(store, bus)

	cfg := hive2.ExecutorConfig{GALlmNo: 0, GAWorkers: 1}
	p, _ := store.Create("mcp测试", "测试MCP", 60, cfg)

	// Add a task
	engine.AddTasks(p.ID, []*hive2.Task{
		{ID: "01", Type: hive2.TaskResearch, Title: "调研", Executor: hive2.ExecutorGA},
	})

	var output bytes.Buffer
	server := NewMCPServerWithIO(engine, ctx, store, ft, nil, &output)
	return server, store, p.ID, &output
}

func TestMCPInitialize(t *testing.T) {
	server, _, _, output := setupMCPServer(t)

	input := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}` + "\n"
	server.reader = strings.NewReader(input)
	server.Run()

	var resp JSONRPCResponse
	json.Unmarshal(output.Bytes(), &resp)
	if resp.Error != nil {
		t.Fatalf("initialize returned error: %s", resp.Error.Message)
	}

	result := resp.Result.(map[string]interface{})
	if result["protocolVersion"] != "2024-11-05" {
		t.Errorf("protocolVersion = %v, want 2024-11-05", result["protocolVersion"])
	}
}

func TestMCPToolsList(t *testing.T) {
	server, _, _, output := setupMCPServer(t)

	input := `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}` + "\n"
	server.reader = strings.NewReader(input)
	server.Run()

	var resp JSONRPCResponse
	json.Unmarshal(output.Bytes(), &resp)
	if resp.Error != nil {
		t.Fatalf("tools/list returned error: %s", resp.Error.Message)
	}

	result := resp.Result.(map[string]interface{})
	tools := result["tools"].([]interface{})
	if len(tools) != 7 {
		t.Errorf("expected 7 tools, got %d", len(tools))
	}
}

func TestMCPToolCall(t *testing.T) {
	server, _, projID, output := setupMCPServer(t)

	callReq := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/call",
		"params": map[string]interface{}{
			"name":      "hive_task_list",
			"arguments": map[string]string{"project_id": projID},
		},
	}
	data, _ := json.Marshal(callReq)
	input := string(data) + "\n"

	server.reader = strings.NewReader(input)
	server.Run()

	var resp JSONRPCResponse
	json.Unmarshal(output.Bytes(), &resp)
	if resp.Error != nil {
		t.Fatalf("tools/call returned error: %s", resp.Error.Message)
	}
}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && go test ./mcp/ -v`
Expected: All 3 MCP tests pass

- [ ] **Step 6: Commit**

```bash
git add backend/mcp/server.go backend/mcp/tools.go backend/mcp/resources.go backend/mcp/server_test.go
git commit -m "feat(hive2): add MCP Server with tools and resources"
```

---

### Task 9: HTTP Handler & Backend Integration

**Files:**
- Create: `backend/handlers/hive2.go`
- Modify: `main.go`

**Interfaces:**
- Consumes: All services from Tasks 1-7 (`ProjectStore`, `TaskEngine`, `ContextStore`, `FileTracker`, `WorkerPool`, `EventBus`, `WebhookDispatcher`, `TemplateLibrary`)
- Produces: All `/api/hive2/` REST endpoints

- [ ] **Step 1: Create backend/handlers/hive2.go with all REST endpoints**

```go
// backend/handlers/hive2.go
package handlers

import (
	"encoding/json"
	"ga_manager/backend/hive2"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type Hive2Handler struct {
	store      *hive2.ProjectStore
	engine     *hive2.TaskEngine
	ctx        *hive2.ContextStore
	ft         *hive2.FileTracker
	pool       *hive2.WorkerPool
	eventBus   *hive2.EventBus
	webhooks   *hive2.WebhookDispatcher
	templates  *hive2.TemplateLibrary
}

func NewHive2Handler(
	store *hive2.ProjectStore,
	engine *hive2.TaskEngine,
	ctx *hive2.ContextStore,
	ft *hive2.FileTracker,
	pool *hive2.WorkerPool,
	eventBus *hive2.EventBus,
	webhooks *hive2.WebhookDispatcher,
	templates *hive2.TemplateLibrary,
) *Hive2Handler {
	return &Hive2Handler{
		store: store, engine: engine, ctx: ctx, ft: ft,
		pool: pool, eventBus: eventBus, webhooks: webhooks, templates: templates,
	}
}

func (h *Hive2Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/hive2/projects", h.handleProjects)
	mux.HandleFunc("/api/hive2/projects/", h.handleProjectByID)
	mux.HandleFunc("/api/hive2/templates", h.handleTemplates)
}

func (h *Hive2Handler) handleProjects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "POST":
		h.createProject(w, r)
	case "GET":
		h.listProjects(w, r)
	default:
		http.Error(w, "Method not allowed", 405)
	}
}

func (h *Hive2Handler) createProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name      string              `json:"name"`
		Objective string              `json:"objective"`
		Budget    int                 `json:"budget_minutes"`
		Config    hive2.ExecutorConfig `json:"executor_config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request body", 400)
		return
	}

	p, err := h.store.Create(req.Name, req.Objective, req.Budget, req.Config)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, p, 201)
}

func (h *Hive2Handler) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.store.List()
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, projects, 200)
}

func (h *Hive2Handler) handleProjectByID(w http.ResponseWriter, r *http.Request) {
	// Parse: /api/hive2/projects/{id}/...
	path := strings.TrimPrefix(r.URL.Path, "/api/hive2/projects/")
	parts := strings.SplitN(path, "/", 2)
	projectID := parts[0]
	subPath := ""
	if len(parts) > 1 {
		subPath = parts[1]
	}

	switch {
	case subPath == "" && r.Method == "GET":
		h.getProject(w, r, projectID)
	case subPath == "start" && r.Method == "POST":
		h.startProject(w, r, projectID)
	case subPath == "stop" && r.Method == "POST":
		h.stopProject(w, r, projectID)
	case subPath == "pause" && r.Method == "POST":
		h.pauseProject(w, r, projectID)
	case subPath == "resume" && r.Method == "POST":
		h.resumeProject(w, r, projectID)
	case subPath == "tasks" && r.Method == "GET":
		h.getTasks(w, r, projectID)
	case subPath == "tasks" && r.Method == "POST":
		h.addTasks(w, r, projectID)
	case strings.HasPrefix(subPath, "tasks/") && strings.HasSuffix(subPath, "/claim"):
		taskID := strings.TrimPrefix(subPath, "tasks/")
		taskID = strings.TrimSuffix(taskID, "/claim")
		h.claimTask(w, r, projectID, taskID)
	case strings.HasPrefix(subPath, "tasks/") && strings.HasSuffix(subPath, "/complete"):
		taskID := strings.TrimPrefix(subPath, "tasks/")
		taskID = strings.TrimSuffix(taskID, "/complete")
		h.completeTask(w, r, projectID, taskID)
	case strings.HasPrefix(subPath, "tasks/") && strings.HasSuffix(subPath, "/fail"):
		taskID := strings.TrimPrefix(subPath, "tasks/")
		taskID = strings.TrimSuffix(taskID, "/fail")
		h.failTask(w, r, projectID, taskID)
	case subPath == "context" && r.Method == "GET":
		h.listContext(w, r, projectID)
	case subPath == "context" && r.Method == "POST":
		h.writeContext(w, r, projectID)
	case strings.HasPrefix(subPath, "context/") && r.Method == "GET":
		key := strings.TrimPrefix(subPath, "context/")
		h.readContext(w, r, projectID, key)
	case subPath == "artifacts" && r.Method == "GET":
		h.listArtifacts(w, r, projectID)
	case strings.HasPrefix(subPath, "artifacts/preview"):
		h.previewArtifact(w, r, projectID)
	case strings.HasPrefix(subPath, "logs/"):
		taskID := strings.TrimPrefix(subPath, "logs/")
		h.getTaskLog(w, r, projectID, taskID)
	case subPath == "from-template" && r.Method == "POST":
		h.createFromTemplate(w, r, projectID)
	default:
		http.Error(w, "Not found", 404)
	}
}

func (h *Hive2Handler) getProject(w http.ResponseWriter, r *http.Request, projectID string) {
	p, err := h.store.Load(projectID)
	if err != nil {
		jsonError(w, "Project not found", 404)
		return
	}
	tasks, _ := h.store.GetTasks(projectID)
	jsonResponse(w, map[string]interface{}{"project": p, "tasks": tasks}, 200)
}

func (h *Hive2Handler) startProject(w http.ResponseWriter, r *http.Request, projectID string) {
	var req struct {
		Workers int `json:"workers"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Workers == 0 {
		req.Workers = 2
	}

	if err := h.pool.StartProject(projectID, req.Workers); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	h.ft.Start(projectID)
	jsonResponse(w, map[string]string{"status": "started"}, 200)
}

func (h *Hive2Handler) stopProject(w http.ResponseWriter, r *http.Request, projectID string) {
	h.pool.StopProject(projectID)
	h.ft.Stop(projectID)
	jsonResponse(w, map[string]string{"status": "stopped"}, 200)
}

func (h *Hive2Handler) pauseProject(w http.ResponseWriter, r *http.Request, projectID string) {
	if err := h.pool.PauseProject(projectID); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	jsonResponse(w, map[string]string{"status": "paused"}, 200)
}

func (h *Hive2Handler) resumeProject(w http.ResponseWriter, r *http.Request, projectID string) {
	if err := h.pool.ResumeProject(projectID); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	jsonResponse(w, map[string]string{"status": "resumed"}, 200)
}

func (h *Hive2Handler) getTasks(w http.ResponseWriter, r *http.Request, projectID string) {
	tasks, err := h.store.GetTasks(projectID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}

	// Filter by query params
	executor := r.URL.Query().Get("executor")
	status := r.URL.Query().Get("status")

	var filtered []*hive2.Task
	for _, t := range tasks {
		if executor != "" && string(t.Executor) != executor {
			continue
		}
		if status != "" && string(t.Status) != status {
			continue
		}
		filtered = append(filtered, t)
	}
	jsonResponse(w, filtered, 200)
}

func (h *Hive2Handler) addTasks(w http.ResponseWriter, r *http.Request, projectID string) {
	var tasks []*hive2.Task
	if err := json.NewDecoder(r.Body).Decode(&tasks); err != nil {
		jsonError(w, "Invalid request body", 400)
		return
	}
	if err := h.engine.AddTasks(projectID, tasks); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]interface{}{"added": len(tasks)}, 201)
}

func (h *Hive2Handler) claimTask(w http.ResponseWriter, r *http.Request, projectID, taskID string) {
	var req struct {
		Assignee string `json:"assignee"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if err := h.engine.ClaimTask(projectID, taskID, req.Assignee); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	h.ft.SetActiveTask(projectID, taskID)
	jsonResponse(w, map[string]string{"status": "claimed"}, 200)
}

func (h *Hive2Handler) completeTask(w http.ResponseWriter, r *http.Request, projectID, taskID string) {
	var req struct {
		Summary string           `json:"summary"`
		Outputs hive2.TaskOutputs `json:"outputs"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if err := h.engine.CompleteTask(projectID, taskID, req.Summary, req.Outputs); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	jsonResponse(w, map[string]string{"status": "completed"}, 200)
}

func (h *Hive2Handler) failTask(w http.ResponseWriter, r *http.Request, projectID, taskID string) {
	var req struct {
		Error string `json:"error"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if err := h.engine.FailTask(projectID, taskID, req.Error); err != nil {
		jsonError(w, err.Error(), 400)
		return
	}
	jsonResponse(w, map[string]string{"status": "failed"}, 200)
}

func (h *Hive2Handler) listContext(w http.ResponseWriter, r *http.Request, projectID string) {
	entries, err := h.ctx.List(projectID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, entries, 200)
}

func (h *Hive2Handler) writeContext(w http.ResponseWriter, r *http.Request, projectID string) {
	var req struct {
		Key        string   `json:"key"`
		Type       string   `json:"type"`
		Content    string   `json:"content"`
		SourceTask string   `json:"source_task"`
		Tags       []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request body", 400)
		return
	}
	if req.Type == "" {
		req.Type = "finding"
	}
	if err := h.ctx.Write(projectID, req.Key, req.Type, req.Content, req.SourceTask, req.Tags); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]string{"status": "written", "key": req.Key}, 201)
}

func (h *Hive2Handler) readContext(w http.ResponseWriter, r *http.Request, projectID, key string) {
	content, err := h.ctx.Read(projectID, key)
	if err != nil {
		jsonError(w, err.Error(), 404)
		return
	}
	jsonResponse(w, map[string]string{"key": key, "content": content}, 200)
}

func (h *Hive2Handler) listArtifacts(w http.ResponseWriter, r *http.Request, projectID string) {
	changes, err := h.ft.GetChanges(projectID)
	if err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, changes, 200)
}

func (h *Hive2Handler) previewArtifact(w http.ResponseWriter, r *http.Request, projectID string) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		jsonError(w, "path parameter required", 400)
		return
	}

	fullPath := filepath.Join(h.store.ProjectDir(projectID), "artifacts", filePath)
	data, err := os.ReadFile(fullPath)
	if err != nil {
		jsonError(w, "File not found", 404)
		return
	}

	// Detect content type
	ext := strings.ToLower(filepath.Ext(filePath))
	switch ext {
	case ".md":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	case ".json":
		w.Header().Set("Content-Type", "application/json")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	default:
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	w.Write(data)
}

func (h *Hive2Handler) getTaskLog(w http.ResponseWriter, r *http.Request, projectID, taskID string) {
	logPath := filepath.Join(h.store.ProjectDir(projectID), "logs", taskID+".log")
	data, err := os.ReadFile(logPath)
	if err != nil {
		jsonResponse(w, map[string]string{"log": ""}, 200)
		return
	}
	jsonResponse(w, map[string]string{"log": string(data)}, 200)
}

func (h *Hive2Handler) handleTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	templates := h.templates.List()
	jsonResponse(w, templates, 200)
}

func (h *Hive2Handler) createFromTemplate(w http.ResponseWriter, r *http.Request, projectID string) {
	var req struct {
		Template  string            `json:"template"`
		Variables map[string]string `json:"variables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "Invalid request body", 400)
		return
	}

	tasks, err := h.templates.Instantiate(req.Template, req.Variables)
	if err != nil {
		jsonError(w, err.Error(), 400)
		return
	}

	if err := h.engine.AddTasks(projectID, tasks); err != nil {
		jsonError(w, err.Error(), 500)
		return
	}
	jsonResponse(w, map[string]interface{}{"tasks_created": len(tasks)}, 201)
}

func jsonResponse(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
```

- [ ] **Step 2: Wire up services in main.go — add Hive2 initialization and route registration**

```go
// Add to main.go (in the service initialization section)

// --- Hive v2 services ---
hive2BaseDir := filepath.Join(dataDir, "hive2_projects")
hive2Store := hive2.NewProjectStore(hive2BaseDir)
hive2EventBus := hive2.NewEventBus()
hive2Engine := hive2.NewTaskEngine(hive2Store, hive2EventBus)
hive2Context := hive2.NewContextStore(hive2Store)
hive2FileTracker := hive2.NewFileTracker(hive2Store, hive2EventBus)
hive2Webhooks := hive2.NewWebhookDispatcher(hive2EventBus)
hive2Templates := hive2.NewTemplateLibrary(filepath.Join(dataDir, "hive_templates"))
hive2GlobalCfg := hive2.HiveGlobalConfig{
	MaxGAWorkersTotal:      10,
	MaxClaudeSessionsTotal: 4,
	WorkerPoolShared:       true,
}
hive2Pool := hive2.NewWorkerPool(hive2GlobalCfg, hive2Engine, hive2EventBus)

hive2Handler := handlers.NewHive2Handler(
	hive2Store, hive2Engine, hive2Context, hive2FileTracker,
	hive2Pool, hive2EventBus, hive2Webhooks, hive2Templates,
)
hive2Handler.RegisterRoutes(mux)
```

- [ ] **Step 3: Run build**

Run: `cd backend && go build ./...`
Expected: Compiles without errors

- [ ] **Step 4: Commit**

```bash
git add backend/handlers/hive2.go main.go
git commit -m "feat(hive2): add HTTP handler with all REST endpoints and wire services"
```

---

### Task 10: Frontend Rewrite

**Files:**
- Create: `frontend/src/store/hive.ts`
- Modify: `frontend/src/pages/HivePage.tsx`
- Create: `frontend/src/pages/HiveProjectPage.tsx`
- Create: `frontend/src/components/hive/TaskList.tsx`
- Create: `frontend/src/components/hive/TaskDetail.tsx`
- Create: `frontend/src/components/hive/ArtifactPanel.tsx`
- Create: `frontend/src/components/hive/FilePreview.tsx`
- Create: `frontend/src/components/hive/NewProjectDialog.tsx`
- Create: `frontend/src/components/hive/ContextBar.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: All `/api/hive2/` REST endpoints from Task 9
- Produces: Complete Hive v2 frontend UI

- [ ] **Step 1: Create frontend/src/store/hive.ts — Zustand slice**

```typescript
// frontend/src/store/hive.ts
import { create } from 'zustand';

interface Project {
  id: string;
  name: string;
  objective: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  budget_minutes: number;
  elapsed_minutes: number;
  executor_config: { ga_llm_no: number; ga_workers: number; claude_code_enabled: boolean };
  task_count: { total: number; done: number; running: number; pending: number; failed: number };
}

interface Task {
  id: string;
  type: string;
  title: string;
  status: string;
  executor: string;
  depends_on: string[];
  assigned_to?: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
}

interface ContextEntry {
  key: string;
  file: string;
  type: string;
  source_task: string;
  tags: string[];
  created_at: string;
}

interface FileChange {
  file: string;
  action: string;
  task_id: string;
  timestamp: string;
  size_bytes: number;
}

interface HiveState {
  projects: Project[];
  selectedProject: Project | null;
  tasks: Task[];
  selectedTask: Task | null;
  contextEntries: ContextEntry[];
  artifacts: FileChange[];
  templates: { name: string; description: string; builtin: boolean }[];
  loading: boolean;

  fetchProjects: () => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
  fetchTasks: (projectId: string) => Promise<void>;
  fetchContext: (projectId: string) => Promise<void>;
  fetchArtifacts: (projectId: string) => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createProject: (data: any) => Promise<Project>;
  startProject: (id: string, workers: number) => Promise<void>;
  stopProject: (id: string) => Promise<void>;
  pauseProject: (id: string) => Promise<void>;
  resumeProject: (id: string) => Promise<void>;
  selectTask: (task: Task | null) => void;
}

const API = '/api/hive2';

export const useHiveStore = create<HiveState>((set, get) => ({
  projects: [],
  selectedProject: null,
  tasks: [],
  selectedTask: null,
  contextEntries: [],
  artifacts: [],
  templates: [],
  loading: false,

  fetchProjects: async () => {
    set({ loading: true });
    const res = await fetch(`${API}/projects`);
    const projects = await res.json();
    set({ projects, loading: false });
  },

  fetchProject: async (id: string) => {
    const res = await fetch(`${API}/projects/${id}`);
    const data = await res.json();
    set({ selectedProject: data.project, tasks: data.tasks || [] });
  },

  fetchTasks: async (projectId: string) => {
    const res = await fetch(`${API}/projects/${projectId}/tasks`);
    const tasks = await res.json();
    set({ tasks });
  },

  fetchContext: async (projectId: string) => {
    const res = await fetch(`${API}/projects/${projectId}/context`);
    const contextEntries = await res.json();
    set({ contextEntries });
  },

  fetchArtifacts: async (projectId: string) => {
    const res = await fetch(`${API}/projects/${projectId}/artifacts`);
    const artifacts = await res.json();
    set({ artifacts });
  },

  fetchTemplates: async () => {
    const res = await fetch(`${API}/templates`);
    const templates = await res.json();
    set({ templates });
  },

  createProject: async (data: any) => {
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const project = await res.json();
    get().fetchProjects();
    return project;
  },

  startProject: async (id: string, workers: number) => {
    await fetch(`${API}/projects/${id}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workers }),
    });
    get().fetchProject(id);
  },

  stopProject: async (id: string) => {
    await fetch(`${API}/projects/${id}/stop`, { method: 'POST' });
    get().fetchProject(id);
  },

  pauseProject: async (id: string) => {
    await fetch(`${API}/projects/${id}/pause`, { method: 'POST' });
    get().fetchProject(id);
  },

  resumeProject: async (id: string) => {
    await fetch(`${API}/projects/${id}/resume`, { method: 'POST' });
    get().fetchProject(id);
  },

  selectTask: (task: Task | null) => set({ selectedTask: task }),
}));
```

- [ ] **Step 2: Rewrite frontend/src/pages/HivePage.tsx — project list + create dialog**

```tsx
// frontend/src/pages/HivePage.tsx
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHiveStore } from '../store/hive';
import NewProjectDialog from '../components/hive/NewProjectDialog';

const statusColors: Record<string, string> = {
  running: '#52c41a',
  paused: '#faad14',
  completed: '#1890ff',
  failed: '#f5222d',
};

const HivePage: React.FC = () => {
  const { projects, loading, fetchProjects, fetchTemplates } = useHiveStore();
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    fetchProjects();
    fetchTemplates();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>Hive v2 Projects</h2>
        <button onClick={() => setShowCreate(true)}>+ New Project</button>
      </div>

      {loading && <p>Loading...</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {projects.map((p) => (
          <div
            key={p.id}
            onClick={() => navigate(`/hive/${p.id}`)}
            style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 16, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{p.name}</strong>
              <span style={{ color: statusColors[p.status] || '#999' }}>{p.status}</span>
            </div>
            <p style={{ color: '#666', margin: '8px 0' }}>{p.objective}</p>
            <div style={{ fontSize: 12, color: '#999' }}>
              Tasks: {p.task_count.done}/{p.task_count.total} done
              {' | '}Running: {p.task_count.running}
              {' | '}Failed: {p.task_count.failed}
            </div>
          </div>
        ))}
      </div>

      {showCreate && <NewProjectDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default HivePage;
```

- [ ] **Step 3: Create frontend/src/pages/HiveProjectPage.tsx — 3-column layout**

```tsx
// frontend/src/pages/HiveProjectPage.tsx
import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useHiveStore } from '../store/hive';
import TaskList from '../components/hive/TaskList';
import TaskDetail from '../components/hive/TaskDetail';
import ArtifactPanel from '../components/hive/ArtifactPanel';
import ContextBar from '../components/hive/ContextBar';

const HiveProjectPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { selectedProject, fetchProject, fetchContext, fetchArtifacts, startProject, stopProject, pauseProject, resumeProject } = useHiveStore();

  useEffect(() => {
    if (id) {
      fetchProject(id);
      fetchContext(id);
      fetchArtifacts(id);
      // Poll every 5s
      const interval = setInterval(() => {
        fetchProject(id);
        fetchArtifacts(id);
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [id]);

  if (!selectedProject) return <p>Loading project...</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0 }}>{selectedProject.name}</h3>
          <span style={{ color: '#666' }}>{selectedProject.objective}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedProject.status === 'running' && (
            <>
              <button onClick={() => pauseProject(id!)}>Pause</button>
              <button onClick={() => stopProject(id!)}>Stop</button>
            </>
          )}
          {selectedProject.status === 'paused' && (
            <button onClick={() => resumeProject(id!)}>Resume</button>
          )}
          {!['running', 'paused'].includes(selectedProject.status) && (
            <button onClick={() => startProject(id!, selectedProject.executor_config.ga_workers)}>Start</button>
          )}
        </div>
      </div>

      {/* 3-column layout */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 280, borderRight: '1px solid #eee', overflowY: 'auto' }}>
          <TaskList />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          <TaskDetail projectId={id!} />
        </div>
        <div style={{ width: 300, borderLeft: '1px solid #eee', overflowY: 'auto' }}>
          <ArtifactPanel projectId={id!} />
        </div>
      </div>

      {/* Context bar */}
      <ContextBar />
    </div>
  );
};

export default HiveProjectPage;
```

- [ ] **Step 4: Create frontend/src/components/hive/TaskList.tsx**

```tsx
// frontend/src/components/hive/TaskList.tsx
import React from 'react';
import { useHiveStore } from '../../store/hive';

const statusIcons: Record<string, string> = {
  pending: '○', blocked: '◌', running: '◉', done: '●', failed: '✕', stalled: '⊘',
};

const TaskList: React.FC = () => {
  const { tasks, selectedTask, selectTask } = useHiveStore();

  return (
    <div style={{ padding: 8 }}>
      <h4 style={{ padding: '0 8px' }}>Tasks ({tasks.length})</h4>
      {tasks.map((t) => (
        <div
          key={t.id}
          onClick={() => selectTask(t)}
          style={{
            padding: '8px 12px',
            cursor: 'pointer',
            borderRadius: 4,
            background: selectedTask?.id === t.id ? '#e6f7ff' : 'transparent',
            marginBottom: 2,
          }}
        >
          <span style={{ marginRight: 8 }}>{statusIcons[t.status] || '?'}</span>
          <span style={{ fontSize: 13 }}>{t.id}. {t.title}</span>
          <div style={{ fontSize: 11, color: '#999', marginLeft: 20 }}>
            {t.executor} | {t.status}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TaskList;
```

- [ ] **Step 5: Create frontend/src/components/hive/TaskDetail.tsx**

```tsx
// frontend/src/components/hive/TaskDetail.tsx
import React, { useEffect, useState } from 'react';
import { useHiveStore } from '../../store/hive';

interface Props { projectId: string }

const TaskDetail: React.FC<Props> = ({ projectId }) => {
  const { selectedTask } = useHiveStore();
  const [log, setLog] = useState('');

  useEffect(() => {
    if (selectedTask) {
      fetch(`/api/hive2/projects/${projectId}/logs/${selectedTask.id}`)
        .then(r => r.json())
        .then(d => setLog(d.log || ''));
    }
  }, [selectedTask, projectId]);

  if (!selectedTask) return <p style={{ color: '#999' }}>Select a task to view details</p>;

  return (
    <div>
      <h3>{selectedTask.title}</h3>
      <table style={{ fontSize: 13 }}>
        <tbody>
          <tr><td><strong>ID:</strong></td><td>{selectedTask.id}</td></tr>
          <tr><td><strong>Type:</strong></td><td>{selectedTask.type}</td></tr>
          <tr><td><strong>Status:</strong></td><td>{selectedTask.status}</td></tr>
          <tr><td><strong>Executor:</strong></td><td>{selectedTask.executor}</td></tr>
          <tr><td><strong>Assigned:</strong></td><td>{selectedTask.assigned_to || '—'}</td></tr>
          <tr><td><strong>Depends on:</strong></td><td>{selectedTask.depends_on?.join(', ') || 'none'}</td></tr>
          {selectedTask.error && <tr><td><strong>Error:</strong></td><td style={{ color: 'red' }}>{selectedTask.error}</td></tr>}
        </tbody>
      </table>

      {log && (
        <div style={{ marginTop: 16 }}>
          <h4>Log</h4>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, maxHeight: 400, overflow: 'auto', fontSize: 12 }}>
            {log}
          </pre>
        </div>
      )}
    </div>
  );
};

export default TaskDetail;
```

- [ ] **Step 6: Create frontend/src/components/hive/ArtifactPanel.tsx**

```tsx
// frontend/src/components/hive/ArtifactPanel.tsx
import React, { useState } from 'react';
import { useHiveStore } from '../../store/hive';
import FilePreview from './FilePreview';

interface Props { projectId: string }

const ArtifactPanel: React.FC<Props> = ({ projectId }) => {
  const { artifacts } = useHiveStore();
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  return (
    <div style={{ padding: 8 }}>
      <h4 style={{ padding: '0 8px' }}>Artifacts ({artifacts.length})</h4>
      {artifacts.map((a, i) => (
        <div
          key={i}
          onClick={() => setPreviewPath(a.file)}
          style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0f0f0' }}
        >
          <span>{a.action === 'created' ? '🆕' : a.action === 'modified' ? '📝' : '🗑️'}</span>
          {' '}{a.file}
          <div style={{ fontSize: 11, color: '#999' }}>Task: {a.task_id} | {a.size_bytes}B</div>
        </div>
      ))}

      {previewPath && (
        <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12 }}>
          <FilePreview projectId={projectId} filePath={previewPath} />
        </div>
      )}
    </div>
  );
};

export default ArtifactPanel;
```

- [ ] **Step 7: Create frontend/src/components/hive/FilePreview.tsx**

```tsx
// frontend/src/components/hive/FilePreview.tsx
import React, { useEffect, useState } from 'react';

interface Props { projectId: string; filePath: string }

const FilePreview: React.FC<Props> = ({ projectId, filePath }) => {
  const [content, setContent] = useState<string>('');
  const [isImage, setIsImage] = useState(false);

  useEffect(() => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext || '')) {
      setIsImage(true);
      setContent(`/api/hive2/projects/${projectId}/artifacts/preview?path=${encodeURIComponent(filePath)}`);
    } else {
      setIsImage(false);
      fetch(`/api/hive2/projects/${projectId}/artifacts/preview?path=${encodeURIComponent(filePath)}`)
        .then(r => r.text())
        .then(setContent)
        .catch(() => setContent('Failed to load'));
    }
  }, [projectId, filePath]);

  if (isImage) {
    return <img src={content} alt={filePath} style={{ maxWidth: '100%' }} />;
  }

  return (
    <pre style={{ fontSize: 12, background: '#fafafa', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>
      {content}
    </pre>
  );
};

export default FilePreview;
```

- [ ] **Step 8: Create frontend/src/components/hive/NewProjectDialog.tsx**

```tsx
// frontend/src/components/hive/NewProjectDialog.tsx
import React, { useState } from 'react';
import { useHiveStore } from '../../store/hive';
import { useNavigate } from 'react-router-dom';

interface Props { onClose: () => void }

const NewProjectDialog: React.FC<Props> = ({ onClose }) => {
  const { templates, createProject } = useHiveStore();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', objective: '', budget_minutes: 60,
    ga_llm_no: 2, ga_workers: 2, claude_code_enabled: true,
    template: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const project = await createProject({
      name: form.name,
      objective: form.objective,
      budget_minutes: form.budget_minutes,
      executor_config: {
        ga_llm_no: form.ga_llm_no,
        ga_workers: form.ga_workers,
        claude_code_enabled: form.claude_code_enabled,
      },
    });
    if (project?.id && form.template) {
      await fetch(`/api/hive2/projects/${project.id}/from-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: form.template, variables: { topic: form.objective, target: form.name } }),
      });
    }
    onClose();
    if (project?.id) navigate(`/hive/${project.id}`);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: 24, borderRadius: 8, width: 480 }}>
        <h3>New Hive Project</h3>
        <div style={{ marginBottom: 12 }}>
          <label>Name</label>
          <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required style={{ width: '100%', padding: 6 }} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Objective</label>
          <textarea value={form.objective} onChange={e => setForm({...form, objective: e.target.value})} required style={{ width: '100%', padding: 6 }} />
        </div>
        <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
          <div>
            <label>Budget (min)</label>
            <input type="number" value={form.budget_minutes} onChange={e => setForm({...form, budget_minutes: +e.target.value})} style={{ width: 80, padding: 6 }} />
          </div>
          <div>
            <label>LLM</label>
            <input type="number" value={form.ga_llm_no} onChange={e => setForm({...form, ga_llm_no: +e.target.value})} style={{ width: 60, padding: 6 }} />
          </div>
          <div>
            <label>Workers</label>
            <input type="number" value={form.ga_workers} onChange={e => setForm({...form, ga_workers: +e.target.value})} style={{ width: 60, padding: 6 }} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Template</label>
          <select value={form.template} onChange={e => setForm({...form, template: e.target.value})} style={{ width: '100%', padding: 6 }}>
            <option value="">None (add tasks manually)</option>
            {templates.map(t => <option key={t.name} value={t.name}>{t.name} — {t.description}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
};

export default NewProjectDialog;
```

- [ ] **Step 9: Create frontend/src/components/hive/ContextBar.tsx**

```tsx
// frontend/src/components/hive/ContextBar.tsx
import React from 'react';
import { useHiveStore } from '../../store/hive';

const ContextBar: React.FC = () => {
  const { contextEntries } = useHiveStore();

  const counts = contextEntries.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div style={{ borderTop: '1px solid #eee', padding: '8px 24px', display: 'flex', gap: 16, fontSize: 12, color: '#666' }}>
      <span>Context: {contextEntries.length} entries</span>
      {Object.entries(counts).map(([type, count]) => (
        <span key={type}>{type}: {count}</span>
      ))}
    </div>
  );
};

export default ContextBar;
```

- [ ] **Step 10: Update App.tsx routes and NavBar**

```tsx
// Add to App.tsx routes:
import HivePage from './pages/HivePage';
import HiveProjectPage from './pages/HiveProjectPage';

// Inside <Routes>:
<Route path="/hive" element={<HivePage />} />
<Route path="/hive/:id" element={<HiveProjectPage />} />

// Update NavBar link from old Hive to new:
<NavLink to="/hive">Hive</NavLink>
```

- [ ] **Step 11: Run build**

Run: `cd frontend && npm run build`
Expected: Build completes with no type errors

- [ ] **Step 12: Commit**

```bash
git add frontend/src/store/hive.ts frontend/src/pages/HivePage.tsx frontend/src/pages/HiveProjectPage.tsx \
  frontend/src/components/hive/TaskList.tsx frontend/src/components/hive/TaskDetail.tsx \
  frontend/src/components/hive/ArtifactPanel.tsx frontend/src/components/hive/FilePreview.tsx \
  frontend/src/components/hive/NewProjectDialog.tsx frontend/src/components/hive/ContextBar.tsx \
  frontend/src/App.tsx
git commit -m "feat(hive2): rewrite frontend with project list and 3-column task board"
```

---

### Task 11: GA Worker Reflect Script

**Files:**
- Create: `hive_v2_worker.py` (standalone file for GA root reflect/ directory)

**Interfaces:**
- Consumes: `/api/hive2/projects/{id}/tasks` (GET with query params), `/api/hive2/projects/{id}/tasks/{tid}/claim` (POST), `/api/hive2/projects/{id}/tasks/{tid}/complete` (POST), `/api/hive2/projects/{id}/context` (POST, GET)
- Produces: Standalone Python reflect script

- [ ] **Step 1: Create hive_v2_worker.py — GA reflect script**

```python
#!/usr/bin/env python3
"""
Hive v2 GA Worker — Reflect Script

Drop this file into your GA root's reflect/ directory.
It polls the Hive v2 Task Engine API for pending tasks assigned to GA,
claims them, reads context, generates a structured prompt for the GA agent,
and on completion posts results back.

Configuration via environment or constants below.
"""

import os
import time
import json
import requests
from datetime import datetime

# --- Configuration ---
GA_MANAGER_URL = os.environ.get("GA_MANAGER_URL", "http://localhost:18080")
PROJECT_ID = os.environ.get("HIVE_PROJECT_ID", "")
WORKER_NAME = os.environ.get("HIVE_WORKER_NAME", f"ga-worker-{os.getpid()}")
INTERVAL = 15  # seconds between polls
MAX_RETRIES = 3

# --- API Helpers ---

def api_get(path, params=None):
    """GET request to Hive v2 API."""
    url = f"{GA_MANAGER_URL}/api/hive2{path}"
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                print(f"[ERROR] GET {url} failed: {e}")
                return None
            time.sleep(2)


def api_post(path, data=None):
    """POST request to Hive v2 API."""
    url = f"{GA_MANAGER_URL}/api/hive2{path}"
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(url, json=data or {}, timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                print(f"[ERROR] POST {url} failed: {e}")
                return None
            time.sleep(2)


# --- Core Logic ---

def fetch_pending_task():
    """Poll for the next pending GA task."""
    tasks = api_get(f"/projects/{PROJECT_ID}/tasks", params={"executor": "ga", "status": "pending"})
    if tasks and len(tasks) > 0:
        return tasks[0]
    return None


def claim_task(task_id):
    """Claim a task for this worker."""
    result = api_post(f"/projects/{PROJECT_ID}/tasks/{task_id}/claim", {"assignee": WORKER_NAME})
    return result is not None


def read_context(key):
    """Read a context entry."""
    data = api_get(f"/projects/{PROJECT_ID}/context/{key}")
    if data:
        return data.get("content", "")
    return ""


def write_context(key, content_type, content, source_task, tags):
    """Write a context entry."""
    api_post(f"/projects/{PROJECT_ID}/context", {
        "key": key,
        "type": content_type,
        "content": content,
        "source_task": source_task,
        "tags": tags,
    })


def complete_task(task_id, summary, context_keys=None, files=None):
    """Mark task as complete with outputs."""
    api_post(f"/projects/{PROJECT_ID}/tasks/{task_id}/complete", {
        "summary": summary,
        "outputs": {
            "context_keys": context_keys or [],
            "files": files or [],
        },
    })


def fail_task(task_id, error_msg):
    """Mark task as failed."""
    api_post(f"/projects/{PROJECT_ID}/tasks/{task_id}/fail", {"error": error_msg})


def build_prompt(task, context_contents):
    """Build a structured prompt for the GA agent based on task type and context."""
    prompt_parts = [
        f"# Task: {task['title']}",
        f"Type: {task['type']}",
        f"ID: {task['id']}",
        "",
    ]

    if context_contents:
        prompt_parts.append("## Context from previous tasks:")
        for key, content in context_contents.items():
            prompt_parts.append(f"\n### {key}\n{content}\n")

    prompt_parts.append("## Instructions:")

    if task["type"] == "research":
        prompt_parts.append(
            "Research the topic thoroughly. Produce a structured summary with:\n"
            "- Key findings (bullet points)\n"
            "- Relevant links/references\n"
            "- Recommendations for next steps\n"
            "Format output as Markdown."
        )
    elif task["type"] == "design":
        prompt_parts.append(
            "Design a solution based on the research context above. Produce:\n"
            "- Architecture overview\n"
            "- Key decisions with rationale\n"
            "- Interface/API definitions\n"
            "- File structure if applicable\n"
            "Format output as Markdown."
        )
    elif task["type"] == "verify":
        prompt_parts.append(
            "Verify the implementation described in context. Check:\n"
            "- Correctness against requirements\n"
            "- Edge cases handled\n"
            "- Test coverage\n"
            "- Any issues found\n"
            "Format output as Markdown."
        )
    else:
        prompt_parts.append("Complete the task as described. Format output as Markdown.")

    return "\n".join(prompt_parts)


def execute_task(task):
    """Execute a single task: read context, build prompt, (agent runs), write results."""
    task_id = task["id"]
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Claiming task {task_id}: {task['title']}")

    if not claim_task(task_id):
        print(f"[WARN] Failed to claim task {task_id}")
        return

    # Read context refs
    context_contents = {}
    context_refs = task.get("inputs", {}).get("context_refs", [])
    for ref in context_refs:
        content = read_context(ref)
        if content:
            context_contents[ref] = content

    # Build prompt for GA agent
    prompt = build_prompt(task, context_contents)

    # --- GA Agent Execution ---
    # The prompt is written to a file that the GA agent picks up.
    # In reflect mode, we output the prompt and the GA framework handles execution.
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Executing task {task_id} ({task['type']})")

    # Output prompt for GA agent framework
    output_key = f"{task_id}-{task['type']}-output"

    # Return the prompt as the reflect output — GA framework will run it
    # and call back with results via the on_complete callback
    return {
        "task_id": task_id,
        "prompt": prompt,
        "output_key": output_key,
    }


def on_task_complete(task_id, output_key, result_content):
    """Called when GA agent finishes executing the task prompt."""
    # Write result to context store
    write_context(
        key=output_key,
        content_type="finding",
        content=result_content,
        source_task=task_id,
        tags=[f"task:{task_id}"],
    )

    # Complete the task
    complete_task(task_id, summary=result_content[:200], context_keys=[output_key])
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Task {task_id} completed")


def on_task_error(task_id, error_msg):
    """Called when GA agent fails to execute the task."""
    fail_task(task_id, error_msg)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Task {task_id} failed: {error_msg}")


# --- Main Loop ---

def main():
    """Main polling loop."""
    if not PROJECT_ID:
        print("[ERROR] HIVE_PROJECT_ID environment variable not set")
        print("Usage: HIVE_PROJECT_ID=<project_id> python hive_v2_worker.py")
        return

    print(f"[Hive v2 Worker] Starting: project={PROJECT_ID}, worker={WORKER_NAME}")
    print(f"[Hive v2 Worker] Polling {GA_MANAGER_URL} every {INTERVAL}s")

    while True:
        try:
            task = fetch_pending_task()
            if task:
                result = execute_task(task)
                if result:
                    # In a real GA reflect setup, the framework calls on_task_complete
                    # Here we simulate: the prompt is the output for the GA to process
                    print(f"[PROMPT for GA] Task {result['task_id']}:")
                    print(result["prompt"][:500])
                    print("---")
            else:
                pass  # No pending tasks, will poll again
        except Exception as e:
            print(f"[ERROR] Unexpected: {e}")

        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify script syntax**

Run: `python -c "import ast; ast.parse(open('hive_v2_worker.py').read()); print('OK')" `
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add hive_v2_worker.py
git commit -m "feat(hive2): add GA Worker reflect script for Hive v2 task polling"
```
