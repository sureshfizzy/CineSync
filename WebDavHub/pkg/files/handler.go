package files

import (
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"cinesync/pkg/logger"
)

// ServeFileOrDirectory decides whether to serve a file or directory listing
func ServeFileOrDirectory(w http.ResponseWriter, r *http.Request, baseDir string, tmpl *template.Template) {
	filePath := filepath.Join(baseDir, r.URL.Path)
	logger.Debug("Requested path: %s (Maps to: %s)", r.URL.Path, filePath)

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		logger.Error("File not found: %s - %v", filePath, err)
		http.Error(w, "File not found: "+err.Error(), http.StatusNotFound)
		return
	}

	if fileInfo.IsDir() {
		logger.Debug("Serving directory listing for: %s", filePath)
		ServeDirectoryListingTemplate(w, r, filePath, r.URL.Path, tmpl)
		return
	}

	logger.Debug("Serving file: %s", filePath)
	ServeFile(w, r, filePath)
}

// ServeDirectoryListingTemplate serves a directory listing using HTML template
func ServeDirectoryListingTemplate(w http.ResponseWriter, r *http.Request, dir, urlPath string, tmpl *template.Template) {
	files, err := os.ReadDir(dir)
	if err != nil {
		logger.Error("Failed to list directory: %s - %v", dir, err)
		http.Error(w, "Failed to list directory: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Debug("Found %d items in directory %s", len(files), dir)

	// Prepare data for template
	data := TemplateData{
		Title:       "Files in " + urlPath,
		CurrentPath: urlPath,
		Year:        time.Now().Format("2006"),
	}

	// Add parent directory if not at root
	if urlPath != "/" && urlPath != "" {
		data.ShowParent = true
		data.ParentPath = filepath.Dir(urlPath)
		if data.ParentPath == "." {
			data.ParentPath = "/"
		}
		logger.Debug("Added parent directory link: %s", data.ParentPath)
	}

	// Build breadcrumbs
	if urlPath != "/" && urlPath != "" {
		parts := SplitPath(urlPath)
		currentPath := ""

		for i, part := range parts {
			currentPath = filepath.Join(currentPath, part)
			data.Breadcrumbs = append(data.Breadcrumbs, BreadcrumbItem{
				Name:   part,
				Path:   currentPath,
				IsLink: i < len(parts)-1,
			})
		}
		logger.Debug("Built %d breadcrumb items for path: %s", len(data.Breadcrumbs), urlPath)
	}

	// Separate directories and files
	var dirs []os.DirEntry
	var regularFiles []os.DirEntry

	for _, file := range files {
		if file.IsDir() {
			dirs = append(dirs, file)
		} else {
			regularFiles = append(regularFiles, file)
		}
	}

	logger.Debug("Directory contains %d subdirectories and %d files", len(dirs), len(regularFiles))

	// Process directories
	for _, file := range dirs {
		name := file.Name()
		path := filepath.Join(urlPath, name)
		fileInfo, _ := file.Info()
		modTime := fileInfo.ModTime().Format("2006-01-02 15:04:05")

		data.Directories = append(data.Directories, FileInfo{
			Name:      name,
			Path:      path,
			ModTime:   modTime,
			Icon:      "fas fa-folder",
			IconClass: "folder-icon",
		})
	}

	// Process files
	for _, file := range regularFiles {
		name := file.Name()
		path := filepath.Join(urlPath, name)
		fileInfo, _ := file.Info()
		size := FormatFileSize(fileInfo.Size())
		modTime := fileInfo.ModTime().Format("2006-01-02 15:04:05")
		icon, iconClass := GetFileIconAndClass(name)

		data.Files = append(data.Files, FileInfo{
			Name:      name,
			Path:      path,
			Size:      size,
			ModTime:   modTime,
			Icon:      icon,
			IconClass: iconClass,
		})
	}

	// Render template
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := tmpl.Execute(w, data); err != nil {
		logger.Error("Error rendering template for directory %s: %v", dir, err)
		http.Error(w, "Error rendering template: "+err.Error(), http.StatusInternalServerError)
		return
	}

	logger.Info("Successfully served directory listing for: %s", urlPath)
}

// ServeFile serves a single file with proper headers
func ServeFile(w http.ResponseWriter, r *http.Request, filePath string) {
	// Get file information
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		logger.Error("File not found when attempting to serve: %s - %v", filePath, err)
		http.Error(w, "File not found: "+err.Error(), http.StatusNotFound)
		return
	}

	// Open the file
	file, err := os.Open(filePath)
	if err != nil {
		logger.Error("Failed to open file: %s - %v", filePath, err)
		http.Error(w, "Failed to open file: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer file.Close()

	// Set proper MIME type
	mimeType := GetMimeType(filePath)
	w.Header().Set("Content-Type", mimeType)
	logger.Debug("Set Content-Type to %s for file %s", mimeType, filePath)

	// Enable byte ranges and proper headers for video/audio streaming
	w.Header().Set("Accept-Ranges", "bytes")

	// Add Content-Length header
	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size()))

	// Add proper caching headers
	w.Header().Set("Cache-Control", "public, max-age=31536000")

	// Fix for some video players - add content disposition
	if IsStreamableMedia(mimeType) {
		filename := filepath.Base(filePath)
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filename))
		logger.Debug("Set streaming headers for media file: %s", filename)
	}

	// Use http.ServeContent instead of http.ServeFile for better range support
	http.ServeContent(w, r, filepath.Base(filePath), fileInfo.ModTime(), file)
	logger.Info("Successfully served file: %s (%s, %s)", filePath, mimeType, FormatFileSize(fileInfo.Size()))
}
