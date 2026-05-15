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

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].Modified > sessions[j].Modified
	})
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
		if currentType == "" || currentContent.Len() == 0 {
			currentContent.Reset()
			return
		}
		text := strings.TrimSpace(currentContent.String())
		if text == "" {
			currentContent.Reset()
			return
		}

		if currentType == "response" {
			subSteps := parseResponseBlock(text, currentTimestamp)
			steps = append(steps, subSteps...)
		} else {
			// Prompt: extract the user text from JSON
			userText := extractPromptText(text)
			steps = append(steps, models.ReplayStep{
				Type:      "prompt",
				Timestamp: currentTimestamp,
				Content:   userText,
			})
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

// extractPromptText pulls the user message text from the JSON prompt block
func extractPromptText(raw string) string {
	// Look for "text": "..." pattern (the actual user message)
	re := regexp.MustCompile(`"text"\s*:\s*"((?:[^"\\]|\\.)*)`)
	matches := re.FindAllStringSubmatch(raw, -1)
	if len(matches) == 0 {
		return raw
	}
	// Collect all text fields (there may be multiple content blocks)
	var parts []string
	for _, m := range matches {
		text := m[1]
		// Unescape basic JSON escapes
		text = strings.ReplaceAll(text, `\n`, "\n")
		text = strings.ReplaceAll(text, `\"`, `"`)
		text = strings.ReplaceAll(text, `\\`, `\`)
		if strings.TrimSpace(text) != "" {
			parts = append(parts, strings.TrimSpace(text))
		}
	}
	if len(parts) == 0 {
		return raw
	}
	return strings.Join(parts, "\n\n")
}

// parseResponseBlock parses a GA response block (Python list format)
// Format: [{'type': 'thinking', 'thinking': '...'}, {'type': 'text', 'text': '...'}]
func parseResponseBlock(text string, timestamp string) []models.ReplayStep {
	steps := make([]models.ReplayStep, 0)

	// Extract thinking blocks: 'thinking': '...' (handle multiline with escaped quotes)
	thinkingRe := regexp.MustCompile(`'thinking'\s*:\s*'((?:[^'\\]|\\.|'')*)'`)
	thinkMatches := thinkingRe.FindAllStringSubmatch(text, -1)
	for _, m := range thinkMatches {
		content := unescapePythonStr(m[1])
		if strings.TrimSpace(content) != "" {
			steps = append(steps, models.ReplayStep{
				Type:      "thinking",
				Timestamp: timestamp,
				Content:   content,
			})
		}
	}

	// Extract tool_use blocks: 'type': 'tool_use', ... 'name': '...'
	if strings.Contains(text, "'type': 'tool_use'") {
		nameRe := regexp.MustCompile(`'name'\s*:\s*'([^']*)'`)
		inputRe := regexp.MustCompile(`'input'\s*:\s*(\{[^}]*\})`)
		names := nameRe.FindAllStringSubmatch(text, -1)
		inputs := inputRe.FindAllStringSubmatch(text, -1)
		for i, nm := range names {
			content := "Tool: " + nm[1]
			if i < len(inputs) {
				content += "\n" + inputs[i][1]
			}
			steps = append(steps, models.ReplayStep{
				Type:      "tool_use",
				Timestamp: timestamp,
				Content:   content,
				ToolName:  nm[1],
			})
		}
	}

	// Extract text blocks: 'type': 'text', 'text': '...'
	textRe := regexp.MustCompile(`'type'\s*:\s*'text'\s*,\s*'text'\s*:\s*'((?:[^'\\]|\\.|'')*)'`)
	textMatches := textRe.FindAllStringSubmatch(text, -1)
	for _, m := range textMatches {
		content := unescapePythonStr(m[1])
		if strings.TrimSpace(content) != "" {
			steps = append(steps, models.ReplayStep{
				Type:      "response",
				Timestamp: timestamp,
				Content:   content,
			})
		}
	}

	// If nothing was parsed, show raw text
	if len(steps) == 0 {
		steps = append(steps, models.ReplayStep{
			Type:      "response",
			Timestamp: timestamp,
			Content:   text,
		})
	}

	return steps
}

func unescapePythonStr(s string) string {
	s = strings.ReplaceAll(s, `\n`, "\n")
	s = strings.ReplaceAll(s, `\t`, "\t")
	s = strings.ReplaceAll(s, `\'`, "'")
	s = strings.ReplaceAll(s, `\\`, `\`)
	return s
}
