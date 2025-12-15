//go:build windows

package realdebrid

import (
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
