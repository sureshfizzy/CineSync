package main

import (
	"flag"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/net/webdav"
	"cinesync/pkg/env"
	"cinesync/pkg/files"
	"cinesync/pkg/logger"
)

// DashboardData
type DashboardData struct {
	Title        string
	MediaFolders []MediaFolder
	Year         int
	Version      string
}

// MediaFolder
type MediaFolder struct {
	Name        string
	Path        string
	Description string
	Icon        string
	ItemCount   int
	TotalSize   string
	LastUpdated string
}

func main() {
	logger.Init()
	env.LoadEnv()

	// Check if WebDAV should be enabled
	if !env.IsWebDAVEnabled() {
		logger.Info("WebDAV is disabled. Set CINESYNC_WEBDAV=true in your .env file to enable it.")
		return
	}

	// Define command-line flags with fallbacks from .env or hardcoded defaults
	dir := flag.String("dir", env.GetString("DESTINATION_DIR", "."), "Directory to serve over WebDAV")
	port := flag.Int("port", env.GetInt("WEBDAV_PORT", 8082), "Port to run the WebDAV server on")
	ip := flag.String("ip", env.GetString("WEBDAV_IP", "0.0.0.0"), "IP address to bind the server to")
	flag.Parse()

	logger.Debug("Starting with configuration: dir=%s, port=%d, ip=%s", *dir, *port, *ip)

	// Ensure the directory exists and is accessible
	if _, err := os.Stat(*dir); os.IsNotExist(err) {
		logger.Fatal("Directory %s does not exist", *dir)
	}

	// Check if CineSync folder exists and use it as the effective root if found
	effectiveRootDir := *dir
	cineSyncPath := filepath.Join(*dir, "CineSync")
	if _, err := os.Stat(cineSyncPath); err == nil {
		logger.Info("CineSync folder found, using it as the effective root directory")
		effectiveRootDir = cineSyncPath
	}

	// Create static directory if it doesn't exist
	staticDir := "./static"
	if _, err := os.Stat(staticDir); os.IsNotExist(err) {
		logger.Info("Static directory does not exist, creating it: %s", staticDir)
		if err := os.Mkdir(staticDir, 0755); err != nil {
			logger.Warn("Could not create static directory: %v", err)
		}
	}

	// Create templates directory if it doesn't exist
	templatesDir := "./templates"
	if _, err := os.Stat(templatesDir); os.IsNotExist(err) {
		logger.Info("Templates directory does not exist, creating it: %s", templatesDir)
		if err := os.Mkdir(templatesDir, 0755); err != nil {
			logger.Warn("Could not create templates directory: %v", err)
		}
	}

	// Parse templates
	logger.Debug("Loading templates from: %s", templatesDir)
	tmpl, err := files.PrepareTemplates(templatesDir)
	if err != nil {
		logger.Fatal("Error parsing templates: %v", err)
	}

	// Create WebDAV handler
	davHandler := &webdav.Handler{
		Prefix:     "/",
		FileSystem: webdav.Dir(effectiveRootDir),
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if err != nil {
				logger.Error("WebDAV %s %s ERROR: %v", r.Method, r.URL.Path, err)
			} else {
				logger.Info("WebDAV %s %s", r.Method, r.URL.Path)
			}
		},
	}
	logger.Debug("WebDAV handler created for directory: %s", effectiveRootDir)

	// Load dashboard template
	dashboardTmpl, err := template.ParseFiles(filepath.Join(templatesDir, "dashboard.html"))
	if err != nil {
		logger.Fatal("Error parsing dashboard template: %v", err)
	}

	// Register static file handler
	fs := http.FileServer(http.Dir(staticDir))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// Handle favicon.ico requests at root level
	http.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(staticDir, "favicon.ico"))
	})

	// Register the main handler which routes between dashboard, file browser, and WebDAV
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Check if request is from a WebDAV client
		isWebDAVClient := isWebDAVUserAgent(r.UserAgent())

		// All non-GET methods are likely WebDAV operations
		if r.Method != http.MethodGet || isWebDAVClient {
			davHandler.ServeHTTP(w, r)
			return
		}

		// Handle dashboard at root path for browsers
		if r.URL.Path == "/" {
			// Get media folders for dashboard
			mediaFolders, err := getMediaFolders(effectiveRootDir)
			if err != nil {
				logger.Error("Error getting media folders: %v", err)
				http.Error(w, "Server error", http.StatusInternalServerError)
				return
			}

			if len(mediaFolders) == 1 {
				http.Redirect(w, r, mediaFolders[0].Path, http.StatusFound)
				return
			}

			data := DashboardData{
				Title:        "CineSync Dashboard",
				MediaFolders: mediaFolders,
				Year:         time.Now().Year(),
				Version:      "v1.0.0",
			}

			err = dashboardTmpl.Execute(w, data)
			if err != nil {
				logger.Error("Error executing dashboard template: %v", err)
				http.Error(w, "Template error", http.StatusInternalServerError)
			}
			return
		}

		// Handle file browsing for specific paths
		if strings.HasPrefix(r.URL.Path, "/browse/") {
			// Remove /browse/ prefix for the file handler
			path := r.URL.Path[len("/browse/"):]

			// Reconstruct request URL for the file handling function
			r.URL.Path = "/" + path
			files.ServeFileOrDirectory(w, r, effectiveRootDir, tmpl)
			return
		}

		// For any other GET requests from browsers, serve them as files
		files.ServeFileOrDirectory(w, r, effectiveRootDir, tmpl)
	})

	// Start server
	addr := fmt.Sprintf("%s:%d", *ip, *port)
	rootInfo := *dir
	if effectiveRootDir != *dir {
		rootInfo = fmt.Sprintf("%s (using CineSync folder as root)", *dir)
	}

	logger.Info("Starting CineSync server on http://%s", addr)
	logger.Info("WebDAV access available at the root path for WebDAV clients")
	logger.Info("Serving content from: %s", rootInfo)
	logger.Info("Dashboard available at http://%s for browsers", addr)

	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Fatal("Server error: %v", err)
	}
}

// isWebDAVUserAgent checks if the user agent is from a WebDAV client
func isWebDAVUserAgent(userAgent string) bool {
	webDAVClients := []string{
		"Microsoft-WebDAV",
		"DavClnt",
		"WebDAVFS",
		"WebDAVLib",
		"cadaver",
		"Cyberduck",
		"davfs2",
		"GoodReader",
		"NetDrive",
		"OwnCloud",
		"NextCloud",
		"rclone",
	}

	userAgent = strings.ToLower(userAgent)
	for _, client := range webDAVClients {
		if strings.Contains(userAgent, strings.ToLower(client)) {
			return true
		}
	}

	return false
}

// getMediaFolders scans the root directory and returns a list of media folders
func getMediaFolders(rootDir string) ([]MediaFolder, error) {
	var folders []MediaFolder

	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			path := filepath.Join(rootDir, entry.Name())

			// Get folder stats with recursive calculation
			itemCount, totalSize, lastUpdated, err := getFolderStats(path)
			if err != nil {
				logger.Warn("Error getting stats for folder %s: %v", path, err)
				continue
			}

			// Default icon and description based on folder name
			icon := "fas fa-folder"
			description := "Media folder"

			// Set specific icons based on folder name for TV and Movies
			lowerName := strings.ToLower(entry.Name())
			if strings.Contains(lowerName, "movie") || strings.Contains(lowerName, "film") {
				icon = "fas fa-film"
				description = "Movie collection"
			} else if strings.Contains(lowerName, "tv") || strings.Contains(lowerName, "show") {
				icon = "fas fa-tv"
				description = "TV shows collection"
			}

			folders = append(folders, MediaFolder{
				Name:        entry.Name(),
				Path:        "/browse/" + entry.Name(),
				Description: description,
				Icon:        icon,
				ItemCount:   itemCount,
				TotalSize:   formatSize(totalSize),
				LastUpdated: lastUpdated,
			})
		}
	}

	return folders, nil
}

// getFolderStats returns statistics about a folder with recursive size calculation
func getFolderStats(path string) (itemCount int, totalSize int64, lastUpdated string, err error) {
	var latestTime time.Time

	err = filepath.Walk(path, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip the root path itself from item count
		if filePath != path {
			if !info.IsDir() {
				itemCount++
				totalSize += info.Size()
			}
		}

		if info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
		}

		return nil
	})

	if err != nil {
		return 0, 0, "", err
	}

	// Format the last updated time
	if !latestTime.IsZero() {
		lastUpdated = latestTime.Format("Jan 02, 2006")
	} else {
		lastUpdated = "N/A"
	}

	return itemCount, totalSize, lastUpdated, nil
}

// formatSize formats a file size in bytes to a human-readable string
func formatSize(size int64) string {
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
