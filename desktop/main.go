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
var iconICO embed.FS

//go:embed app.png
var iconPNG embed.FS

const (
	backendURL   = "http://localhost:18600"
	appTitle     = "GA Manager"
	windowWidth  = 1400
	windowHeight = 900
)

// backendPID stores the PID of the backend process started by this desktop app.
var backendPID int

// browserPID stores the PID of the browser --app window launched by this desktop app.
var browserPID int

func main() {
	// Strict single-instance enforcement via OS-level mutex/flock
	releaseDesktop := ensureSingleDesktop()
	defer releaseDesktop()

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
	// Load icon - use ICO on Windows, PNG on macOS/Linux
	var icon []byte
	var err error
	if runtime.GOOS == "windows" {
		icon, err = iconICO.ReadFile("app.ico")
	} else {
		icon, err = iconPNG.ReadFile("app.png")
	}
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
	log.Println("GA Manager tray exiting, cleaning up all processes...")

	// Step 1: Call backend /api/shutdown to gracefully stop all GA instances
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest("POST", backendURL+"/api/shutdown", nil)
	if req != nil {
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("Shutdown API call failed: %v", err)
		} else {
			resp.Body.Close()
			log.Println("Shutdown API called successfully, waiting for backend to stop...")
			// Give backend time to stop all instances
			time.Sleep(3 * time.Second)
		}
	}

	// Step 2: Force-kill browser window
	if browserPID > 0 {
		log.Printf("Closing browser window (PID %d)...", browserPID)
		var killBrowserCmd *exec.Cmd
		if runtime.GOOS == "windows" {
			killBrowserCmd = exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", browserPID))
		} else {
			killBrowserCmd = exec.Command("kill", fmt.Sprintf("%d", browserPID))
		}
		if out, err := killBrowserCmd.CombinedOutput(); err != nil {
			log.Printf("Browser kill result: %v, output: %s", err, string(out))
		} else {
			log.Println("Browser window closed successfully")
		}
	}

	// Step 3: Force-kill backend process tree as fallback
	if backendPID > 0 {
		log.Printf("Force-killing backend process tree (PID %d)...", backendPID)
		killCmd := exec.Command("taskkill", "/F", "/T", "/PID", fmt.Sprintf("%d", backendPID))
		if runtime.GOOS != "windows" {
			killCmd = exec.Command("kill", "-9", fmt.Sprintf("%d", backendPID))
		}
		if out, err := killCmd.CombinedOutput(); err != nil {
			log.Printf("Force-kill result: %v, output: %s", err, string(out))
		} else {
			log.Println("Backend process tree killed successfully")
		}
	}

	log.Println("GA Manager exit complete.")
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

func backendBinaryName() string {
	if runtime.GOOS == "windows" {
		return "ga-manager-backend.exe"
	}
	return "ga-manager-backend"
}

func startBackend() {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	binName := backendBinaryName()

	candidates := []string{
		filepath.Join(exeDir, binName),
		filepath.Join(exeDir, "..", "backend", binName),
		filepath.Join(exeDir, "..", binName),
	}

	// On macOS inside .app bundle
	if runtime.GOOS == "darwin" {
		candidates = append(candidates,
			filepath.Join(exeDir, "..", "Resources", binName),
		)
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
		return
	}
	backendPID = cmd.Process.Pid
	log.Printf("Backend started with PID %d", backendPID)
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
			browserPID = cmd.Process.Pid
			log.Printf("Launched browser window (PID=%d)", browserPID)
			return
		}
	}
	log.Println("Warning: no supported browser found for app window")
}

// --- Auto Start ---

func macLaunchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.gamanager.app.plist")
}

func isAutoStartEnabled() bool {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("reg", "query",
			`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`,
			"/v", "GAManager")
		return cmd.Run() == nil
	} else if runtime.GOOS == "darwin" {
		_, err := os.Stat(macLaunchAgentPath())
		return err == nil
	}
	return false
}

func enableAutoStart() {
	exePath, _ := os.Executable()
	if runtime.GOOS == "windows" {
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
	} else if runtime.GOOS == "darwin" {
		plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gamanager.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>`, exePath)
		plistPath := macLaunchAgentPath()
		os.MkdirAll(filepath.Dir(plistPath), 0755)
		if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
			log.Printf("Failed to enable auto-start: %v", err)
		} else {
			log.Println("Auto-start enabled (LaunchAgent)")
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
	} else if runtime.GOOS == "darwin" {
		if err := os.Remove(macLaunchAgentPath()); err != nil {
			log.Printf("Failed to disable auto-start: %v", err)
		} else {
			log.Println("Auto-start disabled (LaunchAgent removed)")
		}
	}
}
