//go:build !windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// ensureSingleInstance uses flock on a lock file to guarantee only one
// ga-manager-backend process runs at a time (macOS/Linux).
func ensureSingleInstance() func() {
	// Place lock file next to the executable
	exe, _ := os.Executable()
	lockPath := filepath.Join(filepath.Dir(exe), ".ga-manager.lock")

	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GA Manager] Failed to create lock file: %v\n", err)
		os.Exit(1)
	}

	// Try non-blocking exclusive lock
	err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GA Manager] Another instance is already running. Only one ga-manager is allowed.\n")
		f.Close()
		os.Exit(1)
	}

	// Write PID for debugging
	f.Truncate(0)
	f.Seek(0, 0)
	fmt.Fprintf(f, "%d", os.Getpid())

	return func() {
		syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		f.Close()
		os.Remove(lockPath)
	}
}
