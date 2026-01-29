package api

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	"cinesync/pkg/mediahub"
	"cinesync/pkg/realdebrid"
)

// MediaHub service management
var (
	mediaHubProcess     *exec.Cmd
	mediaHubProcessMux  sync.Mutex
	mediaHubStartTime   time.Time
	mediaHubLiveLogs    []string
	mediaHubLiveLogsMux sync.Mutex
)

type MediaHubStatus struct {
	IsRunning      bool   `json:"isRunning"`
	ProcessExists  bool   `json:"processExists"`
	LockFileExists bool   `json:"lockFileExists"`
	MonitorRunning bool   `json:"monitorRunning"`
	SourceDir      string `json:"sourceDir"`
	DestinationDir string `json:"destinationDir"`
	MonitorPID     int    `json:"monitorPID,omitempty"`
	Uptime         string `json:"uptime,omitempty"`
}

type MediaHubActivity struct {
	TotalFiles   int      `json:"totalFiles"`
	SymlinkCount int      `json:"symlinkCount"`
	RecentLogs   []string `json:"recentLogs"`
	LastActivity string   `json:"lastActivity,omitempty"`
}

// getMediaHubPaths returns the paths for MediaHub lock files
func getMediaHubPaths() (string, string, string, error) {
	// Get the current working directory
	cwd, err := os.Getwd()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to get current directory: %v", err)
	}

	// Go up one level to get to the CineSync root
	rootDir := filepath.Dir(cwd)
	mediaHubDir := filepath.Join(rootDir, "MediaHub")
	dbDir := filepath.Join(rootDir, "db")
	lockFile := filepath.Join(dbDir, "polling_monitor.lock")
	monitorPidFile := filepath.Join(dbDir, "monitor_pid.txt")

	return mediaHubDir, lockFile, monitorPidFile, nil
}

// readPIDFromFile reads a PID from a file
func readPIDFromFile(filename string) (int, error) {
	data, err := os.ReadFile(filename)
	if err != nil {
		return 0, err
	}

	pidStr := strings.TrimSpace(string(data))
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0, fmt.Errorf("invalid PID in file %s: %v", filename, err)
	}

	return pid, nil
}

// checkProcessExists checks if a process with the given PID exists
func checkProcessExists(pid int) bool {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid))
		output, err := cmd.Output()
		if err != nil {
			return false
		}
		return strings.Contains(string(output), strconv.Itoa(pid))
	} else {
		// Unix-like systems - send signal 0 to check if process exists
		process, err := os.FindProcess(pid)
		if err != nil {
			return false
		}
		err = process.Signal(syscall.Signal(0))
		return err == nil
	}
}

// getPythonCommandForMediaHub returns the appropriate Python command
func getPythonCommandForMediaHub() string {
	if customPython := env.GetString("PYTHON_COMMAND", ""); customPython != "" {
		return customPython
	}

	if runtime.GOOS == "windows" {
		return "python"
	}
	return "python3"
}

// GetMediaHubStatus returns the current status of MediaHub service (public wrapper)
func GetMediaHubStatus() (*MediaHubStatus, error) {
	return getMediaHubStatus()
}

// StartMediaHubService starts the MediaHub service programmatically (public wrapper)
func StartMediaHubService() error {
	// Check if already running
	status, err := getMediaHubStatus()
	if err != nil {
		return fmt.Errorf("failed to check MediaHub status: %v", err)
	}

	if status.IsRunning {
		return fmt.Errorf("MediaHub service is already running")
	}

	// Block start if inbuilt mount is configured but not yet ready
	if realdebrid.IsMountConfigured() && !realdebrid.IsMountReady() {
		return fmt.Errorf("cannot start MediaHub: inbuilt mount is not ready yet")
	}

	// Get MediaHub executable configuration
	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		return fmt.Errorf("failed to get MediaHub executable: %v", err)
	}

	// Get command and arguments
	cmd, args := mediaHubExec.GetCommand("--auto-select")

	mediaHubProcessMux.Lock()
	mediaHubProcess = exec.Command(cmd, args...)
	mediaHubProcess.Dir = mediaHubExec.WorkDir

	// Create pipes to capture stdout and stderr for auto-start
	stdout, err := mediaHubProcess.StdoutPipe()
	if err != nil {
		mediaHubProcessMux.Unlock()
		return fmt.Errorf("failed to create stdout pipe: %v", err)
	}

	stderr, err := mediaHubProcess.StderrPipe()
	if err != nil {
		mediaHubProcessMux.Unlock()
		return fmt.Errorf("failed to create stderr pipe: %v", err)
	}

	// Start the process
	if err := mediaHubProcess.Start(); err != nil {
		mediaHubProcessMux.Unlock()
		return fmt.Errorf("failed to start MediaHub: %v", err)
	}

	mediaHubStartTime = time.Now()

	// Start goroutines to stream output to terminal
	go streamOutput(stdout, "MEDIAHUB-AUTO")
	go streamOutput(stderr, "MEDIAHUB-AUTO-ERR")

	// Start a goroutine to wait for the process to finish
	go func() {
		err := mediaHubProcess.Wait()
		mediaHubProcessMux.Lock()
		if err != nil {
			logger.Error("MediaHub auto-start process exited with error: %v", err)
			addLiveLog(fmt.Sprintf("[%s] ERROR: MediaHub auto-start process exited with error: %v",
				time.Now().Format("2006-01-02 15:04:05"), err))
		} else {
			logger.Info("MediaHub auto-start process exited normally")
			addLiveLog(fmt.Sprintf("[%s] INFO: MediaHub auto-start process exited normally",
				time.Now().Format("2006-01-02 15:04:05")))
		}
		mediaHubProcess = nil
		mediaHubStartTime = time.Time{}
		mediaHubProcessMux.Unlock()
	}()

	mediaHubProcessMux.Unlock()

	logger.Info("MediaHub service auto-started with PID: %d", mediaHubProcess.Process.Pid)
	return nil
}

// StartMediaHubMonitorService starts the MediaHub monitor service programmatically (public wrapper)
func StartMediaHubMonitorService() error {
	// Check if monitor is already running
	status, err := getMediaHubStatus()
	if err != nil {
		return fmt.Errorf("failed to check MediaHub status: %v", err)
	}

	if status.MonitorRunning {
		return fmt.Errorf("MediaHub monitor is already running")
	}

	// Get MediaHub executable configuration
	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		return fmt.Errorf("failed to get MediaHub executable: %v", err)
	}

	// Start monitor-only process
	cmd, args := mediaHubExec.GetCommand("--monitor-only")
	monitorProcess := exec.Command(cmd, args...)
	monitorProcess.Dir = mediaHubExec.WorkDir

	// Create pipes to capture monitor output for auto-start
	stdout, err := monitorProcess.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create monitor stdout pipe: %v", err)
	}

	stderr, err := monitorProcess.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create monitor stderr pipe: %v", err)
	}

	// Start the process
	if err := monitorProcess.Start(); err != nil {
		return fmt.Errorf("failed to start MediaHub monitor: %v", err)
	}

	// Start goroutines to stream monitor output to terminal
	go streamOutput(stdout, "RTM-AUTO")
	go streamOutput(stderr, "RTM-AUTO-ERR")

	// Start a goroutine to wait for the monitor process to finish
	go func() {
		err := monitorProcess.Wait()
		if err != nil {
			logger.Error("RTM auto-start process exited with error: %v", err)
			addLiveLog(fmt.Sprintf("[%s] ERROR: RTM auto-start process exited with error: %v",
				time.Now().Format("2006-01-02 15:04:05"), err))
		} else {
			logger.Info("RTM auto-start process exited normally")
			addLiveLog(fmt.Sprintf("[%s] INFO: RTM auto-start process exited normally",
				time.Now().Format("2006-01-02 15:04:05")))
		}
	}()

	logger.Info("MediaHub monitor service auto-started with PID: %d", monitorProcess.Process.Pid)
	return nil
}

// getMediaHubStatus returns the current status of MediaHub service
func getMediaHubStatus() (*MediaHubStatus, error) {
	_, lockFile, monitorPidFile, err := getMediaHubPaths()
	if err != nil {
		return nil, err
	}

	status := &MediaHubStatus{
		IsRunning:      false,
		ProcessExists:  false,
		LockFileExists: false,
		MonitorRunning: false,
		SourceDir:      env.GetString("SOURCE_DIR", ""),
		DestinationDir: env.GetString("DESTINATION_DIR", ""),
	}

	// Check if lock file exists (created by Python script)
	if _, err := os.Stat(lockFile); err == nil {
		status.LockFileExists = true
	}

	// Check monitor process (created by Python script)
	if monitorPID, err := readPIDFromFile(monitorPidFile); err == nil {
		status.MonitorPID = monitorPID
		if checkProcessExists(monitorPID) {
			status.MonitorRunning = true
			logger.Debug("MediaHub monitor process running with PID: %d", monitorPID)
		} else {
			logger.Debug("MediaHub monitor PID file exists but process not running: %d", monitorPID)
			// Clean up stale PID file
			os.Remove(monitorPidFile)
		}
	}

	// Check main process (managed by Go API)
	mediaHubProcessMux.Lock()
	if mediaHubProcess != nil && mediaHubProcess.Process != nil {
		status.ProcessExists = checkProcessExists(mediaHubProcess.Process.Pid)
		if status.ProcessExists && !mediaHubStartTime.IsZero() {
			uptime := time.Since(mediaHubStartTime)
			status.Uptime = uptime.Round(time.Second).String()
		}
		// Removed debug logging to prevent spam
	}
	mediaHubProcessMux.Unlock()

	// Determine overall running status
	// MediaHub main service is considered running ONLY if:
	// 1. Go-managed process exists and is running (started via API)
	// Note: Lock file can be created by monitor-only mode, so it's not a reliable indicator
	// of the main service running. Monitor running alone doesn't mean main service is running.
	status.IsRunning = status.ProcessExists

	return status, nil
}

// HandleMediaHubStatus returns the current status of MediaHub service
func HandleMediaHubStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status, err := getMediaHubStatus()
	if err != nil {
		logger.Error("Failed to get MediaHub status: %v", err)
		http.Error(w, "Failed to get service status", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// addLiveLog adds a log entry to the live logs
func addLiveLog(logEntry string) {
	mediaHubLiveLogsMux.Lock()
	defer mediaHubLiveLogsMux.Unlock()

	mediaHubLiveLogs = append(mediaHubLiveLogs, logEntry)

	// Keep only the last 50 logs
	if len(mediaHubLiveLogs) > 50 {
		mediaHubLiveLogs = mediaHubLiveLogs[len(mediaHubLiveLogs)-50:]
	}
}

// clearLiveLogs clears all live logs
func clearLiveLogs() {
	mediaHubLiveLogsMux.Lock()
	defer mediaHubLiveLogsMux.Unlock()
	mediaHubLiveLogs = []string{}
}

// streamOutput reads from a pipe and adds to live logs
func streamOutput(pipe io.ReadCloser, prefix string) {
	defer pipe.Close()

	scanner := bufio.NewScanner(pipe)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			timestamp := time.Now().Format("2006-01-02 15:04:05")
			logEntry := fmt.Sprintf("[%s] %s: %s", timestamp, prefix, line)
			addLiveLog(logEntry)
			fmt.Println(line)
		}
	}

	if err := scanner.Err(); err != nil && !strings.Contains(err.Error(), "file already closed") {
		logger.Debug("Stream output error for %s: %v", prefix, err)
	}
}

// HandleMediaHubStart starts the MediaHub service
func HandleMediaHubStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if already running
	status, err := getMediaHubStatus()
	if err != nil {
		logger.Error("Failed to check MediaHub status: %v", err)
		http.Error(w, "Failed to check service status", http.StatusInternalServerError)
		return
	}

	if status.IsRunning {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MediaHub service is already running",
			"status":  status,
		})
		return
	}

	// Block start if inbuilt mount is configured but not yet ready
	if realdebrid.IsMountConfigured() && !realdebrid.IsMountReady() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Cannot start MediaHub: Inbuilt mount is not ready yet. Please wait for the mount to complete.",
		})
		return
	}

	// Get MediaHub executable configuration
	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		logger.Error("Failed to get MediaHub executable: %v", err)
		http.Error(w, fmt.Sprintf("Failed to get MediaHub executable: %v", err), http.StatusInternalServerError)
		return
	}

	// Start MediaHub process
	cmd, args := mediaHubExec.GetCommand("--auto-select")

	mediaHubProcessMux.Lock()
	mediaHubProcess = exec.Command(cmd, args...)

	// Set working directory to MediaHub directory
	mediaHubProcess.Dir = mediaHubExec.WorkDir

	// Create pipes to capture stdout and stderr
	stdout, err := mediaHubProcess.StdoutPipe()
	if err != nil {
		mediaHubProcessMux.Unlock()
		logger.Error("Failed to create stdout pipe: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create stdout pipe: %v", err), http.StatusInternalServerError)
		return
	}

	stderr, err := mediaHubProcess.StderrPipe()
	if err != nil {
		mediaHubProcessMux.Unlock()
		logger.Error("Failed to create stderr pipe: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create stderr pipe: %v", err), http.StatusInternalServerError)
		return
	}

	// Start the process
	logger.Info("Starting MediaHub: %s with args: %v", cmd, args)
	if err := mediaHubProcess.Start(); err != nil {
		mediaHubProcessMux.Unlock()
		logger.Error("Failed to start MediaHub process: %v", err)
		http.Error(w, fmt.Sprintf("Failed to start MediaHub: %v", err), http.StatusInternalServerError)
		return
	}

	mediaHubStartTime = time.Now()

	// Start goroutines to stream output
	go streamOutput(stdout, "STDOUT")
	go streamOutput(stderr, "STDERR")

	// Start optimized goroutine to monitor process with auto-restart capability
	go monitorMediaHubProcess()

	mediaHubProcessMux.Unlock()

	logger.Info("MediaHub service started with PID: %d", mediaHubProcess.Process.Pid)

	// Return success response
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "MediaHub service started successfully",
		"pid":     mediaHubProcess.Process.Pid,
	})
}

// HandleMediaHubStop stops the MediaHub service
func HandleMediaHubStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status, err := getMediaHubStatus()
	if err != nil {
		logger.Error("Failed to check MediaHub status: %v", err)
		http.Error(w, "Failed to check service status", http.StatusInternalServerError)
		return
	}

	if !status.IsRunning {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "MediaHub service is not running",
		})
		return
	}

	var stopErr error
	var monitorStopErr error

	// Stop the main process if it exists (this should also kill child processes)
	mediaHubProcessMux.Lock()
	if mediaHubProcess != nil && mediaHubProcess.Process != nil {
		logger.Info("Stopping main MediaHub process with PID: %d", mediaHubProcess.Process.Pid)

		if runtime.GOOS == "windows" {
			stopErr = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(mediaHubProcess.Process.Pid)).Run()
		} else {
			stopErr = mediaHubProcess.Process.Kill()
		}

		if stopErr == nil {
			// Wait for process to exit (with timeout)
			done := make(chan error, 1)
			go func() {
				done <- mediaHubProcess.Wait()
			}()

			select {
			case <-done:
				logger.Info("Main process exited successfully")
			case <-time.After(10 * time.Second):
				logger.Warn("Process didn't exit within timeout, force killing")
				// Timeout, force kill
				if runtime.GOOS == "windows" {
					exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(mediaHubProcess.Process.Pid)).Run()
				} else {
					mediaHubProcess.Process.Kill()
				}
			}
		}

		mediaHubProcess = nil
		mediaHubStartTime = time.Time{}
	}
	mediaHubProcessMux.Unlock()

	// Wait a moment for child processes to be cleaned up
	time.Sleep(2 * time.Second)

	// Check if monitor is still running and force stop it if needed
	if status.MonitorRunning {
		// Re-check if monitor is still actually running
		if checkProcessExists(status.MonitorPID) {
			logger.Info("Monitor process still running, force stopping PID: %d", status.MonitorPID)
			if runtime.GOOS == "windows" {
				monitorStopErr = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(status.MonitorPID)).Run()
			} else {
				if process, err := os.FindProcess(status.MonitorPID); err == nil {
					monitorStopErr = process.Kill()
				} else {
					monitorStopErr = err
				}
			}

			if monitorStopErr != nil {
				logger.Error("Failed to stop monitor process: %v", monitorStopErr)
			} else {
				logger.Info("Monitor process stopped successfully")
			}
		} else {
			logger.Info("Monitor process already stopped")
		}

		// Clean up monitor PID file and lock file
		_, lockFile, monitorPidFile, _ := getMediaHubPaths()
		os.Remove(monitorPidFile)
		os.Remove(lockFile)
	}

	// Clear live logs when service is stopped
	clearLiveLogs()

	// Check for any critical errors
	if stopErr != nil {
		logger.Error("Failed to stop MediaHub process: %v", stopErr)
		http.Error(w, fmt.Sprintf("Failed to stop MediaHub: %v", stopErr), http.StatusInternalServerError)
		return
	}

	// Log success message
	successMsg := "MediaHub service stopped successfully"
	if monitorStopErr != nil {
		successMsg += " (monitor stop had issues but main service stopped)"
	}

	logger.Info(successMsg)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": successMsg,
	})
}

// Simple response recorder for internal requests
type responseRecorder struct {
	statusCode int
	header     http.Header
	body       []byte
}

func (r *responseRecorder) Header() http.Header {
	return r.header
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	r.body = append(r.body, data...)
	return len(data), nil
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	r.statusCode = statusCode
}

// HandleMediaHubRestart restarts the MediaHub service
func HandleMediaHubRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// First stop the service
	status, err := getMediaHubStatus()
	if err == nil && status.IsRunning {
		// Create a temporary request to stop the service
		stopReq, _ := http.NewRequest("POST", "/api/mediahub/stop", nil)
		stopResp := &responseRecorder{header: make(http.Header)}
		HandleMediaHubStop(stopResp, stopReq)

		if stopResp.statusCode != 200 {
			http.Error(w, "Failed to stop service before restart", http.StatusInternalServerError)
			return
		}
	}

	// Wait a moment for cleanup
	time.Sleep(2 * time.Second)

	// Then start the service
	startReq, _ := http.NewRequest("POST", "/api/mediahub/start", nil)
	startResp := &responseRecorder{header: make(http.Header)}
	HandleMediaHubStart(startResp, startReq)

	if startResp.statusCode != 200 {
		http.Error(w, "Failed to start service after restart", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "MediaHub service restarted successfully",
	})
}

// getMediaHubActivity returns activity information and logs
func getMediaHubActivity() (*MediaHubActivity, error) {
	activity := &MediaHubActivity{
		TotalFiles:   0,
		SymlinkCount: 0,
		RecentLogs:   []string{},
	}

	// Get live logs
	mediaHubLiveLogsMux.Lock()
	if len(mediaHubLiveLogs) > 0 {
		activity.RecentLogs = make([]string, len(mediaHubLiveLogs))
		copy(activity.RecentLogs, mediaHubLiveLogs)
	}
	mediaHubLiveLogsMux.Unlock()

	// Parse logs to extract meaningful statistics
	var lastActivityTime time.Time
	for _, log := range activity.RecentLogs {
		// Count different types of activities
		if strings.Contains(log, "Created symlink") {
			activity.SymlinkCount++
		}
		if strings.Contains(log, "Processed file") {
			activity.TotalFiles++
		}
		if strings.Contains(log, "Found movie") || strings.Contains(log, "Found show") {
			activity.TotalFiles++
		}
		if strings.Contains(log, "Initial scan found") {
			// Extract number from "Initial scan found X files"
			parts := strings.Fields(log)
			for i, part := range parts {
				if part == "found" && i+1 < len(parts) {
					if count, err := strconv.Atoi(parts[i+1]); err == nil {
						activity.TotalFiles += count
					}
					break
				}
			}
		}

		// Extract timestamp from log entry to find last activity
		// Log format: [YYYY-MM-DD HH:MM:SS] PREFIX: message
		if strings.HasPrefix(log, "[") {
			endBracket := strings.Index(log, "]")
			if endBracket > 0 {
				timestampStr := log[1:endBracket]
				if timestamp, err := time.Parse("2006-01-02 15:04:05", timestampStr); err == nil {
					if timestamp.After(lastActivityTime) {
						lastActivityTime = timestamp
					}
				}
			}
		}
	}

	// Set last activity time
	if !lastActivityTime.IsZero() {
		activity.LastActivity = lastActivityTime.Format("2006-01-02 15:04:05")
	}

	// Limit recent logs to last 30 for UI display
	if len(activity.RecentLogs) > 30 {
		activity.RecentLogs = activity.RecentLogs[len(activity.RecentLogs)-30:]
	}

	return activity, nil
}

// HandleMediaHubLogs returns recent MediaHub logs and activity
func HandleMediaHubLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	activity, err := getMediaHubActivity()
	if err != nil {
		logger.Error("Failed to get MediaHub activity: %v", err)
		http.Error(w, "Failed to get activity logs", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(activity)
}

// HandleMediaHubLogsExport handles log file export requests
func HandleMediaHubLogsExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get query parameters
	exportType := r.URL.Query().Get("type") // "current", "all", "date"
	dateFilter := r.URL.Query().Get("date") // for date-specific exports

	// Get the current working directory and navigate to logs
	cwd, err := os.Getwd()
	if err != nil {
		logger.Error("Failed to get current directory: %v", err)
		http.Error(w, "Failed to access log directory", http.StatusInternalServerError)
		return
	}

	// Go up one level to get to the CineSync root, then to logs
	rootDir := filepath.Dir(cwd)
	logsDir := filepath.Join(rootDir, "logs")

	// Check if logs directory exists
	if _, err := os.Stat(logsDir); os.IsNotExist(err) {
		logger.Warn("Logs directory not found at %s", logsDir)
		http.Error(w, "No log files available", http.StatusNotFound)
		return
	}

	switch exportType {
	case "current":
		exportCurrentLog(w, logsDir)
	case "all":
		exportAllLogs(w, logsDir)
	case "date":
		if dateFilter == "" {
			http.Error(w, "Date parameter required for date export", http.StatusBadRequest)
			return
		}
		exportLogsByDate(w, logsDir, dateFilter)
	default:
		// Default to current log
		exportCurrentLog(w, logsDir)
	}
}

// exportCurrentLog exports the most recent log file
func exportCurrentLog(w http.ResponseWriter, logsDir string) {
	// Find the most recent log file
	files, err := os.ReadDir(logsDir)
	if err != nil {
		logger.Error("Failed to read logs directory: %v", err)
		http.Error(w, "Failed to read log files", http.StatusInternalServerError)
		return
	}

	var mostRecentFile string
	var mostRecentTime time.Time

	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".log") {
			info, err := file.Info()
			if err != nil {
				continue
			}
			if info.ModTime().After(mostRecentTime) {
				mostRecentTime = info.ModTime()
				mostRecentFile = file.Name()
			}
		}
	}

	if mostRecentFile == "" {
		http.Error(w, "No log files found", http.StatusNotFound)
		return
	}

	logPath := filepath.Join(logsDir, mostRecentFile)
	serveLogFile(w, logPath, mostRecentFile)
}

// exportAllLogs exports all log files as a zip archive
func exportAllLogs(w http.ResponseWriter, logsDir string) {
	files, err := os.ReadDir(logsDir)
	if err != nil {
		logger.Error("Failed to read logs directory: %v", err)
		http.Error(w, "Failed to read log files", http.StatusInternalServerError)
		return
	}

	// Filter log files
	var logFiles []string
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".log") {
			logFiles = append(logFiles, file.Name())
		}
	}

	if len(logFiles) == 0 {
		http.Error(w, "No log files found", http.StatusNotFound)
		return
	}

	// Create zip archive
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=mediahub_logs_%s.zip", time.Now().Format("2006-01-02")))

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	for _, fileName := range logFiles {
		logPath := filepath.Join(logsDir, fileName)
		addFileToZip(zipWriter, logPath, fileName)
	}
}

// exportLogsByDate exports log files for a specific date
func exportLogsByDate(w http.ResponseWriter, logsDir string, dateFilter string) {
	files, err := os.ReadDir(logsDir)
	if err != nil {
		logger.Error("Failed to read logs directory: %v", err)
		http.Error(w, "Failed to read log files", http.StatusInternalServerError)
		return
	}

	// Filter log files by date
	var matchingFiles []string
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".log") {
			if strings.Contains(file.Name(), dateFilter) {
				matchingFiles = append(matchingFiles, file.Name())
			}
		}
	}

	if len(matchingFiles) == 0 {
		http.Error(w, fmt.Sprintf("No log files found for date %s", dateFilter), http.StatusNotFound)
		return
	}

	if len(matchingFiles) == 1 {
		// Single file - serve directly
		logPath := filepath.Join(logsDir, matchingFiles[0])
		serveLogFile(w, logPath, matchingFiles[0])
	} else {
		// Multiple files - create zip
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=mediahub_logs_%s.zip", dateFilter))

		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		for _, fileName := range matchingFiles {
			logPath := filepath.Join(logsDir, fileName)
			addFileToZip(zipWriter, logPath, fileName)
		}
	}
}

// serveLogFile serves a single log file for download
func serveLogFile(w http.ResponseWriter, logPath, fileName string) {
	file, err := os.Open(logPath)
	if err != nil {
		logger.Error("Failed to open log file %s: %v", logPath, err)
		http.Error(w, "Failed to read log file", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Set headers for file download
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", fileName))

	// Copy file content to response
	_, err = io.Copy(w, file)
	if err != nil {
		logger.Error("Failed to serve log file %s: %v", logPath, err)
	}
}

// addFileToZip adds a file to a zip archive
func addFileToZip(zipWriter *zip.Writer, filePath, fileName string) error {
	file, err := os.Open(filePath)
	if err != nil {
		logger.Error("Failed to open file for zip: %s, error: %v", filePath, err)
		return err
	}
	defer file.Close()

	zipFile, err := zipWriter.Create(fileName)
	if err != nil {
		logger.Error("Failed to create zip entry for: %s, error: %v", fileName, err)
		return err
	}

	_, err = io.Copy(zipFile, file)
	if err != nil {
		logger.Error("Failed to copy file to zip: %s, error: %v", fileName, err)
		return err
	}

	return nil
}

// HandleMediaHubMonitorStart starts only the monitor process
func HandleMediaHubMonitorStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if monitor is already running
	status, err := getMediaHubStatus()
	if err != nil {
		logger.Error("Failed to check MediaHub status: %v", err)
		http.Error(w, "Failed to check service status", http.StatusInternalServerError)
		return
	}

	if status.MonitorRunning {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Monitor is already running",
		})
		return
	}

	mediaHubExec, err := mediahub.GetMediaHubExecutable()
	if err != nil {
		logger.Error("Failed to get MediaHub executable: %v", err)
		http.Error(w, fmt.Sprintf("Failed to get MediaHub executable: %v", err), http.StatusInternalServerError)
		return
	}

	// Start monitor-only process
	cmd, args := mediaHubExec.GetCommand("--monitor-only")
	monitorProcess := exec.Command(cmd, args...)

	// Set working directory to MediaHub directory
	monitorProcess.Dir = mediaHubExec.WorkDir

	// Create pipes to capture monitor output for logging
	stdout, err := monitorProcess.StdoutPipe()
	if err != nil {
		logger.Error("Failed to create monitor stdout pipe: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create monitor stdout pipe: %v", err), http.StatusInternalServerError)
		return
	}

	stderr, err := monitorProcess.StderrPipe()
	if err != nil {
		logger.Error("Failed to create monitor stderr pipe: %v", err)
		http.Error(w, fmt.Sprintf("Failed to create monitor stderr pipe: %v", err), http.StatusInternalServerError)
		return
	}

	// Start the process
	if err := monitorProcess.Start(); err != nil {
		logger.Error("Failed to start monitor process: %v", err)
		http.Error(w, fmt.Sprintf("Failed to start monitor: %v", err), http.StatusInternalServerError)
		return
	}

	// Write monitor PID file immediately so the status API / UI can detect the monitor quickly
	if _, _, monitorPidFile, err := getMediaHubPaths(); err == nil {
		pidStr := fmt.Sprintf("%d", monitorProcess.Process.Pid)
		if err := os.WriteFile(monitorPidFile, []byte(pidStr), 0644); err != nil {
			logger.Debug("Failed to write monitor PID file: %v", err)
		}
	} else {
		logger.Debug("Failed to resolve monitor PID file path: %v", err)
	}

	// Start goroutines to stream monitor output
	go streamOutput(stdout, "MONITOR-STDOUT")
	go streamOutput(stderr, "MONITOR-STDERR")

	// Start a goroutine to wait for the monitor process to finish
	go func() {
		err := monitorProcess.Wait()
		if err != nil {
			logger.Error("Monitor process exited with error: %v", err)
			addLiveLog(fmt.Sprintf("[%s] ERROR: Monitor process exited with error: %v",
				time.Now().Format("2006-01-02 15:04:05"), err))
		} else {
			logger.Info("Monitor process exited normally")
			addLiveLog(fmt.Sprintf("[%s] INFO: Monitor process exited normally",
				time.Now().Format("2006-01-02 15:04:05")))
		}
	}()

	logger.Info("MediaHub monitor started successfully with PID: %d", monitorProcess.Process.Pid)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "MediaHub monitor started successfully",
		"pid":     monitorProcess.Process.Pid,
	})
}

// HandleMediaHubMonitorStop stops the monitor process
func HandleMediaHubMonitorStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	status, err := getMediaHubStatus()
	if err != nil {
		logger.Error("Failed to check MediaHub status: %v", err)
		http.Error(w, "Failed to check service status", http.StatusInternalServerError)
		return
	}

	if !status.MonitorRunning {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Monitor is not running",
		})
		return
	}

	// Kill the monitor process
	var stopErr error
	if runtime.GOOS == "windows" {
		stopErr = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(status.MonitorPID)).Run()
	} else {
		if process, err := os.FindProcess(status.MonitorPID); err == nil {
			stopErr = process.Kill()
		} else {
			stopErr = err
		}
	}

	if stopErr != nil {
		logger.Error("Failed to stop monitor process: %v", stopErr)
		http.Error(w, fmt.Sprintf("Failed to stop monitor: %v", stopErr), http.StatusInternalServerError)
		return
	}

	// Clean up PID file
	_, _, monitorPidFile, _ := getMediaHubPaths()
	os.Remove(monitorPidFile)

	logger.Info("MediaHub monitor stopped successfully")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "MediaHub monitor stopped successfully",
	})
}

// monitorMediaHubProcess monitors the MediaHub process with auto-restart for connection issues
func monitorMediaHubProcess() {
	err := mediaHubProcess.Wait()

	mediaHubProcessMux.Lock()
	defer func() {
		mediaHubProcess = nil
		mediaHubStartTime = time.Time{}
		mediaHubProcessMux.Unlock()
	}()

	if err != nil {
		logger.Error("MediaHub process exited with error: %v", err)
		addLiveLog(fmt.Sprintf("[%s] ERROR: MediaHub process exited with error: %v",
			time.Now().Format("2006-01-02 15:04:05"), err))

		// Auto-restart only for connection issues
		errorMsg := err.Error()
		if strings.Contains(errorMsg, "broken pipe") || strings.Contains(errorMsg, "connection reset") {
			logger.Info("Connection issue detected, attempting auto-restart")
			mediaHubProcess = nil
			mediaHubStartTime = time.Time{}
			mediaHubProcessMux.Unlock()

			time.Sleep(2 * time.Second)
			if restartErr := StartMediaHubService(); restartErr != nil {
				logger.Error("Auto-restart failed: %v", restartErr)
			} else {
				logger.Info("MediaHub auto-restart successful")
			}
			return
		}
	} else {
		logger.Info("MediaHub process exited normally")
		addLiveLog(fmt.Sprintf("[%s] INFO: MediaHub process exited normally",
			time.Now().Format("2006-01-02 15:04:05")))
	}
}