package handlers

import (
	"encoding/json"
	"net/http"

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
	for key, value := range body {
		if key == "llm_no" || key == "" {
			continue // already handled above / skip empty keys
		}
		if managerOnly[key] {
			continue // manager-level only, frontend handles optimistically
		}
		cfgCmd := map[string]interface{}{
			"cmd":   "set_config",
			"key":   key,
			"value": value,
		}
		if err := h.manager.SendCommand(id, cfgCmd); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
