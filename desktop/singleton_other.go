//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// ensureSingleDesktop uses flock to guarantee only one
// ga-manager desktop (tray) process runs at a time (macOS/Linux).
func ensureSingleDesktop() func() {
	exe, _ := os.Executable()
	lockPath := filepath.Join(filepath.Dir(exe), ".ga-manager-desktop.lock")

	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GA Manager Desktop] Cannot create lock file: %v\n", err)
		os.Exit(1)
	}

	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GA Manager Desktop] Another instance is already running.\n")
		f.Close()
		os.Exit(1)
	}

	f.Truncate(0)
	f.Seek(0, 0)
	fmt.Fprintf(f, "%d", os.Getpid())

	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
		os.Remove(lockPath)
	}
}
