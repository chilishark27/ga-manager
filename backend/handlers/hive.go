package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"ga_manager/models"
)

type HiveHandler struct {
	cfg *models.AppConfig
}

func NewHiveHandler(cfg *models.AppConfig) *HiveHandler {
	return &HiveHandler{cfg: cfg}
}

func (h *HiveHandler) proxyGet(w http.ResponseWriter, path string, query string) {
	if h.cfg.BBSBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "BBS not configured")
		return
	}
	url := strings.TrimRight(h.cfg.BBSBaseURL, "/") + path
	if query != "" {
		url += "?" + query
	}
	req, _ := http.NewRequest("GET", url, nil)
	if h.cfg.BBSKey != "" {
		req.Header.Set("X-API-Key", h.cfg.BBSKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("BBS unreachable: %v", err))
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *HiveHandler) proxyPost(w http.ResponseWriter, r *http.Request, path string) {
	if h.cfg.BBSBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "BBS not configured")
		return
	}
	url := strings.TrimRight(h.cfg.BBSBaseURL, "/") + path
	req, _ := http.NewRequest("POST", url, r.Body)
	req.Header.Set("Content-Type", "application/json")
	if h.cfg.BBSKey != "" {
		req.Header.Set("X-API-Key", h.cfg.BBSKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("BBS unreachable: %v", err))
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *HiveHandler) GetPosts(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, "/posts", r.URL.RawQuery)
}

func (h *HiveHandler) GetAuthors(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, "/authors", "")
}

func (h *HiveHandler) GetCount(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, "/count", r.URL.RawQuery)
}

func (h *HiveHandler) Poll(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, "/poll", r.URL.RawQuery)
}

func (h *HiveHandler) CreatePost(w http.ResponseWriter, r *http.Request) {
	h.proxyPost(w, r, "/post")
}

func (h *HiveHandler) Register(w http.ResponseWriter, r *http.Request) {
	h.proxyPost(w, r, "/register")
}

func (h *HiveHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"base_url": h.cfg.BBSBaseURL,
		"key":      h.cfg.BBSKey,
	})
}

func (h *HiveHandler) SetConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseURL string `json:"base_url"`
		Key     string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	h.cfg.BBSBaseURL = body.BaseURL
	h.cfg.BBSKey = body.Key
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}