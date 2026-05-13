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

	"ga_manager/handlers"
	"ga_manager/models"
	"ga_manager/services"
)

const defaultConfigFile = "ga_manager_config.json"

func main() {
	cfg := loadConfig()

	log.Printf("[GA Manager] Starting on port %d", cfg.Port)
	log.Printf("[GA Manager] GA Root: %s", cfg.GARoot)

	// Initialize services
	instanceMgr := services.NewInstanceManager(cfg)
	configSvc := services.NewConfigService(cfg.GARoot)

	// Initialize handlers
	instHandler := handlers.NewInstanceHandler(instanceMgr)
	wsHandler := handlers.NewWSHandler(instanceMgr)
	cfgHandler := handlers.NewConfigHandler(configSvc)
	featHandler := handlers.NewFeaturesHandler(instanceMgr)

	// Setup routes
	mux := http.NewServeMux()

	// Chat handler (bridge communication)
	chatHandler := handlers.NewChatHandler(instanceMgr)

	// Instance management
	mux.HandleFunc("GET /api/instances", instHandler.List)
	mux.HandleFunc("POST /api/instances", instHandler.Create)
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

	// WebSocket proxy
	mux.HandleFunc("GET /api/instances/{id}/ws", wsHandler.Handle)

	// Extended features
	mux.HandleFunc("GET /api/instances/{id}/logs/stream", featHandler.GetLogs)
	mux.HandleFunc("GET /api/instances/{id}/chat/history", featHandler.GetChatHistory)
	mux.HandleFunc("GET /api/instances/{id}/chat/export", featHandler.ExportChat)
	mux.HandleFunc("GET /api/instances/{id}/health", featHandler.GetHealth)
	mux.HandleFunc("GET /api/instances/{id}/resources", featHandler.GetResources)
	mux.HandleFunc("POST /api/instances/{id}/restart", featHandler.RestartInstance)
	mux.HandleFunc("POST /api/instances/{id}/forward", featHandler.ForwardMessage)
	mux.HandleFunc("GET /api/instances/{id}/tasks", featHandler.GetScheduledTasks)
	mux.HandleFunc("POST /api/instances/{id}/tasks", featHandler.AddScheduledTask)
	mux.HandleFunc("DELETE /api/instances/{id}/tasks/{taskId}", featHandler.RemoveScheduledTask)
	mux.HandleFunc("POST /api/instances/{id}/quick", featHandler.QuickCommand)
	mux.HandleFunc("POST /api/instances/batch/start", featHandler.StartAll)
	mux.HandleFunc("POST /api/instances/batch/stop", featHandler.StopAll)

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
		json.NewEncoder(w).Encode(cfg)
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
		// Persist to file
		configPath := filepath.Join(getExeDir(), defaultConfigFile)
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

	// Local SOP content - read a specific file
	mux.HandleFunc("GET /api/sops/local/{name}", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		name := r.PathValue("name")
		if name == "" {
			http.Error(w, `{"error":"name required"}`, 400)
			return
		}
		// Security: prevent path traversal
		if strings.Contains(name, "..") || strings.Contains(name, "/") || strings.Contains(name, "\\") {
			http.Error(w, `{"error":"invalid name"}`, 400)
			return
		}
		memDir := filepath.Join(cfg.GARoot, "memory")
		fullPath := filepath.Join(memDir, name)
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
	staticDir := filepath.Join(getExeDir(), "static")
	if _, err := os.Stat(staticDir); err != nil {
		// Fallback: check relative to working directory
		staticDir = filepath.Join(".", "static")
	}
	if _, err := os.Stat(staticDir); err != nil {
		// Fallback: check frontend/dist relative to project
		staticDir = filepath.Join(filepath.Dir(getExeDir()), "frontend", "dist")
	}
	if _, err := os.Stat(staticDir); err != nil {
		// Fallback: hardcoded project path
		staticDir = filepath.Join(cfg.GARoot, "..", "ga_manager", "frontend", "dist")
	}
	if _, err := os.Stat(staticDir); err == nil {
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
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func loadConfig() *models.AppConfig {
	cfg := &models.AppConfig{
		GARoot:       `D:\python3_project\GenericAgent`,
		Port:         18600,
		MaxInstances: 10,
		PythonPath:   "python",
	}

	// Try to load from file
	configPath := filepath.Join(getExeDir(), defaultConfigFile)
	data, err := os.ReadFile(configPath)
	if err == nil {
		json.Unmarshal(data, cfg)
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

func getExeDir() string {
	exe, _ := os.Executable()
	return filepath.Dir(exe)
}

func detectGAPath() []string {
	var found []string
	// Common locations to check
	candidates := []string{
		filepath.Join(os.Getenv("USERPROFILE"), "GenericAgent"),
		filepath.Join(os.Getenv("USERPROFILE"), "Desktop", "GenericAgent"),
		filepath.Join(os.Getenv("USERPROFILE"), "Documents", "GenericAgent"),
		`D:\python3_project\GenericAgent`,
		`C:\GenericAgent`,
		filepath.Join(os.Getenv("HOME"), "GenericAgent"),
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
