//go:build windows

package services

import "os/exec"

// hideWindow is a no-op to avoid antivirus false positives.
// The -H windowsgui linker flag prevents the main window;
// subprocess console windows will flash briefly but this is
// preferable to being flagged as malware.
func hideWindow(cmd *exec.Cmd) {
	// Intentionally empty — CREATE_NO_WINDOW triggers AV detection
}
