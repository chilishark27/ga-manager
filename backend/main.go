package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
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
	configSvc := services.NewConfigService(cfg.GARoot, cfg.PythonPath)

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
	mux.HandleFunc("PUT /api/instances/{id}/name", instHandler.Rename)

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
	mux.HandleFunc("GET /api/instances/{id}/chat/search", chatHandler.SearchMessages)

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

	// Hive (Goal Hive - one-click multi-agent orchestration)
	hiveHandler := handlers.NewHiveHandler(cfg)
	mux.HandleFunc("POST /api/hive/start", hiveHandler.Start)
	mux.HandleFunc("POST /api/hive/stop", hiveHandler.Stop)
	mux.HandleFunc("GET /api/hive/status", hiveHandler.Status)
	mux.HandleFunc("GET /api/hive/posts", hiveHandler.GetPosts)
	mux.HandleFunc("GET /api/hive/authors", hiveHandler.GetAuthors)
	mux.HandleFunc("GET /api/hive/poll", hiveHandler.Poll)
	mux.HandleFunc("POST /api/hive/post", hiveHandler.PostMessage)
	mux.HandleFunc("GET /api/hive/history", hiveHandler.ListRunHistory)
	mux.HandleFunc("GET /api/hive/history/record", hiveHandler.GetRunRecord)

	// Git worktree management
	gitHandler := handlers.NewGitHandler()
	mux.HandleFunc("GET /api/git/worktrees", gitHandler.ListWorktrees)
	mux.HandleFunc("POST /api/git/worktrees", gitHandler.CreateWorktree)
	mux.HandleFunc("DELETE /api/git/worktrees", gitHandler.RemoveWorktree)
	mux.HandleFunc("GET /api/git/branches", gitHandler.ListBranches)
	mux.HandleFunc("GET /api/git/status", gitHandler.Status)

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
	mux.HandleFunc("DELETE /api/conductor/subagents/{sid}", conductorHandler.DeleteSubagent)
	mux.HandleFunc("GET /api/conductor/chat", conductorHandler.GetChat)
	mux.HandleFunc("POST /api/conductor/chat", conductorHandler.PostChat)
	mux.HandleFunc("GET /api/conductor/ws", conductorHandler.WebSocketProxy)
	mux.HandleFunc("GET /api/conductor/reflects", conductorHandler.ListReflects)
	mux.HandleFunc("POST /api/conductor/auto-create", conductorHandler.AutoCreate)

	// Configuration
	mux.HandleFunc("GET /api/config/mykey", cfgHandler.GetMasked)
	mux.HandleFunc("GET /api/config/mykey/raw", cfgHandler.GetRaw)
	mux.HandleFunc("PUT /api/config/mykey/raw", cfgHandler.SaveRaw)
	mux.HandleFunc("GET /api/config/templates", cfgHandler.GetTemplates)
	mux.HandleFunc("GET /api/config/status", cfgHandler.Status)
	mux.HandleFunc("GET /api/config/llms", cfgHandler.GetLLMs)

	// Plugins list
	mux.HandleFunc("GET /api/plugins", func(w http.ResponseWriter, r *http.Request) {
		pluginsDir := filepath.Join(cfg.GARoot, "plugins")
		entries, err := os.ReadDir(pluginsDir)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}
		type PluginInfo struct {
			Name string `json:"name"`
			File string `json:"file"`
			Desc string `json:"desc"`
		}
		var plugins []PluginInfo
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".py") || e.Name() == "__init__.py" {
				continue
			}
			desc := ""
			content, err := os.ReadFile(filepath.Join(pluginsDir, e.Name()))
			if err == nil {
				lines := strings.SplitN(string(content), "\n", 10)
				for _, line := range lines {
					line = strings.TrimSpace(line)
					if strings.HasPrefix(line, "#") && !strings.HasPrefix(line, "#!") {
						desc = strings.TrimSpace(strings.TrimPrefix(line, "#"))
						break
					}
					if strings.HasPrefix(line, `"""`) || strings.HasPrefix(line, `'''`) {
						desc = strings.Trim(line, `"' `)
						break
					}
				}
			}
			name := strings.TrimSuffix(e.Name(), ".py")
			plugins = append(plugins, PluginInfo{Name: name, File: e.Name(), Desc: desc})
		}
		if plugins == nil {
			plugins = []PluginInfo{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(plugins)
	})

	// Serve local files (images referenced in GA responses)
	mux.HandleFunc("GET /api/file", func(w http.ResponseWriter, r *http.Request) {
		filePath := r.URL.Query().Get("path")
		if filePath == "" {
			http.Error(w, "path required", http.StatusBadRequest)
			return
		}
		// Security: only serve files under GA root or system temp
		gaRoot := cfg.GARoot
		allowed := false
		cleanPath := filepath.Clean(filePath)
		if strings.HasPrefix(cleanPath, filepath.Clean(gaRoot)) {
			allowed = true
		}
		if strings.HasPrefix(cleanPath, os.TempDir()) {
			allowed = true
		}
		if !allowed {
			http.Error(w, "access denied", http.StatusForbidden)
			return
		}
		http.ServeFile(w, r, cleanPath)
	})

	// GA Update - git pull in GA root directory
	mux.HandleFunc("POST /api/ga/update", func(w http.ResponseWriter, r *http.Request) {
		gaRoot := cfg.GARoot
		if gaRoot == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "GA Root not configured"})
			return
		}
		cmd := exec.Command("git", "pull")
		cmd.Dir = gaRoot
		out, err := cmd.CombinedOutput()
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error(), "output": string(out)})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok", "output": string(out)})
	})

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
		configSvc.UpdatePython(cfg.PythonPath)
		json.NewEncoder(w).Encode(cfg)
	})
	mux.HandleFunc("GET /api/config/detect-ga", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		candidates := detectGAPath()
		json.NewEncoder(w).Encode(map[string]interface{}{"paths": candidates, "configured": cfg.GARoot})
	})

	mux.HandleFunc("POST /api/config/validate", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			GARoot     string `json:"ga_root"`
			PythonPath string `json:"python_path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "invalid request"})
			return
		}

		result := map[string]interface{}{
			"ga_valid":     false,
			"python_valid": false,
			"bridge_valid": false,
		}

		// Check GA root
		if req.GARoot != "" {
			agentMain := filepath.Join(req.GARoot, "agentmain.py")
			if _, err := os.Stat(agentMain); err == nil {
				result["ga_valid"] = true
			}
		}

		// Check Python
		pythonCmd := req.PythonPath
		if pythonCmd == "" {
			pythonCmd = detectPython()
		}
		// Handle directory path — append executable name
		if info, err := os.Stat(pythonCmd); err == nil && info.IsDir() {
			if _, err := os.Stat(filepath.Join(pythonCmd, "python.exe")); err == nil {
				pythonCmd = filepath.Join(pythonCmd, "python.exe")
			} else if _, err := os.Stat(filepath.Join(pythonCmd, "python3")); err == nil {
				pythonCmd = filepath.Join(pythonCmd, "python3")
			} else if _, err := os.Stat(filepath.Join(pythonCmd, "python")); err == nil {
				pythonCmd = filepath.Join(pythonCmd, "python")
			}
		}
		if out, err := exec.Command(pythonCmd, "--version").Output(); err == nil {
			result["python_valid"] = true
			result["python_version"] = strings.TrimSpace(string(out))
		}

		// Check bridge
		bridgeFound := false
		bridgeCandidates := []string{
			filepath.Join(".", "bridge", "bridge.py"),
			filepath.Join("..", "bridge", "bridge.py"),
		}
		exePath, _ := os.Executable()
		if exePath != "" {
			exeDir := filepath.Dir(exePath)
			bridgeCandidates = append(bridgeCandidates,
				filepath.Join(filepath.Dir(exeDir), "bridge", "bridge.py"),
				filepath.Join(exeDir, "..", "bridge", "bridge.py"),
			)
		}
		for _, bp := range bridgeCandidates {
			if _, err := os.Stat(bp); err == nil {
				bridgeFound = true
				break
			}
		}
		result["bridge_valid"] = bridgeFound

		json.NewEncoder(w).Encode(result)
	})

	// TODO persistence
	todosFile := filepath.Join(getConfigDir(), "todos.json")
	mux.HandleFunc("GET /api/todos", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		data, err := os.ReadFile(todosFile)
		if err != nil {
			w.Write([]byte("[]"))
			return
		}
		w.Write(data)
	})
	mux.HandleFunc("PUT /api/todos", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		data, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
			return
		}
		if err := os.WriteFile(todosFile, data, 0644); err != nil {
			http.Error(w, `{"error":"write failed"}`, http.StatusInternalServerError)
			return
		}
		w.Write([]byte(`{"ok":true}`))
	})

	// Project context - scan directory structure
	mux.HandleFunc("POST /api/project/scan", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "path is required"})
			return
		}
		info, err := os.Stat(req.Path)
		if err != nil || !info.IsDir() {
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "directory not found"})
			return
		}

		// Scan directory tree (max 3 levels, skip hidden/node_modules/venv)
		type FileEntry struct {
			Name string      `json:"name"`
			Type string      `json:"type"`
			Children []FileEntry `json:"children,omitempty"`
		}
		var scanDir func(dir string, depth int) []FileEntry
		scanDir = func(dir string, depth int) []FileEntry {
			if depth > 3 { return nil }
			entries, _ := os.ReadDir(dir)
			var result []FileEntry
			skip := map[string]bool{"node_modules": true, ".git": true, "__pycache__": true, "venv": true, ".venv": true, "dist": true, "build": true, ".next": true}
			for _, e := range entries {
				name := e.Name()
				if strings.HasPrefix(name, ".") && name != ".env.example" { continue }
				if skip[name] { continue }
				entry := FileEntry{Name: name}
				if e.IsDir() {
					entry.Type = "dir"
					entry.Children = scanDir(filepath.Join(dir, name), depth+1)
				} else {
					entry.Type = "file"
				}
				result = append(result, entry)
			}
			return result
		}

		tree := scanDir(req.Path, 0)

		// Read key files for context (README, package.json, etc.)
		keyFiles := []string{"README.md", "readme.md", "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "Makefile"}
		summaries := map[string]string{}
		for _, kf := range keyFiles {
			fp := filepath.Join(req.Path, kf)
			if data, err := os.ReadFile(fp); err == nil {
				content := string(data)
				if len(content) > 500 { content = content[:500] + "..." }
				summaries[kf] = content
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"path": req.Path,
			"name": filepath.Base(req.Path),
			"tree": tree,
			"summaries": summaries,
		})
	})

	// Project context - open native folder picker dialog
	mux.HandleFunc("POST /api/project/browse", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var selectedPath string
		var err error

		switch runtime.GOOS {
		case "windows":
			cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command",
				`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Folder'; $f.ShowNewFolderButton = $true; $f.RootFolder = 'MyComputer'; if ($f.ShowDialog() -eq 'OK') { Write-Output $f.SelectedPath } else { Write-Output '' }`)
			out, e := cmd.Output()
			err = e
			selectedPath = strings.TrimSpace(string(out))
		case "darwin":
			cmd := exec.Command("osascript", "-e",
				`set theFolder to choose folder with prompt "Select Project Folder"
return POSIX path of theFolder`)
			out, e := cmd.Output()
			err = e
			selectedPath = strings.TrimSpace(string(out))
			selectedPath = strings.TrimSuffix(selectedPath, "/")
		default:
			// Linux: try zenity, then kdialog
			cmd := exec.Command("zenity", "--file-selection", "--directory", "--title=Select Project Folder")
			out, e := cmd.Output()
			if e != nil {
				cmd = exec.Command("kdialog", "--getexistingdirectory", ".")
				out, e = cmd.Output()
			}
			err = e
			selectedPath = strings.TrimSpace(string(out))
		}

		if err != nil || selectedPath == "" {
			json.NewEncoder(w).Encode(map[string]interface{}{"path": "", "cancelled": true})
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"path": selectedPath, "name": filepath.Base(selectedPath)})
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

	// staticDir is populated below; declared here so the /api/pets closure can reference it.
	var staticDir string

	// Pet discovery API
	mux.HandleFunc("GET /api/pets", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		petsDir := ""
		candidates := []string{
			filepath.Join(getExeDir(), "static", "pets"),
			filepath.Join(".", "static", "pets"),
		}
		if cwd, err := os.Getwd(); err == nil {
			candidates = append(candidates,
				filepath.Join(cwd, "frontend", "public", "pets"),
				filepath.Join(cwd, "..", "frontend", "public", "pets"),
				filepath.Join(cwd, "static", "pets"),
			)
		}
		if staticDir != "" {
			candidates = append([]string{filepath.Join(staticDir, "pets")}, candidates...)
		}
		for _, c := range candidates {
			if info, err := os.Stat(c); err == nil && info.IsDir() {
				petsDir = c
				break
			}
		}
		if petsDir == "" {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		entries, err := os.ReadDir(petsDir)
		if err != nil {
			json.NewEncoder(w).Encode([]interface{}{})
			return
		}

		type PetAction struct {
			Images    string `json:"images"`
			Frames    int    `json:"frames"`
			Interval  int    `json:"interval"`
			NeedMove  bool   `json:"need_move,omitempty"`
			Direction string `json:"direction,omitempty"`
			FrameMove int    `json:"frame_move,omitempty"`
		}
		type PetInfo struct {
			ID      string               `json:"id"`
			Name    string               `json:"name"`
			Folder  string               `json:"folder"`
			Actions map[string]PetAction `json:"actions"`
		}

		var pets []PetInfo
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			confPath := filepath.Join(petsDir, entry.Name(), "act_conf.json")
			if _, err := os.Stat(confPath); err != nil {
				continue
			}
			data, err := os.ReadFile(confPath)
			if err != nil {
				continue
			}

			var rawConf map[string]map[string]interface{}
			if err := json.Unmarshal(data, &rawConf); err != nil {
				continue
			}

			actionDir := filepath.Join(petsDir, entry.Name(), "action")
			actions := make(map[string]PetAction)

			for actionName, actionData := range rawConf {
				images, _ := actionData["images"].(string)
				if images == "" {
					continue
				}
				frameCount := 0
				if entries2, err := os.ReadDir(actionDir); err == nil {
					for _, f := range entries2 {
						if strings.HasPrefix(f.Name(), images+"_") && strings.HasSuffix(f.Name(), ".png") {
							frameCount++
						}
					}
				}
				if frameCount == 0 {
					continue
				}

				interval := 150
				if fr, ok := actionData["frame_refresh"].(float64); ok && fr > 0 {
					interval = int(fr * 1000)
					if interval < 120 {
						interval = 120
					}
				}

				act := PetAction{
					Images:   images,
					Frames:   frameCount,
					Interval: interval,
				}
				if needMove, ok := actionData["need_move"].(bool); ok {
					act.NeedMove = needMove
				}
				if dir, ok := actionData["direction"].(string); ok {
					act.Direction = dir
				}
				if fm, ok := actionData["frame_move"].(float64); ok {
					act.FrameMove = int(fm)
				}

				actions[actionName] = act
			}

			if len(actions) == 0 {
				continue
			}

			pets = append(pets, PetInfo{
				ID:      entry.Name(),
				Name:    entry.Name(),
				Folder:  "/pets/" + entry.Name(),
				Actions: actions,
			})
		}

		json.NewEncoder(w).Encode(pets)
	})

	// Serve frontend static files (production)
	// Try multiple locations to find static files
	staticDir = ""
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

	// CORS + panic recovery middleware
	handler := panicRecovery(corsMiddleware(mux))

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
	// Default python path: detect on unix, "python" on windows
	defaultPython := "python"
	if filepath.Separator != '\\' {
		defaultPython = detectPython()
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

func detectPython() string {
	// Search common Python locations on macOS/Linux
	// GUI apps (Electron) don't inherit shell PATH, so we check explicitly
	candidates := []string{
		"/opt/homebrew/bin/python3",
		"/usr/local/bin/python3",
		"/usr/bin/python3",
		"/opt/homebrew/bin/python",
		"/usr/local/bin/python",
		"/opt/local/bin/python3",
	}
	// Also check user's pyenv, conda, and versioned installs
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append([]string{
			filepath.Join(home, ".pyenv", "shims", "python3"),
			filepath.Join(home, ".local", "bin", "python3"),
			filepath.Join(home, "miniconda3", "bin", "python3"),
			filepath.Join(home, "anaconda3", "bin", "python3"),
		}, candidates...)
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	// Fallback: try PATH (works if launched from terminal)
	if path, err := exec.LookPath("python3"); err == nil {
		return path
	}
	return "python3"
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
		filepath.Join(home, "code", "GenericAgent"),
		filepath.Join(home, "Code", "GenericAgent"),
		filepath.Join(home, "workspace", "GenericAgent"),
		filepath.Join(home, "dev", "GenericAgent"),
	}

	// Windows-specific
	if filepath.Separator == '\\' {
		drives := []string{"C:", "D:", "E:"}
		for _, d := range drives {
			candidates = append(candidates,
				filepath.Join(d, "GenericAgent"),
				filepath.Join(d, "projects", "GenericAgent"),
				filepath.Join(d, "dev", "GenericAgent"),
			)
		}
	}

	// macOS/Linux-specific
	if filepath.Separator == '/' {
		candidates = append(candidates,
			"/opt/GenericAgent",
			filepath.Join(home, ".local", "share", "GenericAgent"),
			filepath.Join(home, "src", "GenericAgent"),
			filepath.Join(home, "git", "GenericAgent"),
			filepath.Join(home, "Library", "GenericAgent"),
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
func panicRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %s %s: %v", r.Method, r.URL.Path, err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

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
