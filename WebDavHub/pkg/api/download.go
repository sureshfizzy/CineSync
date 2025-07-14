package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"cinesync/pkg/logger"
)

// DownloadRequest and DownloadResponse for download API
type DownloadRequest struct {
	Path string `json:"path"`
}

type DownloadResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// isClientDisconnectError checks if the error is due to client disconnection
func isClientDisconnectError(err error) bool {
	if err == nil {
		return false
	}

	errStr := err.Error()

	// Common client disconnect error patterns
	clientDisconnectPatterns := []string{
		"connection was aborted",
		"wsasend: An established connection was aborted",
		"broken pipe",
		"connection reset by peer",
		"client disconnected",
		"use of closed network connection",
	}

	for _, pattern := range clientDisconnectPatterns {
		if strings.Contains(strings.ToLower(errStr), strings.ToLower(pattern)) {
			return true
		}
	}

	// Check for specific syscall errors that indicate client disconnect
	if opErr, ok := err.(*syscall.Errno); ok {
		switch *opErr {
		case syscall.ECONNRESET, syscall.EPIPE, syscall.ECONNABORTED:
			return true
		}
	}

	return false
}

// HandleDownload streams a file as an attachment for download
func HandleDownload(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		logger.Warn("Error: empty path provided")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}
	cleanPath := filepath.Clean(path)
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, "..") {
		logger.Warn("Error: invalid path: %s", cleanPath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	absPath := filepath.Join(rootDir, cleanPath)
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		logger.Warn("Error: failed to get absolute root path: %v", err)
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}
	absFile, err := filepath.Abs(absPath)
	if err != nil {
		logger.Warn("Error: failed to get absolute file path: %v", err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(absFile, absRoot) {
		logger.Warn("Error: path outside root directory: %s", absFile)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}
	file, err := os.Open(absFile)
	if err != nil {
		logger.Warn("Error: failed to open file: %v", err)
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	fileInfo, err := file.Stat()
	if err != nil {
		logger.Warn("Error: failed to stat file: %v", err)
		http.Error(w, "Failed to stat file", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Disposition", "attachment; filename=\""+fileInfo.Name()+"\"")
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, file); err != nil {
		// Check if this is a client disconnect (expected when user closes player)
		if isClientDisconnectError(err) {
			logger.Info("Client disconnected during download: %s", cleanPath)
		} else {
			logger.Warn("Error: failed to send file: %v", err)
		}
	}
}
