package handlers

import (
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
}

func NewConductorHandler(gaRoot, pythonPath string) *ConductorHandler {
	if pythonPath == "" {
		pythonPath = "python"
	}
	h := &ConductorHandler{gaRoot: gaRoot, python: pythonPath}
	h.loadCachedState()
	return h
}

func (h *ConductorHandler) cacheFilePath() string {
	return filepath.Join(h.gaRoot, "temp", "conductor_state.json")
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

func (h *ConductorHandler) loadCachedState() {
	b, err := os.ReadFile(h.cacheFilePath())
	if err != nil {
		return
	}
	var data []interface{}
	if json.Unmarshal(b, &data) == nil {
		h.cachedSubagents = data
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
		writeError(w, http.StatusNotFound, "conductor.py not found in GA project")
		return
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
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

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
		writeJSON(w, http.StatusOK, map[string]string{"status": "started_but_not_ready"})
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

// GetChat proxies GET /chat
func (h *ConductorHandler) GetChat(w http.ResponseWriter, r *http.Request) {
	last := r.URL.Query().Get("last")
	url := conductorURL + "/chat"
	if last != "" {
		url += "?last=" + last
	}
	resp, err := http.Get(url)
	if err != nil {
		writeError(w, http.StatusBadGateway, "conductor not reachable")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
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
