package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const defaultConductorPort = 8900

type ConductorHandler struct {
	mu              sync.Mutex
	cmd             *exec.Cmd
	running         bool
	actualURL       string
	gaRoot          string
	python          string
	cachedSubagents []interface{}
	cachedChat      []interface{}
	deletedIDs      map[string]bool
}

func (h *ConductorHandler) conductorURL() string {
	if h.actualURL != "" {
		return h.actualURL
	}
	return fmt.Sprintf("http://127.0.0.1:%d", defaultConductorPort)
}

func NewConductorHandler(gaRoot, pythonPath string) *ConductorHandler {
	if pythonPath != "" {
		if info, err := os.Stat(pythonPath); err == nil && info.IsDir() {
			found := false
			for _, name := range []string{"python.exe", "python3", "python"} {
				if _, err := os.Stat(filepath.Join(pythonPath, name)); err == nil {
					pythonPath = filepath.Join(pythonPath, name)
					found = true
					break
				}
			}
			if !found {
				pythonPath = ""
			}
		}
	}
	if pythonPath == "" {
		if p, err := exec.LookPath("python3"); err == nil {
			pythonPath = p
		} else if p, err := exec.LookPath("python"); err == nil {
			pythonPath = p
		} else {
			pythonPath = "python"
		}
	}
	h := &ConductorHandler{gaRoot: gaRoot, python: pythonPath, deletedIDs: make(map[string]bool)}
	h.loadCachedState()
	return h
}

func (h *ConductorHandler) cacheFilePath() string {
	return filepath.Join(h.gaRoot, "temp", "conductor_state.json")
}

func (h *ConductorHandler) chatCacheFilePath() string {
	return filepath.Join(h.gaRoot, "temp", "conductor_chat.json")
}

func (h *ConductorHandler) saveCachedState() {
	h.mu.Lock()
	data := h.cachedSubagents
	h.mu.Unlock()
	if data == nil {
		return
	}
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(h.cacheFilePath()), 0755)
	os.WriteFile(h.cacheFilePath(), b, 0644)
}

func (h *ConductorHandler) saveCachedChat() {
	h.mu.Lock()
	data := h.cachedChat
	h.mu.Unlock()
	if data == nil {
		return
	}
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(h.chatCacheFilePath()), 0755)
	os.WriteFile(h.chatCacheFilePath(), b, 0644)
}

func (h *ConductorHandler) loadCachedState() {
	b, err := os.ReadFile(h.cacheFilePath())
	if err == nil {
		var data []interface{}
		if json.Unmarshal(b, &data) == nil {
			h.cachedSubagents = data
		}
	}
	cb, err := os.ReadFile(h.chatCacheFilePath())
	if err == nil {
		var chatData []interface{}
		if json.Unmarshal(cb, &chatData) == nil {
			h.cachedChat = chatData
		}
	}
}

func (h *ConductorHandler) Start(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.running {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_running"})
		return
	}

	// Clear cached state and deleted IDs for fresh session
	h.cachedSubagents = nil
	h.cachedChat = nil
	h.deletedIDs = make(map[string]bool)
	os.Remove(h.cacheFilePath())
	os.Remove(h.chatCacheFilePath())

	scriptPath := filepath.Join(h.gaRoot, "frontends", "conductor.py")
	if _, err := os.Stat(scriptPath); err != nil {
		writeError(w, http.StatusNotFound, "conductor.py not found in GA project — check GA Root path")
		return
	}

	// Check dependencies
	depCheck := exec.Command(h.python, "-c", "import fastapi, uvicorn, pydantic")
	depCheck.Dir = h.gaRoot
	if err := depCheck.Run(); err != nil {
		install := exec.Command(h.python, "-m", "pip", "install", "fastapi", "uvicorn", "pydantic", "--quiet")
		install.Dir = h.gaRoot
		if out, installErr := install.CombinedOutput(); installErr != nil {
			writeError(w, http.StatusInternalServerError, "Failed to install dependencies: "+string(out))
			return
		}
	}

	// conductor.py uses uvicorn.run("conductor:app"), so cwd must be frontends/
	frontendsDir := filepath.Join(h.gaRoot, "frontends")
	// Monkey-patch webbrowser.open to prevent conductor.py from opening a browser window.
	// Define __file__ so conductor.py can resolve ROOT via os.path.abspath(__file__).
	// Use encoding='utf-8' to avoid GBK decode errors on Windows.
	script := "import webbrowser, os\nwebbrowser.open = lambda *a, **k: None\n__file__ = os.path.abspath('conductor.py')\nexec(compile(open('conductor.py', encoding='utf-8').read(), 'conductor.py', 'exec'))\n"
	cmd := exec.Command(h.python, "-u", "-c", script)
	cmd.Dir = frontendsDir
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PYTHONPATH="+h.gaRoot)
	var stderrBuf bytes.Buffer
	var stdoutBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start conductor: "+err.Error())
		return
	}

	h.cmd = cmd
	h.running = true
	h.actualURL = fmt.Sprintf("http://127.0.0.1:%d", defaultConductorPort)

	go func() {
		cmd.Wait()
		h.mu.Lock()
		h.running = false
		h.cmd = nil
		h.mu.Unlock()
		if errOut := stderrBuf.String(); errOut != "" {
			log.Printf("[Conductor] stderr: %s", errOut)
		}
		log.Println("[Conductor] Process exited")
	}()

	// Wait for conductor to be ready, detect actual port from stdout/stderr
	ready := false
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		// Check both stdout and stderr for actual port
		allOutput := stdoutBuf.String() + "\n" + stderrBuf.String()
		// Find the LAST occurrence of http://127.0.0.1:PORT (the actual running port)
		lastIdx := strings.LastIndex(allOutput, "http://127.0.0.1:")
		if lastIdx >= 0 {
			portStr := allOutput[lastIdx+len("http://127.0.0.1:"):]
			if spaceIdx := strings.IndexAny(portStr, " \n\r()"); spaceIdx > 0 {
				portStr = portStr[:spaceIdx]
			}
			var port int
			if _, err := fmt.Sscanf(portStr, "%d", &port); err == nil && port > 0 {
				h.actualURL = fmt.Sprintf("http://127.0.0.1:%d", port)
			}
		}
		resp, err := http.Get(h.conductorURL() + "/readme")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				ready = true
				break
			}
		}
	}

	if !ready {
		errOut := stderrBuf.String()
		if errOut != "" {
			writeError(w, http.StatusInternalServerError, "conductor failed: "+errOut)
		} else {
			writeError(w, http.StatusInternalServerError, "conductor timeout — check if the port is available and GA frontends/conductor.py exists")
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "running"})
}

func (h *ConductorHandler) Stop(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if !h.running || h.cmd == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not_running"})
		return
	}

	h.cmd.Process.Kill()
	h.running = false
	h.cmd = nil
	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

func (h *ConductorHandler) Status(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	running := h.running
	h.mu.Unlock()

	status := "stopped"
	if running {
		status = "running"
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": status})
}

// Proxy GET requests to conductor
func (h *ConductorHandler) ProxyGet(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("path")
	if target == "" {
		target = "/subagent"
	}
	resp, err := http.Get(h.conductorURL() + target)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// Proxy POST requests to conductor
func (h *ConductorHandler) ProxyPost(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("path")
	if target == "" {
		target = "/subagent"
	}
	resp, err := http.Post(h.conductorURL()+target, "application/json", r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// GetSubagents proxies GET /subagent, caches result for persistence
func (h *ConductorHandler) GetSubagents(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Get(h.conductorURL() + "/subagent")
	if err != nil {
		// Return cached state if conductor is down
		h.mu.Lock()
		cached := h.cachedSubagents
		h.mu.Unlock()
		if cached != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"items": cached, "cached": true})
			return
		}
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var result struct {
		Items []interface{} `json:"items"`
	}
	if json.Unmarshal(body, &result) == nil {
		// Filter out deleted IDs
		h.mu.Lock()
		var filtered []interface{}
		for _, item := range result.Items {
			if m, ok := item.(map[string]interface{}); ok {
				id := fmt.Sprintf("%v", m["id"])
				if !h.deletedIDs[id] {
					filtered = append(filtered, item)
				}
			} else {
				filtered = append(filtered, item)
			}
		}
		h.cachedSubagents = filtered
		h.mu.Unlock()
		go h.saveCachedState()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"items": filtered})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// CreateSubagent proxies POST /subagent
func (h *ConductorHandler) CreateSubagent(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Post(h.conductorURL()+"/subagent", "application/json", r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// SubagentAction proxies POST /subagent/{id}
func (h *ConductorHandler) SubagentAction(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sid")
	resp, err := http.Post(h.conductorURL()+"/subagent/"+sid, "application/json", r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// DeleteSubagent removes a subagent from cache (conductor doesn't support DELETE natively)
func (h *ConductorHandler) DeleteSubagent(w http.ResponseWriter, r *http.Request) {
	sid := r.PathValue("sid")
	h.mu.Lock()
	// Mark as deleted so it won't reappear from conductor polls
	h.deletedIDs[sid] = true
	// Remove from cache
	if h.cachedSubagents != nil {
		var filtered []interface{}
		for _, item := range h.cachedSubagents {
			if m, ok := item.(map[string]interface{}); ok {
				if fmt.Sprintf("%v", m["id"]) != sid {
					filtered = append(filtered, item)
				}
			} else {
				filtered = append(filtered, item)
			}
		}
		h.cachedSubagents = filtered
	}
	h.mu.Unlock()
	go h.saveCachedState()
	// Try to abort the subagent on conductor (best effort)
	body := strings.NewReader(`{"action":"abort"}`)
	http.Post(h.conductorURL()+"/subagent/"+sid, "application/json", body)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "id": sid})
}

// GetChat proxies GET /chat, caches result for persistence
func (h *ConductorHandler) GetChat(w http.ResponseWriter, r *http.Request) {
	last := r.URL.Query().Get("last")
	url := h.conductorURL() + "/chat"
	if last != "" {
		url += "?last=" + last
	}
	resp, err := http.Get(url)
	if err != nil {
		// Return cached chat if conductor is down
		h.mu.Lock()
		cached := h.cachedChat
		h.mu.Unlock()
		if cached != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{"items": cached, "cached": true})
			return
		}
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	// Cache the chat state
	var result struct {
		Items []interface{} `json:"items"`
	}
	if json.Unmarshal(body, &result) == nil && len(result.Items) > 0 {
		h.mu.Lock()
		h.cachedChat = result.Items
		h.mu.Unlock()
		go h.saveCachedChat()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// PostChat proxies POST /chat
func (h *ConductorHandler) PostChat(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Post(h.conductorURL()+"/chat", "application/json", r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// WebSocketProxy proxies WebSocket to conductor
func (h *ConductorHandler) WebSocketProxy(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Conductor WS] upgrade failed: %v", err)
		return
	}
	defer clientConn.Close()

	// Connect to conductor's WebSocket
	backendURL := strings.Replace(h.conductorURL(), "http://", "ws://", 1) + "/ws"
	backendConn, _, err := websocket.DefaultDialer.Dial(backendURL, nil)
	if err != nil {
		clientConn.WriteMessage(websocket.TextMessage, []byte(`{"error":"conductor ws not available"}`))
		return
	}
	defer backendConn.Close()

	// Bidirectional proxy
	done := make(chan struct{})

	// Backend → Client
	go func() {
		defer close(done)
		for {
			msgType, msg, err := backendConn.ReadMessage()
			if err != nil {
				return
			}
			if err := clientConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	// Client → Backend
	go func() {
		for {
			msgType, msg, err := clientConn.ReadMessage()
			if err != nil {
				return
			}
			if err := backendConn.WriteMessage(msgType, msg); err != nil {
				return
			}
		}
	}()

	<-done
}

// suppress unused import
var _ = json.Marshal

// ListReflects scans GA reflect/ directory for available subagent scripts
func (h *ConductorHandler) ListReflects(w http.ResponseWriter, r *http.Request) {
	reflectDir := filepath.Join(h.gaRoot, "reflect")
	entries, err := os.ReadDir(reflectDir)
	if err != nil {
		writeJSON(w, http.StatusOK, []interface{}{})
		return
	}
	var scripts []map[string]string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".py") {
			continue
		}
		name := e.Name()
		desc := ""
		// Read first few lines for docstring/comment
		content, err := os.ReadFile(filepath.Join(reflectDir, name))
		if err == nil {
			lines := strings.SplitN(string(content), "\n", 10)
			for _, line := range lines {
				line = strings.TrimSpace(line)
				if strings.HasPrefix(line, "#") && !strings.HasPrefix(line, "#!") {
					desc = strings.TrimSpace(strings.TrimPrefix(line, "#"))
					break
				}
				if strings.HasPrefix(line, `"""`) || strings.HasPrefix(line, `'''`) {
					desc = strings.Trim(line, `"'`)
					break
				}
			}
		}
		scripts = append(scripts, map[string]string{
			"file": name,
			"path": filepath.Join(reflectDir, name),
			"desc": desc,
		})
	}
	if scripts == nil {
		scripts = []map[string]string{}
	}
	writeJSON(w, http.StatusOK, scripts)
}

// AutoCreate sends an autonomous creation instruction to the conductor via WebSocket
// The conductor event loop only wakes on WebSocket user_message events, not REST /chat posts.
func (h *ConductorHandler) AutoCreate(w http.ResponseWriter, r *http.Request) {
	if !h.running {
		writeError(w, http.StatusServiceUnavailable, "conductor not running")
		return
	}

	var body struct {
		Hint    string   `json:"hint"`
		Scripts []string `json:"scripts"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	// Build the autonomous creation prompt
	reflectDir := filepath.Join(h.gaRoot, "reflect")
	var scriptInfo []string
	if len(body.Scripts) > 0 {
		for _, s := range body.Scripts {
			scriptInfo = append(scriptInfo, s)
		}
	} else {
		entries, _ := os.ReadDir(reflectDir)
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".py") {
				scriptInfo = append(scriptInfo, e.Name())
			}
		}
	}

	prompt := fmt.Sprintf(`你是编排调度器。请根据以下可用的子代理脚本，自主决定需要创建哪些子代理来完成任务。

可用脚本 (reflect/ 目录):
%s

%s

请为每个你认为需要的子代理创建一个任务。直接创建，不需要确认。每个子代理应该有明确的职责分工。`,
		strings.Join(scriptInfo, "\n"),
		func() string {
			if body.Hint != "" {
				return "用户提示: " + body.Hint
			}
			return "请根据项目需要自主决定创建什么子代理。"
		}())

	// Send via WebSocket to trigger conductor's event loop (REST /chat only stores, doesn't wake conductor)
	backendWsURL := strings.Replace(h.conductorURL(), "http://", "ws://", 1) + "/ws"
	wsConn, _, err := websocket.DefaultDialer.Dial(backendWsURL, nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "cannot connect to conductor ws: "+err.Error())
		return
	}

	// Read the hello message first (conductor sends it on connect)
	wsConn.SetReadDeadline(time.Now().Add(5 * time.Second))
	wsConn.ReadMessage()

	payload, _ := json.Marshal(map[string]string{"msg": prompt})
	if err := wsConn.WriteMessage(websocket.TextMessage, payload); err != nil {
		wsConn.Close()
		writeError(w, http.StatusBadGateway, "ws send failed: "+err.Error())
		return
	}

	// Wait for the echo (conductor broadcasts the chat message back) to confirm delivery
	wsConn.SetReadDeadline(time.Now().Add(3 * time.Second))
	wsConn.ReadMessage()
	wsConn.Close()

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent", "prompt": prompt})
}
