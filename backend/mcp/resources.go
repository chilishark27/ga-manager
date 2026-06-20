package mcp

import (
	"encoding/json"
	"fmt"
)

func (s *Server) listResources() map[string]interface{} {
	return map[string]interface{}{
		"resources": []map[string]string{
			{"uri": "hive://project/summary", "name": "Project Summary", "description": "Overview of the active project"},
			{"uri": "hive://tasks/pending", "name": "Pending Tasks", "description": "Tasks ready for execution"},
			{"uri": "hive://tasks/all", "name": "All Tasks", "description": "Complete task list with status"},
			{"uri": "hive://context/list", "name": "Context Entries", "description": "Shared knowledge base entries"},
			{"uri": "hive://artifacts/list", "name": "Artifacts", "description": "Produced file list"},
		},
	}
}

func (s *Server) readResource(params json.RawMessage) interface{} {
	var args struct {
		URI string `json:"uri"`
	}
	json.Unmarshal(params, &args) //nolint:errcheck

	// For now, resources need a project context. Use first running project.
	projects, _ := s.store.List()
	var projectID string
	for _, p := range projects {
		if p.Status == "running" {
			projectID = p.ID
			break
		}
	}
	if projectID == "" && len(projects) > 0 {
		projectID = projects[0].ID
	}
	if projectID == "" {
		return map[string]interface{}{"contents": []map[string]string{{"uri": args.URI, "text": "No projects found"}}}
	}

	var text string
	switch args.URI {
	case "hive://project/summary":
		result, _ := s.toolProjectSummary(mustMarshal(map[string]string{"project_id": projectID}))
		data, _ := json.MarshalIndent(result, "", "  ")
		text = string(data)
	case "hive://tasks/pending":
		result, _ := s.toolTaskList(mustMarshal(map[string]string{"project_id": projectID, "status": "pending"}))
		data, _ := json.MarshalIndent(result, "", "  ")
		text = string(data)
	case "hive://tasks/all":
		result, _ := s.toolTaskList(mustMarshal(map[string]string{"project_id": projectID}))
		data, _ := json.MarshalIndent(result, "", "  ")
		text = string(data)
	case "hive://context/list":
		entries, _ := s.context.List(projectID)
		data, _ := json.MarshalIndent(entries, "", "  ")
		text = string(data)
	case "hive://artifacts/list":
		changes, _ := s.tracker.GetChanges(projectID)
		data, _ := json.MarshalIndent(changes, "", "  ")
		text = string(data)
	default:
		text = fmt.Sprintf("Unknown resource: %s", args.URI)
	}

	return map[string]interface{}{"contents": []map[string]string{{"uri": args.URI, "mimeType": "application/json", "text": text}}}
}

func mustMarshal(v interface{}) json.RawMessage {
	data, _ := json.Marshal(v)
	return data
}
