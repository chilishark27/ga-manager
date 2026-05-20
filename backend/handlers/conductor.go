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
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const conductorPort = 8900
const conductorURL = "http://127.0.0.1:8900"

type ConductorHandler struct {
	mu              sync.Mutex
	cmd             *exec.Cmd
	running         bool
	gaRoot          string
	python          string
	cachedSubagents []interface{}
	cachedChat      []interface{}
}

func NewConductorHandler(gaRoot, pythonPath string) *ConductorHandler {
	if pythonPath != "" {
		if info, err := os.Stat(pythonPath); err == nil && info.IsDir() {
			for _, name := range []string{"python.exe", "python3", "python"} {
				if _, err := os.Stat(filepath.Join(pythonPath, name)); err == nil {
					pythonPath = filepath.Join(pythonPath, name)
					break
				}
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
	h := &ConductorHandler{gaRoot: gaRoot, python: pythonPath}
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

	scriptPath := filepath.Join(h.gaRoot, "frontends", "conductor.py")
	if _, err := os.Stat(scriptPath); err != nil {
		writeError(w, http.StatusNotFound, "conductor.py not found in GA project — check GA Root path")
		return
	}

	// Check dependencies
	depCheck := exec.Command(h.python, "-c", "import fastapi, uvicorn")
	depCheck.Dir = h.gaRoot
	if err := depCheck.Run(); err != nil {
		install := exec.Command(h.python, "-m", "pip", "install", "fastapi", "uvicorn", "--quiet")
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
	cmd.Env = append(os.Environ(), "PYTHONUNBUFFERED=1", "PYTHONPATH="+h.gaRoot)
	var stderrBuf bytes.Buffer
	cmd.Stdout = os.Stdout
	cmd.Stderr = &stderrBuf

	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start conductor: "+err.Error())
		return
	}

	h.cmd = cmd
	h.running = true

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

	// Wait for conductor to be ready
	ready := false
	for i := 0; i < 20; i++ {
		time.Sleep(500 * time.Millisecond)
		resp, err := http.Get(conductorURL + "/readme")
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
			writeError(w, http.StatusInternalServerError, "conductor timeout — check if port 8900 is available and GA frontends/conductor.py exists")
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
	resp, err := http.Get(conductorURL + target)
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
	resp, err := http.Post(conductorURL+target, "application/json", r.Body)
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
	resp, err := http.Get(conductorURL + "/subagent")
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
	// Cache the subagent state
	var result struct {
		Items []interface{} `json:"items"`
	}
	if json.Unmarshal(body, &result) == nil && len(result.Items) > 0 {
		h.mu.Lock()
		h.cachedSubagents = result.Items
		h.mu.Unlock()
		// Persist to file
		go h.saveCachedState()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// CreateSubagent proxies POST /subagent
func (h *ConductorHandler) CreateSubagent(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Post(conductorURL+"/subagent", "application/json", r.Body)
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
	resp, err := http.Post(conductorURL+"/subagent/"+sid, "application/json", r.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// GetChat proxies GET /chat, caches result for persistence
func (h *ConductorHandler) GetChat(w http.ResponseWriter, r *http.Request) {
	last := r.URL.Query().Get("last")
	url := conductorURL + "/chat"
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
	resp, err := http.Post(conductorURL+"/chat", "application/json", r.Body)
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
	backendURL := fmt.Sprintf("ws://127.0.0.1:%d/ws", conductorPort)
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
