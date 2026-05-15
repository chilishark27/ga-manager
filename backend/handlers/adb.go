package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"ga_manager/models"
)

type ADBHandler struct{}

func NewADBHandler() *ADBHandler {
	return &ADBHandler{}
}

var serialPattern = regexp.MustCompile(`^[a-zA-Z0-9._:%-]+$`)

func (h *ADBHandler) ListDevices(w http.ResponseWriter, r *http.Request) {
	cmd := exec.Command("adb", "devices", "-l")
	out, err := cmd.Output()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"devices": []models.ADBDevice{},
			"error":   "adb not available: " + err.Error(),
		})
		return
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	devices := make([]models.ADBDevice, 0)
	for _, line := range lines[1:] { // skip header
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		dev := models.ADBDevice{
			Serial: parts[0],
			State:  parts[1],
		}
		for _, p := range parts[2:] {
			if strings.HasPrefix(p, "model:") {
				dev.Model = strings.TrimPrefix(p, "model:")
			} else if strings.HasPrefix(p, "product:") {
				dev.Product = strings.TrimPrefix(p, "product:")
			}
		}
		devices = append(devices, dev)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"devices": devices})
}

func (h *ADBHandler) Screenshot(w http.ResponseWriter, r *http.Request) {
	serial := r.PathValue("serial")
	if !serialPattern.MatchString(serial) {
		writeError(w, http.StatusBadRequest, "invalid serial")
		return
	}

	cmd := exec.Command("adb", "-s", serial, "exec-out", "screencap", "-p")
	out, err := cmd.Output()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "screencap failed: "+err.Error())
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Length", strconv.Itoa(len(out)))
	w.Write(out)
}

func (h *ADBHandler) Tap(w http.ResponseWriter, r *http.Request) {
	serial := r.PathValue("serial")
	if !serialPattern.MatchString(serial) {
		writeError(w, http.StatusBadRequest, "invalid serial")
		return
	}

	var body struct {
		X int `json:"x"`
		Y int `json:"y"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if body.X < 0 || body.X > 9999 || body.Y < 0 || body.Y > 9999 {
		writeError(w, http.StatusBadRequest, "coordinates out of range (0-9999)")
		return
	}

	cmd := exec.Command("adb", "-s", serial, "shell", "input", "tap",
		fmt.Sprintf("%d", body.X), fmt.Sprintf("%d", body.Y))
	if err := cmd.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "tap failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *ADBHandler) Swipe(w http.ResponseWriter, r *http.Request) {
	serial := r.PathValue("serial")
	if !serialPattern.MatchString(serial) {
		writeError(w, http.StatusBadRequest, "invalid serial")
		return
	}

	var body struct {
		X1       int `json:"x1"`
		Y1       int `json:"y1"`
		X2       int `json:"x2"`
		Y2       int `json:"y2"`
		Duration int `json:"duration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	for _, v := range []int{body.X1, body.Y1, body.X2, body.Y2} {
		if v < 0 || v > 9999 {
			writeError(w, http.StatusBadRequest, "coordinates out of range (0-9999)")
			return
		}
	}
	if body.Duration <= 0 {
		body.Duration = 300
	}

	cmd := exec.Command("adb", "-s", serial, "shell", "input", "swipe",
		fmt.Sprintf("%d", body.X1), fmt.Sprintf("%d", body.Y1),
		fmt.Sprintf("%d", body.X2), fmt.Sprintf("%d", body.Y2),
		fmt.Sprintf("%d", body.Duration))
	if err := cmd.Run(); err != nil {
		writeError(w, http.StatusInternalServerError, "swipe failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
