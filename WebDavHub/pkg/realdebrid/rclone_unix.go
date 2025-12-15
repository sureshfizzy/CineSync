//go:build !windows

package realdebrid

import "os/exec"

// setWindowsProcessAttributes is a no-op on non-Windows platforms
func (rm *RcloneManager) setWindowsProcessAttributes(cmd *exec.Cmd) {
}
