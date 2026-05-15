//go:build windows

package main

import (
	"fmt"
	"net"
	"os"
)

// ensureSingleInstance checks if the HTTP port is already in use.
// If so, another instance is running — exit gracefully.
func ensureSingleInstance() func() {
	ln, err := net.Listen("tcp", "127.0.0.1:18599")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[GA Manager] Another instance is already running.\n")
		os.Exit(1)
	}
	// Keep the listener open as a lock; close on shutdown
	return func() {
		ln.Close()
	}
}
