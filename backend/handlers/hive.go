package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ga_manager/models"
)

type HiveHandler struct {
	mu        sync.Mutex
	cfg       *models.AppConfig
	running   bool
	bbsCmd    *exec.Cmd
	workers   []*exec.Cmd
	masterCmd *exec.Cmd
	port      int
	boardKey  string
	objective string
	budget    int
	startedAt time.Time
	logs      []string
}

func NewHiveHandler(cfg *models.AppConfig) *HiveHandler {
	return &HiveHandler{cfg: cfg, port: 58800}
}

func (h *HiveHandler) addLog(msg string) {
	h.logs = append(h.logs, fmt.Sprintf("[%s] %s", time.Now().Format("15:04:05"), msg))
	if len(h.logs) > 100 {
		h.logs = h.logs[len(h.logs)-100:]
	}
	log.Printf("[Hive] %s", msg)
}

func (h *HiveHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.running {
		h.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_running"})
		return
	}
	h.mu.Unlock()

	var body struct {
		Objective string `json:"objective"`
		Budget    int    `json:"budget_minutes"`
		Workers   int    `json:"workers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Objective == "" {
		writeError(w, http.StatusBadRequest, "objective is required")
		return
	}
	if body.Budget <= 0 {
		body.Budget = 180
	}
	if body.Workers <= 0 {
		body.Workers = 2
	}

	gaRoot := h.cfg.GARoot
	python := h.cfg.PythonPath
	if python != "" {
		if info, err := os.Stat(python); err == nil && info.IsDir() {
			found := false
			for _, name := range []string{"python.exe", "python3", "python"} {
				if _, err := os.Stat(filepath.Join(python, name)); err == nil {
					python = filepath.Join(python, name)
					found = true
					break
				}
			}
			if !found {
				h.logs = nil
				h.addLog("ERROR: python not found in directory: " + python)
				writeError(w, http.StatusInternalServerError, "python not found in directory: "+python)
				return
			}
		}
	}
	if python == "" {
		if p, err := exec.LookPath("python3"); err == nil {
			python = p
		} else if p, err := exec.LookPath("python"); err == nil {
			python = p
		} else {
			python = "python"
		}
	}

	h.logs = nil

	// Verify BBS script exists
	bbsScript := filepath.Join(gaRoot, "assets", "agent_bbs.py")
	if _, err := os.Stat(bbsScript); err != nil {
		h.addLog("ERROR: agent_bbs.py not found at " + bbsScript)
		writeError(w, http.StatusInternalServerError, "agent_bbs.py not found — check GA Root path")
		return
	}

	h.addLog("Checking dependencies...")

	depCheck := exec.Command(python, "-c", "import fastapi, uvicorn, multipart")
	depCheck.Dir = gaRoot
	if err := depCheck.Run(); err != nil {
		h.addLog("Installing dependencies (fastapi, uvicorn, python-multipart)...")
		install := exec.Command(python, "-m", "pip", "install", "fastapi", "uvicorn", "python-multipart", "--quiet")
		install.Dir = gaRoot
		out, installErr := install.CombinedOutput()
		if installErr != nil {
			h.addLog("ERROR: pip install failed: " + installErr.Error() + " " + string(out))
			writeError(w, http.StatusInternalServerError, "Failed to install dependencies: "+installErr.Error())
			return
		}
		h.addLog("Dependencies installed")
	}

	h.port = 58800 + rand.Intn(100)
	h.boardKey = fmt.Sprintf("hive-%d", time.Now().Unix())
	h.objective = body.Objective
	h.budget = body.Budget
	h.startedAt = time.Now()

	bbsCwd := filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
	os.MkdirAll(bbsCwd, 0755)

	h.addLog(fmt.Sprintf("Starting BBS on port %d...", h.port))
	h.bbsCmd = exec.Command(python, "-u", bbsScript,
		"--cwd", bbsCwd, "--port", fmt.Sprintf("%d", h.port), "--key", h.boardKey)
	h.bbsCmd.Dir = gaRoot
	var bbsStderr bytes.Buffer
	h.bbsCmd.Stdout = os.Stdout
	h.bbsCmd.Stderr = &bbsStderr
	if err := h.bbsCmd.Start(); err != nil {
		h.addLog("ERROR: " + err.Error())
		writeError(w, http.StatusInternalServerError, "failed to start BBS: "+err.Error())
		return
	}

	baseURL := fmt.Sprintf("http://127.0.0.1:%d", h.port)
	ready := false
	for i := 0; i < 20; i++ {
		time.Sleep(300 * time.Millisecond)
		req, _ := http.NewRequest("GET", baseURL+"/authors?key="+h.boardKey, nil)
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				ready = true
				break
			}
		}
	}
	if !ready {
		h.bbsCmd.Process.Kill()
		errMsg := bbsStderr.String()
		if errMsg != "" {
			h.addLog("ERROR: BBS stderr: " + errMsg)
		}
		h.addLog("ERROR: BBS timeout (6s)")
		writeError(w, http.StatusInternalServerError, "BBS failed to start: "+errMsg)
		return
	}
	h.addLog("BBS ready")

	// Post initial task
	regBody := `{"name":"Coordinator"}`
	regReq, _ := http.NewRequest("POST", baseURL+"/register", strings.NewReader(regBody))
	regReq.Header.Set("Content-Type", "application/json")
	regReq.Header.Set("X-API-Key", h.boardKey)
	var masterToken string
	if resp, err := http.DefaultClient.Do(regReq); err == nil {
		var rr map[string]string
		json.NewDecoder(resp.Body).Decode(&rr)
		resp.Body.Close()
		masterToken = rr["token"]
	}
	if masterToken != "" {
		task := fmt.Sprintf(`[Coordinator 任务分配] 目标: %s | 时间预算: %d分钟 | Worker数量: %d

重要规则：
1. 你是 Coordinator，负责拆分任务并明确指派给每个 Worker
2. 每个子任务必须标注 [指派: Worker-XXX]，确保不重复
3. Worker 只能执行指派给自己的任务，看到非自己的任务跳过
4. 完成后发帖汇报，等 Coordinator 验收

请立即拆分目标为 %d 个独立子任务并分别指派。`, body.Objective, body.Budget, body.Workers, body.Workers)
		payload, _ := json.Marshal(map[string]string{"token": masterToken, "content": task})
		pr, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(payload)))
		pr.Header.Set("Content-Type", "application/json")
		pr.Header.Set("X-API-Key", h.boardKey)
		http.DefaultClient.Do(pr)
		h.addLog("Task posted")
	}

	// Start workers (with faster check interval)
	h.addLog(fmt.Sprintf("Starting %d workers...", body.Workers))
	workerReflect := filepath.Join(gaRoot, "reflect", "agent_team_worker.py")

	// Create a patched copy with shorter poll interval for faster startup
	patchedReflect := filepath.Join(bbsCwd, "agent_team_worker_fast.py")
	if origData, err := os.ReadFile(workerReflect); err == nil {
		patched := strings.Replace(string(origData), "INTERVAL = 60", "INTERVAL = 10", 1)
		os.WriteFile(patchedReflect, []byte(patched), 0644)
		workerReflect = patchedReflect
		h.addLog("Worker poll interval: 10s (patched from 60s)")
	}

	h.workers = nil
	workerNames := []string{"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}
	for i := 0; i < body.Workers; i++ {
		suffix := workerNames[i%len(workerNames)]
		name := fmt.Sprintf("Worker-%s", suffix)
		cmd := exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"),
			"--reflect", workerReflect,
			"--base_url", baseURL, "--board_key", h.boardKey, "--name", name)
		cmd.Dir = gaRoot
		cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8")
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			h.addLog(fmt.Sprintf("Worker %s failed: %v", name, err))
			continue
		}
		h.workers = append(h.workers, cmd)
		h.addLog(fmt.Sprintf("Worker %s started (PID %d)", name, cmd.Process.Pid))
		// Monitor worker exit
		go func(c *exec.Cmd, wname string) {
			err := c.Wait()
			h.mu.Lock()
			if h.running {
				if err != nil {
					h.addLog(fmt.Sprintf("Worker %s exited with error: %v", wname, err))
				} else {
					h.addLog(fmt.Sprintf("Worker %s finished", wname))
				}
			}
			h.mu.Unlock()
		}(cmd, name)
	}

	// Start master
	goalState := map[string]interface{}{
		"objective": body.Objective, "budget_seconds": body.Budget * 60,
		"start_time": time.Now().Unix(), "turns_used": 0, "max_turns": 200, "status": "running",
	}
	goalData, _ := json.MarshalIndent(goalState, "", "  ")
	goalPath := filepath.Join(gaRoot, "temp", "goal_state.json")
	os.WriteFile(goalPath, goalData, 0644)

	goalReflect := filepath.Join(gaRoot, "reflect", "goal_mode.py")
	h.masterCmd = exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"), "--reflect", goalReflect)
	h.masterCmd.Dir = gaRoot
	h.masterCmd.Env = append(os.Environ(), "GOAL_STATE="+goalPath)
	h.masterCmd.Stdout = os.Stdout
	h.masterCmd.Stderr = os.Stderr
	if err := h.masterCmd.Start(); err != nil {
		h.addLog("Master failed: " + err.Error())
	} else {
		h.addLog(fmt.Sprintf("Master started (PID %d)", h.masterCmd.Process.Pid))
		go func(c *exec.Cmd) {
			err := c.Wait()
			h.mu.Lock()
			if h.running {
				if err != nil {
					h.addLog(fmt.Sprintf("Master exited with error: %v", err))
				} else {
					h.addLog("Master finished")
				}
			}
			h.mu.Unlock()
		}(h.masterCmd)
	}

	h.cfg.BBSBaseURL = baseURL
	h.cfg.BBSKey = h.boardKey
	h.mu.Lock()
	h.running = true
	h.mu.Unlock()
	h.addLog("Hive session ready")

	// Monitor child processes - if BBS dies, log but don't auto-stop
	// (user can manually stop or it will stop on budget expiry)
	go func() {
		if h.bbsCmd != nil {
			h.bbsCmd.Wait()
			h.mu.Lock()
			stillRunning := h.running
			h.mu.Unlock()
			if stillRunning {
				h.addLog("WARNING: BBS process exited, posts may not update")
			}
		}
	}()

	// Auto-stop when budget expires
	go func() {
		timeout := time.Duration(body.Budget) * time.Minute
		time.Sleep(timeout + 2*time.Minute)
		h.mu.Lock()
		if h.running {
			h.mu.Unlock()
			h.addLog(fmt.Sprintf("Budget expired (%d min), auto-stopping...", body.Budget))
			h.stopAll()
		} else {
			h.mu.Unlock()
		}
	}()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "running", "port": h.port, "board_key": h.boardKey,
		"workers": len(h.workers), "objective": body.Objective, "budget": body.Budget,
	})
}

func (h *HiveHandler) stopAll() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.running {
		return
	}
	// Save run record before stopping
	h.saveRunRecord()
	if h.masterCmd != nil && h.masterCmd.Process != nil {
		killProcessTree(h.masterCmd.Process.Pid)
		h.masterCmd = nil
	}
	for _, wk := range h.workers {
		if wk != nil && wk.Process != nil {
			killProcessTree(wk.Process.Pid)
		}
	}
	h.workers = nil
	if h.bbsCmd != nil && h.bbsCmd.Process != nil {
		killProcessTree(h.bbsCmd.Process.Pid)
		h.bbsCmd = nil
	}
	h.running = false
	h.cfg.BBSBaseURL = ""
	h.addLog("Stopped")
}

func (h *HiveHandler) Stop(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	running := h.running
	h.mu.Unlock()
	if !running {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_running"})
		return
	}
	h.addLog("Stopping...")
	h.stopAll()
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (h *HiveHandler) Status(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	resp := map[string]interface{}{
		"running":   h.running,
		"port":      h.port,
		"board_key": h.boardKey,
		"objective": h.objective,
		"budget":    h.budget,
		"workers":   len(h.workers),
		"logs":      h.logs,
	}
	if h.running {
		resp["elapsed_minutes"] = int(time.Since(h.startedAt).Minutes())
	}
	h.mu.Unlock()
	writeJSON(w, http.StatusOK, resp)
}

func (h *HiveHandler) proxyGet(w http.ResponseWriter, path string, query string) {
	if h.cfg.BBSBaseURL == "" {
		writeJSON(w, http.StatusOK, []interface{}{})
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
		writeJSON(w, http.StatusOK, []interface{}{})
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

func (h *HiveHandler) Poll(w http.ResponseWriter, r *http.Request) {
	h.proxyGet(w, "/poll", r.URL.RawQuery)
}

func (h *HiveHandler) PostMessage(w http.ResponseWriter, r *http.Request) {
	if h.cfg.BBSBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "Hive not running")
		return
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Content == "" {
		writeError(w, http.StatusBadRequest, "content required")
		return
	}

	// Use master token to post
	baseURL := h.cfg.BBSBaseURL
	// Register or reuse master
	regBody := `{"name":"user"}`
	regReq, _ := http.NewRequest("POST", baseURL+"/register", strings.NewReader(regBody))
	regReq.Header.Set("Content-Type", "application/json")
	regReq.Header.Set("X-API-Key", h.cfg.BBSKey)
	var token string
	if resp, err := http.DefaultClient.Do(regReq); err == nil {
		var rr map[string]string
		json.NewDecoder(resp.Body).Decode(&rr)
		resp.Body.Close()
		token = rr["token"]
	}
	if token == "" {
		writeError(w, http.StatusInternalServerError, "failed to register")
		return
	}

	payload, _ := json.Marshal(map[string]string{"token": token, "content": body.Content})
	pr, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(payload)))
	pr.Header.Set("Content-Type", "application/json")
	pr.Header.Set("X-API-Key", h.cfg.BBSKey)
	resp, err := http.DefaultClient.Do(pr)
	if err != nil {
		writeError(w, http.StatusBadGateway, "post failed")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	io.Copy(w, resp.Body)
}

func (h *HiveHandler) saveRunRecord() {
	gaRoot := h.cfg.GARoot
	histDir := filepath.Join(gaRoot, "temp", "hive_history")
	os.MkdirAll(histDir, 0755)

	// Fetch posts from BBS
	var posts []interface{}
	if h.cfg.BBSBaseURL != "" {
		req, _ := http.NewRequest("GET", h.cfg.BBSBaseURL+"/posts?limit=100", nil)
		req.Header.Set("X-API-Key", h.cfg.BBSKey)
		if resp, err := http.DefaultClient.Do(req); err == nil {
			json.NewDecoder(resp.Body).Decode(&posts)
			resp.Body.Close()
		}
	}

	record := map[string]interface{}{
		"objective":  h.objective,
		"budget":     h.budget,
		"workers":    len(h.workers),
		"started_at": h.startedAt,
		"stopped_at": time.Now().Format(time.RFC3339),
		"posts":      posts,
		"logs":       h.logs,
	}
	data, _ := json.MarshalIndent(record, "", "  ")
	filename := fmt.Sprintf("run_%s.json", time.Now().Format("20060102_150405"))
	os.WriteFile(filepath.Join(histDir, filename), data, 0644)
}

// ListRunHistory returns saved Hive run records
func (h *HiveHandler) ListRunHistory(w http.ResponseWriter, r *http.Request) {
	gaRoot := h.cfg.GARoot
	histDir := filepath.Join(gaRoot, "temp", "hive_history")
	entries, err := os.ReadDir(histDir)
	if err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	type RunSummary struct {
		File      string `json:"file"`
		Objective string `json:"objective"`
		StoppedAt string `json:"stopped_at"`
		Posts     int    `json:"posts"`
	}
	var results []RunSummary
	for i := len(entries) - 1; i >= 0 && len(results) < 20; i-- {
		e := entries[i]
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(histDir, e.Name()))
		if err != nil {
			continue
		}
		var rec map[string]interface{}
		if json.Unmarshal(data, &rec) != nil {
			continue
		}
		obj, _ := rec["objective"].(string)
		stopped, _ := rec["stopped_at"].(string)
		postsArr, _ := rec["posts"].([]interface{})
		results = append(results, RunSummary{
			File: e.Name(), Objective: obj, StoppedAt: stopped, Posts: len(postsArr),
		})
	}
	writeJSON(w, http.StatusOK, results)
}

// GetRunRecord returns a specific run record
func (h *HiveHandler) GetRunRecord(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")
	if file == "" {
		writeError(w, http.StatusBadRequest, "file required")
		return
	}
	gaRoot := h.cfg.GARoot
	path := filepath.Join(gaRoot, "temp", "hive_history", filepath.Base(file))
	data, err := os.ReadFile(path)
	if err != nil {
		writeError(w, http.StatusNotFound, "record not found")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func killProcessTree(pid int) {
	if pid <= 0 {
		return
	}
	// On Windows, taskkill /T kills the entire tree
	if exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", pid)).Run() == nil {
		return
	}
	// Fallback: just kill the process
	if p, err := os.FindProcess(pid); err == nil {
		p.Kill()
	}
}
