package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"ga_manager/services"
)

// FeaturesHandler handles extended feature endpoints.
type FeaturesHandler struct {
	manager *services.InstanceManager
}

// NewFeaturesHandler creates a new features handler.
func NewFeaturesHandler(mgr *services.InstanceManager) *FeaturesHandler {
	return &FeaturesHandler{manager: mgr}
}

// GetLogs returns log entries for an instance.
func (h *FeaturesHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	logs, err := h.manager.GetLogsReal(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

// GetChatHistory returns chat history for an instance.
func (h *FeaturesHandler) GetChatHistory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	messages, err := h.manager.ExportChat(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

// ExportChat exports chat history as JSON download.
func (h *FeaturesHandler) ExportChat(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	messages, err := h.manager.ExportChat(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}

	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	var data []byte
	contentType := "application/json"
	filename := fmt.Sprintf("chat_%s.json", id)

	switch format {
	case "markdown", "md":
		contentType = "text/markdown"
		filename = fmt.Sprintf("chat_%s.md", id)
		md := "# Chat History\n\n"
		for _, m := range messages {
			md += fmt.Sprintf("**%s** (%s):\n%s\n\n", m.Role, m.Time, m.Content)
		}
		data = []byte(md)
	default:
		data, _ = json.MarshalIndent(messages, "", "  ")
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// GetHealth returns health status for all instances.
func (h *FeaturesHandler) GetHealth(w http.ResponseWriter, r *http.Request) {
	statuses := h.manager.GetHealthStatus()
	writeJSON(w, http.StatusOK, statuses)
}

// GetResources returns resource stats for all instances.
func (h *FeaturesHandler) GetResources(w http.ResponseWriter, r *http.Request) {
	resources := h.manager.GetResources()
	writeJSON(w, http.StatusOK, resources)
}

// StartAll starts all stopped instances.
func (h *FeaturesHandler) StartAll(w http.ResponseWriter, r *http.Request) {
	results := h.manager.BatchStart()
	writeJSON(w, http.StatusOK, results)
}

// StopAll stops all running instances.
func (h *FeaturesHandler) StopAll(w http.ResponseWriter, r *http.Request) {
	results := h.manager.BatchStop()
	writeJSON(w, http.StatusOK, results)
}

// RestartInstance restarts a single instance (stop + start).
func (h *FeaturesHandler) RestartInstance(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.manager.Stop(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.manager.Start(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarted"})
}

// ForwardMessage forwards a message between instances.
func (h *FeaturesHandler) ForwardMessage(w http.ResponseWriter, r *http.Request) {
	fromID := r.PathValue("id")
	var body struct {
		TargetID string `json:"target_id"`
		Message  string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.TargetID == "" || body.Message == "" {
		writeError(w, http.StatusBadRequest, "target_id and message required")
		return
	}
	if err := h.manager.ForwardMessage(fromID, body.TargetID, body.Message); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "forwarded"})
}

// GetScheduledTasks returns scheduled tasks for an instance.
func (h *FeaturesHandler) GetScheduledTasks(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	tasks := h.manager.GetScheduledTasks(id)
	writeJSON(w, http.StatusOK, tasks)
}

// AddScheduledTask adds a new scheduled task.
func (h *FeaturesHandler) AddScheduledTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Cron    string `json:"cron"`
		Command string `json:"command"`
		Name    string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.Cron == "" || body.Command == "" {
		writeError(w, http.StatusBadRequest, "cron and command required")
		return
	}
	task, err := h.manager.AddScheduledTask(id, body.Name, body.Cron, body.Command)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

// RemoveScheduledTask removes a scheduled task by ID.
func (h *FeaturesHandler) RemoveScheduledTask(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("taskId")
	if err := h.manager.RemoveScheduledTask(taskID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

// QuickCommand executes a quick command on an instance.
func (h *FeaturesHandler) QuickCommand(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		CommandID string `json:"command_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.CommandID == "" {
		writeError(w, http.StatusBadRequest, "command_id required")
		return
	}
	if err := h.manager.ExecuteQuickCommand(id, body.CommandID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "executed"})
}

// GetTokenStats returns token usage statistics for an instance.
func (h *FeaturesHandler) GetTokenStats(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	stats, err := h.manager.GetTokenStats(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
