//go:build windows

package main

func hideConsoleWindow() {
	// No-op: -H windowsgui linker flag handles console hiding at build time.
}
