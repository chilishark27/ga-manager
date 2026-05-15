//go:build !windows

package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func runDesktop(port int) {
	launchBrowser(port)
	// Block forever (HTTP server runs in goroutine)
	select {}
}

func launchBrowser(port int) {
	url := fmt.Sprintf("http://localhost:%d", port)
	var cmd *exec.Cmd
	if runtime.GOOS == "darwin" {
		cmd = exec.Command("open", url)
	} else {
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

func hideConsoleWindowIfNeeded() {}

func macLaunchAgentPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", "com.gamanager.app.plist")
}

func isAutoStartEnabled() bool {
	if runtime.GOOS == "darwin" {
		_, err := os.Stat(macLaunchAgentPath())
		return err == nil
	}
	return false
}

func enableAutoStart() {
	exePath, _ := os.Executable()
	if runtime.GOOS == "darwin" {
		plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.gamanager.app</string>
<key>ProgramArguments</key><array><string>%s</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>`, exePath)
		p := macLaunchAgentPath()
		os.MkdirAll(filepath.Dir(p), 0755)
		os.WriteFile(p, []byte(plist), 0644)
		log.Println("Auto-start enabled (LaunchAgent)")
	}
}

func disableAutoStart() {
	if runtime.GOOS == "darwin" {
		os.Remove(macLaunchAgentPath())
		log.Println("Auto-start disabled")
	}
}
