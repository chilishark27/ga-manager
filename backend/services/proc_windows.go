//go:build windows

package services

import (
	"os/exec"
	"syscall"
)

// hideWindow sets CREATE_NO_WINDOW flag to prevent console window flash on Windows.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
