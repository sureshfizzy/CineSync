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
	Waiting   bool
	WaitingReason string
	APIKey   string
}

// RcloneManager manages rclone mounts
type RcloneManager struct {
	mounts map[string]*RcloneMount
	mutex  sync.RWMutex
	pendingMount *RcloneMount
	pendingMutex sync.RWMutex
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

// GetServerOS returns the server's operating system
func GetServerOS() string {
	return runtime.GOOS
}

// startCleanupRoutine starts a background routine to clean up stale mounts
func (rm *RcloneManager) startCleanupRoutine() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	
	for range ticker.C {
		rm.CleanupStaleMounts()
	}
}


// triggerPendingMount executes the pending mount when torrents are loaded
func triggerPendingMount() {
	rm := GetRcloneManager()
	
	rm.pendingMutex.RLock()
	pendingMount := rm.pendingMount
	rm.pendingMutex.RUnlock()
	
	if pendingMount == nil {
		return
	}
	
	logger.Info("[Rclone] Torrents loaded, executing pending mount for %s", pendingMount.MountPath)
	
	// Clear the pending mount
	rm.pendingMutex.Lock()
	rm.pendingMount = nil
	rm.pendingMutex.Unlock()
	
	// Execute the mount in a goroutine to avoid blocking
	go func() {
		_, err := rm.Mount(pendingMount.Config, pendingMount.APIKey)
		if err != nil {
			logger.Error("[Rclone] Failed to execute pending mount for %s: %v", pendingMount.MountPath, err)
		}
	}()
}

// MountStatus represents the status of a mount
type MountStatus struct {
	Mounted  bool   `json:"mounted"`
	MountPath string `json:"mountPath,omitempty"`
	Error    string `json:"error,omitempty"`
	ProcessID int   `json:"processId,omitempty"`
	Waiting  bool   `json:"waiting,omitempty"`
	WaitingReason string `json:"waitingReason,omitempty"`
}

// Mount starts an rclone mount
func (rm *RcloneManager) Mount(config RcloneSettings, apiKey string) (*MountStatus, error) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	rm.cleanupStaleMountAtPath(config.MountPath)

	// Check if already mounted
	if mount, exists := rm.mounts[config.MountPath]; exists {
		if rm.isProcessRunning(mount.ProcessID) {
			return &MountStatus{
				Mounted:    true,
				MountPath:  mount.MountPath,
				ProcessID:  mount.ProcessID,
			}, nil
		}
		// If it's a waiting mount, return waiting status
		if mount.Waiting {
			return &MountStatus{
				Waiting: true,
				WaitingReason: mount.WaitingReason,
			}, nil
		}
		delete(rm.mounts, config.MountPath)
	}

	// Check if torrents are loaded before mounting
	tm := GetTorrentManager(apiKey)
	allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	torrentCount := 0
	if ok {
		torrentCount = allTorrentsMap.Count()
	}
	
	if torrentCount == 0 {
		pendingMount := &RcloneMount{
			MountPath: config.MountPath,
			RemoteName: config.RemoteName,
			Config: config,
			Waiting: true,
			WaitingReason: "Waiting for torrents to be loaded",
			APIKey: apiKey,
		}
		rm.pendingMutex.Lock()
		rm.pendingMount = pendingMount
		rm.pendingMutex.Unlock()

		return &MountStatus{
			Waiting: true,
			WaitingReason: "Waiting for torrents to be loaded",
		}, nil
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
	rm.setProcessAttributes(cmd)

	if err := cmd.Start(); err != nil {
		logger.Error("Failed to start rclone command: %v", err)
		return &MountStatus{Error: fmt.Sprintf("failed to start rclone: %v", err)}, err
	}

	// Wait a moment for mount to initialize
	time.Sleep(3 * time.Second)

	if runtime.GOOS == "windows" {
		if !rm.isProcessRunning(cmd.Process.Pid) {
			errorMsg := "rclone process exited immediately. Check if WinFsp is installed and the mount path is valid."
			return &MountStatus{Error: errorMsg}, fmt.Errorf("rclone process exited")
		}
		
		// Check if the mount point is accessible
		if _, err := os.Stat(config.MountPath); err != nil {
			logger.Warn("Mount point may not be accessible: %v", err)
		}
	} else {
		if !rm.isMountPoint(config.MountPath) {
			errorMsg := "rclone mount failed - mount point not accessible"
			logger.Error(errorMsg)
			return &MountStatus{Error: errorMsg}, fmt.Errorf("mount verification failed")
		}
		logger.Info("Mount point verified: %s", config.MountPath)
	}

	// Store mount info
	actualPid := cmd.Process.Pid
	if runtime.GOOS != "windows" {
		if daemonPid := rm.findRcloneMountPid(config.MountPath); daemonPid > 0 {
			actualPid = daemonPid
			logger.Info("Found rclone daemon PID: %d", daemonPid)
		}
	}
	
	mount := &RcloneMount{
		ProcessID: actualPid,
		MountPath: config.MountPath,
		RemoteName: config.RemoteName,
		StartTime: time.Now(),
		Config:    config,
	}
	rm.mounts[config.MountPath] = mount

	logger.Info("Rclone mount started successfully: PID=%d, Path=%s", actualPid, config.MountPath)

	return &MountStatus{
		Mounted:   true,
		MountPath: config.MountPath,
		ProcessID: actualPid,
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

	if runtime.GOOS != "windows" {
		rm.forceUnmountPath(mount.MountPath)
		time.Sleep(500 * time.Millisecond)
	}

	// Then kill the rclone process if still running
	if rm.isProcessRunning(mount.ProcessID) {
		if err := rm.forceKill(mount.ProcessID); err != nil {
			logger.Warn("Failed to kill rclone process %d: %v", mount.ProcessID, err)
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
			if runtime.GOOS != "windows" && rm.isMountPoint(mountPath) {
				return &MountStatus{Mounted: true, MountPath: mountPath}
			}
			return &MountStatus{Mounted: false}
		}
	}

	if runtime.GOOS != "windows" {
		if rm.isMountPoint(mount.MountPath) {
			if !rm.isProcessRunning(mount.ProcessID) {
				if newPid := rm.findRcloneMountPid(mount.MountPath); newPid > 0 {
					mount.ProcessID = newPid
				}
			}
			return &MountStatus{
				Mounted:   true,
				MountPath: mount.MountPath,
				ProcessID: mount.ProcessID,
			}
		}
		return &MountStatus{Mounted: false, Error: "mount point not active"}
	}

	// Windows: check process status
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
		// On Unix, verify mount point status
		if runtime.GOOS != "windows" {
			if rm.isMountPoint(mount.MountPath) {
				statuses[path] = &MountStatus{
					Mounted:   true,
					MountPath: mount.MountPath,
					ProcessID: mount.ProcessID,
				}
			} else {
				statuses[path] = &MountStatus{Mounted: false, Error: "mount point not active"}
			}
		} else {
			// Windows: check process status
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

// setProcessAttributes sets platform-specific process attributes
func (rm *RcloneManager) setProcessAttributes(cmd *exec.Cmd) {
	if runtime.GOOS == "windows" {
		rm.setWindowsProcessAttributes(cmd)
	}
}

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
		"--attr-timeout", config.AttrTimeout,
		"--vfs-read-ahead", config.VfsReadAhead,
		"--no-modtime",
		"--no-checksum",
		"--vfs-cache-poll-interval", config.VfsCachePollInterval,
		"--timeout", config.Timeout,
		"--contimeout", config.Contimeout,
		"--low-level-retries", config.LowLevelRetries,
		"--retries", config.Retries,
		"--transfers", config.Transfers,
		"--use-server-modtime",
		"--ignore-checksum",
		"--no-gzip-encoding",
		"--vfs-read-wait", config.VfsReadWait,
		"--vfs-write-wait", config.VfsWriteWait,
		"--tpslimit", config.TpsLimit,
		"--tpslimit-burst", config.TpsLimitBurst,
		"--drive-chunk-size", config.DriveChunkSize,
		"--max-read-ahead", config.MaxReadAhead,
	}

    if config.LogLevel != "" {
        args = append(args, "--log-level", config.LogLevel)
    }
    if config.LogFile != "" {
        args = append(args, "--log-file", config.LogFile)
    }

	if config.CachePath != "" {
		args = append(args, "--cache-dir", config.CachePath)
	}

	if config.VfsReadChunkSize != "" {
		args = append(args, "--vfs-read-chunk-size", config.VfsReadChunkSize)
	}
	if config.VfsReadChunkSizeLimit != "" {
		args = append(args, "--vfs-read-chunk-size-limit", config.VfsReadChunkSizeLimit)
	}

	if runtime.GOOS == "windows" {
		args = append(args, "--links")
	} else {
		args = append(args, "--allow-other")
		args = append(args, "--daemon")
		args = append(args, "--allow-non-empty")
	}

	return args
}

// obscurePassword uses rclone to obscure a password
func obscurePassword(password string, rclonePath string) (string, error) {
	
	// If no path configured, try to find rclone
	if rclonePath == "" {
		if runtime.GOOS == "windows" {
			// On Windows, search for rclone in common locations
			logger.Info("No rclone path configured, searching for rclone...")
			rcloneCmd := "rclone.exe"
			
			// Try common rclone locations on Windows
			possiblePaths := []string{
				rcloneCmd, // PATH
				"C:\\Program Files\\rclone\\rclone.exe",
				"C:\\Program Files (x86)\\rclone\\rclone.exe",
				"C:\\Users\\" + os.Getenv("USERNAME") + "\\AppData\\Local\\rclone\\rclone.exe",
			}
			
			for _, path := range possiblePaths {
				if _, err := exec.LookPath(path); err == nil {
					rclonePath = path
					break
				}
			}
		} else {
			rclonePath = "rclone"
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
	if pid <= 0 {
		return false
	}
	
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	
	// On Unix systems, signal 0 can be used to check if process exists
	if runtime.GOOS != "windows" {
		err = process.Signal(syscall.Signal(0))
		return err == nil
	}

	return true
}

// isMountPoint checks if a path is a mount point (Unix only)
func (rm *RcloneManager) isMountPoint(path string) bool {
	if runtime.GOOS == "windows" {
		return false
	}
	
	// Check if path exists and is accessible
	if _, err := os.Stat(path); err != nil {
		return false
	}
	
	// Use mountpoint command if available
	cmd := exec.Command("mountpoint", "-q", path)
	if err := cmd.Run(); err == nil {
		return true
	}
	
	// Fallback: check /proc/mounts
	cmd = exec.Command("grep", "-qs", path, "/proc/mounts")
	return cmd.Run() == nil
}

// findRcloneMountPid finds the PID of the rclone process for a given mount path (Unix only)
func (rm *RcloneManager) findRcloneMountPid(mountPath string) int {
	if runtime.GOOS == "windows" {
		return 0
	}
	
	// Use pgrep to find rclone processes
	cmd := exec.Command("pgrep", "-f", "rclone mount.*"+mountPath)
	output, err := cmd.Output()
	if err != nil {
		return 0
	}
	
	// Parse the first PID
	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return 0
	}
	
	// Get first line if multiple PIDs
	lines := strings.Split(pidStr, "\n")
	if len(lines) > 0 {
		pid, err := strconv.Atoi(lines[0])
		if err == nil {
			return pid
		}
	}
	
	return 0
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

// cleanupStaleMountAtPath cleans up a stale mount at a specific path
func (rm *RcloneManager) cleanupStaleMountAtPath(mountPath string) {
	if runtime.GOOS == "windows" {
		return
	}

	if _, err := os.Stat(mountPath); err != nil {
		return
	}

	isStale := false

	_, err := os.ReadDir(mountPath)
	if err != nil && strings.Contains(err.Error(), "transport endpoint is not connected") {
		isStale = true
	}

	if !isStale && rm.isInProcMounts(mountPath) && err != nil {
		isStale = true
	}

	if isStale {
		rm.forceUnmountPath(mountPath)
	}
}

// isInProcMounts checks if a path appears in /proc/mounts
func (rm *RcloneManager) isInProcMounts(mountPath string) bool {
	if runtime.GOOS == "windows" {
		return false
	}
	
	cmd := exec.Command("grep", "-qs", mountPath, "/proc/mounts")
	return cmd.Run() == nil
}

// forceUnmountPath forcefully unmounts a path using fusermount
func (rm *RcloneManager) forceUnmountPath(mountPath string) {
	if runtime.GOOS == "windows" {
		return
	}

	logger.Info("Unmounting filesystem at %s", mountPath)

	unmountCommands := [][]string{
		{"fusermount3", "-uz", mountPath},
		{"fusermount", "-uz", mountPath},
		{"umount", "-l", mountPath},
	}

	for _, cmdArgs := range unmountCommands {
		cmd := exec.Command(cmdArgs[0], cmdArgs[1:]...)
		output, err := cmd.CombinedOutput()
		if err == nil {
			return
		}
		logger.Debug("Failed to unmount with %s: %v (output: %s)", cmdArgs[0], err, string(output))
	}
}

// CleanupStaleMounts removes mounts that are no longer running
func (rm *RcloneManager) CleanupStaleMounts() {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	for path, mount := range rm.mounts {
		shouldCleanup := false
		
		if runtime.GOOS != "windows" {
			// On Unix, check if mount point is still active
			if !rm.isMountPoint(mount.MountPath) {
				shouldCleanup = true
			} else {
				// Update PID if changed
				if !rm.isProcessRunning(mount.ProcessID) {
					if newPid := rm.findRcloneMountPid(mount.MountPath); newPid > 0 {
						logger.Info("Updating mount PID for %s: %d -> %d", path, mount.ProcessID, newPid)
						mount.ProcessID = newPid
					}
				}
			}
		} else {
			// On Windows, check process status
			if !rm.isProcessRunning(mount.ProcessID) {
				shouldCleanup = true
			}
		}
		
		if shouldCleanup {
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
		logger.Info("Unmounting: Path=%s, PID=%d", path, mount.ProcessID)
		if runtime.GOOS != "windows" {
			rm.forceUnmountPath(mount.MountPath)
			time.Sleep(500 * time.Millisecond)
		}
		
		// Then kill the process if it's still running
		if rm.isProcessRunning(mount.ProcessID) {
			logger.Info("Killing rclone process: PID=%d", mount.ProcessID)
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
