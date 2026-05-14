//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const desktopMutexName = "Global\\GAManagerDesktopSingleInstance"

var (
	kernel32              = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutexW      = kernel32.NewProc("CreateMutexW")
	procCloseHandleDesktop = kernel32.NewProc("CloseHandle")
)

// ensureSingleDesktop creates a named mutex to guarantee only one
// ga-manager desktop (tray) process runs at a time.
func ensureSingleDesktop() func() {
	name, _ := syscall.UTF16PtrFromString(desktopMutexName)
	handle, _, err := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		fmt.Fprintf(os.Stderr, "[GA Manager Desktop] Failed to create mutex: %v\n", err)
		os.Exit(1)
	}

	// ERROR_ALREADY_EXISTS = 183
	if err.(syscall.Errno) == 183 {
		fmt.Fprintf(os.Stderr, "[GA Manager Desktop] Another instance is already running.\n")
		procCloseHandleDesktop.Call(handle)
		os.Exit(1)
	}

	return func() {
		procCloseHandleDesktop.Call(handle)
	}
}
