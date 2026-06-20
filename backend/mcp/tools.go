package mcp

import (
	"encoding/json"
	"fmt"

	"ga_manager/hive2"
)

func (s *Server) registerTools() {
	s.tools["hive_task_list"] = s.toolTaskList
	s.tools["hive_task_claim"] = s.toolTaskClaim
	s.tools["hive_task_update"] = s.toolTaskUpdate
	s.tools["hive_context_read"] = s.toolContextRead
	s.tools["hive_context_write"] = s.toolContextWrite
	s.tools["hive_artifact_register"] = s.toolArtifactRegister
	s.tools["hive_project_summary"] = s.toolProjectSummary
}

func (s *Server) toolTaskList(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		Status    string `json:"status,omitempty"`
		Type      string `json:"type,omitempty"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" {
		return nil, fmt.Errorf("project_id required")
	}

	tasks, err := s.store.GetTasks(args.ProjectID)
	if err != nil {
		return nil, err
	}

	var filtered []*hive2.Task
	for _, t := range tasks {
		if args.Status != "" && string(t.Status) != args.Status {
			continue
		}
		if args.Type != "" && string(t.Type) != args.Type {
			continue
		}
		filtered = append(filtered, t)
	}
	return filtered, nil
}

func (s *Server) toolTaskClaim(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		TaskID    string `json:"task_id"`
		Assignee  string `json:"assignee"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" || args.TaskID == "" {
		return nil, fmt.Errorf("project_id and task_id required")
	}
	if args.Assignee == "" {
		args.Assignee = "claude_code"
	}

	err := s.engine.ClaimTask(args.ProjectID, args.TaskID, args.Assignee)
	if err != nil {
		return nil, err
	}
	return map[string]string{"status": "claimed", "task_id": args.TaskID}, nil
}

func (s *Server) toolTaskUpdate(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string           `json:"project_id"`
		TaskID    string           `json:"task_id"`
		Status    string           `json:"status"` // "done" or "failed"
		Summary   string           `json:"summary,omitempty"`
		Error     string           `json:"error,omitempty"`
		Outputs   hive2.TaskOutputs `json:"outputs,omitempty"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" || args.TaskID == "" {
		return nil, fmt.Errorf("project_id and task_id required")
	}

	switch args.Status {
	case "done":
		return map[string]string{"status": "done"}, s.engine.CompleteTask(args.ProjectID, args.TaskID, args.Summary, args.Outputs)
	case "failed":
		return map[string]string{"status": "failed"}, s.engine.FailTask(args.ProjectID, args.TaskID, args.Error)
	default:
		return nil, fmt.Errorf("status must be 'done' or 'failed'")
	}
}

func (s *Server) toolContextRead(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
		Key       string `json:"key"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" || args.Key == "" {
		return nil, fmt.Errorf("project_id and key required")
	}

	body, err := s.context.ReadBody(args.ProjectID, args.Key)
	if err != nil {
		return nil, err
	}
	return map[string]string{"key": args.Key, "content": body}, nil
}

func (s *Server) toolContextWrite(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID  string   `json:"project_id"`
		Key        string   `json:"key"`
		Type       string   `json:"type"`
		Content    string   `json:"content"`
		SourceTask string   `json:"source_task,omitempty"`
		Tags       []string `json:"tags,omitempty"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" || args.Key == "" || args.Content == "" {
		return nil, fmt.Errorf("project_id, key, and content required")
	}
	if args.Type == "" {
		args.Type = "finding"
	}

	err := s.context.Write(args.ProjectID, args.Key, args.Type, args.Content, args.SourceTask, args.Tags)
	if err != nil {
		return nil, err
	}
	return map[string]string{"status": "written", "key": args.Key}, nil
}

func (s *Server) toolArtifactRegister(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID   string `json:"project_id"`
		TaskID      string `json:"task_id"`
		FilePath    string `json:"file_path"`
		Description string `json:"description"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" || args.FilePath == "" {
		return nil, fmt.Errorf("project_id and file_path required")
	}

	change := hive2.FileChange{
		File:   args.FilePath,
		Action: "created",
		TaskID: args.TaskID,
	}
	if err := s.tracker.RecordChange(args.ProjectID, change); err != nil {
		return nil, err
	}
	return map[string]string{"status": "registered", "file": args.FilePath}, nil
}

func (s *Server) toolProjectSummary(params json.RawMessage) (interface{}, error) {
	var args struct {
		ProjectID string `json:"project_id"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.ProjectID == "" {
		return nil, fmt.Errorf("project_id required")
	}

	p, err := s.store.Load(args.ProjectID)
	if err != nil {
		return nil, err
	}

	tasks, _ := s.store.GetTasks(args.ProjectID)
	contextEntries, _ := s.context.List(args.ProjectID)

	return map[string]interface{}{
		"project":         p,
		"tasks":           tasks,
		"context_entries": len(contextEntries),
	}, nil
}
