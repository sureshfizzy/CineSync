package server

import (
	"encoding/json"
	"html/template"
	"net/http"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"cinesync/pkg/auth"
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

// ReadlinkRequest represents the request structure for the readlink API
type ReadlinkRequest struct {
	Path string `json:"path"`
}

// ReadlinkResponse represents the response structure for the readlink API
type ReadlinkResponse struct {
	RealPath  string `json:"realPath"`
	AbsPath   string `json:"absPath"`
	Error     string `json:"error,omitempty"`
}

// executeReadlink runs the readlink command on the provided path
func executeReadlink(path string) (string, error) {
	cmd := exec.Command("readlink", "-f", path)
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
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

	// Add readlink API endpoint
	http.HandleFunc("/api/readlink", func(w http.ResponseWriter, r *http.Request) {
		// Only accept POST requests
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Parse the request body
		var req ReadlinkRequest
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&req); err != nil {
			logger.Error("Error decoding readlink request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ReadlinkResponse{
				Error: "Invalid request format",
			})
			return
		}

		// Validate the path
		if req.Path == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ReadlinkResponse{
				Error: "Path cannot be empty",
			})
			return
		}

		// Create the absolute path
		absPath := filepath.Join(s.RootDir, req.Path)

		// Execute readlink
		realPath, err := executeReadlink(absPath)
		if err != nil {
			logger.Error("Error executing readlink: %v", err)
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ReadlinkResponse{
				Error:    "Failed to get real path",
				AbsPath:  absPath,
				RealPath: absPath,
			})
			return
		}

		// Return the result
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(ReadlinkResponse{
			RealPath: realPath,
			AbsPath:  absPath,
		})
	})

	// Create the main handler that will handle all paths
	mainHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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

	// Wrap the main handler with authentication and register it
	authenticatedHandler := auth.BasicAuth(mainHandler)
	http.Handle("/", authenticatedHandler)

	return nil
}
