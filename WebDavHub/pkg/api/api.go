package api

import (
	"cinesync/pkg/logger"
	"cinesync/pkg/db"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"runtime"
)

var rootDir string
var lastStats Stats
var lastStatsUpdate time.Time
var statsCacheDuration = 5 * time.Minute // Cache stats for 5 minutes
var statsScanInProgress bool
var statsScanProgress struct {
	CurrentPath string
	FilesScanned int
	FoldersScanned int
	TotalSize int64
	LastUpdate time.Time
}

// SetRootDir sets the root directory for file operations and initializes the DB
func SetRootDir(dir string) {
	rootDir = dir
	if err := db.InitDB(rootDir); err != nil {
		logger.Warn("Failed to initialize SQLite DB: %v", err)
	}
	if err := db.InitTmdbCacheTable(); err != nil {
		logger.Warn("Failed to initialize TMDB cache table: %v", err)
	}
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

// DownloadRequest and DownloadResponse for download API
type DownloadRequest struct {
	Path string `json:"path"`
}

type DownloadResponse struct {
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

			// 3. If we have a media type (from .tmdb or content) but no TMDB ID yet (maybe .tmdb only had ID or no .tmdb), try to search
			// BUT: Don't create .tmdb files in season folders - only in show root directories
			if subDirMediaType != "" && subDirTmdbID == "" && !isSeasonFolder(entry.Name()) {
				folderName := entry.Name()
				year := ""

				// Try to extract year from folder name (assuming format like "Name (2023)" or "Name 2023")
				yearMatch := regexp.MustCompile(`[\( ](\d{4})[\)]?`).FindStringSubmatch(folderName)
				if len(yearMatch) > 1 {
					year = yearMatch[1]
				}

				// Clean the folder name by removing year and any special characters
				cleanName := regexp.MustCompile(`[\( ]\d{4}[\)]?`).ReplaceAllString(folderName, "")
				cleanName = regexp.MustCompile(`[^\w\s]`).ReplaceAllString(cleanName, " ")
				cleanName = strings.TrimSpace(cleanName)

				// Search TMDB with the cleaned name and year
				if cleanName != "" {
					logger.Info("Searching TMDB for %s (Year: %s, Type: %s)", cleanName, year, subDirMediaType)

					// Use the existing TMDB proxy endpoint
					params := url.Values{}
					params.Set("query", cleanName)
					if year != "" {
						params.Set("year", year)
					}
					params.Set("mediaType", subDirMediaType)

					// Make request to our local TMDB proxy
					proxyReq, _ := http.NewRequest("GET", "/api/tmdb/search?" + params.Encode(), nil)
					proxyReq.Header.Set("X-Real-IP", "127.0.0.1")

					// Use the existing TMDB handler directly
					recorder := httptest.NewRecorder()
					HandleTmdbProxy(recorder, proxyReq)

					resp := recorder.Result()
					if resp != nil && resp.Body != nil {
						defer resp.Body.Close()
					}

					if resp.StatusCode == http.StatusOK {
						var result struct {
							Results []struct {
								ID    int    `json:"id"`
								Title string `json:"title"`
								Name  string `json:"name"`
							} `json:"results"`
						}

						if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
							logger.Warn("Failed to decode TMDB response: %v", err)
						} else if len(result.Results) > 0 {
							// Use the first result
							firstResult := result.Results[0]
							fileInfo.TmdbId = fmt.Sprintf("%d", firstResult.ID)

							// Create .tmdb file with the found ID AND MediaType
							tmdbContent := fileInfo.TmdbId
							if fileInfo.MediaType != "" { // Should always be true here if we searched
								tmdbContent += ":" + fileInfo.MediaType
							}

							if err := os.WriteFile(subTmdbPath, []byte(tmdbContent), 0644); err != nil {
								logger.Warn("Failed to write .tmdb file for %s: %v", entry.Name(), err)
							} else {
								logger.Info("Created .tmdb file for %s with ID %s and Type %s after search", entry.Name(), fileInfo.TmdbId, fileInfo.MediaType)
							}
						}
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
	// Note: JWT is only required if WEBDAV_AUTH_ENABLED is true (handled by middleware)
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Return cached stats if they're still valid
	if !lastStatsUpdate.IsZero() && time.Since(lastStatsUpdate) < statsCacheDuration {
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
		LastUpdate: time.Now(),
	}

	// Use a buffered channel to limit concurrent operations
	sem := make(chan struct{}, 10) // Limit to 10 concurrent operations
	var wg sync.WaitGroup
	var mu sync.Mutex // Mutex to protect shared variables

	var totalFiles int
	var totalFolders int
	var totalSize int64
	var lastSync time.Time

	// Get disk usage information
	_, _, err := getDiskUsage(rootDir)
	if err != nil {
		logger.Warn("Failed to get disk stats: %v", err)
	}

	// Use a more efficient scanning method with concurrent processing
	err = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			logger.Warn("Skipping path due to error: %s - %v", path, err)
			return nil // Skip this file/dir but continue
		}

		// Update progress
		statsScanProgress.CurrentPath = path
		statsScanProgress.LastUpdate = time.Now()

		if info.IsDir() {
			// For directories, process them concurrently
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				mu.Lock()
				if path != rootDir {
					totalFolders++
				}
				statsScanProgress.FoldersScanned = totalFolders + 1 // Include root directory
				mu.Unlock()
			}()
		} else {
			if info.Name() == ".tmdb" {
				return nil // Skip .tmdb files from counting and processing
			}
			mu.Lock()
			totalFiles++
			totalSize += info.Size()
			statsScanProgress.FilesScanned = totalFiles
			statsScanProgress.TotalSize = totalSize
			if info.ModTime().After(lastSync) {
				lastSync = info.ModTime()
			}
			mu.Unlock()
		}

		return nil
	})

	if err != nil {
		statsScanInProgress = false
		http.Error(w, "Failed to calculate stats", http.StatusInternalServerError)
		return
	}

	// Wait for all concurrent operations to complete
	wg.Wait()

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
		logger.Warn("Error: failed to send file: %v", err)
	}
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
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
