//go:build !windows

package services

import (
	"os/exec"
	"syscall"
)

// hideWindow sets process group on Unix so we can kill the entire tree later.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killPgid kills a process group by sending SIGKILL to the negative PID.
func killPgid(pid int) error {
	return syscall.Kill(-pid, syscall.SIGKILL)
}
