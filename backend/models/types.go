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
	Autonomous bool   `json:"autonomous"`
	Goal       string `json:"goal,omitempty"`
	Reflect    bool   `json:"reflect"`

	// Stats
	TotalTurns int    `json:"total_turns"`
	TokensUsed int    `json:"tokens_used"`
	LastError  string `json:"last_error,omitempty"`
}

// CreateInstanceRequest is the payload for POST /api/instances
type CreateInstanceRequest struct {
	Name       string `json:"name"`
	LLMNo      int    `json:"llm_no"`
	Autonomous bool   `json:"autonomous"`
	Goal       string `json:"goal"`
}

// AppConfig holds the manager-level configuration
type AppConfig struct {
	GARoot       string `json:"ga_root"`
	Port         int    `json:"port"`
	MaxInstances int    `json:"max_instances"`
	PythonPath   string `json:"python_path"`
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
}
