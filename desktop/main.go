package main

import (
	"embed"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/getlantern/systray"
)

//go:embed app.ico
var iconData embed.FS

const (
	backendURL   = "http://localhost:18600"
	appTitle     = "GA Manager"
	windowWidth  = 1400
	windowHeight = 900
)

func main() {
	// Hide console window on Windows
	hideConsoleWindow()

	// Ensure backend is running
	if !isBackendRunning() {
		log.Println("Starting backend server...")
		startBackend()
		if !waitForBackend(10 * time.Second) {
			log.Fatal("Backend failed to start within 10 seconds")
		}
	} else {
		log.Println("Backend already running on :18600")
	}

	// Run systray (blocks until quit)
	systray.Run(onReady, onExit)
}

func onReady() {
	// Load icon
	icon, err := iconData.ReadFile("app.ico")
	if err != nil {
		log.Printf("Warning: failed to load tray icon: %v", err)
	} else {
		systray.SetIcon(icon)
	}
	systray.SetTitle("GA Manager")
	systray.SetTooltip("GA Manager - GenericAgent 多实例管理器")

	// Menu items
	mOpen := systray.AddMenuItem("打开管理面板", "在浏览器中打开 GA Manager")
	systray.AddSeparator()
	mStartAll := systray.AddMenuItem("启动所有实例", "启动所有已配置的 Agent 实例")
	mStopAll := systray.AddMenuItem("停止所有实例", "停止所有运行中的 Agent 实例")
	systray.AddSeparator()
	mAutoStart := systray.AddMenuItemCheckbox("开机自启", "设置 GA Manager 开机自动启动", isAutoStartEnabled())
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "退出 GA Manager")

	// Launch browser window on startup
	go launchAppWindow()

	// Handle menu clicks
	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				launchAppWindow()
			case <-mStartAll.ClickedCh:
				startAllInstances()
			case <-mStopAll.ClickedCh:
				stopAllInstances()
			case <-mAutoStart.ClickedCh:
				if mAutoStart.Checked() {
					mAutoStart.Uncheck()
					disableAutoStart()
				} else {
					mAutoStart.Check()
					enableAutoStart()
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
			}
		}
	}()
}

func onExit() {
	log.Println("GA Manager tray exiting...")
	// Optionally stop backend on exit
	stopAllInstances()
}

// --- Backend Management ---

func isBackendRunning() bool {
	conn, err := net.DialTimeout("tcp", "localhost:18600", 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func startBackend() {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)

	candidates := []string{
		filepath.Join(exeDir, "ga_manager.exe"),
		filepath.Join(exeDir, "..", "backend", "ga_manager.exe"),
		filepath.Join(exeDir, "..", "ga_manager.exe"),
	}

	var backendPath string
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			backendPath = p
			break
		}
	}

	if backendPath == "" {
		log.Println("Warning: backend executable not found")
		return
	}

	cmd := exec.Command(backendPath)
	cmd.Dir = filepath.Dir(backendPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		log.Printf("Warning: failed to start backend: %v\n", err)
	}
}

func waitForBackend(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := http.Get(backendURL + "/api/health")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return true
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

// --- Instance Control via API ---

func startAllInstances() {
	resp, err := http.Get(backendURL + "/api/instances")
	if err != nil {
		log.Printf("Failed to get instances: %v", err)
		return
	}
	resp.Body.Close()
	// TODO: parse response and start each stopped instance
	log.Println("Start all instances triggered")
}

func stopAllInstances() {
	resp, err := http.Get(backendURL + "/api/instances")
	if err != nil {
		log.Printf("Failed to get instances: %v", err)
		return
	}
	resp.Body.Close()
	// TODO: parse response and stop each running instance
	log.Println("Stop all instances triggered")
}

// --- Browser Window ---

func launchAppWindow() {
	appURL := backendURL
	args := []string{
		fmt.Sprintf("--app=%s", appURL),
		fmt.Sprintf("--window-size=%d,%d", windowWidth, windowHeight),
		"--disable-extensions",
		"--disable-default-apps",
		"--no-first-run",
		"--no-default-browser-check",
		fmt.Sprintf("--app-name=%s", appTitle),
	}

	var browsers []string
	if runtime.GOOS == "windows" {
		browsers = []string{
			"msedge",
			`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
			`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
			`C:\Program Files\Google\Chrome\Application\chrome.exe`,
			`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
		}
	} else if runtime.GOOS == "darwin" {
		browsers = []string{
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		}
	} else {
		browsers = []string{
			"microsoft-edge",
			"google-chrome",
			"chromium-browser",
			"chromium",
		}
	}

	for _, browser := range browsers {
		cmd := exec.Command(browser, args...)
		if err := cmd.Start(); err == nil {
			log.Printf("Launched browser window (PID=%d)", cmd.Process.Pid)
			return
		}
	}
	log.Println("Warning: no supported browser found for app window")
}

// --- Auto Start ---

func isAutoStartEnabled() bool {
	if runtime.GOOS == "windows" {
		// Check registry for auto-start entry
		cmd := exec.Command("reg", "query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "GAManager")
		return cmd.Run() == nil
	}
	return false
}

func enableAutoStart() {
	if runtime.GOOS == "windows" {
		exePath, _ := os.Executable()
		cmd := exec.Command("reg", "add",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "GAManager",
			"/t", "REG_SZ",
			"/d", exePath,
			"/f")
		if err := cmd.Run(); err != nil {
			log.Printf("Failed to enable auto-start: %v", err)
		} else {
			log.Println("Auto-start enabled")
		}
	}
}

func disableAutoStart() {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("reg", "delete",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "GAManager",
			"/f")
		if err := cmd.Run(); err != nil {
			log.Printf("Failed to disable auto-start: %v", err)
		} else {
			log.Println("Auto-start disabled")
		}
	}
}
