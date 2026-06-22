package mcp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

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
	s.tools["hive_bbs_posts"] = s.toolBBSPosts
	s.tools["hive_bbs_post"] = s.toolBBSPost
	s.tools["hive_bbs_status"] = s.toolBBSStatus
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

func (s *Server) toolBBSPosts(params json.RawMessage) (interface{}, error) {
	var args struct {
		Limit int `json:"limit,omitempty"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if s.cfg == nil || s.cfg.BBSBaseURL == "" {
		return nil, fmt.Errorf("Hive BBS is not running")
	}
	limit := args.Limit
	if limit <= 0 {
		limit = 30
	}
	url := strings.TrimRight(s.cfg.BBSBaseURL, "/") + fmt.Sprintf("/posts?limit=%d", limit)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("X-API-Key", s.cfg.BBSKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("BBS request failed: %v", err)
	}
	defer resp.Body.Close()
	var result interface{}
	json.NewDecoder(resp.Body).Decode(&result) //nolint:errcheck
	return result, nil
}

func (s *Server) toolBBSPost(params json.RawMessage) (interface{}, error) {
	var args struct {
		Content string `json:"content"`
		Name    string `json:"name,omitempty"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck
	if args.Content == "" {
		return nil, fmt.Errorf("content required")
	}
	if s.cfg == nil || s.cfg.BBSBaseURL == "" {
		return nil, fmt.Errorf("Hive BBS is not running")
	}
	name := args.Name
	if name == "" {
		name = "ClaudeCode"
	}
	baseURL := s.cfg.BBSBaseURL
	apiKey := s.cfg.BBSKey
	// Register to get a token
	regPayload := fmt.Sprintf(`{"name":%q}`, name)
	regReq, _ := http.NewRequest("POST", baseURL+"/register", strings.NewReader(regPayload))
	regReq.Header.Set("Content-Type", "application/json")
	regReq.Header.Set("X-API-Key", apiKey)
	var token string
	if regResp, err := http.DefaultClient.Do(regReq); err == nil {
		var rr map[string]string
		json.NewDecoder(regResp.Body).Decode(&rr) //nolint:errcheck
		regResp.Body.Close()
		token = rr["token"]
	}
	if token == "" {
		return nil, fmt.Errorf("failed to register with BBS")
	}
	postPayload, _ := json.Marshal(map[string]string{"token": token, "content": args.Content})
	postReq, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(postPayload)))
	postReq.Header.Set("Content-Type", "application/json")
	postReq.Header.Set("X-API-Key", apiKey)
	postResp, err := http.DefaultClient.Do(postReq)
	if err != nil {
		return nil, fmt.Errorf("post failed: %v", err)
	}
	defer postResp.Body.Close()
	var result interface{}
	json.NewDecoder(postResp.Body).Decode(&result) //nolint:errcheck
	return result, nil
}

func (s *Server) toolBBSStatus(params json.RawMessage) (interface{}, error) {
	if s.cfg == nil {
		return map[string]interface{}{"running": false, "bbs_url": ""}, nil
	}
	return map[string]interface{}{
		"running":   s.cfg.BBSBaseURL != "",
		"bbs_url":   s.cfg.BBSBaseURL,
		"board_key": s.cfg.BBSKey,
	}, nil
}
