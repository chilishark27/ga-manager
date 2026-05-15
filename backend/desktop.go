//go:build windows

package main

import (
	"embed"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/getlantern/systray"
)

//go:embed app.ico
var iconICO embed.FS

//go:embed app.png
var iconPNG embed.FS

const (
	appTitle     = "GA Manager"
	windowWidth  = 1400
	windowHeight = 900
)

var browserPID int

func runDesktop(port int) {
	systray.Run(func() { onSystrayReady(port) }, onSystrayExit)
}

func onSystrayReady(port int) {
	icon, err := iconICO.ReadFile("app.ico")
	if err == nil {
		systray.SetIcon(icon)
	}
	systray.SetTitle("GA Manager")
	systray.SetTooltip("GA Manager - GenericAgent 多实例管理器")

	mOpen := systray.AddMenuItem("打开管理面板", "在浏览器中打开 GA Manager")
	systray.AddSeparator()
	mAutoStart := systray.AddMenuItemCheckbox("开机自启", "设置开机自动启动", isAutoStartEnabled())
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "退出 GA Manager")

	go func() {
		for {
			select {
			case <-mOpen.ClickedCh:
				launchAppWindow(port)
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

func onSystrayExit() {
	log.Println("[GA Manager] Exiting...")
	if browserPID > 0 {
		proc, err := os.FindProcess(browserPID)
		if err == nil {
			proc.Kill()
		}
	}
	os.Exit(0)
}

func launchAppWindow(port int) {
	appURL := fmt.Sprintf("http://localhost:%d", port)
	args := []string{
		fmt.Sprintf("--app=%s", appURL),
		fmt.Sprintf("--window-size=%d,%d", windowWidth, windowHeight),
		"--disable-extensions",
		"--disable-default-apps",
		"--no-first-run",
		"--no-default-browser-check",
	}
	browsers := []string{
		"msedge",
		`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Microsoft\Edge\Application\msedge.exe`,
		`C:\Program Files\Google\Chrome\Application\chrome.exe`,
		`C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`,
	}
	for _, browser := range browsers {
		cmd := exec.Command(browser, args...)
		if err := cmd.Start(); err == nil {
			browserPID = cmd.Process.Pid
			return
		}
	}
	log.Println("Warning: no supported browser found")
}

func isAutoStartEnabled() bool {
	startupDir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	// Check for .bat file (no COM/WScript needed)
	bat := filepath.Join(startupDir, "GA Manager.bat")
	_, err := os.Stat(bat)
	return err == nil
}

func enableAutoStart() {
	exePath, _ := os.Executable()
	startupDir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	bat := filepath.Join(startupDir, "GA Manager.bat")
	content := fmt.Sprintf("@echo off\r\nstart \"\" \"%s\"\r\n", exePath)
	os.WriteFile(bat, []byte(content), 0644)
}

func disableAutoStart() {
	startupDir := filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
	os.Remove(filepath.Join(startupDir, "GA Manager.bat"))
}

func hideConsoleWindowIfNeeded() {
	hideConsoleWindow()
}
