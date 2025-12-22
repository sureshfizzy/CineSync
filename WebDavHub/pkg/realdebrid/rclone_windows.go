//go:build windows

package realdebrid

import (
	"os"
	"os/exec"
	"syscall"
)

// setWindowsProcessAttributes sets Windows-specific process attributes
func (rm *RcloneManager) setWindowsProcessAttributes(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
}

// isProcessRunningPlatform checks if a process is running on Windows
func isProcessRunningPlatform(pid int, process *os.Process) bool {
	handle, err := syscall.OpenProcess(syscall.PROCESS_QUERY_INFORMATION, false, uint32(pid))
	if err != nil {
		return false
	}
	defer syscall.CloseHandle(handle)

	var exitCode uint32
	err = syscall.GetExitCodeProcess(handle, &exitCode)
	if err != nil {
		return false
	}

	return exitCode == 259
}
