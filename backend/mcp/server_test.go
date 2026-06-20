package mcp

import (
	"bytes"
	"encoding/json"
	"testing"

	"ga_manager/hive2"
)

func setupTestServer(t *testing.T) (*Server, string) {
	dir := t.TempDir()
	store := hive2.NewProjectStore(dir)
	bus := hive2.NewEventBus()
	engine := hive2.NewTaskEngine(store, bus)
	ctx := hive2.NewContextStore(store)
	tracker := hive2.NewFileTracker(store, bus)

	cfg := hive2.ExecutorConfig{GALlmNo: 0, GAWorkers: 1, ClaudeCodeEnabled: true}
	p, _ := store.Create("测试MCP", "目标", 60, cfg)
	engine.AddTasks(p.ID, []*hive2.Task{ //nolint:errcheck
		{ID: "01", Type: hive2.TaskTypeResearch, Title: "调研", Executor: hive2.ExecutorGA},
		{ID: "02", Type: hive2.TaskTypeImplement, Title: "实现", Executor: hive2.ExecutorClaudeCode, DependsOn: []string{"01"}},
	})

	var out bytes.Buffer
	s := NewServerWithIO(store, engine, ctx, tracker, nil, &out)
	return s, p.ID
}

func callServer(s *Server, method string, params interface{}) Response {
	p, _ := json.Marshal(params)
	req, _ := json.Marshal(Request{JSONRPC: "2.0", ID: 1, Method: method, Params: p})
	respBytes := s.HandleSingleRequest(req)
	var resp Response
	json.Unmarshal(respBytes, &resp) //nolint:errcheck
	return resp
}

func TestMCPInitialize(t *testing.T) {
	s, _ := setupTestServer(t)
	resp := callServer(s, "initialize", nil)
	if resp.Error != nil {
		t.Fatalf("error: %s", resp.Error.Message)
	}
}

func TestMCPToolsList(t *testing.T) {
	s, _ := setupTestServer(t)
	resp := callServer(s, "tools/list", nil)
	if resp.Error != nil {
		t.Fatal(resp.Error.Message)
	}
	result, _ := json.Marshal(resp.Result)
	if !bytes.Contains(result, []byte("hive_task_list")) {
		t.Error("missing hive_task_list tool")
	}
}

func TestMCPToolTaskList(t *testing.T) {
	s, projID := setupTestServer(t)
	resp := callServer(s, "tools/call", map[string]interface{}{
		"name":      "hive_task_list",
		"arguments": map[string]string{"project_id": projID, "status": "pending"},
	})
	if resp.Error != nil {
		t.Fatal(resp.Error.Message)
	}
}

func TestMCPToolContextWriteAndRead(t *testing.T) {
	s, projID := setupTestServer(t)

	// Write
	callServer(s, "tools/call", map[string]interface{}{
		"name": "hive_context_write",
		"arguments": map[string]interface{}{
			"project_id": projID,
			"key":        "test_entry",
			"type":       "finding",
			"content":    "hello world",
			"tags":       []string{"test"},
		},
	})

	// Read
	resp := callServer(s, "tools/call", map[string]interface{}{
		"name":      "hive_context_read",
		"arguments": map[string]string{"project_id": projID, "key": "test_entry"},
	})
	if resp.Error != nil {
		t.Fatal(resp.Error.Message)
	}
	result, _ := json.Marshal(resp.Result)
	if !bytes.Contains(result, []byte("hello world")) {
		t.Error("context read did not return written content")
	}
}

func TestMCPResourcesList(t *testing.T) {
	s, _ := setupTestServer(t)
	resp := callServer(s, "resources/list", nil)
	if resp.Error != nil {
		t.Fatal(resp.Error.Message)
	}
	result, _ := json.Marshal(resp.Result)
	if !bytes.Contains(result, []byte("hive://project/summary")) {
		t.Error("missing project/summary resource")
	}
}
