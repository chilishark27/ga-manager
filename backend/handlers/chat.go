package handlers

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"ga_manager/services"
)

// ChatHandler handles chat-related REST API requests.
// Note: Real-time streaming goes through WebSocket (ws.go).
// These REST endpoints are for simple request/response patterns.
type ChatHandler struct {
	manager *services.InstanceManager
}

// NewChatHandler creates a new chat handler.
func NewChatHandler(manager *services.InstanceManager) *ChatHandler {
	return &ChatHandler{manager: manager}
}

// SendMessage handles POST /api/instances/{id}/chat
// Sends a message to the bridge via stdin pipe. Response comes via WebSocket stream.
func (h *ChatHandler) SendMessage(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body struct {
		Message string   `json:"message"`
		Images  []string `json:"images,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if body.Message == "" {
		writeError(w, http.StatusBadRequest, "message is required")
		return
	}

	// Send command to bridge stdin (include images if provided)
	cmd := map[string]interface{}{
		"cmd":  "send",
		"text": body.Message,
	}
	if len(body.Images) > 0 {
		cmd["images"] = body.Images
	}

	if err := h.manager.SendCommand(id, cmd); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]string{
		"status":  "accepted",
		"message": "Message sent to bridge. Connect to WebSocket for streaming response.",
	})
}

// ClearChat handles POST /api/instances/{id}/clear
func (h *ChatHandler) ClearChat(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cmd := map[string]interface{}{"cmd": "clear"}
	_ = h.manager.SendCommand(id, cmd)
	writeJSON(w, http.StatusOK, map[string]string{"status": "cleared", "id": id})
}

// Interrupt handles POST /api/instances/{id}/interrupt
func (h *ChatHandler) Interrupt(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	cmd := map[string]interface{}{
		"cmd": "abort",
	}

	if err := h.manager.SendCommand(id, cmd); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "interrupted"})
}

// UpdateConfig handles PATCH /api/instances/{id}/config
func (h *ChatHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Handle llm_no separately — bridge expects {"cmd":"switch_llm","idx":N}
	if llmNoRaw, ok := body["llm_no"]; ok {
		if llmNoFloat, ok := llmNoRaw.(float64); ok {
			idx := int(llmNoFloat)
			_ = h.manager.UpdateLLMNo(id, idx)
			switchCmd := map[string]interface{}{
				"cmd": "switch_llm",
				"idx": idx,
			}
			if err := h.manager.SendCommand(id, switchCmd); err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
		}
	}

	// Send remaining config keys individually — bridge expects {"cmd":"set_config","key":"x","value":y}
	// Keys that are manager-level only (not forwarded to bridge)
	managerOnly := map[string]bool{"im_channel": true}
	// Keys that should also update in-memory instance state
	featureKeys := map[string]bool{"autonomous": true, "reflect": true, "goal": true, "dev_mode": true}
	for key, value := range body {
		if key == "llm_no" || key == "" {
			continue // already handled above / skip empty keys
		}
		// Update in-memory state for feature keys
		if featureKeys[key] {
			_ = h.manager.UpdateFeature(id, key, value)
		}
		if managerOnly[key] {
			continue // manager-level only, frontend handles optimistically
		}
		cfgCmd := map[string]interface{}{
			"cmd":   "set_config",
			"key":   key,
			"value": value,
		}
		// Don't fail if bridge is not running — state is saved in memory
		_ = h.manager.SendCommand(id, cfgCmd)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

// extractSessionPreview reads the first user prompt from a session file (max 80 chars).
func extractSessionPreview(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)
	inPrompt := false
	var jsonBuf strings.Builder
	braceCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "=== Prompt ===") {
			inPrompt = true
			jsonBuf.Reset()
			braceCount = 0
			continue
		}
		if strings.HasPrefix(line, "=== Response ===") || (strings.HasPrefix(line, "=== ") && inPrompt && jsonBuf.Len() > 0) {
			break
		}
		if inPrompt {
			jsonBuf.WriteString(line)
			jsonBuf.WriteByte('\n')
			braceCount += strings.Count(line, "{") - strings.Count(line, "}")
			if braceCount <= 0 && jsonBuf.Len() > 2 {
				break
			}
		}
	}

	raw := strings.TrimSpace(jsonBuf.String())
	if raw == "" {
		return ""
	}

	// Try to parse as JSON message
	var msg struct {
		Content interface{} `json:"content"`
	}
	if err := json.Unmarshal([]byte(raw), &msg); err == nil {
		switch c := msg.Content.(type) {
		case string:
			return truncatePreview(c)
		case []interface{}:
			for _, item := range c {
				if m, ok := item.(map[string]interface{}); ok {
					if m["type"] == "text" {
						if text, ok := m["text"].(string); ok {
							return truncatePreview(text)
						}
					}
				}
			}
		}
	}

	// Fallback: treat as plain text
	lines := strings.Split(raw, "\n")
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && l != "{" && l != "}" && !strings.HasPrefix(l, "\"role\"") && !strings.HasPrefix(l, "\"content\"") {
			return truncatePreview(l)
		}
	}
	return ""
}

func truncatePreview(s string) string {
	s = strings.TrimSpace(s)
	// Remove common prefixes like [定时任务] etc
	if idx := strings.Index(s, "\n"); idx > 0 && idx < 100 {
		s = s[:idx]
	}
	runes := []rune(s)
	if len(runes) > 60 {
		return string(runes[:60]) + "..."
	}
	return s
}

// ListSessions handles GET /api/instances/{id}/sessions
// Returns list of session log files from model_responses directory and L4 archive
func (h *ChatHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	_, err := h.manager.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "instance not found")
		return
	}

	// model_responses is at <ga_root>/temp/model_responses/
	gaRoot := h.manager.GetGARoot()
	sessDir := filepath.Join(gaRoot, "temp", "model_responses")

	type SessionInfo struct {
		Name     string `json:"name"`
		Modified string `json:"modified"`
		Size     int64  `json:"size"`
		Source   string `json:"source"`
		Preview  string `json:"preview"`
	}

	var sessions []SessionInfo

	// Scan current model_responses
	entries, err := os.ReadDir(sessDir)
	if err == nil {
		for _, e := range entries {
			if e.IsDir() || (!strings.HasSuffix(e.Name(), ".txt") && !strings.HasSuffix(e.Name(), ".log")) {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			preview := extractSessionPreview(filepath.Join(sessDir, e.Name()))
			sessions = append(sessions, SessionInfo{
				Name:     e.Name(),
				Modified: info.ModTime().Format("2006-01-02 15:04"),
				Size:     info.Size(),
				Source:   "current",
				Preview:  preview,
			})
		}
	}

	// Also scan L4 archive directory for uncompressed session files
	l4Dir := filepath.Join(gaRoot, "memory", "L4_raw_sessions")
	l4Entries, err := os.ReadDir(l4Dir)
	if err == nil {
		for _, e := range l4Entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
				continue
			}
			if e.Name() == "all_histories.txt" || e.Name() == "compress_session.py" {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			preview := extractSessionPreview(filepath.Join(l4Dir, e.Name()))
			sessions = append(sessions, SessionInfo{
				Name:     "L4/" + e.Name(),
				Modified: info.ModTime().Format("2006-01-02 15:04"),
				Size:     info.Size(),
				Source:   "archive",
				Preview:  preview,
			})
		}
	}

	// Sort by modified desc (newest first)
	for i := 0; i < len(sessions); i++ {
		for j := i + 1; j < len(sessions); j++ {
			if sessions[j].Modified > sessions[i].Modified {
				sessions[i], sessions[j] = sessions[j], sessions[i]
			}
		}
	}

	writeJSON(w, http.StatusOK, sessions)
}

// GetSessionContent handles GET /api/instances/{id}/sessions/{file}
// Returns raw content of a session file
func (h *ChatHandler) GetSessionContent(w http.ResponseWriter, r *http.Request) {
	_ = r.PathValue("id")
	fileName := r.PathValue("file")

	gaRoot := h.manager.GetGARoot()

	// Security: prevent path traversal (but allow "L4/" prefix)
	if strings.Contains(fileName, "..") || strings.Contains(fileName, "\\") {
		writeError(w, http.StatusBadRequest, "invalid file name")
		return
	}

	var filePath string
	if strings.HasPrefix(fileName, "L4/") {
		// Archive file
		actualName := strings.TrimPrefix(fileName, "L4/")
		if strings.Contains(actualName, "/") {
			writeError(w, http.StatusBadRequest, "invalid file name")
			return
		}
		filePath = filepath.Join(gaRoot, "memory", "L4_raw_sessions", actualName)
	} else {
		if strings.Contains(fileName, "/") {
			writeError(w, http.StatusBadRequest, "invalid file name")
			return
		}
		filePath = filepath.Join(gaRoot, "temp", "model_responses", fileName)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		writeError(w, http.StatusNotFound, "session file not found")
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}
