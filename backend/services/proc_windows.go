//go:build windows

package services

import (
	"fmt"
	"os/exec"
	"syscall"
)

// hideWindow prevents subprocess from showing a console window.
// Uses DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP which are less likely
// to trigger antivirus than CREATE_NO_WINDOW (0x08000000).
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | 0x00000008, // DETACHED_PROCESS
	}
}

// killPgid is not used on Windows (taskkill handles tree killing).
func killPgid(pid int) error {
	return fmt.Errorf("not supported on windows")
}
