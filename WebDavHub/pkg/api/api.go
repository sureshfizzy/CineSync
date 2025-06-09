package api

import (
	"cinesync/pkg/logger"
	"cinesync/pkg/db"
	"cinesync/pkg/env"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

var rootDir string
var lastStats Stats
var lastStatsUpdate time.Time
var statsCacheDuration = 30 * time.Second
var statsScanInProgress bool
var statsScanProgress struct {
	CurrentPath string
	FilesScanned int
	FoldersScanned int
	TotalSize int64
	LastUpdate time.Time
}

var isPlaceholderConfig bool

// SetRootDir sets the root directory for file operations and initializes the DB
func SetRootDir(dir string) {
	rootDir = dir

	// Check if we're using a placeholder or fallback configuration
	originalDestDir := os.Getenv("DESTINATION_DIR")
	isPlaceholderConfig = (originalDestDir == "" ||
		originalDestDir == "/path/to/destination" ||
		originalDestDir == "\\path\\to\\destination" ||
		dir == ".")

	if err := db.InitDB(rootDir); err != nil {
		logger.Warn("Failed to initialize SQLite DB: %v", err)
	}
	if err := db.InitTmdbCacheTable(); err != nil {
		logger.Warn("Failed to initialize TMDB cache table: %v", err)
	}
}

// UpdateRootDir updates the root directory when configuration changes
func UpdateRootDir() {
	newDestDir := env.GetString("DESTINATION_DIR", ".")

	// Check if the directory exists
	if _, err := os.Stat(newDestDir); os.IsNotExist(err) {
		logger.Warn("Directory %s does not exist. Please create it manually before using it as DESTINATION_DIR", newDestDir)
		return
	}

	// Update the root directory only if it exists
	oldRootDir := rootDir
	SetRootDir(newDestDir)

	logger.Info("Root directory updated from %s to %s", oldRootDir, newDestDir)
}

// InitializeImageCache initializes the image cache service with project directory
func InitializeImageCache(projectDir string) {
	InitImageCache(projectDir)
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
	TmdbId   string `json:"tmdbId,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
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
	TotalMovies  int    `json:"totalMovies"`
	TotalShows   int    `json:"totalShows"`
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

// HandleConfigStatus returns the configuration status
func HandleConfigStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get the current destination directory from environment (which may have been reloaded)
	currentDestDir := env.GetString("DESTINATION_DIR", ".")

	// Check if the current destination directory is a placeholder or invalid
	currentIsPlaceholder := currentDestDir == "/path/to/destination" ||
		currentDestDir == "\\path\\to\\destination" ||
		currentDestDir == "." ||
		currentDestDir == ""

	// Also check if the directory actually exists
	if !currentIsPlaceholder {
		if _, err := os.Stat(currentDestDir); os.IsNotExist(err) {
			logger.Warn("DESTINATION_DIR %s does not exist", currentDestDir)
			currentIsPlaceholder = true
		}
	}

	response := map[string]interface{}{
		"isPlaceholder":        currentIsPlaceholder,
		"destinationDir":       currentDestDir,
		"effectiveRootDir":     rootDir,
		"needsConfiguration":   currentIsPlaceholder,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func HandleFiles(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// If using placeholder configuration, return a special response
	if isPlaceholderConfig {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Needs-Configuration", "true")
		json.NewEncoder(w).Encode([]FileInfo{})
		return
	}

	path := r.URL.Path
	if path == "/api/files" {
		path = "/"
	} else {
		path = strings.TrimPrefix(path, "/api/files")
	}

	// Parse pagination parameters
	page := 1
	limit := 100
	if pageStr := r.URL.Query().Get("page"); pageStr != "" {
		if parsedPage, err := strconv.Atoi(pageStr); err == nil && parsedPage > 0 {
			page = parsedPage
		}
	}
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 && parsedLimit <= 1000 {
			limit = parsedLimit
		}
	}

	dir := filepath.Join(rootDir, path)
	logger.Info("Listing directory: %s (API path: %s)", dir, path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		logger.Warn("Failed to read directory: %s - %v", dir, err)
		http.Error(w, "Failed to read directory", http.StatusInternalServerError)
		return
	}

	// Build a filtered list of entries that excludes .tmdb
	effectiveEntries := make([]os.DirEntry, 0, len(entries))
	var tmdbID string
	var mediaType string
	// Only set tmdbID if .tmdb exists directly in this directory
	tmdbPath := filepath.Join(dir, ".tmdb")
	if data, err := os.ReadFile(tmdbPath); err == nil {
		content := strings.TrimSpace(string(data))
		parts := strings.Split(content, ":")
		if len(parts) >= 2 {
			tmdbID = parts[0]
			mediaType = parts[1]
		} else {
			tmdbID = content
		}
	}
	for _, entry := range entries {
		if entry.Name() == ".tmdb" {
			continue
		}
		effectiveEntries = append(effectiveEntries, entry)
	}

	files := make([]FileInfo, 0)
	seasonFolderCount := 0
	fileCount := 0
	// Check for allowed extensions in this directory
	allowedExtStr := os.Getenv("ALLOWED_EXTENSIONS")
	allowedExts := []string{}
	if allowedExtStr != "" {
		for _, ext := range strings.Split(allowedExtStr, ",") {
			ext = strings.TrimSpace(strings.ToLower(ext))
			if ext != "" {
				if !strings.HasPrefix(ext, ".") {
					ext = "." + ext
				}
				allowedExts = append(allowedExts, ext)
			}
		}
	}
	hasAllowed := false
	// Check for allowed extensions in this directory only
	if len(allowedExts) > 0 {
		for _, entry := range effectiveEntries {
			if !entry.IsDir() {
				ext := strings.ToLower(filepath.Ext(entry.Name()))
						for _, allowed := range allowedExts {
							if ext == allowed {
								hasAllowed = true
								break
							}
						}
						if hasAllowed {
							break
						}
					}
				}
	}

	w.Header().Set("X-Has-Allowed-Extensions", fmt.Sprintf("%v", hasAllowed))
	// Set TMDB headers if we have the information
	if tmdbID != "" && path != "/" {
		w.Header().Set("X-TMDB-ID", tmdbID)
		if mediaType != "" {
			w.Header().Set("X-Media-Type", mediaType)
		} else {
			logger.Info("MediaType not in .tmdb for %s, will be determined by content or subdirectories.", dir)
		}
	}

	// --- TV Show Root Detection ---
	if len(effectiveEntries) > 0 {
		seasonCount := 0
		fileCountInDir := 0
		for _, entry := range effectiveEntries {
			if entry.IsDir() && isSeasonFolder(entry.Name()) {
				seasonCount++
			} else if !entry.IsDir() {
				fileCountInDir++
			}
		}
		if seasonCount > 0 && seasonCount == len(effectiveEntries)-fileCountInDir && fileCountInDir == 0 {
			w.Header().Set("X-Has-Season-Folders", "true")
			if mediaType == "" { // Only set if not already determined from .tmdb
				w.Header().Set("X-Media-Type", "tv")
				mediaType = "tv" // Update local mediaType as well
				logger.Info("Directory %s identified as TV Show root by content, X-Media-Type set to tv", dir)
			}
		}
	}

	for _, entry := range effectiveEntries {
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

			// --- Subdirectory TMDB/Media Type Logic ---
			subDirPath := filepath.Join(dir, entry.Name())
			subDirTmdbID := ""
			subDirMediaType := ""

			// 1. Check .tmdb file in subdirectory first
			subTmdbPath := filepath.Join(subDirPath, ".tmdb")
			if data, err := os.ReadFile(subTmdbPath); err == nil {
				content := strings.TrimSpace(string(data))
				parts := strings.Split(content, ":")
				if len(parts) >= 2 {
					subDirTmdbID = parts[0]
					subDirMediaType = parts[1]
					fileInfo.TmdbId = subDirTmdbID
					fileInfo.MediaType = subDirMediaType
					if subDirMediaType == "tv" {
						fileInfo.HasSeasonFolders = true
					}
				} else {
					subDirTmdbID = content
					fileInfo.TmdbId = subDirTmdbID
				}
			}

			// 2. If MediaType not found in .tmdb, then check content (season folders/media files)
			if subDirMediaType == "" {
				if subEntries, err := os.ReadDir(subDirPath); err == nil {
					seasonFound := false
					hasMediaFiles := false
					for _, subEntry := range subEntries {
						if subEntry.IsDir() && isSeasonFolder(subEntry.Name()) {
							seasonFound = true
							break
						}
						if !subEntry.IsDir() {
							ext := strings.ToLower(filepath.Ext(subEntry.Name()))
							for _, allowed := range allowedExts {
								if ext == allowed {
									hasMediaFiles = true
									break
								}
							}
							if hasMediaFiles {
								break
							}
						}
					}

					if seasonFound {
						fileInfo.MediaType = "tv"
						fileInfo.HasSeasonFolders = true
						subDirMediaType = "tv"
						logger.Info("Detected TV show structure in %s by content (no .tmdb type or .tmdb not present)", subDirPath)
					} else if hasMediaFiles {
						fileInfo.MediaType = "movie"
						subDirMediaType = "movie"
						logger.Info("Detected movie files in %s by content (no .tmdb type or .tmdb not present)", subDirPath)
					}
				}
			}

			// For season folders, try to inherit TMDB ID from parent directory
			if isSeasonFolder(entry.Name()) && subDirTmdbID == "" {
				// Check if parent directory has a .tmdb file
				if tmdbID != "" {
					fileInfo.TmdbId = tmdbID
					fileInfo.MediaType = "tv" // Season folders are always TV
					logger.Info("Season folder %s inherited TMDB ID %s from parent directory", entry.Name(), tmdbID)
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

	// Sort files: directories first, then alphabetically
	sort.Slice(files, func(i, j int) bool {
		if files[i].Type == "directory" && files[j].Type != "directory" {
			return true
		}
		if files[i].Type != "directory" && files[j].Type == "directory" {
			return false
		}
		return strings.ToLower(files[i].Name) < strings.ToLower(files[j].Name)
	})

	// Apply pagination
	totalFiles := len(files)
	startIndex := (page - 1) * limit
	endIndex := startIndex + limit

	if startIndex >= totalFiles {
		files = []FileInfo{}
	} else {
		if endIndex > totalFiles {
			endIndex = totalFiles
		}
		files = files[startIndex:endIndex]
	}

	// Add pagination headers
	w.Header().Set("X-Total-Count", fmt.Sprintf("%d", totalFiles))
	w.Header().Set("X-Page", fmt.Sprintf("%d", page))
	w.Header().Set("X-Limit", fmt.Sprintf("%d", limit))
	w.Header().Set("X-Total-Pages", fmt.Sprintf("%d", (totalFiles+limit-1)/limit))

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
		a.Port != b.Port ||
		a.TotalMovies != b.TotalMovies ||
		a.TotalShows != b.TotalShows
}

func HandleStats(w http.ResponseWriter, r *http.Request) {
	// Note: JWT is only required if CINESYNC_AUTH_ENABLED is true (handled by middleware)
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check for force refresh parameter
	forceRefresh := r.URL.Query().Get("refresh") == "true"

	// Return cached stats if they're still valid (unless force refresh requested)
	if !forceRefresh && !lastStatsUpdate.IsZero() && time.Since(lastStatsUpdate) < statsCacheDuration {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(lastStats)
		return
	}

	// If a scan is already in progress, return current progress
	if statsScanInProgress {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"scanning": true,
			"progress": statsScanProgress,
		})
		return
	}

	// Start new scan
	statsScanInProgress = true
	statsScanProgress = struct {
		CurrentPath string
		FilesScanned int
		FoldersScanned int
		TotalSize int64
		LastUpdate time.Time
	}{
		CurrentPath: "Initializing database query...",
		LastUpdate: time.Now(),
	}

	// Get all stats from MediaHub database - no file system scanning needed
	totalFiles, totalFolders, totalSize, movieCount, showCount, err := db.GetAllStatsFromDB()

	if err != nil {
		// Set reasonable defaults
		totalFiles, totalFolders, totalSize, movieCount, showCount = 0, 0, 0, 0, 0
	}

	// Update progress to show completion
	statsScanProgress.FilesScanned = totalFiles
	statsScanProgress.FoldersScanned = totalFolders
	statsScanProgress.TotalSize = totalSize
	statsScanProgress.CurrentPath = "Database query completed"
	statsScanProgress.LastUpdate = time.Now()

	// For lastSync, use current time since we're not scanning files
	lastSync := time.Now()

	ip := os.Getenv("CINESYNC_IP")
	if ip == "" {
		ip = "0.0.0.0"
	}
	port := os.Getenv("CINESYNC_API_PORT")
	if port == "" {
		port = "8082"
	}
	webdavStatus := "Active"
	stats := Stats{
		TotalFiles:   totalFiles,
		TotalFolders: totalFolders,
		TotalSize:    formatFileSize(totalSize),
		LastSync:     lastSync.Format(time.RFC3339),
		WebDAVStatus: webdavStatus,
		StorageUsed:  formatFileSize(totalSize),
		IP:           ip,
		Port:         port,
		TotalMovies:  movieCount,
		TotalShows:   showCount,
	}

	if statsChanged(stats, lastStats) {
		lastStats = stats
		lastStatsUpdate = time.Now()
	}

	statsScanInProgress = false

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
	if v := os.Getenv("CINESYNC_AUTH_ENABLED"); v == "false" || v == "0" {
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

// HandleFileDetails handles GET/POST/DELETE for file details
func HandleFileDetails(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// GET /api/file-details?path=... or ?prefix=...
		path := r.URL.Query().Get("path")
		prefix := r.URL.Query().Get("prefix")
		if path != "" {
			fd, err := db.GetFileDetail(path)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if fd == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			json.NewEncoder(w).Encode(fd)
			return
		}
		if prefix != "" {
			fds, err := db.ListFileDetails(prefix)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			json.NewEncoder(w).Encode(fds)
			return
		}
		w.WriteHeader(http.StatusBadRequest)
		return
	case http.MethodPost:
		// POST /api/file-details (body: FileDetail)
		var fd db.FileDetail
		if err := json.NewDecoder(r.Body).Decode(&fd); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		if err := db.UpsertFileDetail(fd); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	case http.MethodDelete:
		// DELETE /api/file-details?path=...
		path := r.URL.Query().Get("path")
		if path == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err := db.DeleteFileDetail(path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// --- TMDB Cache API ---
// GET /api/tmdb-cache?query=...  |  POST /api/tmdb-cache {query, result}
func HandleTmdbCache(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cacheKey := r.URL.Query().Get("query")
		if cacheKey == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		result, err := db.GetTmdbCache(cacheKey)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if result == "" {
			// --- Secondary lookup for id-based cacheKey ---
			if strings.HasPrefix(cacheKey, "id:") {
				parts := strings.Split(cacheKey, ":")
				if len(parts) >= 3 {
					tmdbID := parts[1]
					mediaType := parts[2]
					// Try to find any cache row with this tmdb_id and media_type
					altResult, err := db.GetTmdbCacheByTmdbIdAndType(tmdbID, mediaType)
					if err == nil && altResult != "" {
						// Upsert under the new cacheKey for future hits
						db.UpsertTmdbCache(cacheKey, altResult)
						w.Header().Set("Content-Type", "application/json")
						w.Header().Set("X-TMDB-Cache", "HIT-SECONDARY")
						w.Write([]byte(altResult))
						return
					}
				}
			}
			// Cache miss: call TMDB API, store, and return
			// Parse cacheKey: query|year|mediaType
			parts := strings.Split(cacheKey, "|")
			query := ""
			year := ""
			mediaType := ""
			if len(parts) > 0 {
				query = parts[0]
			}
			if len(parts) > 1 {
				year = parts[1]
			}
			if len(parts) > 2 {
				mediaType = parts[2]
			}
			// Call TMDB API (proxy)
			backendHost := os.Getenv("CINESYNC_API_HOST")
			if backendHost == "" {
				backendHost = "http://localhost:8082"
			}
			params := url.Values{}
			params.Set("query", query)
			params.Set("include_adult", "false")
			if year != "" {
				params.Set("year", year)
			}
			if mediaType != "" {
				params.Set("mediaType", mediaType)
			}
			tmdbUrl := backendHost + "/api/tmdb/search?" + params.Encode()
			req, _ := http.NewRequest("GET", tmdbUrl, nil)
			req.Header = r.Header
			resp, err := http.DefaultClient.Do(req)
			if err != nil || resp.StatusCode != 200 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			defer resp.Body.Close()
			var tmdbResp struct {
				Results []map[string]interface{} `json:"results"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&tmdbResp); err != nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if len(tmdbResp.Results) == 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			best := tmdbResp.Results[0]
			id, _ := best["id"].(float64)
			title, _ := best["title"].(string)
			if title == "" {
				title, _ = best["name"].(string)
			}
			posterPath, _ := best["poster_path"].(string)
			releaseDate, _ := best["release_date"].(string)
			if releaseDate == "" {
				releaseDate, _ = best["first_air_date"].(string)
			}
			mediaType, _ = best["media_type"].(string)
			if mediaType == "" {
				parsedType := strings.ToLower(parts[len(parts)-1])
				if parsedType == "tv" {
					mediaType = "tv"
				} else {
					mediaType = "movie"
				}
			}
			resultJson := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
				int(id), title, posterPath, releaseDate, mediaType)
			db.UpsertTmdbCache(cacheKey, resultJson)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-TMDB-Cache", "MISS")
			w.Write([]byte(resultJson))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-TMDB-Cache", "HIT")
		w.Write([]byte(result))
		return
	case http.MethodPost:
		var req struct {
			Query  string `json:"query"`
			Result string `json:"result"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}
		if req.Query == "" || req.Result == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if err := db.UpsertTmdbCache(req.Query, req.Result); err != nil {
			http.Error(w, "DB error: "+err.Error(), http.StatusInternalServerError)
			logger.Warn("TMDB cache upsert error: %v", err)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	case http.MethodDelete:
		if err := db.ClearTmdbCache(); err != nil {
			http.Error(w, "Failed to clear cache: "+err.Error(), http.StatusInternalServerError)
			logger.Warn("TMDB cache clear error: %v", err)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleMediaHubMessage handles structured messages
func HandleMediaHubMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var message struct {
		Type      string                 `json:"type"`
		Timestamp float64                `json:"timestamp"`
		Data      map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(r.Body).Decode(&message); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if message.Type == "symlink_created" {
		handleSymlinkCreated(message.Data)
	}

	forwardToPythonBridge(message)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func forwardToPythonBridge(message struct {
	Type      string                 `json:"type"`
	Timestamp float64                `json:"timestamp"`
	Data      map[string]interface{} `json:"data"`
}) {
	// Get the active response writer to forward the message
	activePythonResponseMutex.Lock()
	responseWriter := activePythonResponseWriter
	activePythonResponseMutex.Unlock()

	if responseWriter == nil {
		return
	}

	// Create the structured message in the format expected by the frontend
	structuredMsg := StructuredMessage{
		Type:      message.Type,
		Timestamp: message.Timestamp,
		Data:      message.Data,
	}

	// Create response with structured data
	response := PythonBridgeResponse{
		StructuredData: &structuredMsg,
	}

	// Send the response to the active bridge session
	data, err := json.Marshal(response)
	if err != nil {
		logger.Warn("Failed to marshal structured message for forwarding: %v", err)
		return
	}

	// Write to the active bridge response writer
	responseWriter.Write(data)
	responseWriter.Write([]byte("\n"))

	if flusher, ok := responseWriter.(http.Flusher); ok {
		flusher.Flush()
	}

	logger.Info("Forwarded structured message to Python bridge: %s", message.Type)
}

func handleSymlinkCreated(data map[string]interface{}) {
	mediaName, _ := data["media_name"].(string)
	mediaType, _ := data["media_type"].(string)
	destinationFile, _ := data["destination_file"].(string)
	filename, _ := data["filename"].(string)
	tmdbIdInterface := data["tmdb_id"]

	var tmdbId string
	if tmdbIdInterface != nil {
		if id, ok := tmdbIdInterface.(float64); ok {
			tmdbId = fmt.Sprintf("%.0f", id)
		} else if id, ok := tmdbIdInterface.(string); ok {
			tmdbId = id
		}
	}

	if mediaName == "" || mediaType == "" {
		return
	}

	// Determine folder name based on media type
	folderName := "Movies"
	if mediaType == "tvshow" {
		folderName = "TV Shows"
	}

	// Initialize the new media entry
	newMedia := db.RecentMedia{
		Name:       mediaName,
		Path:       destinationFile,
		FolderName: folderName,
		UpdatedAt:  time.Now().Unix(),
		Type:       mediaType,
		TmdbId:     tmdbId,
		Filename:   filename,
	}

	// For TV shows, use rich data directly from MediaHub
	if mediaType == "tvshow" {
		// Season number
		if seasonInterface, exists := data["season_number"]; exists {
			if season, ok := seasonInterface.(float64); ok {
				newMedia.SeasonNumber = int(season)
			} else if seasonStr, ok := seasonInterface.(string); ok {
				if season, err := strconv.Atoi(seasonStr); err == nil {
					newMedia.SeasonNumber = season
				}
			}
		}

		// Episode number
		if episodeInterface, exists := data["episode_number"]; exists {
			if episode, ok := episodeInterface.(float64); ok {
				newMedia.EpisodeNumber = int(episode)
			} else if episodeStr, ok := episodeInterface.(string); ok {
				if episode, err := strconv.Atoi(episodeStr); err == nil {
					newMedia.EpisodeNumber = episode
				}
			}
		}

		// Show name (prefer show_name, fallback to cleaned proper_show_name)
		if showNameInterface, exists := data["show_name"]; exists {
			if showName, ok := showNameInterface.(string); ok && showName != "" {
				newMedia.ShowName = showName
			}
		}
		if newMedia.ShowName == "" {
			if properShowNameInterface, exists := data["proper_show_name"]; exists {
				if properShowName, ok := properShowNameInterface.(string); ok && properShowName != "" {
					tmdbPattern := regexp.MustCompile(`\s*\{tmdb-\d+\}`)
					cleanShowName := tmdbPattern.ReplaceAllString(properShowName, "")
					newMedia.ShowName = strings.TrimSpace(cleanShowName)
				}
			}
		}

		// Episode title (directly from MediaHub/TMDB)
		if episodeTitleInterface, exists := data["episode_title"]; exists {
			if episodeTitle, ok := episodeTitleInterface.(string); ok && episodeTitle != "" {
				seasonEpisodePattern := regexp.MustCompile(`^S\d{2}E\d{2}\s*-?\s*`)
				cleanEpisodeTitle := seasonEpisodePattern.ReplaceAllString(episodeTitle, "")
				newMedia.EpisodeTitle = strings.TrimSpace(cleanEpisodeTitle)
			}
		}
	}

	// Add to database
	if err := db.AddRecentMedia(newMedia); err != nil {
		return
	}

	// Notify dashboard about stats change (file was added)
	db.NotifyDashboardStatsChanged()
}

// HandleRecentMedia returns the recent media list from database
func HandleRecentMedia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get recent media from database
	recentMedia, err := db.GetRecentMedia(10)
	if err != nil {
		http.Error(w, "Failed to retrieve recent media", http.StatusInternalServerError)
		return
	}

	// Convert database format to API format for compatibility
	var result []map[string]interface{}
	for _, media := range recentMedia {
		item := map[string]interface{}{
			"name":       media.Name,
			"path":       media.Path,
			"folderName": media.FolderName,
			"updatedAt":  time.Unix(media.UpdatedAt, 0).Format(time.RFC3339),
			"type":       media.Type,
			"filename":   media.Filename,
		}

		if media.TmdbId != "" {
			item["tmdbId"] = media.TmdbId
		}
		if media.ShowName != "" {
			item["showName"] = media.ShowName
		}
		if media.SeasonNumber > 0 {
			item["seasonNumber"] = media.SeasonNumber
		}
		if media.EpisodeNumber > 0 {
			item["episodeNumber"] = media.EpisodeNumber
		}
		if media.EpisodeTitle != "" {
			item["episodeTitle"] = media.EpisodeTitle
		}

		result = append(result, item)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// HandleRestart handles server restart requests
func HandleRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	logger.Info("Server restart requested")

	// Send success response before restarting
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "success",
		"message": "Server restart initiated",
	})

	// Flush the response to ensure it's sent
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Give a moment for the response to be sent
	go func() {
		time.Sleep(1 * time.Second)
		logger.Info("Initiating server restart...")

		// Cross-platform graceful shutdown
		c := make(chan os.Signal, 1)
		signal.Notify(c, os.Interrupt)
		c <- os.Interrupt

		time.Sleep(5 * time.Second)
		logger.Warn("Graceful shutdown timeout, forcing exit")
		os.Exit(0)
	}()
}