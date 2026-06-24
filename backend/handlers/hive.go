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
		Objective  string `json:"objective"`
		Budget     int    `json:"budget_minutes"`
		Workers    int    `json:"workers"`
		LLMNo      int    `json:"llm_no"`
		Mode       string `json:"mode"` // "hive" (default), "checklist", or "subagent"
		ProjectDir string `json:"project_dir"`
		PlanFirst  bool   `json:"plan_first"`
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

	var bbsCwd string
	if body.ProjectDir != "" {
		bbsCwd = body.ProjectDir
		os.MkdirAll(bbsCwd, 0755)
	} else {
		bbsCwd = filepath.Join(gaRoot, "temp", fmt.Sprintf("hive_%d", time.Now().Unix()))
		os.MkdirAll(bbsCwd, 0755)
	}
	h.projectDir = bbsCwd

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
		projectInfo := ""
		if body.ProjectDir != "" {
			projectInfo = fmt.Sprintf("\n\n⚠️ 项目工作目录（严格限制）: %s\n- 所有文件读写、代码分析必须限制在此目录及其子目录下\n- 禁止访问此目录以外的任何文件、代码或项目\n- 指派任务时必须提醒 Worker 只在此目录工作\n- 先扫描目录结构了解项目情况再分配任务", body.ProjectDir)
		}
		task := fmt.Sprintf(`[Coordinator 任务分配] 目标: %s | 时间预算: %d分钟 | Worker数量: %d%s

=== 你的职责 ===
你是 Coordinator（项目总指挥）。你需要：

1. **分析用户意图**：判断目标属于什么领域（软件开发、安全审计、市场调研、产品分析、架构设计等）
2. **定义专业角色**：根据目标为每个 Worker 分配一个专业角色，而非通用名称。例如：
   - 代码审计目标 → 安全审计师、架构分析师、性能专家
   - 市场调研目标 → 行业分析师、竞品研究员、用户画像专家
   - 功能开发目标 → 前端工程师、后端工程师、测试工程师
   - 产品设计目标 → 产品经理、UX设计师、技术方案师
3. **拆分任务并指派**：每个子任务必须标注 [指派: Worker-XXX]，并附上明确的验收标准

=== 验收标准（每个任务必须包含） ===
指派任务时，你必须为每个任务定义验收条件，例如：
- ✅ 输出格式要求（报告/代码/表格/对比分析）
- ✅ 必须覆盖的要点（至少列出 N 个关键点）
- ✅ 深度要求（是否需要看源码、引用数据、给出具体行号）
- ✅ 禁止事项（不要泛泛而谈、不要抄文档、不要遗漏关键模块）

=== 质量验收流程 ===
Worker 提交产出后，你必须进行验收：

1. **检查完整性**：是否覆盖了所有要求的要点？
2. **检查深度**：是否有具体证据/数据/代码引用支撑结论？还是只是泛泛描述？
3. **检查准确性**：结论是否合理？是否有明显错误或自相矛盾？
4. **检查可操作性**：建议是否具体可执行？还是空话套话？

验收结果：
- [验收通过] — 产出满足要求，简短点评即可
- [驳回重做] — 产出不合格，必须指出哪里不行、具体要补什么，Worker 看到后会重新执行
  格式：[驳回重做: Worker-XXX] 原因：xxx。补充要求：1. ... 2. ...

⚠️ 不要怕驳回！质量比速度重要。泛泛而谈的报告、缺乏证据的结论、遗漏关键模块的分析，都应该驳回。

=== 最终总结（所有验收通过后） ===
所有 Worker 产出验收通过后，发一条 [最终总结]，格式：
## 最终总结
### 背景与目标
（一句话概括）
### 核心发现
（按重要性排列的关键结论，每条一行）
### 详细分析
（整合各 Worker 产出为连贯的叙述，标注来源 Worker）
### 建议行动
（下一步该做什么，按优先级排列）
### 质量评估
（每个 Worker 的表现评价：完成度、深度、是否被驳回过）

=== 约束 ===
- Worker 只能执行指派给自己的任务
- 协作记忆：Worker 完成后把关键结论发帖到 BBS
- 持久化：重要结论通过 /memory 写入记忆
- 不要产出超过 3000 字的帖子，太长请拆分

请立即分析目标，定义 %d 个专业角色，拆分任务（附验收标准）并分别指派。`, body.Objective, body.Budget, body.Workers, projectInfo, body.Workers)

		// Plan First mode: prepend planning phase instructions
		if body.PlanFirst {
			planPrefix := `
=== ⚠️ Plan 阶段（必须先完成再指派任务） ===
本次启用了 Plan 模式。你必须先执行规划阶段，再分配任务：

第一步：项目调研（立即执行）
1. 扫描项目目录结构，了解项目组成
2. 阅读 README、配置文件、入口文件，理解项目架构
3. 识别技术栈、核心模块、依赖关系

第二步：制定执行计划
在 BBS 发一条 [执行计划] 帖，包含：
- 项目现状总结（一段话）
- 任务拆解方案（每个 Worker 做什么）
- 执行顺序和依赖关系
- 风险点和注意事项

第三步：等用户确认（如有疑问发帖询问）
如果计划中有不确定的决策点，发帖标注 [需确认] 等用户回复

第四步：计划确认后，再正式指派任务给 Workers

`
			task = planPrefix + task
		}

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

	// Create a patched copy with shorter poll interval for faster startup
	// Write to gaRoot/temp to avoid polluting user's project directory
	patchedReflect := filepath.Join(gaRoot, "temp", "agent_team_worker_fast.py")
	if origData, err := os.ReadFile(workerReflect); err == nil {
		origStr := string(origData)
		if strings.Contains(origStr, "INTERVAL = 60") {
			patched := strings.Replace(origStr, "INTERVAL = 60", "INTERVAL = 10", 1)
			os.WriteFile(patchedReflect, []byte(patched), 0644)
			workerReflect = patchedReflect
			h.addLog("Worker poll interval: 10s (patched from 60s)")
		} else if strings.Contains(origStr, "INTERVAL") {
			// Different interval value, try generic patch
			h.addLog("WARN: INTERVAL != 60 in worker script, using original interval")
		} else {
			h.addLog("WARN: No INTERVAL found in worker script")
		}
	} else {
		h.addLog(fmt.Sprintf("WARN: Cannot read worker script: %v", err))
	}

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

	// Start master (choose reflect script based on mode)
	goalState := map[string]interface{}{
		"objective": body.Objective, "budget_seconds": body.Budget * 60,
		"start_time": time.Now().Unix(), "turns_used": 0, "max_turns": 200, "status": "running",
	}
	goalData, _ := json.MarshalIndent(goalState, "", "  ")
	goalPath := filepath.Join(gaRoot, "temp", "goal_state.json")
	os.WriteFile(goalPath, goalData, 0644)

	goalReflect := filepath.Join(gaRoot, "reflect", "goal_mode.py")
	if body.Mode == "checklist" {
		checklistReflect := filepath.Join(gaRoot, "reflect", "checklist_master.py")
		if _, err := os.Stat(checklistReflect); err == nil {
			goalReflect = checklistReflect
			h.addLog("Mode: checklist (structured task decomposition)")
		} else {
			h.addLog("WARN: checklist_master.py not found, falling back to goal_mode")
		}
	} else {
		h.addLog("Mode: hive (goal-driven coordination)")
	}
	h.masterCmd = exec.Command(python, "-u", filepath.Join(gaRoot, "agentmain.py"), "--reflect", goalReflect, "--llm_no", strconv.Itoa(body.LLMNo))
	if body.ProjectDir != "" {
		h.masterCmd.Dir = body.ProjectDir
	} else {
		h.masterCmd.Dir = gaRoot
	}
	h.masterCmd.Env = append(os.Environ(), "GOAL_STATE="+goalPath, "PYTHONPATH="+gaRoot)
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
		File       string `json:"file"`
		Objective  string `json:"objective"`
		StoppedAt  string `json:"stopped_at"`
		Posts      int    `json:"posts"`
		ProjectDir string `json:"project_dir,omitempty"`
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
		projDir, _ := rec["project_dir"].(string)
		results = append(results, RunSummary{
			File: e.Name(), Objective: obj, StoppedAt: stopped, Posts: len(postsArr), ProjectDir: projDir,
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
