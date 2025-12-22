//go:build !windows

package realdebrid

import (
	"os"
	"os/exec"
	"syscall"
)

// setWindowsProcessAttributes is a no-op on non-Windows platforms
func (rm *RcloneManager) setWindowsProcessAttributes(cmd *exec.Cmd) {
}

// isProcessRunningPlatform checks if a process is running on Unix systems
func isProcessRunningPlatform(pid int, process *os.Process) bool {
	err := process.Signal(syscall.Signal(0))
	return err == nil
}
