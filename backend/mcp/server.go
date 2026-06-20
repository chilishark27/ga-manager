package mcp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"ga_manager/hive2"
)

// JSON-RPC 2.0 types
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Response struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Server handles MCP protocol over stdio
type Server struct {
	store   *hive2.ProjectStore
	engine  *hive2.TaskEngine
	context *hive2.ContextStore
	tracker *hive2.FileTracker
	tools   map[string]ToolHandler
	input   io.Reader
	output  io.Writer
}

type ToolHandler func(params json.RawMessage) (interface{}, error)

func NewServer(store *hive2.ProjectStore, engine *hive2.TaskEngine, ctx *hive2.ContextStore, tracker *hive2.FileTracker) *Server {
	s := &Server{
		store:   store,
		engine:  engine,
		context: ctx,
		tracker: tracker,
		tools:   make(map[string]ToolHandler),
		input:   os.Stdin,
		output:  os.Stdout,
	}
	s.registerTools()
	return s
}

// NewServerWithIO creates a server with custom IO (for testing)
func NewServerWithIO(store *hive2.ProjectStore, engine *hive2.TaskEngine, ctx *hive2.ContextStore, tracker *hive2.FileTracker, in io.Reader, out io.Writer) *Server {
	s := &Server{
		store:   store,
		engine:  engine,
		context: ctx,
		tracker: tracker,
		tools:   make(map[string]ToolHandler),
		input:   in,
		output:  out,
	}
	s.registerTools()
	return s
}

// Run starts the server loop (blocking). Reads JSON-RPC from input, writes responses to output.
func (s *Server) Run() {
	scanner := bufio.NewScanner(s.input)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024) // 1MB buffer
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			s.writeError(nil, -32700, "Parse error")
			continue
		}
		s.handleRequest(req)
	}
}

// HandleSingleRequest processes one request (for testing)
func (s *Server) HandleSingleRequest(data []byte) []byte {
	var req Request
	if err := json.Unmarshal(data, &req); err != nil {
		resp := Response{JSONRPC: "2.0", Error: &RPCError{Code: -32700, Message: "Parse error"}}
		out, _ := json.Marshal(resp)
		return out
	}
	return s.handleRequestBytes(req)
}

func (s *Server) handleRequest(req Request) {
	data := s.handleRequestBytes(req)
	fmt.Fprintf(s.output, "%s\n", data)
}

func (s *Server) handleRequestBytes(req Request) []byte {
	var resp Response
	resp.JSONRPC = "2.0"
	resp.ID = req.ID

	switch req.Method {
	case "initialize":
		resp.Result = map[string]interface{}{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}, "resources": map[string]interface{}{}},
			"serverInfo":      map[string]interface{}{"name": "ga-hive", "version": "1.0.0"},
		}
	case "tools/list":
		resp.Result = s.listTools()
	case "tools/call":
		resp.Result = s.callTool(req.Params)
	case "resources/list":
		resp.Result = s.listResources()
	case "resources/read":
		resp.Result = s.readResource(req.Params)
	default:
		resp.Error = &RPCError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", req.Method)}
	}
	data, _ := json.Marshal(resp)
	return data
}

func (s *Server) writeError(id interface{}, code int, msg string) {
	resp := Response{JSONRPC: "2.0", ID: id, Error: &RPCError{Code: code, Message: msg}}
	data, _ := json.Marshal(resp)
	fmt.Fprintf(s.output, "%s\n", data)
}

func (s *Server) listTools() map[string]interface{} {
	var toolList []map[string]interface{}
	for name := range s.tools {
		toolList = append(toolList, map[string]interface{}{"name": name, "description": toolDescriptions[name]})
	}
	return map[string]interface{}{"tools": toolList}
}

func (s *Server) callTool(params json.RawMessage) interface{} {
	var req struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	json.Unmarshal(params, &req) //nolint:errcheck
	handler, ok := s.tools[req.Name]
	if !ok {
		return map[string]interface{}{"content": []map[string]string{{"type": "text", "text": "Tool not found: " + req.Name}}, "isError": true}
	}
	result, err := handler(req.Arguments)
	if err != nil {
		return map[string]interface{}{"content": []map[string]string{{"type": "text", "text": err.Error()}}, "isError": true}
	}
	text, _ := json.MarshalIndent(result, "", "  ")
	return map[string]interface{}{"content": []map[string]string{{"type": "text", "text": string(text)}}}
}

var toolDescriptions = map[string]string{
	"hive_task_list":         "List tasks in a project, optionally filtered by status and type",
	"hive_task_claim":        "Claim a pending task for execution",
	"hive_task_update":       "Update task status (complete or fail)",
	"hive_context_read":      "Read a context entry by key",
	"hive_context_write":     "Write a new context entry",
	"hive_artifact_register": "Register a produced artifact file",
	"hive_project_summary":   "Get project overview with task counts and status",
}
