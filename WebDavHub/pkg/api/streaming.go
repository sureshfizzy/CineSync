package api

import (
	"cinesync/pkg/logger"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// isMobileUserAgent checks if the request is from a mobile browser
func isMobileUserAgent(userAgent string) bool {
	mobileKeywords := []string{
		"Mobile", "Android", "iPhone", "iPad", "iPod", "BlackBerry",
		"Windows Phone", "Opera Mini", "IEMobile", "webOS",
	}
	userAgentLower := strings.ToLower(userAgent)
	for _, keyword := range mobileKeywords {
		if strings.Contains(userAgentLower, strings.ToLower(keyword)) {
			return true
		}
	}
	return false
}

// HandleStream handles video streaming with chunked/range request support
func HandleStream(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/stream/")

	// Decode the URL-encoded path
	decodedPath, err := url.QueryUnescape(path)
	if err != nil {
		http.Error(w, "Invalid path encoding", http.StatusBadRequest)
		return
	}

	var fullPath string
	if runtime.GOOS == "windows" {
		// For Windows, just join the rootDir and path directly
		fullPath = filepath.Join(rootDir, decodedPath)
	} else {
		// For Linux/Unix systems, handle the first directory logic
		entries, err := os.ReadDir(rootDir)
		if err != nil {
			logger.Error("Failed to read root directory: %v", err)
			http.Error(w, "Failed to read root directory", http.StatusInternalServerError)
			return
		}

		// Find the first non-hidden directory
		var firstDir string
		for _, entry := range entries {
			if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
				firstDir = entry.Name()
				break
			}
		}

		if firstDir == "" {
			logger.Error("No valid first directory found in root directory")
			http.Error(w, "Invalid directory structure", http.StatusInternalServerError)
			return
		}

		// Construct the full path ensuring the first directory is included for Linux
		if !strings.HasPrefix(decodedPath, firstDir) {
			fullPath = filepath.Join(rootDir, firstDir, decodedPath)
		} else {
			fullPath = filepath.Join(rootDir, decodedPath)
		}
	}

	logger.Info("Starting video stream for: %s", fullPath)

	// Verify the path exists and is within rootDir
	absPath, err := filepath.Abs(fullPath)
	if err != nil {
		logger.Error("Failed to get absolute path: %v", err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		logger.Error("Failed to get absolute root path: %v", err)
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	if !strings.HasPrefix(absPath, absRoot) {
		logger.Error("Path outside root directory: %s", absPath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// Open the file
	file, err := os.Open(fullPath)
	if err != nil {
		logger.Error("Failed to open file for streaming: %v (attempted path: %s)", err, fullPath)
		http.Error(w, "Failed to open file", http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Get file info
	fileInfo, err := file.Stat()
	if err != nil {
		logger.Error("Failed to get file info: %v", err)
		http.Error(w, "Failed to get file info", http.StatusInternalServerError)
		return
	}
	logger.Info("File size: %s", formatFileSize(fileInfo.Size()))

	// Set content type based on file extension
	contentType := "video/mp4" // default
	switch strings.ToLower(filepath.Ext(decodedPath)) {
	case ".mp4":
		contentType = "video/mp4"
	case ".webm":
		contentType = "video/webm"
	case ".mkv":
		contentType = "video/x-matroska"
	case ".avi":
		contentType = "video/x-msvideo"
	case ".mov":
		contentType = "video/quicktime"
	case ".wmv":
		contentType = "video/x-ms-wmv"
	case ".flv":
		contentType = "video/x-flv"
	}
	logger.Info("Content-Type: %s", contentType)

	// Get the size of the file
	fileSize := fileInfo.Size()

	// Detect mobile browser and adjust chunk sizes accordingly
	userAgent := r.Header.Get("User-Agent")
	isMobile := isMobileUserAgent(userAgent)

	var initialChunkSize, defaultChunkSize int64
	if isMobile {
		// Smaller chunks for mobile browsers to reduce buffering
		initialChunkSize = int64(256 * 1024)    // 256KB
		defaultChunkSize = int64(512 * 1024)    // 512KB
		logger.Info("Mobile browser detected, using smaller chunk sizes")
	} else {
		// Larger chunks for desktop browsers
		initialChunkSize = int64(2 * 1024 * 1024)    // 2MB
		defaultChunkSize = int64(8 * 1024 * 1024)    // 8MB
	}

	// Get the range header
	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
		// If no range header, return the first chunk
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", fileSize))
		// Return 206 Partial Content status to indicate more content is available
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-%d/%d", initialChunkSize-1, fileSize))
		w.WriteHeader(http.StatusPartialContent)

		// Copy the initial chunk
		if _, err := io.CopyN(w, file, initialChunkSize); err != nil && err != io.EOF {
			logger.Error("Failed to copy initial chunk: %v", err)
			return
		}
		return
	}

	// Parse the range header
	var start, end int64
	if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-", &start); err != nil {
			logger.Error("Failed to parse range header: %v", err)
			http.Error(w, "Invalid range header", http.StatusBadRequest)
			return
		}
		// If this is the initial request (start = 0), use smaller chunk
		if start == 0 {
			end = initialChunkSize - 1
		} else {
			// For mobile browsers, prevent large end-of-file requests
			if isMobile && start > fileSize/2 {
				// If requesting from second half of file, use smaller chunks
				end = start + (defaultChunkSize / 2) - 1
			} else {
				end = start + defaultChunkSize - 1
			}
		}
	}

	// Validate range
	if start >= fileSize {
		logger.Error("Invalid range: start position %d exceeds file size %d", start, fileSize)
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", fileSize))
		http.Error(w, "Invalid range", http.StatusRequestedRangeNotSatisfiable)
		return
	}
	if end >= fileSize {
		end = fileSize - 1
	}

	// Set headers for partial content
	contentLength := end - start + 1
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", contentLength))
	w.Header().Set("Content-Type", contentType)

	// Add optimized headers for mobile browsers
	if isMobile {
		w.Header().Set("Cache-Control", "public, max-age=3600") // Shorter cache for mobile
		w.Header().Set("Connection", "keep-alive")
	} else {
		w.Header().Set("Cache-Control", "public, max-age=31536000") // Longer cache for desktop
	}

	w.WriteHeader(http.StatusPartialContent)

	// Seek to start position
	if _, err := file.Seek(start, 0); err != nil {
		logger.Error("Failed to seek file: %v", err)
		http.Error(w, "Failed to seek file", http.StatusInternalServerError)
		return
	}

	// Use optimized buffer size based on device type
	var bufferSize int
	if isMobile {
		bufferSize = 16 * 1024 // 16KB buffer for mobile
	} else {
		bufferSize = 32 * 1024 // 32KB buffer for desktop
	}

	buffer := make([]byte, bufferSize)
	written := int64(0)
	for written < contentLength {
		n, err := file.Read(buffer)
		if err != nil && err != io.EOF {
			logger.Error("Error reading file: %v", err)
			return
		}
		if n == 0 {
			break
		}
		remaining := contentLength - written
		if int64(n) > remaining {
			n = int(remaining)
		}
		if _, err := w.Write(buffer[:n]); err != nil {
			// Check if this is a client disconnect (expected when user closes player)
			if isClientDisconnectError(err) {
				logger.Info("Client disconnected during streaming: %s", decodedPath)
			} else {
				logger.Error("Error writing to response: %v", err)
			}
			return
		}
		written += int64(n)
	}
}