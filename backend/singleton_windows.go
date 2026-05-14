//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

const mutexName = "Global\\GAManagerSingleInstance"

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutex = kernel32.NewProc("CreateMutexW")
	procCloseHandle = kernel32.NewProc("CloseHandle")
)

// ensureSingleInstance creates a named mutex to guarantee only one
// ga-manager-backend process runs at a time. If another instance
// already holds the mutex, this function prints an error and exits.
func ensureSingleInstance() func() {
	name, _ := syscall.UTF16PtrFromString(mutexName)
	handle, _, err := procCreateMutex.Call(
		0,
		1, // bInitialOwner = TRUE
		uintptr(unsafe.Pointer(name)),
	)

	if handle == 0 {
		fmt.Fprintf(os.Stderr, "[GA Manager] Failed to create mutex: %v\n", err)
		os.Exit(1)
	}

	// ERROR_ALREADY_EXISTS = 183
	if err.(syscall.Errno) == 183 {
		fmt.Fprintf(os.Stderr, "[GA Manager] Another instance is already running. Only one ga-manager is allowed.\n")
		procCloseHandle.Call(handle)
		os.Exit(1)
	}

	// Return a cleanup function to release the mutex on shutdown
	return func() {
		procCloseHandle.Call(handle)
	}
}
