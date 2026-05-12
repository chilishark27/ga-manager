package handlers

import (
	"encoding/json"
	"net/http"

	"ga_manager/models"
	"ga_manager/services"
)

// InstanceHandler handles REST API requests for instance management
type InstanceHandler struct {
	manager *services.InstanceManager
}

// NewInstanceHandler creates a new handler
func NewInstanceHandler(mgr *services.InstanceManager) *InstanceHandler {
	return &InstanceHandler{manager: mgr}
}

// List returns all instances
// GET /api/instances
func (h *InstanceHandler) List(w http.ResponseWriter, r *http.Request) {
	instances := h.manager.List()
	writeJSON(w, http.StatusOK, instances)
}

// Create spawns a new instance
// POST /api/instances
func (h *InstanceHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req models.CreateInstanceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	inst, err := h.manager.Create(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, inst)
}

// Get returns a single instance
// GET /api/instances/{id}
func (h *InstanceHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	inst, err := h.manager.Get(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, inst)
}

// Start launches a stopped instance
// POST /api/instances/{id}/start
func (h *InstanceHandler) Start(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.manager.Start(id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "running"})
}

// Stop terminates an instance
// POST /api/instances/{id}/stop
func (h *InstanceHandler) Stop(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.manager.Stop(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// Remove stops and removes an instance
// DELETE /api/instances/{id}
func (h *InstanceHandler) Remove(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.manager.Remove(id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "removed"})
}

// Logs returns recent log lines for an instance
// GET /api/instances/{id}/logs
func (h *InstanceHandler) Logs(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	logs, err := h.manager.GetLogs(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"logs": logs})
}

// GetConfig returns the instance configuration
// GET /api/instances/{id}/config
func (h *InstanceHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	config, err := h.manager.GetConfig(id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(config))
}

// SaveConfig saves the instance configuration
// PUT /api/instances/{id}/config
func (h *InstanceHandler) SaveConfig(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Config string `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.manager.SaveConfig(id, body.Config); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
