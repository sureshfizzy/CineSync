package api

import (
	"cinesync/pkg/logger"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var rootDir string
var lastStats Stats

// SetRootDir sets the root directory for file operations
func SetRootDir(dir string) {
	rootDir = dir
}

type FileInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Size     string `json:"size,omitempty"`
	Modified string `json:"modified,omitempty"`
	Path     string `json:"path,omitempty"`
	Icon     string `json:"icon,omitempty"`
	IsSeasonFolder bool `json:"isSeasonFolder,omitempty"`
	HasSeasonFolders bool `json:"hasSeasonFolders,omitempty"`
}

type Stats struct {
	TotalFiles   int    `json:"totalFiles"`
	TotalFolders int    `json:"totalFolders"`
	TotalSize    string `json:"totalSize"`
	LastSync     string `json:"lastSync"`
	WebDAVStatus string `json:"webdavStatus"`
	StorageUsed  string `json:"storageUsed"`
	IP           string `json:"ip"`
	Port         string `json:"port"`
}

type ReadlinkRequest struct {
	Path string `json:"path"`
}

type ReadlinkResponse struct {
	RealPath string `json:"realPath"`
	AbsPath  string `json:"absPath"`
	Error    string `json:"error,omitempty"`
}

type DeleteRequest struct {
	Path string `json:"path"`
}

type DeleteResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type RenameRequest struct {
	OldPath string `json:"oldPath"`
	NewName string `json:"newName"`
}

type RenameResponse struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

func formatFileSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}

// getFileIcon returns a string representing the icon type for a file
func getFileIcon(name string, isDir bool) string {
	if isDir {
		return "folder"
	}
	ext := strings.ToLower(filepath.Ext(name))
	switch ext {
	case ".mp4", ".webm", ".avi", ".mov", ".mkv":
		return "movie"
	case ".mp3", ".wav", ".ogg", ".flac":
		return "music"
	case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp":
		return "image"
	case ".pdf":
		return "pdf"
	case ".doc", ".docx", ".txt", ".rtf":
		return "text"
	case ".xls", ".xlsx", ".csv":
		return "spreadsheet"
	case ".ppt", ".pptx":
		return "presentation"
	case ".zip", ".rar", ".tar", ".gz", ".7z":
		return "archive"
	case ".go", ".js", ".html", ".css", ".py", ".java", ".c", ".cpp", ".php", ".rb":
		return "code"
	default:
		return "file"
	}
}

func HandleFiles(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Path
	if path == "/api/files" {
		path = "/"
	} else {
		path = strings.TrimPrefix(path, "/api/files")
	}

	dir := filepath.Join(rootDir, path)
	logger.Info("Listing directory: %s (API path: %s)", dir, path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Warn("Failed to read directory: %s - %v", dir, err)
		http.Error(w, "Failed to read directory", http.StatusInternalServerError)
		return
	}

	files := make([]FileInfo, 0)
	seasonFolderCount := 0
	fileCount := 0
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		filePath := filepath.Join(path, entry.Name())
		fileInfo := FileInfo{
			Name:     entry.Name(),
			Type:     "file",
			Modified: info.ModTime().Format(time.RFC3339),
			Path:     filePath,
			Icon:     getFileIcon(entry.Name(), entry.IsDir()),
		}

		if entry.IsDir() {
			fileInfo.Type = "directory"
			if isSeasonFolder(entry.Name()) {
				fileInfo.IsSeasonFolder = true
				seasonFolderCount++
			}

			subDirPath := filepath.Join(dir, entry.Name())
			subEntries, err := os.ReadDir(subDirPath)
			if err == nil && len(subEntries) > 0 {
				seasonCount := 0
				fileCountInSub := 0
				for _, subEntry := range subEntries {
					if subEntry.IsDir() && isSeasonFolder(subEntry.Name()) {
						seasonCount++
					} else if !subEntry.IsDir() {
						fileCountInSub++
					}
				}
				if seasonCount > 0 && seasonCount == len(subEntries) && fileCountInSub == 0 {
					fileInfo.HasSeasonFolders = true
					logger.Info("[API] Detected TV show root: %s (all %d children are season folders)", filePath, seasonCount)
				}
			}

			logger.Info("Found directory: %s", filePath)
		} else {
			fileInfo.Size = formatFileSize(info.Size())
			fileCount++
			logger.Info("Found file: %s (Size: %s, Modified: %s)", filePath, fileInfo.Size, fileInfo.Modified)
		}

		files = append(files, fileInfo)
	}
	// If all directories are season folders and there are no files, mark parent as hasSeasonFolders
	if seasonFolderCount > 0 && seasonFolderCount == len(entries)-fileCount && fileCount == 0 {
		for i := range files {
			if files[i].Type == "directory" && files[i].IsSeasonFolder {
				files[i].HasSeasonFolders = false // child
			}
		}

		w.Header().Set("X-Has-Season-Folders", "true")
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func isSeasonFolder(name string) bool {
	nameLower := strings.ToLower(name)
	return strings.HasPrefix(nameLower, "season ") && len(nameLower) > 7 && isNumeric(nameLower[7:])
}

func isNumeric(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) == 0 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func statsChanged(a, b Stats) bool {
	return a.TotalFiles != b.TotalFiles ||
		a.TotalFolders != b.TotalFolders ||
		a.TotalSize != b.TotalSize ||
		a.LastSync != b.LastSync ||
		a.WebDAVStatus != b.WebDAVStatus ||
		a.StorageUsed != b.StorageUsed ||
		a.IP != b.IP ||
		a.Port != b.Port
}

func HandleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var totalFiles int
	var totalFolders int
	var totalSize int64
	var lastSync time.Time

	// Get disk usage information
	_, _, err := getDiskUsage(rootDir)
	if err != nil {
		logger.Warn("Failed to get disk stats: %v", err)
	}

	err = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			logger.Warn("Skipping path due to error: %s - %v", path, err)
			return nil // Skip this file/dir but continue
		}
		if info.IsDir() {
			totalFolders++
		} else {
			totalFiles++
			totalSize += info.Size()
			if info.ModTime().After(lastSync) {
				lastSync = info.ModTime()
			}
		}
		return nil
	})

	if err != nil {
		http.Error(w, "Failed to calculate stats", http.StatusInternalServerError)
		return
	}

	ip := os.Getenv("CINESYNC_IP")
	if ip == "" {
		ip = "0.0.0.0"
	}
	port := os.Getenv("CINESYNC_API_PORT")
	if port == "" {
		port = "8082"
	}
	webdavEnabled := os.Getenv("CINESYNC_WEBDAV")
	webdavStatus := "Inactive"
	if webdavEnabled == "true" || webdavEnabled == "1" {
		webdavStatus = "Active"
	}
	stats := Stats{
		TotalFiles:   totalFiles,
		TotalFolders: totalFolders,
		TotalSize:    formatFileSize(totalSize),
		LastSync:     lastSync.Format(time.RFC3339),
		WebDAVStatus: webdavStatus,
		StorageUsed:  formatFileSize(totalSize),
		IP:           ip,
		Port:         port,
	}
	if statsChanged(stats, lastStats) {
		logger.Info("API response: totalFiles=%d, totalFolders=%d, totalSize=%d bytes (%.2f GB)", totalFiles, totalFolders, totalSize, float64(totalSize)/(1024*1024*1024))
		lastStats = stats
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func HandleAuthTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// If we reach here, the authentication middleware has already validated the credentials
	w.WriteHeader(http.StatusOK)
}

func HandleAuthEnabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	enabled := true
	if v := os.Getenv("WEBDAV_AUTH_ENABLED"); v == "false" || v == "0" {
		enabled = false
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"enabled": enabled})
}

func executeReadlink(path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return "", err
	}
	return abs, nil
}

func HandleReadlink(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req ReadlinkRequest
	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	absPath := filepath.Join(rootDir, req.Path)
	realPath, err := executeReadlink(absPath)
	resp := ReadlinkResponse{
		RealPath: realPath,
		AbsPath:  absPath,
	}
	if err != nil {
		resp.Error = err.Error()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// HandleDelete deletes a file or directory at the given relative path
func HandleDelete(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)

	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		logger.Warn("Invalid method: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		logger.Warn("Error: failed to read request body: %v", err)
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req DeleteRequest
	if err := json.Unmarshal(body, &req); err != nil {
		logger.Warn("Error: invalid request body: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		logger.Warn("Error: empty path provided")
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	cleanPath := filepath.Clean(req.Path)
	if cleanPath == "." || cleanPath == ".." || strings.HasPrefix(cleanPath, "..") {
		logger.Warn("Error: invalid path: %s", cleanPath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	path := filepath.Join(rootDir, cleanPath)

	absPath, err := filepath.Abs(path)
	if err != nil {
		logger.Warn("Error: failed to get absolute path: %v", err)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		logger.Warn("Error: failed to get absolute root path: %v", err)
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}

	if !strings.HasPrefix(absPath, absRoot) {
		logger.Warn("Error: path outside root directory: %s", absPath)
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		logger.Warn("Error: file or directory not found: %s", path)
		http.Error(w, "File or directory not found", http.StatusNotFound)
		return
	}

	err = os.RemoveAll(path)
	if err != nil {
		logger.Warn("Error: failed to delete %s: %v", path, err)
		http.Error(w, "Failed to delete file or directory", http.StatusInternalServerError)
		return
	}

	logger.Info("Success: deleted %s", path)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DeleteResponse{Success: true})
}

// HandleRename renames a file or directory at the given relative path
func HandleRename(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)

	if r.Method != http.MethodPost {
		logger.Warn("Invalid method: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		logger.Warn("Error: failed to read request body: %v", err)
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	var req RenameRequest
	if err := json.Unmarshal(body, &req); err != nil {
		logger.Warn("Error: invalid request body: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.OldPath == "" || req.NewName == "" {
		logger.Warn("Error: missing oldPath or newName")
		http.Error(w, "oldPath and newName are required", http.StatusBadRequest)
		return
	}

	cleanOldPath := filepath.Clean(req.OldPath)
	if cleanOldPath == "." || cleanOldPath == ".." || strings.HasPrefix(cleanOldPath, "..") {
		logger.Warn("Error: invalid oldPath: %s", cleanOldPath)
		http.Error(w, "Invalid oldPath", http.StatusBadRequest)
		return
	}

	oldFullPath := filepath.Join(rootDir, cleanOldPath)
	newFullPath := filepath.Join(filepath.Dir(oldFullPath), req.NewName)

	absOld, err := filepath.Abs(oldFullPath)
	if err != nil {
		logger.Warn("Error: failed to get absolute old path: %v", err)
		http.Error(w, "Invalid oldPath", http.StatusBadRequest)
		return
	}
	absRoot, err := filepath.Abs(rootDir)
	if err != nil {
		logger.Warn("Error: failed to get absolute root path: %v", err)
		http.Error(w, "Server configuration error", http.StatusInternalServerError)
		return
	}
	if !strings.HasPrefix(absOld, absRoot) {
		logger.Warn("Error: oldPath outside root directory: %s", absOld)
		http.Error(w, "Invalid oldPath", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(oldFullPath); os.IsNotExist(err) {
		logger.Warn("Error: file or directory not found: %s", oldFullPath)
		http.Error(w, "File or directory not found", http.StatusNotFound)
		return
	}

	if _, err := os.Stat(newFullPath); err == nil {
		logger.Warn("Error: target already exists: %s", newFullPath)
		http.Error(w, "Target already exists", http.StatusConflict)
		return
	}

	err = os.Rename(oldFullPath, newFullPath)
	if err != nil {
		logger.Warn("Error: failed to rename %s to %s: %v", oldFullPath, newFullPath, err)
		http.Error(w, "Failed to rename file or directory", http.StatusInternalServerError)
		return
	}

	logger.Info("Success: renamed %s to %s", oldFullPath, newFullPath)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(RenameResponse{Success: true})
}

func HandleStream(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/stream/")
	filePath := filepath.Join(rootDir, path)
	logger.Info("Starting video stream for: %s", filePath)

	// Open the file
	file, err := os.Open(filePath)
	if err != nil {
		logger.Error("Failed to open file for streaming: %v", err)
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
	switch strings.ToLower(filepath.Ext(path)) {
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

	// Default chunk size (2MB for initial chunk, 8MB for subsequent chunks)
	initialChunkSize := int64(2 * 1024 * 1024)    // 2MB
	defaultChunkSize := int64(8 * 1024 * 1024)    // 8MB

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
			end = start + defaultChunkSize - 1
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
	// Add cache control headers for better performance
	w.Header().Set("Cache-Control", "public, max-age=31536000")
	w.WriteHeader(http.StatusPartialContent)

	// Seek to start position
	if _, err := file.Seek(start, 0); err != nil {
		logger.Error("Failed to seek file: %v", err)
		http.Error(w, "Failed to seek file", http.StatusInternalServerError)
		return
	}

	// Use a reasonably sized buffer for copying
	buffer := make([]byte, 32*1024) // 32KB buffer
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
			logger.Error("Error writing to response: %v", err)
			return
		}
		written += int64(n)
	}
}
