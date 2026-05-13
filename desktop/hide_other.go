//go:build !windows

package main

func hideConsoleWindow() {
	// No-op on non-Windows platforms
}
