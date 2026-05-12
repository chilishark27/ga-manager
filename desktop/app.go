package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

// App struct
type App struct {
	ctx        context.Context
	backendCmd *exec.Cmd
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.startBackend()
}

// shutdown is called when the app is closing
func (a *App) shutdown(ctx context.Context) {
	a.stopBackend()
}

// startBackend launches the Go backend server
func (a *App) startBackend() {
	// Check if backend is already running on port 18600
	conn, err := net.DialTimeout("tcp", "127.0.0.1:18600", 2*time.Second)
	if err == nil {
		conn.Close()
		fmt.Println("[Desktop] Backend already running on :18600")
		return
	}

	// Find backend executable
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	var backendPath string
	candidates := []string{
		filepath.Join(exeDir, "ga_manager.exe"),
		filepath.Join(exeDir, "..", "backend", "ga_manager.exe"),
		filepath.Join(exeDir, "backend", "ga_manager.exe"),
	}

	if runtime.GOOS != "windows" {
		candidates = []string{
			filepath.Join(exeDir, "ga_manager"),
			filepath.Join(exeDir, "..", "backend", "ga_manager"),
			filepath.Join(exeDir, "backend", "ga_manager"),
		}
	}

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			backendPath = c
			break
		}
	}

	if backendPath == "" {
		fmt.Println("[Desktop] Warning: backend executable not found, assuming it runs separately")
		return
	}

	fmt.Printf("[Desktop] Starting backend: %s\n", backendPath)
	a.backendCmd = exec.Command(backendPath)
	a.backendCmd.Dir = filepath.Dir(backendPath)
	a.backendCmd.Stdout = os.Stdout
	a.backendCmd.Stderr = os.Stderr

	if err := a.backendCmd.Start(); err != nil {
		fmt.Printf("[Desktop] Failed to start backend: %v\n", err)
		return
	}

	// Wait for backend to be ready
	for i := 0; i < 30; i++ {
		conn, err := net.DialTimeout("tcp", "127.0.0.1:18600", 500*time.Millisecond)
		if err == nil {
			conn.Close()
			fmt.Println("[Desktop] Backend is ready")
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	fmt.Println("[Desktop] Warning: backend may not be ready")
}

// stopBackend kills the backend process
func (a *App) stopBackend() {
	if a.backendCmd != nil && a.backendCmd.Process != nil {
		fmt.Println("[Desktop] Stopping backend...")
		a.backendCmd.Process.Kill()
	}
}

// GetBackendURL returns the backend URL for the frontend
func (a *App) GetBackendURL() string {
	return "http://127.0.0.1:18600"
}
