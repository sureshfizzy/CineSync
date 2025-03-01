package server

import (
	"html/template"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"cinesync/pkg/dashboard"
	"cinesync/pkg/files"
	"cinesync/pkg/logger"
	"cinesync/pkg/webdav"
)

// Server represents the CineSync server
type Server struct {
	RootDir string
}

// NewServer creates a new server instance
func NewServer(rootDir string) *Server {
	return &Server{
		RootDir: rootDir,
	}
}

// Initialize sets up the HTTP handlers and templates
func (s *Server) Initialize() error {
	// Parse templates
	templatesDir := "./templates"
	logger.Debug("Loading templates from: %s", templatesDir)
	tmpl, err := files.PrepareTemplates(templatesDir)
	if err != nil {
		return err
	}

	// Load dashboard template
	dashboardTmpl, err := template.ParseFiles(filepath.Join(templatesDir, "dashboard.html"))
	if err != nil {
		return err
	}

	// Create WebDAV handler
	davHandler := webdav.NewHandler(s.RootDir)
	logger.Debug("WebDAV handler created for directory: %s", s.RootDir)

	// Register static file handler
	staticDir := "./static"
	fs := http.FileServer(http.Dir(staticDir))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// Handle favicon.ico requests at root level
	http.HandleFunc("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(staticDir, "favicon.ico"))
	})

	// Register the main handler which routes between dashboard, file browser, and WebDAV
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Check if request is from a WebDAV client
		isWebDAVClient := webdav.IsWebDAVUserAgent(r.UserAgent())

		// All non-GET methods are likely WebDAV operations
		if r.Method != http.MethodGet || isWebDAVClient {
			davHandler.ServeHTTP(w, r)
			return
		}

		// Handle dashboard at root path for browsers
		if r.URL.Path == "/" {
			// Get media folders for dashboard
			mediaFolders, err := dashboard.GetMediaFolders(s.RootDir)
			if err != nil {
				logger.Error("Error getting media folders: %v", err)
				http.Error(w, "Server error", http.StatusInternalServerError)
				return
			}

			if len(mediaFolders) == 1 {
				http.Redirect(w, r, mediaFolders[0].Path, http.StatusFound)
				return
			}

			data := dashboard.DashboardData{
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
			files.ServeFileOrDirectory(w, r, s.RootDir, tmpl)
			return
		}

		// For any other GET requests from browsers, serve them as files
		files.ServeFileOrDirectory(w, r, s.RootDir, tmpl)
	})

	return nil
}
