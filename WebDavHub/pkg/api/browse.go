package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"cinesync/pkg/logger"
)

// BrowseItem represents a file or directory in the file system
type BrowseItem struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
	Size        int64  `json:"size"`
	SizeFormatted string `json:"sizeFormatted"`
	Modified    string `json:"modified"`
	IsMediaFile bool   `json:"isMediaFile"`
	Extension   string `json:"extension"`
}

// BrowseResponse represents the response from the browse API
type BrowseResponse struct {
	Items       []BrowseItem `json:"items"`
	CurrentPath string       `json:"currentPath"`
	ParentPath  string       `json:"parentPath"`
	Drives      []string     `json:"drives,omitempty"`
	Error       string       `json:"error,omitempty"`
}

// getWindowsDrives returns available Windows drives
func getWindowsDrives() []string {
	var drives []string
	if runtime.GOOS == "windows" {
		for _, drive := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
			drivePath := string(drive) + ":\\"
			if _, err := os.Stat(drivePath); err == nil {
				drives = append(drives, string(drive)+":")
			}
		}
	}
	return drives
}

// isMediaFile checks if a file is a media file based on extension
func isMediaFile(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	mediaExtensions := []string{
		".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
		".mpg", ".mpeg", ".3gp", ".ogv", ".ts", ".m2ts", ".mts", ".strm",
	}
	
	for _, mediaExt := range mediaExtensions {
		if ext == mediaExt {
			return true
		}
	}
	return false
}

// normalizePath normalizes a file path for the current OS
func normalizePath(path string) string {
	if runtime.GOOS == "windows" {
		path = strings.ReplaceAll(path, "/", "\\")
		if len(path) >= 2 && path[1] == ':' && len(path) == 2 {
			path += "\\"
		}
	} else {
		path = strings.ReplaceAll(path, "\\", "/")
	}
	return path
}

// getParentPath returns the parent directory path
func getParentPath(path string) string {
	if path == "" || path == "/" || (runtime.GOOS == "windows" && len(path) <= 3) {
		return ""
	}
	
	parent := filepath.Dir(path)
	if parent == path {
		return ""
	}
	
	return parent
}

// HandleBrowse handles file system browsing requests
func HandleBrowse(w http.ResponseWriter, r *http.Request) {
	logger.Info("Browse Request: %s %s", r.Method, r.URL.Path)
	
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get path parameter
	requestedPath := r.URL.Query().Get("path")

	if requestedPath == "" {
		if runtime.GOOS == "windows" {
			drives := getWindowsDrives()
			response := BrowseResponse{
				Items:       []BrowseItem{},
				CurrentPath: "",
				ParentPath:  "",
				Drives:      drives,
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
			return
		} else {
			requestedPath = "/"
		}
	}

	// Normalize the path
	normalizedPath := normalizePath(requestedPath)

	logger.Info("Browsing directory: %s", normalizedPath)

	// Check if path exists and is accessible
	info, err := os.Stat(normalizedPath)
	if err != nil {
		logger.Warn("Failed to access path %s: %v", normalizedPath, err)
		response := BrowseResponse{
			Error: fmt.Sprintf("Cannot access path: %s", err.Error()),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response)
		return
	}

	// If it's a file, return its parent directory
	if !info.IsDir() {
		normalizedPath = filepath.Dir(normalizedPath)
	}

	// Read directory contents
	entries, err := os.ReadDir(normalizedPath)
	if err != nil {
		logger.Warn("Failed to read directory %s: %v", normalizedPath, err)
		response := BrowseResponse{
			Error: fmt.Sprintf("Cannot read directory: %s", err.Error()),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(response)
		return
	}

	// Convert entries to BrowseItems
	var items []BrowseItem
	for _, entry := range entries {
		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}

		if runtime.GOOS != "windows" && strings.HasPrefix(entry.Name(), ".") {
			continue
		}

		itemPath := filepath.Join(normalizedPath, entry.Name())
		
		item := BrowseItem{
			Name:        entry.Name(),
			Path:        itemPath,
			IsDirectory: entry.IsDir(),
			Size:        entryInfo.Size(),
			SizeFormatted: formatFileSize(entryInfo.Size()),
			Modified:    entryInfo.ModTime().Format(time.RFC3339),
			Extension:   strings.ToLower(filepath.Ext(entry.Name())),
		}

		// Check if it's a media file
		if !entry.IsDir() {
			item.IsMediaFile = isMediaFile(entry.Name())
		}

		items = append(items, item)
	}

	// Sort items: directories first, then files, both alphabetically
	sort.Slice(items, func(i, j int) bool {
		if items[i].IsDirectory && !items[j].IsDirectory {
			return true
		}
		if !items[i].IsDirectory && items[j].IsDirectory {
			return false
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	// Prepare response
	response := BrowseResponse{
		Items:       items,
		CurrentPath: normalizedPath,
		ParentPath:  getParentPath(normalizedPath),
	}

	// Add drives for Windows root level
	if runtime.GOOS == "windows" && (normalizedPath == "" || len(normalizedPath) <= 3) {
		response.Drives = getWindowsDrives()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}