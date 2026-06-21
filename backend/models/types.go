package models

import (
	"time"
)

// InstanceState represents the lifecycle state of a GA instance
type InstanceState string

const (
	StateStarting InstanceState = "starting"
	StateRunning  InstanceState = "running"
	StateBusy     InstanceState = "busy"
	StateStopped  InstanceState = "stopped"
	StateError    InstanceState = "error"
)

// Instance is the public DTO returned by API (no mutex, pure data)
type Instance struct {
	ID        string        `json:"id"`
	Name      string        `json:"name"`
	State     InstanceState `json:"state"`
	PID       int           `json:"pid"`
	Port      int           `json:"port"`
	LLMNo     int           `json:"llm_no"`
	CreatedAt time.Time     `json:"created_at"`
	Uptime    int64         `json:"uptime"`

	// Feature toggles
	Autonomous    bool   `json:"autonomous"`
	Goal          string `json:"goal,omitempty"`
	Reflect       bool   `json:"reflect"`
	DevMode       bool   `json:"dev_mode"`
	ProjectDir    string `json:"project_dir,omitempty"`
	ReflectScript string `json:"reflect_script,omitempty"`

	// Stats
	TotalTurns int    `json:"total_turns"`
	TokensUsed int    `json:"tokens_used"`
	LastError  string `json:"last_error,omitempty"`
}

// CreateInstanceRequest is the payload for POST /api/instances
type CreateInstanceRequest struct {
	Name          string `json:"name"`
	LLMNo         int    `json:"llm_no"`
	Autonomous    bool   `json:"autonomous"`
	Goal          string `json:"goal"`
	GARoot        string `json:"ga_root"`
	Reflect       bool   `json:"reflect"`
	ProjectDir    string `json:"project_dir"`
	ReflectScript string `json:"reflect_script"`
}

// AppConfig holds the manager-level configuration
type AppConfig struct {
	GARoot       string `json:"ga_root"`
	Port         int    `json:"port"`
	MaxInstances int    `json:"max_instances"`
	PythonPath   string `json:"python_path"`
	BBSBaseURL   string `json:"bbs_base_url,omitempty"`
	BBSKey       string `json:"bbs_key,omitempty"`
}

// AdoptInstanceRequest is the payload for POST /api/instances/adopt
type AdoptInstanceRequest struct {
	Port   int    `json:"port"`
	Name   string `json:"name"`
	GARoot string `json:"ga_root"`
}

// MyKeyProvider represents one LLM provider entry in mykey.py
type MyKeyProvider struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	ModelID string `json:"model_id"`
}

// MyKeyConfig represents the full mykey.py configuration
type MyKeyConfig struct {
	Providers []MyKeyProvider `json:"providers"`
	RawSource string         `json:"raw_source,omitempty"`
}

// LLMConfig represents a single LLM configuration extracted from mykey.py
type LLMConfig struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Type  string `json:"type"`
	Key   string `json:"key"`
	Model string `json:"model,omitempty"`
}

// TokenRecord represents a single token usage entry.
type TokenRecord struct {
	Timestamp    time.Time `json:"timestamp"`
	InputTokens  int64     `json:"input_tokens"`
	OutputTokens int64     `json:"output_tokens"`
	CacheCreated int64     `json:"cache_created"`
	CacheRead    int64     `json:"cache_read"`
}

// TokenStats holds cumulative token usage for an instance.
type TokenStats struct {
	InputTokens  int64         `json:"input_tokens"`
	OutputTokens int64         `json:"output_tokens"`
	CacheCreated int64         `json:"cache_created"`
	CacheRead    int64         `json:"cache_read"`
	TotalTurns   int           `json:"total_turns"`
	CacheHitRate float64       `json:"cache_hit_rate"`
	History      []TokenRecord `json:"history"`
}

// SkillNode represents a node in the skill tree graph.
type SkillNode struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Type        string `json:"type"` // sop, script, index, data
	AccessCount int    `json:"accessCount"`
	LastAccess  string `json:"lastAccess"`
	Size        int64  `json:"size"`
}

// SkillEdge represents a dependency edge in the skill tree.
type SkillEdge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Type string `json:"type"` // reference, import
}

// SkillTree is the full skill tree response.
type SkillTree struct {
	Nodes []SkillNode `json:"nodes"`
	Edges []SkillEdge `json:"edges"`
}

// ReplayStep represents one step in a task replay.
type ReplayStep struct {
	Type      string `json:"type"` // prompt, thinking, tool_use, tool_result, response
	Timestamp string `json:"timestamp,omitempty"`
	Content   string `json:"content"`
	ToolName  string `json:"tool_name,omitempty"`
}

// ReplaySession represents a parsed session for replay.
type ReplaySession struct {
	Filename string       `json:"filename"`
	Steps    []ReplayStep `json:"steps"`
}

// ADBDevice represents a connected Android device.
type ADBDevice struct {
	Serial  string `json:"serial"`
	State   string `json:"state"`
	Model   string `json:"model"`
	Product string `json:"product"`
}
