package server

import (
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
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
	RealPath string `json:"realPath"`
	AbsPath  string `json:"absPath"`
	Error    string `json:"error,omitempty"`
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
	return s.ensureDirectoryExists(s.RootDir)
}

func (s *Server) ensureDirectoryExists(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		log.Printf("Creating directory: %s", dir)
		return os.MkdirAll(dir, 0755)
	}
	return nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// Log the request with timestamp
	log.Printf("[%s] WebDAV Request: %s %s",
		start.Format("2006-01-02 15:04:05"),
		r.Method,
		r.URL.Path,
	)

	// Create a custom file system that logs file operations
	fs := &loggingFileSystem{
		root: s.RootDir,
	}

	// Serve the request
	http.FileServer(fs).ServeHTTP(w, r)

	// Log the response time
	duration := time.Since(start)
	log.Printf("[%s] Request completed in %v",
		time.Now().Format("2006-01-02 15:04:05"),
		duration,
	)
}

type loggingFileSystem struct {
	root string
}

func (fs *loggingFileSystem) Open(name string) (http.File, error) {
	path := filepath.Join(fs.root, name)

	// Get file info for better logging
	info, err := os.Stat(path)
	if err != nil {
		log.Printf("[%s] Error accessing path: %s - %v",
			time.Now().Format("2006-01-02 15:04:05"),
			path,
			err,
		)
		return nil, err
	}

	// Log file/directory details
	if info.IsDir() {
		log.Printf("[%s] Serving directory: %s",
			time.Now().Format("2006-01-02 15:04:05"),
			path,
		)
	} else {
		log.Printf("[%s] Serving file: %s (Size: %d bytes, Modified: %s)",
			time.Now().Format("2006-01-02 15:04:05"),
			path,
			info.Size(),
			info.ModTime().Format("2006-01-02 15:04:05"),
		)
	}

	return http.Dir(fs.root).Open(name)
}
