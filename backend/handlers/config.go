package handlers

import (
	"encoding/json"
	"net/http"

	"ga_manager/services"
)

// ConfigHandler handles mykey.py configuration API
type ConfigHandler struct {
	svc *services.ConfigService
}

// NewConfigHandler creates a new config handler
func NewConfigHandler(svc *services.ConfigService) *ConfigHandler {
	return &ConfigHandler{svc: svc}
}

// GetMasked returns mykey.py with API keys masked
// GET /api/config/mykey
func (h *ConfigHandler) GetMasked(w http.ResponseWriter, r *http.Request) {
	content, err := h.svc.GetMyKeyMasked()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"content": content,
		"exists":  true,
	})
}

// GetRaw returns raw mykey.py source (advanced mode)
// GET /api/config/mykey/raw
func (h *ConfigHandler) GetRaw(w http.ResponseWriter, r *http.Request) {
	content, err := h.svc.GetMyKeyRaw()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"content": content})
}

// SaveRaw saves raw mykey.py source
// PUT /api/config/mykey/raw
func (h *ConfigHandler) SaveRaw(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SaveMyKeyRaw(body.Content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

// GetTemplates returns available provider templates
// GET /api/config/templates
func (h *ConfigHandler) GetTemplates(w http.ResponseWriter, r *http.Request) {
	templates, err := h.svc.GetTemplates()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, templates)
}

// Status returns whether mykey.py exists
// GET /api/config/status
func (h *ConfigHandler) Status(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"mykey_exists": h.svc.HasMyKey(),
	})
}

// GetLLMs returns the list of available LLM configurations
// GET /api/config/llms
func (h *ConfigHandler) GetLLMs(w http.ResponseWriter, r *http.Request) {
	llms, err := h.svc.GetLLMList()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, llms)
}
