package hive2

import "time"

// TaskType defines the kind of work a task performs.
type TaskType string

const (
	TaskTypeResearch   TaskType = "research"
	TaskTypeDesign     TaskType = "design"
	TaskTypeImplement  TaskType = "implement"
	TaskTypeVerify     TaskType = "verify"
)

// TaskStatus represents the lifecycle state of a task.
type TaskStatus string

const (
	TaskStatusPending  TaskStatus = "pending"
	TaskStatusBlocked  TaskStatus = "blocked"
	TaskStatusRunning  TaskStatus = "running"
	TaskStatusDone     TaskStatus = "done"
	TaskStatusFailed   TaskStatus = "failed"
	TaskStatusStalled  TaskStatus = "stalled"
)

// ExecutorType identifies who/what executes a task.
type ExecutorType string

const (
	ExecutorGA          ExecutorType = "ga"
	ExecutorClaudeCode  ExecutorType = "claude_code"
	ExecutorHuman       ExecutorType = "human"
)

// ProjectStatus represents the lifecycle state of a project.
type ProjectStatus string

const (
	ProjectStatusRunning   ProjectStatus = "running"
	ProjectStatusPaused    ProjectStatus = "paused"
	ProjectStatusCompleted ProjectStatus = "completed"
	ProjectStatusFailed    ProjectStatus = "failed"
)

// Priority controls scheduling order.
type Priority string

const (
	PriorityHigh   Priority = "high"
	PriorityNormal Priority = "normal"
	PriorityLow    Priority = "low"
)

// TaskInputs holds references to context needed by a task.
type TaskInputs struct {
	ContextRefs []string `json:"context_refs"`
}

// TaskOutputs describes what a task produces.
type TaskOutputs struct {
	ContextKeys []string `json:"context_keys"`
	Files       []string `json:"files"`
}

// Task represents a single unit of work in a project's task graph.
type Task struct {
	ID               string      `json:"id"`
	Type             TaskType    `json:"type"`
	Title            string      `json:"title"`
	Status           TaskStatus  `json:"status"`
	Executor         ExecutorType `json:"executor"`
	DependsOn        []string    `json:"depends_on"`
	Inputs           TaskInputs  `json:"inputs"`
	Outputs          TaskOutputs `json:"outputs"`
	AssignedTo       string      `json:"assigned_to,omitempty"`
	StartedAt        *time.Time  `json:"started_at,omitempty"`
	FinishedAt       *time.Time  `json:"finished_at,omitempty"`
	BudgetMinutes    int         `json:"budget_minutes"`
	LogFile          string      `json:"log_file,omitempty"`
	Error            string      `json:"error,omitempty"`
	RequiresApproval bool        `json:"requires_approval"`
}

// ExecutorConfig defines how executors are configured for a project.
type ExecutorConfig struct {
	GALlmNo           int  `json:"ga_llm_no"`
	GAWorkers         int  `json:"ga_workers"`
	ClaudeCodeEnabled bool `json:"claude_code_enabled"`
}

// AutomationConfig controls which lifecycle gates require human approval.
type AutomationConfig struct {
	AutoDispatchGA                  bool `json:"auto_dispatch_ga"`
	AutoDispatchClaude              bool `json:"auto_dispatch_claude"`
	RequireApprovalBeforeImplement  bool `json:"require_approval_before_implement"`
	RequireApprovalBeforeVerify     bool `json:"require_approval_before_verify"`
}

// TaskCount is a summary of task states for a project.
type TaskCount struct {
	Total   int `json:"total"`
	Done    int `json:"done"`
	Running int `json:"running"`
	Pending int `json:"pending"`
	Failed  int `json:"failed"`
}

// WebhookConfig describes a webhook endpoint for project events.
type WebhookConfig struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	Format string   `json:"format"`
}

// Project is the top-level record for a Hive v2 project.
type Project struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Objective      string         `json:"objective"`
	ProjectDir     string         `json:"project_dir,omitempty"`
	Status         ProjectStatus  `json:"status"`
	Priority       Priority       `json:"priority"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	BudgetMinutes  int            `json:"budget_minutes"`
	ElapsedMinutes int            `json:"elapsed_minutes"`
	ExecutorConfig ExecutorConfig `json:"executor_config"`
	Automation     AutomationConfig `json:"automation"`
	TaskCount      TaskCount      `json:"task_count"`
	Webhooks       []WebhookConfig `json:"webhooks"`
}

// ContextEntry records a piece of context produced during a project.
type ContextEntry struct {
	Key        string    `json:"key"`
	File       string    `json:"file"`
	Type       string    `json:"type"`
	SourceTask string    `json:"source_task"`
	Tags       []string  `json:"tags"`
	CreatedAt  time.Time `json:"created_at"`
}

// FileChange records a file modification event during a project.
type FileChange struct {
	File      string    `json:"file"`
	Action    string    `json:"action"`
	TaskID    string    `json:"task_id"`
	Timestamp time.Time `json:"timestamp"`
	SizeBytes int64     `json:"size_bytes"`
}

// HiveGlobalConfig holds system-wide limits for Hive v2.
type HiveGlobalConfig struct {
	MaxConcurrentProjects   int  `json:"max_concurrent_projects"`
	MaxGAWorkersTotal       int  `json:"max_ga_workers_total"`
	MaxClaudeSessionsTotal  int  `json:"max_claude_sessions_total"`
	WorkerPoolShared        bool `json:"worker_pool_shared"`
}
