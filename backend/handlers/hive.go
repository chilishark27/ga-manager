package handlers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ga_manager/models"
)

type HiveHandler struct {
	mu           sync.Mutex
	cfg          *models.AppConfig
	running      bool
	bbsCmd       *exec.Cmd
	workers      []*exec.Cmd
	masterCmd    *exec.Cmd
	port         int
	boardKey     string
	objective    string
	sessionName  string            // user-given name for this session (optional)
	budget       int
	startedAt    time.Time
	logs         []string
	conductor      *ConductorHandler // reference to conductor for subagent mode
	subagentMode   bool              // true when running in subagent mode
	subagentIDs    []string          // track created subagent IDs
	subagentNames  map[string]string // id -> display name
	projectDir     string            // working directory (BBS cwd)
}

func NewHiveHandler(cfg *models.AppConfig) *HiveHandler {
	return &HiveHandler{cfg: cfg, port: 39800}
}

// SetConductor injects the ConductorHandler so Hive can use subagent mode.
func (h *HiveHandler) SetConductor(ch *ConductorHandler) {
	h.conductor = ch
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
	h.running = true // Mark as starting to prevent concurrent starts
	h.mu.Unlock()

	// If start fails, reset running to false
	startFailed := true
	defer func() {
		if startFailed {
			h.mu.Lock()
			h.running = false
			h.mu.Unlock()
		}
	}()

	var body struct {
		Objective   string `json:"objective"`
		Budget      int    `json:"budget_minutes"`
		Workers     int    `json:"workers"`
		LLMNo       int    `json:"llm_no"`
		Mode        string `json:"mode"` // "hive" (default), "checklist", or "subagent"
		ProjectDir  string `json:"project_dir"`
		PlanFirst   bool   `json:"plan_first"`
		SessionName string `json:"session_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Objective == "" {
		writeError(w, http.StatusBadRequest, "objective is required")
		return
	}
	if body.Budget < 0 {
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

	h.port = 39800 + rand.Intn(100)
	h.boardKey = fmt.Sprintf("hive-%d", time.Now().Unix())
	h.objective = body.Objective
	h.budget = body.Budget
	h.startedAt = time.Now()
	// Truncate session name to 20 chars; fall back to first 20 chars of objective
	sname := body.SessionName
	if sname == "" && len(body.Objective) > 0 {
		sname = body.Objective
		if len(sname) > 20 {
			sname = sname[:20]
		}
	} else if len(sname) > 20 {
		sname = sname[:20]
	}
	h.sessionName = sname

	var bbsCwd string
	if body.ProjectDir != "" {
		bbsCwd = body.ProjectDir
		os.MkdirAll(bbsCwd, 0755)
	} else {
		bbsCwd = filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
		os.MkdirAll(bbsCwd, 0755)
	}
	h.projectDir = bbsCwd

	// Install git pre-push hook to prevent workers from pushing
	if body.ProjectDir != "" {
		hookDir := filepath.Join(body.ProjectDir, ".git", "hooks")
		hookPath := filepath.Join(hookDir, "pre-push")
		// Only install if .git exists and no pre-push hook already exists
		if _, err := os.Stat(filepath.Join(body.ProjectDir, ".git")); err == nil {
			if _, err := os.Stat(hookPath); os.IsNotExist(err) {
				os.MkdirAll(hookDir, 0755)
				hookContent := "#!/bin/sh\necho \"[Hive] Push blocked. Only Coordinator can push after verification.\"\nexit 1\n"
				os.WriteFile(hookPath, []byte(hookContent), 0755)
				h.addLog("Git pre-push hook installed (workers cannot push)")
			}
		}
	}

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

	// Post initial task — brief project context only; Coordinator agent handles detailed assignment
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
		projectInfo := ""
		if body.ProjectDir != "" {
			projectInfo = fmt.Sprintf("\n项目目录: %s", body.ProjectDir)
		}
		task := fmt.Sprintf("[Hive 启动] 目标: %s | Worker数量: %d | 时间: %d分钟%s\n\nCoordinator 正在分析目标并分配任务，请等待...",
			body.Objective, body.Workers, body.Budget, projectInfo)
		payload, _ := json.Marshal(map[string]string{"token": masterToken, "content": task})
		pr, _ := http.NewRequest("POST", baseURL+"/post", strings.NewReader(string(payload)))
		pr.Header.Set("Content-Type", "application/json")
		pr.Header.Set("X-API-Key", h.boardKey)
		http.DefaultClient.Do(pr)
		h.addLog("Task posted")
	}

	// ── Subagent mode: use Conductor sub-agents instead of Python worker processes ──
	if body.Mode == "subagent" {
		if h.conductor == nil {
			h.bbsCmd.Process.Kill()
			h.bbsCmd = nil
			writeError(w, http.StatusInternalServerError, "conductor not available (SetConductor not called)")
			return
		}

		// Ensure conductor is running
		h.conductor.mu.Lock()
		condRunning := h.conductor.running
		h.conductor.mu.Unlock()

		if !condRunning {
			h.addLog("Starting conductor for subagent mode...")
			fakeBody := strings.NewReader(`{"llm_no":0}`)
			fakeReq, _ := http.NewRequest("POST", "/api/conductor/start", fakeBody)
			fakeReq.Header.Set("Content-Type", "application/json")
			rec := &fakeResponseWriter{header: make(http.Header)}
			h.conductor.Start(rec, fakeReq)
			if rec.status >= 400 {
				h.bbsCmd.Process.Kill()
				h.bbsCmd = nil
				writeError(w, http.StatusInternalServerError, "failed to start conductor: "+string(rec.body))
				return
			}
			h.addLog("Conductor started")
		}

		// Build prompts
		h.subagentIDs = nil
		h.subagentNames = make(map[string]string)
		workerNames := []string{"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}
		condURL := h.conductor.conductorURL()

		coordPrompt := fmt.Sprintf(
			"[Hive Coordinator] 你是项目总指挥。\n"+
				"目标: %s\n"+
				"时间预算: %d分钟\n"+
				"Worker数量: %d\n\n"+
				"BBS 信息:\n"+
				"- URL: %s\n"+
				"- API Key: %s\n"+
				"- 项目目录: %s\n\n"+
				"=== 你的职责 ===\n"+
				"1. 分析用户意图，判断目标领域（开发/审计/调研/设计等）\n"+
				"2. 为每个 Worker 定义一个专业角色（如安全审计师、架构分析师、市场研究员）\n"+
				"3. 拆分任务并发帖指派，标注 [指派: Worker-XXX]\n"+
				"4. 审阅每个 Worker 的汇报，给出专业点评\n"+
				"5. 所有 Worker 完成后，发一条 [最终总结]：核心发现 + 详细分析 + 建议行动\n\n"+
				"=== BBS API ===\n"+
				"- GET %s/posts?key=%s&limit=20 查看帖子\n"+
				"- POST %s/post (body: {\"token\":\"你的token\",\"content\":\"内容\"}) 发帖\n"+
				"- POST %s/register (body: {\"name\":\"Coordinator\"}) 注册获取token\n\n"+
				"约束：不要产出超过 3000 字的帖子。请立即分析目标，定义专业角色，拆分并指派。",
			body.Objective, body.Budget, body.Workers,
			baseURL, h.boardKey, bbsCwd,
			baseURL, h.boardKey, baseURL, baseURL,
		)

		h.addLog("Creating Coordinator sub-agent...")
		coordPayload, _ := json.Marshal(map[string]string{
			"prompt": coordPrompt,
		})
		coordResp, err := http.Post(condURL+"/subagent", "application/json", bytes.NewReader(coordPayload))
		if err != nil {
			h.addLog("ERROR: failed to create Coordinator sub-agent: " + err.Error())
		} else {
			var coordResult map[string]interface{}
			json.NewDecoder(coordResp.Body).Decode(&coordResult)
			coordResp.Body.Close()
			if id, ok := coordResult["id"].(string); ok && id != "" {
				h.subagentIDs = append(h.subagentIDs, id)
				h.subagentNames[id] = "Coordinator"
				h.addLog(fmt.Sprintf("Coordinator sub-agent created (id=%s)", id))
			} else {
				h.addLog(fmt.Sprintf("WARN: Coordinator sub-agent response: %v", coordResult))
			}
		}

		// Create Worker sub-agents
		for i := 0; i < body.Workers; i++ {
			suffix := workerNames[i%len(workerNames)]
			workerPrompt := fmt.Sprintf(
				"[Hive Worker-%s] 你是 Hive Worker。\n"+
					"BBS 信息:\n"+
					"- URL: %s\n"+
					"- API Key: %s\n"+
					"- 项目目录: %s\n\n"+
					"你的职责：\n"+
					"1. 注册到 BBS: POST %s/register (body: {\"name\":\"Worker-%s\"})\n"+
					"2. 查看帖子: GET %s/posts?key=%s&limit=20\n"+
					"3. 找到标注 [指派: Worker-%s] 的任务\n"+
					"4. 发帖认领: POST %s/post (body: {\"token\":\"你的token\",\"content\":\"[认领] ...\"})\n"+
					"5. 执行任务（在项目目录下工作）\n"+
					"6. 发帖汇报结果\n\n"+
					"注意：只接自己的任务，其他 Worker 的任务不要动。每隔一段时间重新检查 BBS 是否有新任务。",
				suffix,
				baseURL, h.boardKey, bbsCwd,
				baseURL, suffix,
				baseURL, h.boardKey,
				suffix,
				baseURL,
			)
			h.addLog(fmt.Sprintf("Creating Worker-%s sub-agent...", suffix))
			workerPayload, _ := json.Marshal(map[string]string{
				"prompt": workerPrompt,
			})
			wResp, err := http.Post(condURL+"/subagent", "application/json", bytes.NewReader(workerPayload))
			if err != nil {
				h.addLog(fmt.Sprintf("ERROR: failed to create Worker-%s: %v", suffix, err))
				continue
			}
			var wResult map[string]interface{}
			json.NewDecoder(wResp.Body).Decode(&wResult)
			wResp.Body.Close()
			if id, ok := wResult["id"].(string); ok && id != "" {
				h.subagentIDs = append(h.subagentIDs, id)
				h.subagentNames[id] = fmt.Sprintf("Worker-%s", suffix)
				h.addLog(fmt.Sprintf("Worker-%s sub-agent created (id=%s)", suffix, id))
			} else {
				h.addLog(fmt.Sprintf("WARN: Worker-%s response: %v", suffix, wResult))
			}
		}

		h.subagentMode = true
		h.cfg.BBSBaseURL = baseURL
		h.cfg.BBSKey = h.boardKey
		startFailed = false
		h.addLog("Hive subagent session ready")

		// Auto-stop when budget expires
		if body.Budget > 0 {
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
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": "running", "port": h.port, "board_key": h.boardKey,
			"workers": body.Workers, "objective": body.Objective, "budget": body.Budget,
			"mode": "subagent",
		})
		return
	}

	// ── Normal hive/checklist mode: spawn Python worker processes ──
	h.addLog(fmt.Sprintf("Starting %d workers...", body.Workers))
	workerReflect := filepath.Join(gaRoot, "reflect", "agent_team_worker.py")

	// Worker uses /wait long-poll (blocks up to 55s), INTERVAL=60 is correct as-is.
	// No patching needed — /wait gives instant response when tasks arrive.
	h.addLog("Worker mode: long-poll (/wait endpoint, <1s response time)")

	h.workers = nil
	workerNames := []string{"Alpha", "Beta", "Gamma", "Delta", "Epsilon"}
	for i := 0; i < body.Workers; i++ {
		suffix := workerNames[i%len(workerNames)]
		name := fmt.Sprintf("Worker-%s", suffix)
		h.addLog(fmt.Sprintf("⏳ Initializing %s (agent loading LLM, may take 30-60s)...", name))
		cmd := exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"),
			"--reflect", workerReflect, "--llm_no", strconv.Itoa(body.LLMNo),
			"--base_url", baseURL, "--board_key", h.boardKey, "--name", name,
			"--project_dir", body.ProjectDir)
		// Workers run in project dir so their memory and file ops are scoped there
		if body.ProjectDir != "" {
			cmd.Dir = body.ProjectDir
		} else {
			cmd.Dir = gaRoot
		}
		cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PYTHONPATH="+gaRoot, "GA_PROJECT_DIR="+body.ProjectDir)

		// Capture worker output to hive logs
		workerName := name
		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		if err := cmd.Start(); err != nil {
			h.addLog(fmt.Sprintf("❌ %s failed to start: %v", name, err))
			continue
		}
		h.workers = append(h.workers, cmd)
		h.addLog(fmt.Sprintf("Worker %s started (PID %d)", name, cmd.Process.Pid))

		// Stream worker output to hive logs
		stdoutReady := make(chan bool, 1)
		go func(wname string, r io.Reader, ready chan<- bool) {
			scanner := bufio.NewScanner(r)
			notified := false
			for scanner.Scan() {
				line := scanner.Text()
				if line == "" {
					continue
				}
				h.mu.Lock()
				h.addLog(fmt.Sprintf("[%s] %s", wname, line))
				h.mu.Unlock()
				if !notified && strings.Contains(line, "[Reflect] loaded") {
					ready <- true
					notified = true
				}
			}
			if !notified {
				ready <- false
			}
		}(workerName, stdout, stdoutReady)
		go func(wname string, r io.Reader) {
			scanner := bufio.NewScanner(r)
			for scanner.Scan() {
				line := scanner.Text()
				if line != "" {
					h.mu.Lock()
					h.addLog(fmt.Sprintf("[%s:err] %s", wname, line))
					h.mu.Unlock()
				}
			}
		}(workerName, stderr)

		// Wait for this worker to be ready before starting next (max 90s)
		if i < body.Workers-1 {
			select {
			case ok := <-stdoutReady:
				if ok {
					h.addLog(fmt.Sprintf("✅ %s ready", name))
				} else {
					h.addLog(fmt.Sprintf("⚠️ %s process ended without ready signal", name))
				}
			case <-time.After(90 * time.Second):
				h.addLog(fmt.Sprintf("⚠️ %s init timeout (90s), starting next worker anyway", name))
			}
		}

		// Monitor worker exit
		go func(c *exec.Cmd, wname string) {
			err := c.Wait()
			h.mu.Lock()
			if h.running {
				if err != nil {
					h.addLog(fmt.Sprintf("❌ %s exited with error: %v", wname, err))
				} else {
					h.addLog(fmt.Sprintf("Worker %s finished", wname))
				}
			}
			h.mu.Unlock()
		}(cmd, name)
	}

	// Start master (Coordinator agent that assigns tasks via BBS)
	coordReflect := filepath.Join(gaRoot, "reflect", "agent_team_coordinator.py")
	if body.Mode == "checklist" {
		checklistReflect := filepath.Join(gaRoot, "reflect", "checklist_master.py")
		if _, err := os.Stat(checklistReflect); err == nil {
			coordReflect = checklistReflect
			h.addLog("Mode: checklist (structured task decomposition)")
		} else {
			h.addLog("WARN: checklist_master.py not found, falling back to coordinator")
		}
	} else {
		h.addLog("Mode: hive (Coordinator assigns tasks via BBS)")
	}

	// Pass coordinator params as extra CLI args (parsed by agentmain into reflect init dict)
	planFirstStr := "0"
	if body.PlanFirst {
		planFirstStr = "1"
	}
	h.masterCmd = exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"),
		"--reflect", coordReflect, "--llm_no", strconv.Itoa(body.LLMNo),
		"--base_url", baseURL, "--board_key", h.boardKey,
		"--worker_count", strconv.Itoa(body.Workers),
		"--objective", body.Objective,
		"--project_dir", body.ProjectDir,
		"--plan_first", planFirstStr)
	if body.ProjectDir != "" {
		h.masterCmd.Dir = body.ProjectDir
	} else {
		h.masterCmd.Dir = gaRoot
	}
	h.masterCmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PYTHONPATH="+gaRoot)

	// Capture Coordinator output to hive logs (same as workers)
	masterStdout, _ := h.masterCmd.StdoutPipe()
	masterStderr, _ := h.masterCmd.StderrPipe()

	if err := h.masterCmd.Start(); err != nil {
		h.addLog("Master failed: " + err.Error())
	} else {
		h.addLog(fmt.Sprintf("Coordinator started (PID %d)", h.masterCmd.Process.Pid))

		go func(r io.Reader) {
			scanner := bufio.NewScanner(r)
			scanner.Buffer(make([]byte, 64*1024), 64*1024)
			for scanner.Scan() {
				line := scanner.Text()
				if line == "" { continue }
				h.mu.Lock()
				h.addLog(fmt.Sprintf("[Coordinator] %s", line))
				h.mu.Unlock()
			}
		}(masterStdout)
		go func(r io.Reader) {
			scanner := bufio.NewScanner(r)
			scanner.Buffer(make([]byte, 64*1024), 64*1024)
			for scanner.Scan() {
				line := scanner.Text()
				if line != "" {
					h.mu.Lock()
					h.addLog(fmt.Sprintf("[Coordinator:err] %s", line))
					h.mu.Unlock()
				}
			}
		}(masterStderr)

		go func(c *exec.Cmd) {
			err := c.Wait()
			h.mu.Lock()
			if h.running {
				if err != nil {
					h.addLog(fmt.Sprintf("Coordinator exited with error: %v", err))
				} else {
					h.addLog("Coordinator finished")
				}
			}
			h.mu.Unlock()
		}(h.masterCmd)
	}

	h.cfg.BBSBaseURL = baseURL
	h.cfg.BBSKey = h.boardKey
	startFailed = false
	h.addLog("Hive session ready")

	// Monitor child processes - if BBS dies, log but don't auto-stop
	bbsCmd := h.bbsCmd // copy pointer before goroutine to avoid data race
	go func() {
		if bbsCmd != nil {
			bbsCmd.Wait()
			h.mu.Lock()
			stillRunning := h.running
			h.mu.Unlock()
			if stillRunning {
				h.addLog("WARNING: BBS process exited, posts may not update")
			}
		}
	}()

	// Auto-stop when budget expires
	if body.Budget > 0 {
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
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status": "running", "port": h.port, "board_key": h.boardKey,
		"workers": len(h.workers), "objective": body.Objective, "budget": body.Budget,
	})
}

func (h *HiveHandler) stopAll() {
	h.mu.Lock()
	if !h.running {
		h.mu.Unlock()
		return
	}
	// Mark as stopped immediately to prevent re-entry
	h.running = false
	h.cfg.BBSBaseURL = ""

	// Copy state needed for cleanup
	subagentMode := h.subagentMode
	subagentIDs := h.subagentIDs
	h.subagentIDs = nil
	h.subagentNames = nil
	h.subagentMode = false

	masterCmd := h.masterCmd
	h.masterCmd = nil
	workers := h.workers
	h.workers = nil
	bbsCmd := h.bbsCmd
	h.bbsCmd = nil
	h.mu.Unlock()

	// Save run record (makes HTTP call to BBS — must not hold mutex)
	h.saveRunRecord()

	// Abort conductor sub-agents (HTTP calls — must not hold mutex)
	if subagentMode && h.conductor != nil {
		condURL := h.conductor.conductorURL()
		for _, sid := range subagentIDs {
			abortBody := strings.NewReader(`{"action":"abort"}`)
			http.Post(condURL+"/subagent/"+sid, "application/json", abortBody)
		}
	}

	// Kill processes
	if masterCmd != nil && masterCmd.Process != nil {
		killProcessTree(masterCmd.Process.Pid)
	}
	for _, wk := range workers {
		if wk != nil && wk.Process != nil {
			killProcessTree(wk.Process.Pid)
		}
	}
	if bbsCmd != nil && bbsCmd.Process != nil {
		killProcessTree(bbsCmd.Process.Pid)
	}

	// Remove git pre-push hook on stop
	if h.projectDir != "" {
		hookPath := filepath.Join(h.projectDir, ".git", "hooks", "pre-push")
		if data, err := os.ReadFile(hookPath); err == nil {
			if strings.Contains(string(data), "[Hive] Push blocked") {
				os.Remove(hookPath)
			}
		}
	}

	h.mu.Lock()
	h.addLog("Stopped")
	h.mu.Unlock()
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
	mode := "hive"
	if h.subagentMode {
		mode = "subagent"
	}
	workerCount := len(h.workers)
	if h.subagentMode {
		workerCount = len(h.subagentIDs)
	}
	resp := map[string]interface{}{
		"running":       h.running,
		"port":          h.port,
		"board_key":     h.boardKey,
		"objective":     h.objective,
		"session_name":  h.sessionName,
		"budget":        h.budget,
		"workers":       workerCount,
		"logs":          h.logs,
		"mode":          mode,
		"subagent_mode": h.subagentMode,
		"cwd":           h.projectDir,
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
		"objective":    h.objective,
		"session_name": h.sessionName,
		"budget":       h.budget,
		"workers":      len(h.workers),
		"started_at":   h.startedAt,
		"stopped_at":   time.Now().Format(time.RFC3339),
		"project_dir":  h.projectDir,
		"posts":        posts,
		"logs":         h.logs,
	}
	data, _ := json.MarshalIndent(record, "", "  ")
	filename := fmt.Sprintf("run_%s.json", time.Now().Format("20060102_150405"))
	os.WriteFile(filepath.Join(histDir, filename), data, 0644)
}

// SubagentStatus returns the status of sub-agents created in subagent mode.
// If not in subagent mode, returns an empty array.
func (h *HiveHandler) SubagentStatus(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	mode := h.subagentMode
	ids := append([]string(nil), h.subagentIDs...)
	names := make(map[string]string, len(h.subagentNames))
	for k, v := range h.subagentNames {
		names[k] = v
	}
	h.mu.Unlock()

	if !mode || h.conductor == nil || len(ids) == 0 {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	// Fetch all subagents from conductor
	resp, err := http.Get(h.conductor.conductorURL() + "/subagent")
	if err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		Items []map[string]interface{} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}

	// Build a set of tracked IDs for fast lookup
	idSet := make(map[string]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}

	// Filter to only our subagents; extract name, status, last reply snippet
	type SubagentInfo struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Status   string `json:"status"`
		LastReply string `json:"last_reply"`
	}
	var filtered []SubagentInfo
	for _, item := range result.Items {
		id := fmt.Sprintf("%v", item["id"])
		if !idSet[id] {
			continue
		}
		name := names[id]
		if name == "" {
			name = id
		}
		status := fmt.Sprintf("%v", item["status"])
		lastReply := ""
		if lr, ok := item["reply"].(string); ok && lr != "" {
			if len(lr) > 80 {
				lr = lr[:80] + "..."
			}
			lastReply = lr
		}
		filtered = append(filtered, SubagentInfo{ID: id, Name: name, Status: status, LastReply: lastReply})
	}
	if filtered == nil {
		filtered = []SubagentInfo{}
	}
	writeJSON(w, http.StatusOK, filtered)
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
		File        string `json:"file"`
		Objective   string `json:"objective"`
		SessionName string `json:"session_name,omitempty"`
		StoppedAt   string `json:"stopped_at"`
		Posts       int    `json:"posts"`
		ProjectDir  string `json:"project_dir,omitempty"`
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
		sname, _ := rec["session_name"].(string)
		stopped, _ := rec["stopped_at"].(string)
		postsArr, _ := rec["posts"].([]interface{})
		projDir, _ := rec["project_dir"].(string)
		results = append(results, RunSummary{
			File: e.Name(), Objective: obj, SessionName: sname, StoppedAt: stopped, Posts: len(postsArr), ProjectDir: projDir,
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

// DeleteRunRecord removes a specific run record
func (h *HiveHandler) DeleteRunRecord(w http.ResponseWriter, r *http.Request) {
	file := r.URL.Query().Get("file")
	if file == "" {
		writeError(w, http.StatusBadRequest, "file required")
		return
	}
	gaRoot := h.cfg.GARoot
	path := filepath.Join(gaRoot, "temp", "hive_history", filepath.Base(file))
	if err := os.Remove(path); err != nil {
		writeError(w, http.StatusNotFound, "record not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// UploadFile proxies file upload to the BBS for image/file attachments.
// Returns {"url": "http://127.0.0.1:PORT/file/REF"} for embedding in posts.
func (h *HiveHandler) UploadFile(w http.ResponseWriter, r *http.Request) {
	if h.cfg.BBSBaseURL == "" {
		writeError(w, http.StatusServiceUnavailable, "Hive not running")
		return
	}

	// Parse multipart form (max 10MB)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "invalid multipart form: "+err.Error())
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "file field required")
		return
	}
	defer file.Close()

	// Register as "user" to get a token
	baseURL := h.cfg.BBSBaseURL
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
		writeError(w, http.StatusInternalServerError, "failed to register with BBS")
		return
	}

	// Build multipart request to BBS /file/upload
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	mw.WriteField("token", token)
	fw, _ := mw.CreateFormFile("file", header.Filename)
	io.Copy(fw, file)
	mw.Close()

	uploadReq, _ := http.NewRequest("POST", baseURL+"/file/upload", &buf)
	uploadReq.Header.Set("Content-Type", mw.FormDataContentType())
	uploadReq.Header.Set("X-API-Key", h.cfg.BBSKey)
	resp, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upload failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)

	// Return full URL for the uploaded file
	ref := result["ref"]
	if ref != "" {
		writeJSON(w, http.StatusOK, map[string]string{
			"url": baseURL + "/file/" + ref,
			"ref": ref,
		})
	} else {
		writeError(w, http.StatusInternalServerError, "upload returned no ref")
	}
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

// GetProjectDir returns the current Hive project directory (thread-safe).
func (h *HiveHandler) GetProjectDir() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.projectDir
}

// ListFiles returns files in the Hive working directory
func (h *HiveHandler) ListFiles(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	root := h.projectDir
	h.mu.Unlock()

	if root == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"files": []interface{}{}, "cwd": ""})
		return
	}

	// Support subdirectory navigation via ?sub=relative/path
	sub := r.URL.Query().Get("sub")
	cwd := root
	if sub != "" {
		cwd = filepath.Join(root, filepath.Clean(sub))
		// Security: ensure result is still under root
		if !strings.HasPrefix(filepath.Clean(cwd)+string(filepath.Separator), filepath.Clean(root)+string(filepath.Separator)) {
			writeError(w, http.StatusBadRequest, "invalid path")
			return
		}
		if info, err := os.Stat(cwd); err != nil || !info.IsDir() {
			writeError(w, http.StatusNotFound, "directory not found")
			return
		}
	}

	type FileInfo struct {
		Name  string `json:"name"`
		Path  string `json:"path"`
		Size  int64  `json:"size"`
		IsDir bool   `json:"is_dir"`
	}
	var files []FileInfo
	entries, _ := os.ReadDir(cwd)
	for _, e := range entries {
		name := e.Name()
		if name == "." || name == ".." || name == "__pycache__" || name == ".git" || name == "node_modules" {
			continue
		}
		info, err := e.Info()
		if err != nil { continue }
		files = append(files, FileInfo{Name: name, Path: filepath.Join(cwd, name), Size: info.Size(), IsDir: e.IsDir()})
	}
	if files == nil { files = []FileInfo{} }
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"files": files,
		"cwd":   cwd,
		"root":  root,
		"sub":   sub,
	})
}

// ListPresets returns hardcoded scene preset configurations.
func (h *HiveHandler) ListPresets(w http.ResponseWriter, r *http.Request) {
	presets := []map[string]interface{}{
		{"id": "code_audit", "name": "🔍 代码审计", "desc": "安全+架构+性能三视角审查", "workers": 3, "plan_first": true, "objective_template": "对项目进行全面代码审计，涵盖安全漏洞、架构设计、性能瓶颈三个维度"},
		{"id": "market_research", "name": "📊 市场调研", "desc": "行业+竞品+用户三方向", "workers": 3, "plan_first": true, "objective_template": "调研{topic}市场，涵盖行业趋势、竞品分析、目标用户画像"},
		{"id": "feature_dev", "name": "🛠️ 功能开发", "desc": "设计+实现，串行依赖", "workers": 2, "plan_first": true, "objective_template": "设计并实现{feature}功能"},
		{"id": "bug_fix", "name": "🐛 Bug修复", "desc": "单Worker快速定位修复", "workers": 1, "plan_first": false, "objective_template": "定位并修复：{bug_description}"},
		{"id": "doc_writing", "name": "📝 文档撰写", "desc": "调研+撰写", "workers": 2, "plan_first": false, "objective_template": "撰写{doc_topic}文档"},
		{"id": "custom", "name": "⚙️ 自定义", "desc": "手动配置所有参数", "workers": 2, "plan_first": true, "objective_template": ""},
	}
	writeJSON(w, http.StatusOK, presets)
}

// Dashboard parses BBS posts and returns structured phase/worker status.
func (h *HiveHandler) Dashboard(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	running := h.running
	port := h.port
	boardKey := h.boardKey
	objective := h.objective
	projectDir := h.projectDir
	startedAt := h.startedAt
	h.mu.Unlock()

	if !running {
		writeJSON(w, http.StatusOK, map[string]interface{}{"phase": "stopped"})
		return
	}

	// Fetch posts from BBS
	baseURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	var posts []map[string]interface{}
	req, _ := http.NewRequest("GET", baseURL+"/posts?limit=50", nil)
	req.Header.Set("X-API-Key", boardKey)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		json.NewDecoder(resp.Body).Decode(&posts)
		resp.Body.Close()
	}

	// Parse posts to determine phase and worker status
	type WorkerInfo struct {
		Name     string `json:"name"`
		Role     string `json:"role"`
		Status   string `json:"status"`
		Progress string `json:"progress"`
		Plan     string `json:"plan"`
	}

	phase := "waiting" // waiting | planning | assigning | executing | reviewing | done
	workerMap := make(map[string]*WorkerInfo)
	totalTasks := 0
	claimedTasks := 0
	doneTasks := 0
	verifiedTasks := 0

	for _, p := range posts {
		author, _ := p["author"].(string)
		content, _ := p["content"].(string)

		// Detect assignments
		if strings.Contains(content, "[指派") {
			phase = "executing"
			totalTasks += strings.Count(content, "[指派")
		}

		if strings.Contains(content, "[执行计划]") {
			phase = "planning"
		}

		// Track workers
		if strings.Contains(author, "Worker") {
			if _, exists := workerMap[author]; !exists {
				workerMap[author] = &WorkerInfo{Name: author, Status: "idle"}
			}
			wi := workerMap[author]

			if strings.Contains(content, "[接单]") || strings.Contains(content, "[认领]") {
				wi.Status = "busy"
				claimedTasks++
			}
			if strings.Contains(content, "[计划]") {
				wi.Status = "planning"
				planIdx := strings.Index(content, "[计划]")
				if planIdx >= 0 {
					planText := content[planIdx+len("[计划]"):]
					if len(planText) > 80 {
						planText = planText[:80]
					}
					wi.Plan = strings.TrimSpace(planText)
				}
			}
			// Progress: [进度 N/M]
			if idx := strings.Index(content, "[进度"); idx >= 0 {
				end := strings.Index(content[idx:], "]")
				if end > 0 {
					wi.Progress = content[idx+1 : idx+end]
					wi.Status = "busy"
				}
			}
			if strings.Contains(content, "[完成]") || strings.Contains(content, "[任务完成]") {
				wi.Status = "done"
				doneTasks++
			}
		}

		// Coordinator actions
		if author == "Coordinator" {
			if strings.Contains(content, "[验收通过]") {
				verifiedTasks++
				phase = "reviewing"
			}
			if strings.Contains(content, "[驳回重做") {
				phase = "reviewing"
			}
			if strings.Contains(content, "[最终总结]") || strings.Contains(content, "## 最终总结") {
				phase = "done"
			}
		}
	}

	// Build workers slice from map
	finalWorkers := make([]WorkerInfo, 0, len(workerMap))
	for _, wi := range workerMap {
		finalWorkers = append(finalWorkers, *wi)
	}

	elapsed := int(time.Since(startedAt).Minutes())

	result := map[string]interface{}{
		"phase":           phase,
		"objective":       objective,
		"project_dir":     projectDir,
		"elapsed_minutes": elapsed,
		"progress": map[string]int{
			"total":    totalTasks,
			"claimed":  claimedTasks,
			"done":     doneTasks,
			"verified": verifiedTasks,
		},
		"workers": finalWorkers,
	}
	writeJSON(w, http.StatusOK, result)
}

// Resume restarts a Hive from history
func (h *HiveHandler) Resume(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	if h.running {
		h.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_running"})
		return
	}
	h.mu.Unlock()

	var body struct {
		File       string `json:"file"`
		Workers    int    `json:"workers"`
		LLMNo      int    `json:"llm_no"`
		ProjectDir string `json:"project_dir"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.File == "" {
		writeError(w, http.StatusBadRequest, "file required")
		return
	}

	gaRoot := h.cfg.GARoot
	recordPath := filepath.Join(gaRoot, "temp", "hive_history", filepath.Base(body.File))
	data, err := os.ReadFile(recordPath)
	if err != nil {
		writeError(w, http.StatusNotFound, "record not found")
		return
	}
	var record struct {
		Objective  string `json:"objective"`
		ProjectDir string `json:"project_dir"`
	}
	json.Unmarshal(data, &record)

	workers := body.Workers
	if workers <= 0 { workers = 2 }

	// Use project_dir from the saved record if not provided in request
	projectDir := body.ProjectDir
	if projectDir == "" {
		projectDir = record.ProjectDir
	}

	resumeObj := fmt.Sprintf("[继续执行] %s\n\n请先阅读 .hive/hive_progress.md 了解上次进度，继续未完成的工作。", record.Objective)

	startPayload, _ := json.Marshal(map[string]interface{}{
		"objective":      resumeObj,
		"budget_minutes": 0,
		"workers":        workers,
		"llm_no":         body.LLMNo,
		"mode":           "hive",
		"project_dir":    projectDir,
	})
	startReq, _ := http.NewRequest("POST", "/api/hive/start", bytes.NewReader(startPayload))
	startReq.Header.Set("Content-Type", "application/json")
	h.Start(w, startReq)
}
