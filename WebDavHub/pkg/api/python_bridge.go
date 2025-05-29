package api

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"strings"
	"io"
	"cinesync/pkg/logger"
	"cinesync/pkg/env"
)

// PythonBridgeRequest represents the request payload for running the python bridge
type PythonBridgeRequest struct {
	SourcePath string `json:"sourcePath"`
	DisableMonitor bool `json:"disableMonitor"`
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

	// Clean and validate the source path
	cleanPath := filepath.Clean(req.SourcePath)
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Join with root directory to get absolute path
	absPath := filepath.Join(rootDir, cleanPath)

	// Verify the path exists and is within rootDir
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	finalAbsPath, err := filepath.Abs(absPath)
	if err != nil {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if !strings.HasPrefix(finalAbsPath, absRoot) {
		http.Error(w, "Path outside root directory", http.StatusBadRequest)
		return
	}

	// Check if file exists
	if _, err := os.Stat(finalAbsPath); os.IsNotExist(err) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	// Try to resolve real path using readlink logic
	realPath, err := executeReadlink(finalAbsPath)
	if err != nil {
		logger.Warn("Failed to resolve real path for %s: %v, using original path", finalAbsPath, err)
		realPath = finalAbsPath // fallback to original path
	}

	// Prepare command args with resolved real path
	args := []string{"../MediaHub/main.py", realPath}
	if req.DisableMonitor {
		args = append(args, "--disable-monitor")
	}
	args = append(args, "--force")

	// Get the appropriate Python command for this platform
	pythonCmd := getPythonCommand()

	// Log the command being executed
	logger.Info("Executing python bridge: %s %s", pythonCmd, strings.Join(args, " "))

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

	// Function to send JSON response
	sendResponse := func(resp PythonBridgeResponse) error {
		mu.Lock()
		defer mu.Unlock()
		data, err := json.Marshal(resp)
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
		flusher.Flush()
		return nil
	}

	// Read stdout and stderr and send to client
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			sendResponse(PythonBridgeResponse{Output: line})
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()

			// Check if this is a structured message
			if structuredMsg := parseStructuredMessage(line); structuredMsg != nil {
				// Send structured data along with the output
				sendResponse(PythonBridgeResponse{
					Output:         line,
					StructuredData: structuredMsg,
				})
			} else {
				// Regular stderr output
				sendResponse(PythonBridgeResponse{Output: line})
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
			sendResponse(PythonBridgeResponse{Error: err.Error(), Done: true})
		} else {
			sendResponse(PythonBridgeResponse{Done: true})
		}
	case <-r.Context().Done():
		// Client closed connection
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

	// Log the input being sent
	logger.Info("Sent input to python process: %s", strings.TrimSpace(req.Input))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
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
