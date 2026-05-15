package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"ga_manager/models"
)

type ReplayHandler struct {
	gaRoot string
}

func NewReplayHandler(gaRoot string) *ReplayHandler {
	return &ReplayHandler{gaRoot: gaRoot}
}

func (h *ReplayHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	respDir := filepath.Join(h.gaRoot, "temp", "model_responses")
	entries, err := os.ReadDir(respDir)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"sessions": []string{}})
		return
	}

	type sessionInfo struct {
		Filename string `json:"filename"`
		Size     int64  `json:"size"`
		Modified string `json:"modified"`
	}
	sessions := make([]sessionInfo, 0)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, "model_responses_") || !strings.HasSuffix(name, ".txt") {
			continue
		}
		info, _ := e.Info()
		s := sessionInfo{Filename: name}
		if info != nil {
			s.Size = info.Size()
			s.Modified = info.ModTime().Format("2006-01-02 15:04:05")
		}
		sessions = append(sessions, s)
	}

	// Sort newest first
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].Modified > sessions[j].Modified
	})

	// Limit to 50
	if len(sessions) > 50 {
		sessions = sessions[:50]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"sessions": sessions})
}

func (h *ReplayHandler) GetSession(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	if filename == "" || strings.Contains(filename, "..") || strings.Contains(filename, "/") || strings.Contains(filename, "\\") {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	fullPath := filepath.Join(h.gaRoot, "temp", "model_responses", filename)
	if _, err := os.Stat(fullPath); err != nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "read failed")
		return
	}

	// Limit to 2MB
	if len(content) > 2*1024*1024 {
		content = content[:2*1024*1024]
	}

	steps := parseSessionLog(string(content))
	writeJSON(w, http.StatusOK, models.ReplaySession{
		Filename: filename,
		Steps:    steps,
	})
}

var promptSep = regexp.MustCompile(`=== Prompt === (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`)
var responseSep = regexp.MustCompile(`=== Response === (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})`)

func parseSessionLog(content string) []models.ReplayStep {
	steps := make([]models.ReplayStep, 0)
	lines := strings.Split(content, "\n")

	var currentType string
	var currentTimestamp string
	var currentContent strings.Builder

	flushCurrent := func() {
		if currentType != "" && currentContent.Len() > 0 {
			text := strings.TrimSpace(currentContent.String())
			if len(text) > 10000 {
				text = text[:10000] + "\n... [truncated]"
			}
			if currentType == "response" {
				// Try to parse response into sub-steps
				subSteps := parseResponseBlock(text, currentTimestamp)
				steps = append(steps, subSteps...)
			} else {
				steps = append(steps, models.ReplayStep{
					Type:      currentType,
					Timestamp: currentTimestamp,
					Content:   text,
				})
			}
		}
		currentContent.Reset()
	}

	for _, line := range lines {
		if m := promptSep.FindStringSubmatch(line); m != nil {
			flushCurrent()
			currentType = "prompt"
			currentTimestamp = m[1]
			continue
		}
		if m := responseSep.FindStringSubmatch(line); m != nil {
			flushCurrent()
			currentType = "response"
			currentTimestamp = m[1]
			continue
		}
		if currentType != "" {
			currentContent.WriteString(line)
			currentContent.WriteString("\n")
		}
	}
	flushCurrent()

	return steps
}

func parseResponseBlock(text string, timestamp string) []models.ReplayStep {
	steps := make([]models.ReplayStep, 0)

	// Simple heuristic parsing for thinking/tool_use/text blocks
	if strings.Contains(text, `"type": "thinking"`) || strings.Contains(text, `"thinking":`) {
		// Extract thinking blocks
		thinkStart := strings.Index(text, `"thinking"`)
		if thinkStart >= 0 {
			steps = append(steps, models.ReplayStep{
				Type:      "thinking",
				Timestamp: timestamp,
				Content:   extractJSONValue(text[thinkStart:], "thinking"),
			})
		}
	}

	if strings.Contains(text, `"type": "tool_use"`) || strings.Contains(text, `"name":`) {
		// Extract tool use
		toolName := extractJSONValue(text, "name")
		steps = append(steps, models.ReplayStep{
			Type:      "tool_use",
			Timestamp: timestamp,
			Content:   text,
			ToolName:  toolName,
		})
	} else if len(steps) == 0 {
		// Plain response
		steps = append(steps, models.ReplayStep{
			Type:      "response",
			Timestamp: timestamp,
			Content:   text,
		})
	}

	if len(steps) == 0 {
		steps = append(steps, models.ReplayStep{
			Type:      "response",
			Timestamp: timestamp,
			Content:   text,
		})
	}

	return steps
}

func extractJSONValue(text string, key string) string {
	pattern := `"` + key + `"\s*:\s*"([^"]*)`
	re := regexp.MustCompile(pattern)
	m := re.FindStringSubmatch(text)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}
