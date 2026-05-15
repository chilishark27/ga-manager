package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ga_manager/services"
)

type VisionHandler struct {
	manager *services.InstanceManager
	gaRoot  string
}

func NewVisionHandler(mgr *services.InstanceManager, gaRoot string) *VisionHandler {
	return &VisionHandler{manager: mgr, gaRoot: gaRoot}
}

func (h *VisionHandler) ListScreenshots(w http.ResponseWriter, r *http.Request) {
	tempDir := filepath.Join(h.gaRoot, "temp")
	var screenshots []map[string]interface{}

	entries, err := os.ReadDir(tempDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"screenshots": []string{}})
		return
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		if strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") {
			info, _ := e.Info()
			item := map[string]interface{}{
				"name": name,
			}
			if info != nil {
				item["size"] = info.Size()
				item["modified"] = info.ModTime().Format("2006-01-02 15:04:05")
			}
			screenshots = append(screenshots, item)
		}
	}

	// Sort by modification time (newest first)
	sort.Slice(screenshots, func(i, j int) bool {
		mi, _ := screenshots[i]["modified"].(string)
		mj, _ := screenshots[j]["modified"].(string)
		return mi > mj
	})

	// Limit to 20 most recent
	if len(screenshots) > 20 {
		screenshots = screenshots[:20]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"screenshots": screenshots})
}

func (h *VisionHandler) GetScreenshot(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		http.Error(w, "invalid filename", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(h.gaRoot, "temp", filename)
	if _, err := os.Stat(fullPath); err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".png") {
		w.Header().Set("Content-Type", "image/png")
	} else {
		w.Header().Set("Content-Type", "image/jpeg")
	}
	http.ServeFile(w, r, fullPath)
}

func (h *VisionHandler) TakeScreenshot(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	cmd := map[string]interface{}{
		"cmd":  "send",
		"text": "请截取当前屏幕截图并保存到temp目录",
	}
	if err := h.manager.SendCommand(id, cmd); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "screenshot_requested"})
}
