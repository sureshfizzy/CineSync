package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"strings"
	"time"
	"io"
	"cinesync/pkg/logger"
	"cinesync/pkg/env"
)

// PythonBridgeRequest represents the request payload for running the python bridge
type PythonBridgeRequest struct {
	SourcePath string `json:"sourcePath"`
	DisableMonitor bool `json:"disableMonitor"`
	SelectedOption string `json:"selectedOption,omitempty"`
	SelectedIds map[string]string `json:"selectedIds,omitempty"`
	BatchApply bool `json:"batchApply,omitempty"`
	ManualSearch bool `json:"manualSearch,omitempty"`
	AutoSelect bool `json:"autoSelect,omitempty"`
	BulkAutoProcess bool `json:"bulkAutoProcess,omitempty"`
}

// PythonBridgeResponse represents a message sent to the client
type PythonBridgeResponse struct {
	Output           string                 `json:"output,omitempty"`
	Error            string                 `json:"error,omitempty"`
	Done             bool                   `json:"done,omitempty"`
	StructuredData   *StructuredMessage     `json:"structuredData,omitempty"`
}

// StructuredMessage represents structured data from Python processors
type StructuredMessage struct {
	Type      string                 `json:"type"`
	Timestamp float64                `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}

// SymlinkCreatedData represents the data structure for symlink creation events
type SymlinkCreatedData struct {
	SourceFile      string  `json:"source_file"`
	DestinationFile string  `json:"destination_file"`
	NewFolderName   string  `json:"new_folder_name"`
	NewFilename     string  `json:"new_filename"`
	NewPath         string  `json:"new_path"`
	TmdbID          *int    `json:"tmdb_id,omitempty"`
	SeasonNumber    *int    `json:"season_number,omitempty"`
	ForceMode       bool    `json:"force_mode"`
}

// PythonInputRequest represents input to send to the python process
type PythonInputRequest struct {
	Input string `json:"input"`
}

// Global variables to manage the active python process
var (
	activePythonCmd    *exec.Cmd
	activePythonStdin  io.WriteCloser
	activePythonMutex  sync.Mutex
	activePythonResponseWriter http.ResponseWriter
	activePythonResponseMutex  sync.Mutex
)

// getPythonCommand determines the correct Python executable based on the OS and environment
func getPythonCommand() string {
	// Check if a custom Python command is set via environment variable
	if customPython := env.GetString("PYTHON_COMMAND", ""); customPython != "" {
		return customPython
	}

	// Default platform-specific behavior
	if runtime.GOOS == "windows" {
		return "python"
	}
	return "python3"
}

// findVideoFileInTVShowFolder finds a video file within a TV show folder and resolves its symlink
func findVideoFileInTVShowFolder(showFolderPath string) (string, error) {
	videoExtensions := []string{".mp4", ".mkv", ".avi", ".mov", ".wmv", ".m4v", ".webm"}

	// Walk through the show folder to find season folders
	entries, err := os.ReadDir(showFolderPath)
	if err != nil {
		return "", err
	}

	// Look for season folders first
	for _, entry := range entries {
		if entry.IsDir() && isSeasonFolder(entry.Name()) {
			seasonPath := filepath.Join(showFolderPath, entry.Name())
			seasonEntries, err := os.ReadDir(seasonPath)
			if err != nil {
				continue
			}

			// Find the first video file in this season folder
			for _, seasonEntry := range seasonEntries {
				if !seasonEntry.IsDir() {
					fileName := seasonEntry.Name()
					ext := strings.ToLower(filepath.Ext(fileName))

					// Check if this is a video file
					for _, videoExt := range videoExtensions {
						if ext == videoExt {
							videoFilePath := filepath.Join(seasonPath, fileName)

							// Try to resolve the symlink of this video file
							realPath, err := executeReadlink(videoFilePath)
							if err != nil {
								logger.Warn("Failed to resolve symlink for %s: %v", videoFilePath, err)
								continue
							}

							logger.Info("Found video file in TV show folder: %s -> %s", videoFilePath, realPath)
							return realPath, nil
						}
					}
				}
			}
		}
	}

	return "", fmt.Errorf("no video files found in TV show folder")
}

// parseStructuredMessage attempts to parse a structured message from Python
func parseStructuredMessage(line string) *StructuredMessage {
	const prefix = "WEBDAV_API_MESSAGE:"
	if !strings.HasPrefix(line, prefix) {
		return nil
	}

	jsonStr := strings.TrimPrefix(line, prefix)
	var msg StructuredMessage
	if err := json.Unmarshal([]byte(jsonStr), &msg); err != nil {
		logger.Warn("Failed to parse structured message: %v", err)
		return nil
	}

	return &msg
}

// HandlePythonBridge handles the interactive execution of the python bridge
func HandlePythonBridge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PythonBridgeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	logger.Info("Received python bridge request: %+v", req)

	if req.BulkAutoProcess {
		handleBulkAutoProcess(w, r, req)
		return
	}

	logger.Info("Source path: '%s'", req.SourcePath)
	if req.SelectedIds != nil {
		logger.Info("Selected IDs received:")
		for key, value := range req.SelectedIds {
			logger.Info("  %s: %s", key, value)
		}
	}

	// Clean and validate the source path
	cleanPath := filepath.Clean(req.SourcePath)
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	var finalAbsPath string

	if strings.HasPrefix(cleanPath, "/") {
		logger.Debug("Unix path detected: '%s'", cleanPath)
		var foundPath string

		if _, err := os.Lstat(cleanPath); err == nil {
			foundPath = cleanPath
			logger.Debug("Found Unix path directly: '%s'", cleanPath)
		} else {
			logger.Debug("Absolute path not found, trying as relative to rootDir: '%s'", rootDir)
			relativePath := strings.TrimPrefix(cleanPath, "/")
			candidatePath := filepath.Join(rootDir, relativePath)
			logger.Debug("Trying candidate path relative to rootDir: '%s'", candidatePath)

			resolvedPath, err := resolveActualDirectoryPath(candidatePath, relativePath)
			if err == nil && resolvedPath != candidatePath {
				foundPath = resolvedPath
				logger.Debug("Resolved Unix path '%s' using ID suffix matching: '%s'", cleanPath, resolvedPath)
			} else if _, err := os.Lstat(candidatePath); err == nil {
				foundPath = candidatePath
				logger.Debug("Resolved Unix path '%s' relative to rootDir: '%s'", cleanPath, candidatePath)
			} else {
				sourceDirs := env.GetString("SOURCE_DIR", "")
				logger.Debug("Not found in destination, trying SOURCE_DIR: '%s'", sourceDirs)

				if sourceDirs != "" {
					sourceDirList := strings.Split(sourceDirs, ",")

					for _, sourceDir := range sourceDirList {
						sourceDir = strings.TrimSpace(sourceDir)
						if sourceDir == "" {
							continue
						}

						logger.Debug("Checking source directory: '%s'", sourceDir)

						candidatePath := filepath.Join(sourceDir, relativePath)
						logger.Debug("Trying candidate path (with virtual prefix): '%s'", candidatePath)

						if _, err := os.Lstat(candidatePath); err == nil {
							foundPath = candidatePath
							logger.Debug("Resolved Unix-style path '%s' to '%s'", cleanPath, foundPath)
							break
						}

						pathParts := strings.Split(relativePath, "/")
						if len(pathParts) > 1 {
							withoutPrefix := strings.Join(pathParts[1:], "/")
							candidatePath2 := filepath.Join(sourceDir, withoutPrefix)
							logger.Debug("Trying candidate path (without virtual prefix): '%s'", candidatePath2)

							if _, err := os.Lstat(candidatePath2); err == nil {
								foundPath = candidatePath2
								logger.Debug("Resolved Unix-style path '%s' to '%s' (removed virtual prefix)", cleanPath, foundPath)
								break
							}
						}
					}
				}
			}
		}

		if foundPath != "" {
			finalAbsPath = foundPath
			logger.Debug("Successfully resolved Unix path '%s' to '%s'", cleanPath, foundPath)
		} else {
			logger.Error("Unix-style path '%s' not found in destination or source directories", cleanPath)
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
	} else if filepath.IsAbs(cleanPath) {
		apiPath := strings.TrimPrefix(cleanPath, rootDir)
		apiPath = strings.ReplaceAll(apiPath, "\\", "/")
		resolvedPath, err := resolveActualDirectoryPath(cleanPath, apiPath)
		if err == nil && resolvedPath != cleanPath {
			finalAbsPath = resolvedPath
			logger.Debug("Resolved absolute path '%s' using ID suffix matching: '%s'", cleanPath, resolvedPath)
		} else {
			finalAbsPath = cleanPath
		}
	} else {
		absPath := filepath.Join(rootDir, cleanPath)

		absRoot, err := filepath.Abs(rootDir)
		if err != nil {
			logger.Error("Failed to get absolute root dir for relative path: %v", err)
			http.Error(w, "Server configuration error", http.StatusInternalServerError)
			return
		}

		finalAbsPath, err = filepath.Abs(absPath)
		if err != nil {
			logger.Error("Failed to get absolute path for '%s': %v", absPath, err)
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}

		if !strings.HasPrefix(finalAbsPath, absRoot) {
			http.Error(w, "Path outside root directory", http.StatusBadRequest)
			return
		}

		apiPath := cleanPath
		resolvedPath, err := resolveActualDirectoryPath(finalAbsPath, apiPath)
		if err == nil && resolvedPath != finalAbsPath {
			finalAbsPath = resolvedPath
			logger.Debug("Resolved relative path '%s' using ID suffix matching: '%s'", cleanPath, resolvedPath)
		}
	}

	if strings.HasPrefix(req.SourcePath, "/") {
		apiPath := strings.TrimPrefix(req.SourcePath, "/")
		resolvedPath, err := resolveActualDirectoryPath(finalAbsPath, apiPath)
		if err == nil && resolvedPath != finalAbsPath {
			finalAbsPath = resolvedPath
		}
	}

	fileInfo, err := os.Lstat(finalAbsPath)
	if os.IsNotExist(err) {
		logger.Error("File not found: '%s'", finalAbsPath)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	if err != nil {
		logger.Error("Failed to access file '%s': %v", finalAbsPath, err)
		http.Error(w, "Failed to get file info", http.StatusInternalServerError)
		return
	}

	if fileInfo.Mode()&os.ModeSymlink != 0 {
		if _, err := os.Stat(finalAbsPath); os.IsNotExist(err) {
			logger.Warn("Processing broken symlink: %s (target does not exist)", finalAbsPath)
		}
	}

	var realPath string
	if fileInfo.IsDir() {
		logger.Debug("Processing directory: '%s'", finalAbsPath)
		absRoot, err := filepath.Abs(rootDir)
		if err != nil {
			absRoot = rootDir
		}

		isDestinationFolder := strings.HasPrefix(finalAbsPath, absRoot)

		if isDestinationFolder {
			realPath = finalAbsPath
			logger.Debug("Using destination folder directly: '%s'", realPath)
		} else {
			logger.Debug("Source folder detected, searching for video file")
			realPath, err = findVideoFileInTVShowFolder(finalAbsPath)
			if err != nil {
				logger.Debug("No video file found in folder, using folder path: %v", err)
				realPath = finalAbsPath
			} else {
				logger.Debug("Found video file in folder: '%s'", realPath)
			}
		}
	} else {
		logger.Debug("Processing individual file: '%s'", finalAbsPath)
		realPath, err = executeReadlink(finalAbsPath)
		if err != nil {
			logger.Debug("Not a symlink or readlink failed, using original path: %v", err)
			realPath = finalAbsPath
		} else {
			logger.Debug("Resolved symlink to: '%s'", realPath)
		}
	}

	args := []string{"../MediaHub/main.py", realPath}
	if req.DisableMonitor {
		args = append(args, "--disable-monitor")
	}
	args = append(args, "--force")
	if req.BatchApply {
		args = append(args, "--batch-apply")
	}
	if req.ManualSearch {
		args = append(args, "--manual-search")
	}
	if req.AutoSelect {
		args = append(args, "--auto-select")
		args = append(args, "--use-source-db")
	}

	// Add selected action option if provided
	if req.SelectedOption != "" {
		switch req.SelectedOption {
		case "force":
			// --force is already added above
		case "auto-select":
			// --auto-select is handled above
		case "force-show":
			args = append(args, "--force-show")
		case "force-movie":
			args = append(args, "--force-movie")
		case "force-extra":
			args = append(args, "--force-extra")
		case "skip":
			args = append(args, "--skip")
		}
	}

	// Add ID-based arguments if provided
	if req.SelectedIds != nil {
		if imdbId, ok := req.SelectedIds["imdb"]; ok && imdbId != "" {
			args = append(args, "--imdb", imdbId)
		}
		if tmdbId, ok := req.SelectedIds["tmdb"]; ok && tmdbId != "" {
			args = append(args, "--tmdb", tmdbId)
		}
		if tvdbId, ok := req.SelectedIds["tvdb"]; ok && tvdbId != "" {
			args = append(args, "--tvdb", tvdbId)
		}
		if seasonEpisode, ok := req.SelectedIds["season-episode"]; ok && seasonEpisode != "" {
			args = append(args, "--season-episode", seasonEpisode)
		}
	}

	// Get the appropriate Python command for this platform
	pythonCmd := getPythonCommand()

	// Log the start of processing
	logger.Info("Starting Python bridge processing for: %s", filepath.Base(realPath))

	// Create command context with cancel
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonCmd, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		http.Error(w, "Failed to get stdin pipe: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Store the active command and stdin for input handling
	activePythonMutex.Lock()
	activePythonCmd = cmd
	activePythonStdin = stdin
	activePythonMutex.Unlock()

	// Store the response writer for structured message handling
	activePythonResponseMutex.Lock()
	activePythonResponseWriter = w
	activePythonResponseMutex.Unlock()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		http.Error(w, "Failed to get stdout pipe: "+err.Error(), http.StatusInternalServerError)
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		http.Error(w, "Failed to get stderr pipe: "+err.Error(), http.StatusInternalServerError)
		return
	}

	if err := cmd.Start(); err != nil {
		http.Error(w, "Failed to start command: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Set headers for streaming JSON response
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Use a mutex to synchronize writes to ResponseWriter
	var mu sync.Mutex

	// Optimized function to send JSON response with minimal retry for transient issues
	sendResponse := func(resp PythonBridgeResponse) error {
		mu.Lock()
		defer mu.Unlock()

		// Check if client connection is still active
		select {
		case <-r.Context().Done():
			return fmt.Errorf("client disconnected")
		default:
		}

		data, err := json.Marshal(resp)
		if err != nil {
			return err
		}

		// Single attempt with immediate failure detection
		if _, err = w.Write(data); err != nil {
			if isClientDisconnectError(err) {
				logger.Debug("Client disconnected during response write")
				return fmt.Errorf("client disconnected: %v", err)
			}
			return err
		}

		if _, err = w.Write([]byte("\n")); err != nil {
			if isClientDisconnectError(err) {
				logger.Debug("Client disconnected during newline write")
				return fmt.Errorf("client disconnected: %v", err)
			}
			return err
		}

		// Successful write, flush and return
		flusher.Flush()
		return nil
	}

	// Read stdout and stderr and send to client
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if err := sendResponse(PythonBridgeResponse{Output: line}); err != nil {
				if isClientDisconnectError(err) {
					logger.Debug("Client disconnected, stopping stdout reading")
				} else {
					logger.Error("Error sending stdout response: %v", err)
				}
				break
			}
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()

			// Check if this is a structured message
			if structuredMsg := parseStructuredMessage(line); structuredMsg != nil {
				// Send structured data along with the output
				if err := sendResponse(PythonBridgeResponse{
					Output:         line,
					StructuredData: structuredMsg,
				}); err != nil {
					if isClientDisconnectError(err) {
						logger.Debug("Client disconnected, stopping stderr reading")
					} else {
						logger.Error("Error sending structured stderr response: %v", err)
					}
					break
				}
			} else {
				// Regular stderr output
				if err := sendResponse(PythonBridgeResponse{Output: line}); err != nil {
					if isClientDisconnectError(err) {
						logger.Debug("Client disconnected, stopping stderr reading")
					} else {
						logger.Error("Error sending stderr response: %v", err)
					}
					break
				}
			}
		}
	}()

	// Wait for command to finish in a goroutine
	doneChan := make(chan error)
	go func() {
		doneChan <- cmd.Wait()
	}()

	// Wait for command to finish or client to close connection
	select {
	case err := <-doneChan:
		if err != nil {
			logger.Error("Python bridge processing failed for '%s': %v", filepath.Base(realPath), err)
			if sendErr := sendResponse(PythonBridgeResponse{Error: err.Error(), Done: true}); sendErr != nil {
				if !isClientDisconnectError(sendErr) {
					logger.Error("Error sending error response: %v", sendErr)
				}
			}
		} else {
			logger.Info("Python bridge processing completed successfully for: %s", filepath.Base(realPath))
			if sendErr := sendResponse(PythonBridgeResponse{Done: true}); sendErr != nil {
				if !isClientDisconnectError(sendErr) {
					logger.Error("Error sending completion response: %v", sendErr)
				}
			}
		}
	case <-r.Context().Done():
		// Client closed connection
		logger.Warn("Python bridge processing interrupted (client disconnected) for: %s", filepath.Base(realPath))
		cmd.Process.Kill()
	}

	// Close stdin and cleanup
	stdin.Close()

	// Clear active command and response writer
	activePythonMutex.Lock()
	activePythonCmd = nil
	activePythonStdin = nil
	activePythonMutex.Unlock()

	activePythonResponseMutex.Lock()
	activePythonResponseWriter = nil
	activePythonResponseMutex.Unlock()
}

// HandlePythonBridgeInput handles sending input to the active python process
func HandlePythonBridgeInput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body
	var req PythonInputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	activePythonMutex.Lock()
	defer activePythonMutex.Unlock()

	if activePythonStdin == nil {
		http.Error(w, "No active python process", http.StatusBadRequest)
		return
	}

	// Send input to the python process
	_, err := activePythonStdin.Write([]byte(req.Input))
	if err != nil {
		logger.Error("Failed to send input to python process: %v", err)
		http.Error(w, "Failed to send input", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

func handleBulkAutoProcess(w http.ResponseWriter, r *http.Request, req PythonBridgeRequest) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Cache-Control")

	sendResponse := func(response PythonBridgeResponse) error {
		data, err := json.Marshal(response)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte("\n"))
		if err != nil {
			return err
		}
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		return nil
	}

	if err := sendResponse(PythonBridgeResponse{Output: "Starting bulk auto processing...\n"}); err != nil {
		logger.Error("Error sending initial response: %v", err)
		return
	}

	args := []string{"../MediaHub/main.py"}

	if req.DisableMonitor {
		args = append(args, "--disable-monitor")
	}
	args = append(args, "--force")
	if req.BatchApply {
		args = append(args, "--batch-apply")
	}
	if req.ManualSearch {
		args = append(args, "--manual-search")
	}
	if req.AutoSelect {
		args = append(args, "--auto-select", "--use-source-db")
	}

	pythonCmd := getPythonCommand()
	logger.Info("Starting bulk auto processing with command: %s %v", pythonCmd, args)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonCmd, args...)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		sendResponse(PythonBridgeResponse{Error: "Failed to get stdout pipe: " + err.Error(), Done: true})
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		sendResponse(PythonBridgeResponse{Error: "Failed to get stderr pipe: " + err.Error(), Done: true})
		return
	}

	if err := cmd.Start(); err != nil {
		sendResponse(PythonBridgeResponse{Error: "Failed to start bulk processing: " + err.Error(), Done: true})
		return
	}

	var wg sync.WaitGroup
	doneChan := make(chan error, 1)

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			if err := sendResponse(PythonBridgeResponse{Output: line + "\n"}); err != nil {
				if !isClientDisconnectError(err) {
					logger.Error("Error sending stdout response: %v", err)
				}
				return
			}
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			if err := sendResponse(PythonBridgeResponse{Output: line + "\n"}); err != nil {
				if !isClientDisconnectError(err) {
					logger.Error("Error sending stderr response: %v", err)
				}
				return
			}
		}
	}()

	go func() {
		wg.Wait()
		doneChan <- cmd.Wait()
	}()

	clientDisconnected := make(chan bool, 1)
	go func() {
		<-r.Context().Done()
		clientDisconnected <- true
	}()

	select {
	case err := <-doneChan:
		if err != nil {
			logger.Error("Auto processing failed: %v", err)
			sendResponse(PythonBridgeResponse{Error: err.Error(), Done: true})
		} else {
			logger.Info("Auto processing completed successfully")
			sendResponse(PythonBridgeResponse{Done: true})
		}
	case <-clientDisconnected:
		logger.Info("Client disconnected during bulk processing, terminating")
		cancel()
		select {
		case <-doneChan:
		case <-time.After(5 * time.Second):
			if cmd.Process != nil {
				cmd.Process.Kill()
			}
		}
	}
}

// HandlePythonMessage handles structured messages sent directly from Python processors
func HandlePythonMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse the structured message from request body
	var msg StructuredMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Get the active response writer to forward the message
	activePythonResponseMutex.Lock()
	responseWriter := activePythonResponseWriter
	activePythonResponseMutex.Unlock()

	if responseWriter == nil {
		// No active python bridge session
		w.WriteHeader(http.StatusOK)
		return
	}

	// Create response with structured data
	response := PythonBridgeResponse{
		StructuredData: &msg,
	}

	// Send the response to the active bridge session
	data, err := json.Marshal(response)
	if err != nil {
		http.Error(w, "Failed to marshal response", http.StatusInternalServerError)
		return
	}

	// Write to the active bridge response writer
	responseWriter.Write(data)
	responseWriter.Write([]byte("\n"))

	if flusher, ok := responseWriter.(http.Flusher); ok {
		flusher.Flush()
	}

	w.WriteHeader(http.StatusOK)
}

// HandlePythonBridgeTerminate handles terminating the active python bridge process
func HandlePythonBridgeTerminate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	activePythonMutex.Lock()
	cmd := activePythonCmd
	stdin := activePythonStdin
	activePythonMutex.Unlock()

	if cmd == nil {
		// No active process to terminate
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "success",
			"message": "No active python process to terminate",
		})
		return
	}

	logger.Info("Terminating active python bridge process")

	// Close stdin first to signal the process to stop gracefully
	if stdin != nil {
		stdin.Close()
	}

	// Kill the process
	if cmd.Process != nil {
		err := cmd.Process.Kill()
		if err != nil {
			logger.Error("Failed to kill python process: %v", err)
			http.Error(w, "Failed to terminate process", http.StatusInternalServerError)
			return
		}
	}

	// Clear the active command and response writer
	activePythonMutex.Lock()
	activePythonCmd = nil
	activePythonStdin = nil
	activePythonMutex.Unlock()

	activePythonResponseMutex.Lock()
	activePythonResponseWriter = nil
	activePythonResponseMutex.Unlock()

	logger.Info("Python bridge process terminated successfully")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "success",
		"message": "Python bridge process terminated",
	})
}

// SkipProcessingRequest represents the request payload for skipping file processing
type SkipProcessingRequest struct {
	Path string `json:"path"`
}

// ProcessingResponse represents the response for processing operations
type ProcessingResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// HandleSkipProcessing handles POST /api/processing/skip - Skip processing for a file/folder
func HandleSkipProcessing(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req SkipProcessingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "path is required", http.StatusBadRequest)
		return
	}

	logger.Info("Skip processing request for: %s", req.Path)

	// Prepare command args for skip processing
	args := []string{"../MediaHub/main.py", req.Path, "--skip", "--disable-monitor"}

	// Get the appropriate Python command
	pythonCmd := getPythonCommand()

	logger.Info("Executing skip processing command: %s %v", pythonCmd, args)

	// Execute the command
	cmd := exec.Command(pythonCmd, args...)

	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.Error("Skip processing failed: %v, output: %s", err, string(output))
		response := ProcessingResponse{
			Success: false,
			Message: "Failed to skip processing",
			Details: fmt.Sprintf("Error: %v, Output: %s", err, string(output)),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	logger.Info("Skip processing completed successfully for: %s", req.Path)

	response := ProcessingResponse{
		Success: true,
		Message: "File processing skipped successfully",
		Details: string(output),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
