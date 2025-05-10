package api

import (
	"encoding/json"
	"fmt"
	"log"
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
	log.Printf("[REQUEST] %s %s", r.Method, r.URL.Path)
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
	log.Printf("[NAVIGATE] Listing directory: %s (API path: %s)", dir, path)
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("[ERROR] Failed to read directory: %s - %v", dir, err)
		http.Error(w, "Failed to read directory", http.StatusInternalServerError)
		return
	}

	files := make([]FileInfo, 0)
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
			log.Printf("[NAVIGATE] Found directory: %s", filePath)
		} else {
			fileInfo.Size = formatFileSize(info.Size())
			log.Printf("[SERVE] Found file: %s (Size: %s, Modified: %s)", filePath, fileInfo.Size, fileInfo.Modified)
		}

		files = append(files, fileInfo)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
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
		log.Printf("Failed to get disk stats: %v", err)
	}

	err = filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			log.Printf("[ERROR] Skipping path due to error: %s - %v", path, err)
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
		log.Printf("[STATS] API response: totalFiles=%d, totalFolders=%d, totalSize=%d bytes (%.2f GB)", totalFiles, totalFolders, totalSize, float64(totalSize)/(1024*1024*1024))
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
