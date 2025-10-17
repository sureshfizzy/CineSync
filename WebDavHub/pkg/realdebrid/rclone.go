package realdebrid

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
)

// RcloneMount represents a mounted rclone instance
type RcloneMount struct {
	ProcessID int
	MountPath string
	RemoteName string
	StartTime time.Time
	Config    RcloneSettings
}

// RcloneManager manages rclone mounts
type RcloneManager struct {
	mounts map[string]*RcloneMount
	mutex  sync.RWMutex
}

var (
	rcloneManager *RcloneManager
	rcloneOnce    sync.Once
)

// GetRcloneManager returns the singleton rclone manager
func GetRcloneManager() *RcloneManager {
	rcloneOnce.Do(func() {
		rcloneManager = &RcloneManager{
			mounts: make(map[string]*RcloneMount),
		}
		// Start background cleanup routine
		go rcloneManager.startCleanupRoutine()
	})
	return rcloneManager
}

// startCleanupRoutine starts a background routine to clean up stale mounts
func (rm *RcloneManager) startCleanupRoutine() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for range ticker.C {
		rm.CleanupStaleMounts()
	}
}

// MountStatus represents the status of a mount
type MountStatus struct {
	Mounted  bool   `json:"mounted"`
	MountPath string `json:"mountPath,omitempty"`
	Error    string `json:"error,omitempty"`
	ProcessID int   `json:"processId,omitempty"`
}

// Mount starts an rclone mount
func (rm *RcloneManager) Mount(config RcloneSettings, apiKey string) (*MountStatus, error) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	// Check if already mounted
	if mount, exists := rm.mounts[config.MountPath]; exists {
		if rm.isProcessRunning(mount.ProcessID) {
			return &MountStatus{
				Mounted:    true,
				MountPath:  mount.MountPath,
				ProcessID:  mount.ProcessID,
			}, nil
		}
		delete(rm.mounts, config.MountPath)
	}

	// Validate mount path
	if config.MountPath == "" {
		return &MountStatus{Error: "mount path is required"}, fmt.Errorf("mount path is required")
	}

	// Windows-specific validation
	if runtime.GOOS == "windows" {
		if len(config.MountPath) >= 2 && config.MountPath[1] == ':' {
			if len(config.MountPath) == 2 {
				config.MountPath = config.MountPath + "\\"
			}
		} else if !strings.HasPrefix(config.MountPath, "\\\\") {
			if !filepath.IsAbs(config.MountPath) {
				absPath, err := filepath.Abs(config.MountPath)
				if err != nil {
					return &MountStatus{Error: fmt.Sprintf("invalid mount path: %v", err)}, err
				}
				config.MountPath = absPath
			}
		}
	}

	if runtime.GOOS == "windows" && len(config.MountPath) == 3 && config.MountPath[1] == ':' && config.MountPath[2] == '\\' {
		logger.Info("Windows drive letter mount detected: %s", config.MountPath)
	} else {
		if err := os.MkdirAll(config.MountPath, 0755); err != nil {
			return &MountStatus{Error: fmt.Sprintf("failed to create mount directory: %v", err)}, err
		}
	}

	// Check if rclone is available
	if !rm.isRcloneAvailable(config.RclonePath) {
		return &MountStatus{Error: "rclone is not installed or not in PATH"}, fmt.Errorf("rclone is not available")
	}

	// Create rclone config if it doesn't exist
	if err := CreateRcloneConfig(apiKey, config.RclonePath); err != nil {
		return &MountStatus{Error: fmt.Sprintf("failed to create rclone config: %v", err)}, err
	}

	// Build rclone command
	args := rm.buildRcloneArgs(config)
	
	// Debug logging
	rcloneCmd := "rclone"
	if config.RclonePath != "" {
		rcloneCmd = config.RclonePath
	}

	// Start rclone process
	cmd := exec.Command(rcloneCmd, args...)
	if runtime.GOOS == "windows" {
		cmd.SysProcAttr = &syscall.SysProcAttr{
			HideWindow:    true,
			CreationFlags: 0x08000000,
		}
	}

	if err := cmd.Start(); err != nil {
		logger.Error("Failed to start rclone command: %v", err)
		return &MountStatus{Error: fmt.Sprintf("failed to start rclone: %v", err)}, err
	}

	// Wait a moment for mount to initialize
	time.Sleep(3 * time.Second)

	// Check if process is still running
	if !rm.isProcessRunning(cmd.Process.Pid) {
		errorMsg := "rclone process exited immediately. Check if WinFsp is installed and the mount path is valid."
		return &MountStatus{Error: errorMsg}, fmt.Errorf("rclone process exited")
	}

	// Additional Windows-specific validation
	if runtime.GOOS == "windows" {
		// Check if the mount point is accessible
		if _, err := os.Stat(config.MountPath); err != nil {
			logger.Warn("Mount point may not be accessible: %v", err)
		}
	}

	// Store mount info
	mount := &RcloneMount{
		ProcessID: cmd.Process.Pid,
		MountPath: config.MountPath,
		RemoteName: config.RemoteName,
		StartTime: time.Now(),
		Config:    config,
	}
	rm.mounts[config.MountPath] = mount

	logger.Info("Rclone mount started successfully: PID=%d, Path=%s", cmd.Process.Pid, config.MountPath)

	return &MountStatus{
		Mounted:   true,
		MountPath: config.MountPath,
		ProcessID: cmd.Process.Pid,
	}, nil
}

// Unmount stops an rclone mount
func (rm *RcloneManager) Unmount(mountPath string) (*MountStatus, error) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	normalizedPath := normalizeMountPath(mountPath)
	mount, exists := rm.mounts[normalizedPath]
	if !exists {
		mount, exists = rm.mounts[mountPath]
		if !exists {
			return &MountStatus{Error: "mount not found"}, fmt.Errorf("mount not found")
		}
	} else {
		mountPath = normalizedPath
	}

	// Try graceful unmount first
	if rm.isProcessRunning(mount.ProcessID) {
		if err := rm.gracefulUnmount(mountPath); err != nil {
			logger.Warn("Graceful unmount failed, trying force kill: %v", err)
			if err := rm.forceKill(mount.ProcessID); err != nil {
				return &MountStatus{Error: fmt.Sprintf("failed to kill process: %v", err)}, err
			}
		}
	}

	// Remove from map
	delete(rm.mounts, mountPath)

	logger.Info("Rclone mount stopped: Path=%s", mountPath)

	return &MountStatus{Mounted: false}, nil
}

// GetStatus returns the status of a mount
func (rm *RcloneManager) GetStatus(mountPath string) *MountStatus {
	rm.mutex.RLock()
	defer rm.mutex.RUnlock()

	normalizedPath := normalizeMountPath(mountPath)
	mount, exists := rm.mounts[normalizedPath]
	if !exists {
		mount, exists = rm.mounts[mountPath]
		if !exists {
			return &MountStatus{Mounted: false}
		}
	}

	if !rm.isProcessRunning(mount.ProcessID) {
		return &MountStatus{Mounted: false, Error: "process not running"}
	}

	return &MountStatus{
		Mounted:   true,
		MountPath: mount.MountPath,
		ProcessID: mount.ProcessID,
	}
}

// GetAllStatuses returns status of all mounts
func (rm *RcloneManager) GetAllStatuses() map[string]*MountStatus {
	rm.mutex.RLock()
	defer rm.mutex.RUnlock()

	statuses := make(map[string]*MountStatus)
	for path, mount := range rm.mounts {
		if rm.isProcessRunning(mount.ProcessID) {
			statuses[path] = &MountStatus{
				Mounted:   true,
				MountPath: mount.MountPath,
				ProcessID: mount.ProcessID,
			}
		} else {
			statuses[path] = &MountStatus{Mounted: false, Error: "process not running"}
		}
	}
	return statuses
}

func normalizeMountPath(path string) string {
	if runtime.GOOS == "windows" {
		if len(path) == 2 && path[1] == ':' {
			return path + "\\"
		}
	}
	return path
}

// buildRcloneArgs builds the rclone command arguments
func (rm *RcloneManager) buildRcloneArgs(config RcloneSettings) []string {
	args := []string{
		"mount",
		config.RemoteName + ":",
		config.MountPath,
		"--config", GetRcloneConfigPath(),
		"--vfs-cache-mode", config.VfsCacheMode,
		"--vfs-cache-max-size", config.VfsCacheMaxSize,
		"--vfs-cache-max-age", config.VfsCacheMaxAge,
		"--buffer-size", config.BufferSize,
		"--dir-cache-time", config.DirCacheTime,
		"--poll-interval", config.PollInterval,
	}

	// Platform-specific options
	if runtime.GOOS == "windows" {
		args = append(args, "--links")
	} else {
		args = append(args, "--allow-other")
		args = append(args, "--daemon")
	}

	return args
}

// obscurePassword uses rclone to obscure a password
func obscurePassword(password string, rclonePath string) (string, error) {
	
	// If no path configured, try to find rclone
	if rclonePath == "" {
		logger.Info("No rclone path configured, searching for rclone...")
		rcloneCmd := "rclone"
		if runtime.GOOS == "windows" {
			rcloneCmd = "rclone.exe"
		}
		
		// Try common rclone locations
		possiblePaths := []string{
			rcloneCmd, // PATH
			"C:\\Program Files\\rclone\\rclone.exe",
			"C:\\Program Files (x86)\\rclone\\rclone.exe",
			"C:\\Users\\" + os.Getenv("USERNAME") + "\\AppData\\Local\\rclone\\rclone.exe",
		}
		
		for _, path := range possiblePaths {
			if _, err := exec.LookPath(path); err == nil {
				rclonePath = path
				logger.Info("Found rclone at: %s", path)
				break
			}
		}
	} else {
		if _, err := os.Stat(rclonePath); err != nil {
			logger.Warn("Configured rclone path does not exist: %s", rclonePath)
			rclonePath = ""
		}
	}
	
	if rclonePath == "" {
		return "", fmt.Errorf("rclone not found")
	}
	
	// Run rclone obscure directly without cmd.exe
	cmd := exec.Command(rclonePath, "obscure", password)
	
	// Capture both stdout and stderr
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	
	err := cmd.Run()
	if err != nil {
		logger.Error("Failed to run rclone obscure: %v", err)
		logger.Error("Rclone stdout: %s", stdout.String())
		logger.Error("Rclone stderr: %s", stderr.String())
		return "", fmt.Errorf("failed to obscure password: %v", err)
	}
	
	obscured := strings.TrimSpace(stdout.String())
	if obscured == "" {
		logger.Error("Empty obscured password from rclone")
		logger.Error("Rclone stderr: %s", stderr.String())
		return "", fmt.Errorf("empty obscured password")
	}
	
	return obscured, nil
}

// isRcloneAvailable checks if rclone is installed and available
func (rm *RcloneManager) isRcloneAvailable(rclonePath string) bool {
	rcloneCmd := "rclone"
	if rclonePath != "" {
		rcloneCmd = rclonePath
	}
	cmd := exec.Command(rcloneCmd, "version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// IsRcloneAvailable is a public method to check if rclone is available
func (rm *RcloneManager) IsRcloneAvailable(rclonePath string) bool {
	return rm.isRcloneAvailable(rclonePath)
}

// isProcessRunning checks if a process is still running
func (rm *RcloneManager) isProcessRunning(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	
	// On Unix systems, signal 0 can be used to check if process exists
	if runtime.GOOS != "windows" {
		err = process.Signal(os.Signal(nil))
		return err == nil
	}

	return true
}

// gracefulUnmount attempts to gracefully unmount using fusermount/unmount
func (rm *RcloneManager) gracefulUnmount(mountPath string) error {
	var cmd *exec.Cmd
	
	if runtime.GOOS == "windows" {
		return fmt.Errorf("graceful unmount not supported on Windows")
	} else {
		// Try fusermount first (Linux/macOS)
		cmd = exec.Command("fusermount", "-u", mountPath)
		if err := cmd.Run(); err != nil {
			// Try generic unmount as fallback
			cmd = exec.Command("umount", mountPath)
			return cmd.Run()
		}
	}
	
	return nil
}

// forceKill forcefully kills a process
func (rm *RcloneManager) forceKill(pid int) error {
	if runtime.GOOS == "windows" {
		logger.Info("Force killing rclone process: PID=%d", pid)
		cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
		output, err := cmd.CombinedOutput()
		if err != nil {
			logger.Error("Taskkill failed: %v, output: %s", err, string(output))
			return err
		}
		logger.Info("Taskkill output: %s", string(output))
		return nil
	} else {
		// On Unix systems, use kill
		process, err := os.FindProcess(pid)
		if err != nil {
			return err
		}
		return process.Kill()
	}
}

// CleanupStaleMounts removes mounts that are no longer running
func (rm *RcloneManager) CleanupStaleMounts() {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	for path, mount := range rm.mounts {
		if !rm.isProcessRunning(mount.ProcessID) {
			logger.Info("Cleaning up stale mount: %s (PID: %d)", path, mount.ProcessID)
			delete(rm.mounts, path)
		}
	}
}

// CleanupAllMounts unmounts all active mounts (called on shutdown)
func (rm *RcloneManager) CleanupAllMounts() {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()
	
	logger.Info("Cleaning up all rclone mounts...")
	for path, mount := range rm.mounts {
		if rm.isProcessRunning(mount.ProcessID) {
			logger.Info("Stopping rclone mount: Path=%s, PID=%d", path, mount.ProcessID)
			if err := rm.forceKill(mount.ProcessID); err != nil {
				logger.Error("Failed to kill rclone process %d: %v", mount.ProcessID, err)
			}
		}
		delete(rm.mounts, path)
	}
	logger.Info("All rclone mounts cleaned up")
}

// GetRcloneConfigPath returns the path to rclone config file
func GetRcloneConfigPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	
	if runtime.GOOS == "windows" {
		return filepath.Join(homeDir, "AppData", "Roaming", "rclone", "cinesync.conf")
	} else {
		return filepath.Join(homeDir, ".config", "rclone", "cinesync.conf")
	}
}

// CreateRcloneConfig creates a basic rclone config for Real-Debrid
func CreateRcloneConfig(apiKey string, rclonePath string) error {
	configPath := GetRcloneConfigPath()
	if configPath == "" {
		return fmt.Errorf("unable to determine rclone config path")
	}

	// Create config directory if it doesn't exist
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	// Check if config already exists
	if _, err := os.Stat(configPath); err == nil {
		return UpdateRcloneConfig(apiKey, rclonePath)
	}

    // Enforce default remote name
    remoteName := "CineSync"

	// Get CineSync credentials for authentication
	username := env.GetString("CINESYNC_USERNAME", "admin")
	password := env.GetString("CINESYNC_PASSWORD", "admin")
	webdavPort := env.GetInt("CINESYNC_API_PORT", 8082)
	
	obscuredPassword, err := obscurePassword(password, rclonePath)
	if err != nil {
		logger.Error("Failed to obscure password: %v", err)
		logger.Warn("Using plain text password as fallback")
		obscuredPassword = password
	}
	
	config := fmt.Sprintf(`[%s]
type = webdav
url = http://localhost:%d/api/realdebrid/webdav/
user = %s
pass = %s
vendor = other
`, remoteName, webdavPort, username, obscuredPassword)

	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		return fmt.Errorf("failed to write rclone config: %v", err)
	}

	return nil
}

// UpdateRcloneConfig updates the rclone config with new API key
func UpdateRcloneConfig(apiKey string, rclonePath string) error {
	configPath := GetRcloneConfigPath()
	if configPath == "" {
		return fmt.Errorf("unable to determine rclone config path")
	}
    // Enforce default remote name
    remoteName := "CineSync"
	// Create config directory if it doesn't exist
	configDir := filepath.Dir(configPath)
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	// Create updated config for Real-Debrid Virtual Filesystem
	username := env.GetString("CINESYNC_USERNAME", "admin")
	password := env.GetString("CINESYNC_PASSWORD", "admin")
	webdavPort := env.GetInt("CINESYNC_API_PORT", 8082)
	
	obscuredPassword, err := obscurePassword(password, rclonePath)
	if err != nil {
		logger.Error("Failed to obscure password: %v", err)
		obscuredPassword = password
	}
	
	config := fmt.Sprintf(`[%s]
type = webdav
url = http://localhost:%d/api/realdebrid/webdav/
user = %s
pass = %s
vendor = other
`, remoteName, webdavPort, username, obscuredPassword)

	if err := os.WriteFile(configPath, []byte(config), 0600); err != nil {
		return fmt.Errorf("failed to write rclone config: %v", err)
	}
	return nil
}
