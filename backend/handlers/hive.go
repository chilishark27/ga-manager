package handlers

import (
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
	if python == "" {
		python = "python"
	}

	h.logs = nil
	h.addLog("Checking dependencies...")

	depCheck := exec.Command(python, "-c", "import fastapi, uvicorn, multipart")
	depCheck.Dir = gaRoot
	if err := depCheck.Run(); err != nil {
		h.addLog("Installing dependencies...")
		install := exec.Command(python, "-m", "pip", "install", "fastapi", "uvicorn", "python-multipart", "--quiet")
		install.Dir = gaRoot
		install.Run()
	}

	h.port = 58800 + rand.Intn(100)
	h.boardKey = fmt.Sprintf("hive-%d", time.Now().Unix())
	h.objective = body.Objective
	h.budget = body.Budget
	h.startedAt = time.Now()

	bbsCwd := filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
	os.MkdirAll(bbsCwd, 0755)

	h.addLog(fmt.Sprintf("Starting BBS on port %d...", h.port))
	bbsScript := filepath.Join(gaRoot, "assets", "agent_bbs.py")
	h.bbsCmd = exec.Command(python, "-u", bbsScript,
		"--cwd", bbsCwd, "--port", fmt.Sprintf("%d", h.port), "--key", h.boardKey)
	h.bbsCmd.Dir = gaRoot
	h.bbsCmd.Stdout = os.Stdout
	h.bbsCmd.Stderr = os.Stderr
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
		h.addLog("ERROR: BBS timeout")
		writeError(w, http.StatusInternalServerError, "BBS failed to start")
		return
	}
	h.addLog("BBS ready")

	// Post initial task
	regBody := `{"name":"hive-master"}`
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
		task := fmt.Sprintf("[任务分配] 目标: %s | 时间: %d分钟 | Worker请认领执行，完成后回复。", body.Objective, body.Budget)
		payload, _ := json.Marshal(map[string]string{"token": masterToken, "content": task})
		pr, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(payload)))
		pr.Header.Set("Content-Type", "application/json")
		pr.Header.Set("X-API-Key", h.boardKey)
		http.DefaultClient.Do(pr)
		h.addLog("Task posted")
	}

	// Start workers
	h.addLog(fmt.Sprintf("Starting %d workers...", body.Workers))
	workerReflect := filepath.Join(gaRoot, "reflect", "agent_team_worker.py")
	h.workers = nil
	for i := 0; i < body.Workers; i++ {
		name := fmt.Sprintf("hive-worker-%d", i+1)
		cmd := exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"),
			"--reflect", workerReflect,
			"--base_url", baseURL, "--board_key", h.boardKey, "--name", name)
		cmd.Dir = gaRoot
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			h.addLog(fmt.Sprintf("Worker %s failed: %v", name, err))
			continue
		}
		h.workers = append(h.workers, cmd)
		h.addLog(fmt.Sprintf("Worker %s started (PID %d)", name, cmd.Process.Pid))
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
	}

	h.cfg.BBSBaseURL = baseURL
	h.cfg.BBSKey = h.boardKey
	h.mu.Lock()
	h.running = true
	h.mu.Unlock()
	h.addLog("Hive session ready")

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "running", "port": h.port, "board_key": h.boardKey,
		"workers": len(h.workers), "objective": body.Objective, "budget": body.Budget,
	})
}

func (h *HiveHandler) Stop(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if !h.running {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_running"})
		return
	}

	h.addLog("Stopping...")
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
