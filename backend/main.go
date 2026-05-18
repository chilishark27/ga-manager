package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"ga_manager/handlers"
	"ga_manager/models"
	"ga_manager/services"
)

const defaultConfigFile = "ga_manager_config.json"

func main() {
	// Strict single-instance enforcement via OS-level mutex
	releaseMutex := ensureSingleInstance()
	defer releaseMutex()

	cfg := loadConfig()

	log.Printf("[GA Manager] Starting on port %d", cfg.Port)
	log.Printf("[GA Manager] GA Root: %s", cfg.GARoot)
	log.Printf("[GA Manager] Python: %s", cfg.PythonPath)
	log.Printf("[GA Manager] Exe dir: %s", getExeDir())
	if cwd, err := os.Getwd(); err == nil {
		log.Printf("[GA Manager] Working dir: %s", cwd)
	}

	// Initialize services
	instanceMgr := services.NewInstanceManager(cfg)
	instanceMgr.RestoreInstances()
	instanceMgr.StartHealthMonitor(30*time.Second, true)
	instanceMgr.StartMemoryWatcher(cfg.GARoot)
	configSvc := services.NewConfigService(cfg.GARoot)

	// Initialize handlers
	instHandler := handlers.NewInstanceHandler(instanceMgr)
	wsHandler := handlers.NewWSHandler(instanceMgr)
	cfgHandler := handlers.NewConfigHandler(configSvc)
	featHandler := handlers.NewFeaturesHandler(instanceMgr)
	skillTreeHandler := handlers.NewSkillTreeHandler(cfg.GARoot)
	visionHandler := handlers.NewVisionHandler(instanceMgr, cfg.GARoot)
	adbHandler := handlers.NewADBHandler()
	replayHandler := handlers.NewReplayHandler(cfg.GARoot)
	conductorHandler := handlers.NewConductorHandler(cfg.GARoot, cfg.PythonPath)

	// Setup routes
	mux := http.NewServeMux()

	// Chat handler (bridge communication)
	chatHandler := handlers.NewChatHandler(instanceMgr)

	// Instance management
	mux.HandleFunc("GET /api/instances", instHandler.List)
	mux.HandleFunc("POST /api/instances", instHandler.Create)
	mux.HandleFunc("POST /api/instances/adopt", instHandler.Adopt)
	mux.HandleFunc("GET /api/instances/{id}", instHandler.Get)
	mux.HandleFunc("POST /api/instances/{id}/start", instHandler.Start)
	mux.HandleFunc("POST /api/instances/{id}/stop", instHandler.Stop)
	mux.HandleFunc("DELETE /api/instances/{id}", instHandler.Remove)

	// Instance logs & config
	mux.HandleFunc("GET /api/instances/{id}/logs", instHandler.Logs)
	mux.HandleFunc("GET /api/instances/{id}/config", instHandler.GetConfig)
	mux.HandleFunc("PUT /api/instances/{id}/config", instHandler.SaveConfig)

	// Chat & control (via stdin pipe to bridge subprocess)
	mux.HandleFunc("POST /api/instances/{id}/chat", chatHandler.SendMessage)
	mux.HandleFunc("POST /api/instances/{id}/clear", chatHandler.ClearChat)
	mux.HandleFunc("POST /api/instances/{id}/interrupt", chatHandler.Interrupt)
	mux.HandleFunc("PATCH /api/instances/{id}/config", chatHandler.UpdateConfig)
	mux.HandleFunc("GET /api/instances/{id}/sessions", chatHandler.ListSessions)
	mux.HandleFunc("GET /api/instances/{id}/sessions/{file}", chatHandler.GetSessionContent)
	mux.HandleFunc("POST /api/instances/{id}/sessions/rename", chatHandler.RenameSession)

	// WebSocket proxy
	mux.HandleFunc("GET /api/instances/{id}/ws", wsHandler.Handle)

	// Extended features
	mux.HandleFunc("GET /api/instances/{id}/logs/stream", featHandler.GetLogs)
	mux.HandleFunc("GET /api/instances/{id}/chat/history", featHandler.GetChatHistory)
	mux.HandleFunc("GET /api/instances/{id}/chat/export", featHandler.ExportChat)
	mux.HandleFunc("GET /api/instances/{id}/health", featHandler.GetHealth)
	mux.HandleFunc("GET /api/instances/{id}/resources", featHandler.GetResources)
	mux.HandleFunc("GET /api/system/resources", featHandler.GetSystemResources)
	mux.HandleFunc("POST /api/instances/{id}/restart", featHandler.RestartInstance)
	mux.HandleFunc("POST /api/instances/{id}/forward", featHandler.ForwardMessage)
	mux.HandleFunc("GET /api/instances/{id}/tasks", featHandler.GetScheduledTasks)
	mux.HandleFunc("POST /api/instances/{id}/tasks", featHandler.AddScheduledTask)
	mux.HandleFunc("DELETE /api/instances/{id}/tasks/{taskId}", featHandler.RemoveScheduledTask)
	mux.HandleFunc("POST /api/instances/{id}/quick", featHandler.QuickCommand)
	mux.HandleFunc("POST /api/instances/batch/start", featHandler.StartAll)
	mux.HandleFunc("POST /api/instances/batch/stop", featHandler.StopAll)

	// Discover existing GA instances (port scan)
	discoverHandler := handlers.NewDiscoverHandler()

	// Supervisor Agent
	supervisorHandler := handlers.NewSupervisorHandler(instanceMgr)
	mux.HandleFunc("GET /api/discover", discoverHandler.Discover)

	// Hive (BBS proxy)
	hiveHandler := handlers.NewHiveHandler(cfg)
	mux.HandleFunc("GET /api/hive/posts", hiveHandler.GetPosts)
	mux.HandleFunc("GET /api/hive/authors", hiveHandler.GetAuthors)
	mux.HandleFunc("GET /api/hive/count", hiveHandler.GetCount)
	mux.HandleFunc("GET /api/hive/poll", hiveHandler.Poll)
	mux.HandleFunc("POST /api/hive/post", hiveHandler.CreatePost)
	mux.HandleFunc("POST /api/hive/register", hiveHandler.Register)
	mux.HandleFunc("GET /api/hive/config", hiveHandler.GetConfig)
	mux.HandleFunc("PUT /api/hive/config", hiveHandler.SetConfig)

	// Supervisor Agent
	mux.HandleFunc("GET /api/supervisor/status", supervisorHandler.Status)
	mux.HandleFunc("POST /api/supervisor/start", supervisorHandler.Start)
	mux.HandleFunc("POST /api/supervisor/stop", supervisorHandler.Stop)

	// Token statistics
	mux.HandleFunc("GET /api/instances/{id}/tokens", featHandler.GetTokenStats)
	mux.HandleFunc("GET /api/instances/{id}/costs", featHandler.GetCosts)

	// Skill tree
	mux.HandleFunc("GET /api/skilltree", skillTreeHandler.GetSkillTree)

	// Vision / Screenshots
	mux.HandleFunc("GET /api/instances/{id}/screenshots", visionHandler.ListScreenshots)
	mux.HandleFunc("GET /api/instances/{id}/screenshots/{filename}", visionHandler.GetScreenshot)
	mux.HandleFunc("POST /api/instances/{id}/screenshot", visionHandler.TakeScreenshot)

	// ADB device management
	mux.HandleFunc("GET /api/adb/devices", adbHandler.ListDevices)
	mux.HandleFunc("GET /api/adb/screenshot/{serial}", adbHandler.Screenshot)
	mux.HandleFunc("POST /api/adb/tap/{serial}", adbHandler.Tap)
	mux.HandleFunc("POST /api/adb/swipe/{serial}", adbHandler.Swipe)

	// Task replay
	mux.HandleFunc("GET /api/instances/{id}/replay/sessions", replayHandler.ListSessions)
	mux.HandleFunc("GET /api/instances/{id}/replay/{filename}", replayHandler.GetSession)

	// Conductor (multi-agent orchestrator)
	mux.HandleFunc("POST /api/conductor/start", conductorHandler.Start)
	mux.HandleFunc("POST /api/conductor/stop", conductorHandler.Stop)
	mux.HandleFunc("GET /api/conductor/status", conductorHandler.Status)
	mux.HandleFunc("GET /api/conductor/subagents", conductorHandler.GetSubagents)
	mux.HandleFunc("POST /api/conductor/subagents", conductorHandler.CreateSubagent)
	mux.HandleFunc("POST /api/conductor/subagents/{sid}", conductorHandler.SubagentAction)
	mux.HandleFunc("GET /api/conductor/chat", conductorHandler.GetChat)
	mux.HandleFunc("POST /api/conductor/chat", conductorHandler.PostChat)
	mux.HandleFunc("GET /api/conductor/ws", conductorHandler.WebSocketProxy)

	// Configuration
	mux.HandleFunc("GET /api/config/mykey", cfgHandler.GetMasked)
	mux.HandleFunc("GET /api/config/mykey/raw", cfgHandler.GetRaw)
	mux.HandleFunc("PUT /api/config/mykey/raw", cfgHandler.SaveRaw)
	mux.HandleFunc("GET /api/config/templates", cfgHandler.GetTemplates)
	mux.HandleFunc("GET /api/config/status", cfgHandler.Status)
	mux.HandleFunc("GET /api/config/llms", cfgHandler.GetLLMs)

	// App config (GA path, etc.)
	mux.HandleFunc("GET /api/config/app", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Check if GA root actually exists
		_, gaExists := os.Stat(cfg.GARoot)
		// Check if config file exists (user has explicitly configured)
		configPath := filepath.Join(getConfigDir(), defaultConfigFile)
		_, cfgExists := os.Stat(configPath)
		resp := map[string]interface{}{
			"ga_root":       cfg.GARoot,
			"port":          cfg.Port,
			"max_instances": cfg.MaxInstances,
			"python_path":   cfg.PythonPath,
			"bbs_base_url":  cfg.BBSBaseURL,
			"bbs_key":       cfg.BBSKey,
			"configured":    cfgExists == nil && gaExists == nil,
		}
		json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("PUT /api/config/app", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var update models.AppConfig
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			http.Error(w, `{"error":"invalid json"}`, 400)
			return
		}
		if update.GARoot != "" {
			cfg.GARoot = update.GARoot
		}
		if update.PythonPath != "" {
			cfg.PythonPath = update.PythonPath
		}
		// Persist to file (user config dir)
		configPath := filepath.Join(getConfigDir(), defaultConfigFile)
		data, _ := json.MarshalIndent(cfg, "", "  ")
		os.WriteFile(configPath, data, 0644)
		// Update services
		instanceMgr.UpdateConfig(cfg)
		configSvc.UpdateRoot(cfg.GARoot)
		json.NewEncoder(w).Encode(cfg)
	})
	mux.HandleFunc("GET /api/config/detect-ga", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		candidates := detectGAPath()
		json.NewEncoder(w).Encode(map[string]interface{}{"paths": candidates, "configured": cfg.GARoot})
	})

	// Health check
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	// Shutdown endpoint - stops all instances then exits
	mux.HandleFunc("POST /api/shutdown", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "shutting_down"})
		go func() {
			log.Println("[GA Manager] Shutdown requested via API, stopping all instances...")
			instanceMgr.StopAll()
			log.Println("[GA Manager] All instances stopped, exiting.")
			os.Exit(0)
		}()
	})

	// Local SOPs - list memory directory files
	mux.HandleFunc("GET /api/sops/local", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		memDir := filepath.Join(cfg.GARoot, "memory")
		entries, err := os.ReadDir(memDir)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"sops": []string{}, "error": err.Error()})
			return
		}
		type SopItem struct {
			Name string `json:"name"`
			Type string `json:"type"` // "md", "py", "dir"
			Size int64  `json:"size"`
		}
		var sops []SopItem
		for _, e := range entries {
			name := e.Name()
			if name == "__pycache__" || name == ".git" || strings.HasPrefix(name, ".") {
				continue
			}
			info, _ := e.Info()
			item := SopItem{Name: name}
			if e.IsDir() {
				item.Type = "dir"
			} else if strings.HasSuffix(name, ".md") {
				item.Type = "md"
			} else if strings.HasSuffix(name, ".py") {
				item.Type = "py"
			} else if strings.HasSuffix(name, ".txt") {
				item.Type = "txt"
			} else {
				item.Type = "file"
			}
			if info != nil {
				item.Size = info.Size()
			}
			sops = append(sops, item)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"sops": sops, "count": len(sops)})
	})

	// Local SOP content - read a specific file or list directory
	mux.HandleFunc("GET /api/sops/local/{name...}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		name := r.PathValue("name")
		if name == "" {
			http.Error(w, `{"error":"name required"}`, 400)
			return
		}
		// Security: prevent path traversal via ".."
		if strings.Contains(name, "..") {
			http.Error(w, `{"error":"invalid name"}`, 400)
			return
		}
		memDir := filepath.Join(cfg.GARoot, "memory")
		fullPath := filepath.Clean(filepath.Join(memDir, name))
		// Ensure resolved path is still within memDir
		if !strings.HasPrefix(fullPath, filepath.Clean(memDir)+string(filepath.Separator)) && fullPath != filepath.Clean(memDir) {
			http.Error(w, `{"error":"invalid path"}`, 400)
			return
		}
		info, err := os.Stat(fullPath)
		if err != nil {
			http.Error(w, `{"error":"not found"}`, 404)
			return
		}
		if info.IsDir() {
			// List directory contents
			entries, _ := os.ReadDir(fullPath)
			var files []string
			for _, e := range entries {
				files = append(files, e.Name())
			}
			json.NewEncoder(w).Encode(map[string]interface{}{"name": name, "type": "dir", "files": files})
			return
		}
		// Limit file size to 200KB
		if info.Size() > 200*1024 {
			json.NewEncoder(w).Encode(map[string]interface{}{"name": name, "type": "file", "content": "[File too large to display]", "size": info.Size()})
			return
		}
		content, err := os.ReadFile(fullPath)
		if err != nil {
			http.Error(w, `{"error":"read failed"}`, 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"name": name, "type": "file", "content": string(content), "size": info.Size()})
	})

	// SOP write (create/update)
	mux.HandleFunc("PUT /api/sops/local/{name...}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		name := r.PathValue("name")
		if name == "" || strings.Contains(name, "..") {
			http.Error(w, `{"error":"invalid name"}`, 400)
			return
		}
		memDir := filepath.Join(cfg.GARoot, "memory")
		fullPath := filepath.Clean(filepath.Join(memDir, name))
		if !strings.HasPrefix(fullPath, filepath.Clean(memDir)+string(filepath.Separator)) {
			http.Error(w, `{"error":"invalid path"}`, 400)
			return
		}
		var body struct {
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"invalid json"}`, 400)
			return
		}
		if len(body.Content) > 500*1024 {
			http.Error(w, `{"error":"content too large (max 500KB)"}`, 400)
			return
		}
		// Backup existing file
		if _, err := os.Stat(fullPath); err == nil {
			os.Rename(fullPath, fullPath+".bak")
		}
		// Ensure parent directory exists
		os.MkdirAll(filepath.Dir(fullPath), 0755)
		if err := os.WriteFile(fullPath, []byte(body.Content), 0644); err != nil {
			http.Error(w, `{"error":"write failed: `+err.Error()+`"}`, 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": name})
	})

	// SOP create new
	mux.HandleFunc("POST /api/sops/local", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var body struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":"invalid json"}`, 400)
			return
		}
		if body.Name == "" || strings.Contains(body.Name, "..") || strings.Contains(body.Name, "/") || strings.Contains(body.Name, "\\") {
			http.Error(w, `{"error":"invalid name"}`, 400)
			return
		}
		memDir := filepath.Join(cfg.GARoot, "memory")
		fullPath := filepath.Join(memDir, body.Name)
		if _, err := os.Stat(fullPath); err == nil {
			http.Error(w, `{"error":"file already exists"}`, 409)
			return
		}
		if err := os.WriteFile(fullPath, []byte(body.Content), 0644); err != nil {
			http.Error(w, `{"error":"write failed"}`, 500)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": body.Name})
	})

	// SOP delete
	mux.HandleFunc("DELETE /api/sops/local/{name...}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		name := r.PathValue("name")
		if name == "" || strings.Contains(name, "..") {
			http.Error(w, `{"error":"invalid name"}`, 400)
			return
		}
		memDir := filepath.Join(cfg.GARoot, "memory")
		fullPath := filepath.Clean(filepath.Join(memDir, name))
		if !strings.HasPrefix(fullPath, filepath.Clean(memDir)+string(filepath.Separator)) {
			http.Error(w, `{"error":"invalid path"}`, 400)
			return
		}
		if _, err := os.Stat(fullPath); err != nil {
			http.Error(w, `{"error":"not found"}`, 404)
			return
		}
		// Move to .deleted instead of hard delete
		os.Rename(fullPath, fullPath+".deleted")
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "name": name})
	})

	// SopHub proxy - forward requests to fudankw.cn
	mux.HandleFunc("GET /api/sophub/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		resp, err := http.Get("https://fudankw.cn/sophub/api/sops?q=" + q)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", "application/json")
		io.Copy(w, resp.Body)
	})
	mux.HandleFunc("GET /api/sophub/download/{sopId}", func(w http.ResponseWriter, r *http.Request) {
		sopId := r.PathValue("sopId")
		if sopId == "" {
			// fallback: extract from path
			parts := strings.Split(r.URL.Path, "/")
			if len(parts) > 0 {
				sopId = parts[len(parts)-1]
			}
		}
		resp, err := http.Get("https://fudankw.cn/sophub/api/sops/" + sopId + "/download")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		for k, v := range resp.Header {
			w.Header().Set(k, v[0])
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	// Serve frontend static files (production)
	// Try multiple locations to find static files
	staticDir := ""
	staticCandidates := []string{
		filepath.Join(getExeDir(), "static"),
		filepath.Join(".", "static"),
		filepath.Join(getExeDir(), "..", "static"),
		filepath.Join(filepath.Dir(getExeDir()), "frontend", "dist"),
	}
	// Also check cwd-relative paths
	if cwd, err := os.Getwd(); err == nil {
		staticCandidates = append(staticCandidates,
			filepath.Join(cwd, "static"),
			filepath.Join(cwd, "..", "backend", "static"),
		)
	}
	for _, candidate := range staticCandidates {
		indexPath := filepath.Join(candidate, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			staticDir = candidate
			break
		}
	}
	if staticDir != "" {
		log.Printf("[GA Manager] Serving static files from: %s", staticDir)
		mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
			// SPA fallback: serve file if exists, otherwise index.html
			path := r.URL.Path
			if path == "/" {
				path = "/index.html"
			}
			fullPath := filepath.Join(staticDir, filepath.Clean(path))

			// HTML files: no-cache (always revalidate)
			// Assets with hash in filename: long cache
			if path == "/index.html" || path == "/" {
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
			}

			if _, err := os.Stat(fullPath); err == nil {
				http.ServeFile(w, r, fullPath)
				return
			}
			// SPA fallback to index.html
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
			http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
		})
	} else {
		log.Printf("[GA Manager] WARNING: No static directory found, frontend will not be served")
	}

	// CORS middleware for development
	handler := corsMiddleware(mux)

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("[GA Manager] Shutting down, stopping all instances...")
		instanceMgr.StopAll()
		os.Exit(0)
	}()

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("[GA Manager] Listening on http://localhost%s", addr)

	// Check if running in GUI mode (default) or headless mode (--no-gui)
	headless := false
	for _, arg := range os.Args[1:] {
		if arg == "--no-gui" || arg == "-headless" {
			headless = true
			break
		}
	}

	if headless {
		// Headless mode: just run the HTTP server
		if err := http.ListenAndServe(addr, handler); err != nil {
			log.Fatalf("Server failed: %v", err)
		}
	} else {
		// GUI mode: start HTTP server in background, run systray in main thread
		hideConsoleWindowIfNeeded()
		go func() {
			if err := http.ListenAndServe(addr, handler); err != nil {
				log.Fatalf("Server failed: %v", err)
			}
		}()
		runDesktop(cfg.Port)
	}
}

func loadConfig() *models.AppConfig {
	// Platform-aware default GA root
	defaultGARoot := ""
	if home, err := os.UserHomeDir(); err == nil {
		defaultGARoot = filepath.Join(home, "GenericAgent")
	}
	// Default python path: python3 on unix, python on windows
	defaultPython := "python"
	if filepath.Separator != '\\' {
		defaultPython = "python3"
	}

	cfg := &models.AppConfig{
		GARoot:       defaultGARoot,
		Port:         18600,
		MaxInstances: 10,
		PythonPath:   defaultPython,
	}

	// Try to load config from multiple locations (first found wins)
	configPaths := []string{
		filepath.Join(getConfigDir(), defaultConfigFile),
		filepath.Join(getExeDir(), defaultConfigFile),
		filepath.Join(".", defaultConfigFile),
	}
	for _, cp := range configPaths {
		if data, err := os.ReadFile(cp); err == nil {
			json.Unmarshal(data, cfg)
			break
		}
	}

	// Override from environment
	if v := os.Getenv("GA_ROOT"); v != "" {
		cfg.GARoot = v
	}
	if v := os.Getenv("GA_MANAGER_PORT"); v != "" {
		fmt.Sscanf(v, "%d", &cfg.Port)
	}

	return cfg
}

func getConfigDir() string {
	if home, err := os.UserHomeDir(); err == nil {
		dir := filepath.Join(home, ".ga-manager")
		os.MkdirAll(dir, 0755)
		return dir
	}
	return getExeDir()
}

func getExeDir() string {
	exe, _ := os.Executable()
	return filepath.Dir(exe)
}

func detectGAPath() []string {
	var found []string
	home, _ := os.UserHomeDir()

	// Common locations to check (cross-platform)
	candidates := []string{
		filepath.Join(home, "GenericAgent"),
		filepath.Join(home, "Desktop", "GenericAgent"),
		filepath.Join(home, "Documents", "GenericAgent"),
		filepath.Join(home, "projects", "GenericAgent"),
		filepath.Join(home, "Developer", "GenericAgent"),
	}

	// Windows-specific
	if filepath.Separator == '\\' {
		candidates = append(candidates,
			`D:\python3_project\GenericAgent`,
			`C:\GenericAgent`,
		)
	}

	// Also check sibling directories of exe
	exeDir := getExeDir()
	candidates = append(candidates, filepath.Join(filepath.Dir(exeDir), "GenericAgent"))
	candidates = append(candidates, filepath.Join(exeDir, "..", "GenericAgent"))

	for _, p := range candidates {
		if p == "" {
			continue
		}
		agentMain := filepath.Join(p, "agentmain.py")
		if _, err := os.Stat(agentMain); err == nil {
			// Normalize path
			abs, _ := filepath.Abs(p)
			// Deduplicate
			dup := false
			for _, f := range found {
				if strings.EqualFold(f, abs) {
					dup = true
					break
				}
			}
			if !dup {
				found = append(found, abs)
			}
		}
	}
	return found
}

// corsMiddleware adds CORS headers for development
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
