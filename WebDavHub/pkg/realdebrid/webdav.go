package realdebrid

import (
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"cinesync/pkg/logger"
	"github.com/studio-b12/gowebdav"
)

// WebDAVClient wraps the gowebdav client for Real-Debrid
type WebDAVClient struct {
	client *gowebdav.Client
	apiKey string
}

// FileInfo represents file information from WebDAV
type FileInfo struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
}

// NewWebDAVClient creates a new Real-Debrid WebDAV client
func NewWebDAVClient(apiKey string) *WebDAVClient {
	client := gowebdav.NewClient("https://webdav.debrid.it", apiKey, "eeeeee")
	client.SetTimeout(30 * time.Second)
	
	return &WebDAVClient{
		client: client,
		apiKey: apiKey,
	}
}

// SetAPIKey updates the API key and reinitializes the client
func (w *WebDAVClient) SetAPIKey(apiKey string) {
	w.apiKey = apiKey
	w.client = gowebdav.NewClient("https://webdav.debrid.it", apiKey, "eeeeee")
	w.client.SetTimeout(30 * time.Second)
}

// TestConnection tests the WebDAV connection
func (w *WebDAVClient) TestConnection() error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Try to list the root directory to test connection
	_, err := w.client.ReadDir("/")
	if err != nil {
		return fmt.Errorf("failed to connect to Real-Debrid WebDAV: %w", err)
	}

	return nil
}

// ListDirectory lists files and directories in the specified path
func (w *WebDAVClient) ListDirectory(remotePath string) ([]FileInfo, error) {
	if w.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	// Remove trailing slash for directory listing
	remotePath = strings.TrimSuffix(remotePath, "/")

	files, err := w.client.ReadDir(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory %s: %w", remotePath, err)
	}

	var fileInfos []FileInfo
	for _, file := range files {
		filePath := path.Join(remotePath, file.Name())
		fileInfos = append(fileInfos, FileInfo{
			Name:    file.Name(),
			Path:    filePath,
			Size:    file.Size(),
			IsDir:   file.IsDir(),
			ModTime: file.ModTime(),
		})
	}

	return fileInfos, nil
}

// ReadFile reads a file from the WebDAV server
func (w *WebDAVClient) ReadFile(remotePath string) ([]byte, error) {
	if w.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	data, err := w.client.Read(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", remotePath, err)
	}

	return data, nil
}

// ReadFileStream returns a reader for streaming file content
func (w *WebDAVClient) ReadFileStream(remotePath string) (io.ReadCloser, error) {
	if w.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	reader, err := w.client.ReadStream(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file stream %s: %w", remotePath, err)
	}

	return reader, nil
}

// WriteFile writes data to a file on the WebDAV server
func (w *WebDAVClient) WriteFile(remotePath string, data []byte) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	// Create parent directories if they don't exist
	dir := path.Dir(remotePath)
	if dir != "/" && dir != "." {
		if err := w.MkdirAll(dir); err != nil {
			logger.Warn("Failed to create parent directory %s: %v", dir, err)
		}
	}

	err := w.client.Write(remotePath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to write file %s: %w", remotePath, err)
	}

	return nil
}

// DeleteFile deletes a file from the WebDAV server
func (w *WebDAVClient) DeleteFile(remotePath string) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	err := w.client.Remove(remotePath)
	if err != nil {
		return fmt.Errorf("failed to delete file %s: %w", remotePath, err)
	}

	return nil
}

// Mkdir creates a directory on the WebDAV server
func (w *WebDAVClient) Mkdir(remotePath string) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	err := w.client.Mkdir(remotePath, 0755)
	if err != nil {
		return fmt.Errorf("failed to create directory %s: %w", remotePath, err)
	}

	return nil
}

// MkdirAll creates a directory and all its parents on the WebDAV server
func (w *WebDAVClient) MkdirAll(remotePath string) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	// Split path into components
	parts := strings.Split(strings.Trim(remotePath, "/"), "/")
	currentPath := ""

	for _, part := range parts {
		if part == "" {
			continue
		}
		currentPath = currentPath + "/" + part

		// Check if directory exists
		exists, err := w.Exists(currentPath)
		if err != nil {
			return fmt.Errorf("failed to check if directory exists %s: %w", currentPath, err)
		}

		if !exists {
			err := w.Mkdir(currentPath)
			if err != nil {
				return fmt.Errorf("failed to create directory %s: %w", currentPath, err)
			}
		}
	}

	return nil
}

// Exists checks if a file or directory exists on the WebDAV server
func (w *WebDAVClient) Exists(remotePath string) (bool, error) {
	if w.apiKey == "" {
		return false, fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	// Try to stat the path to check if it exists
	_, err := w.client.Stat(remotePath)
	if err != nil {
		// If stat fails, the path doesn't exist
		return false, nil
	}

	return true, nil
}

// Stat returns file information
func (w *WebDAVClient) Stat(remotePath string) (*FileInfo, error) {
	if w.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	// Ensure path starts with /
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}

	file, err := w.client.Stat(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info %s: %w", remotePath, err)
	}

	return &FileInfo{
		Name:    file.Name(),
		Path:    remotePath,
		Size:    file.Size(),
		IsDir:   file.IsDir(),
		ModTime: file.ModTime(),
	}, nil
}

// CopyFile copies a file on the WebDAV server
func (w *WebDAVClient) CopyFile(srcPath, dstPath string) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure paths start with /
	if !strings.HasPrefix(srcPath, "/") {
		srcPath = "/" + srcPath
	}
	if !strings.HasPrefix(dstPath, "/") {
		dstPath = "/" + dstPath
	}

	err := w.client.Copy(srcPath, dstPath, false)
	if err != nil {
		return fmt.Errorf("failed to copy file from %s to %s: %w", srcPath, dstPath, err)
	}

	return nil
}

// MoveFile moves/renames a file on the WebDAV server
func (w *WebDAVClient) MoveFile(srcPath, dstPath string) error {
	if w.apiKey == "" {
		return fmt.Errorf("API key not set")
	}

	// Ensure paths start with /
	if !strings.HasPrefix(srcPath, "/") {
		srcPath = "/" + srcPath
	}
	if !strings.HasPrefix(dstPath, "/") {
		dstPath = "/" + dstPath
	}

	err := w.client.Rename(srcPath, dstPath, false)
	if err != nil {
		return fmt.Errorf("failed to move file from %s to %s: %w", srcPath, dstPath, err)
	}

	return nil
}

// GetFileSize returns the size of a file
func (w *WebDAVClient) GetFileSize(remotePath string) (int64, error) {
	stat, err := w.Stat(remotePath)
	if err != nil {
		return 0, err
	}
	return stat.Size, nil
}

// IsDirectory checks if the path is a directory
func (w *WebDAVClient) IsDirectory(remotePath string) (bool, error) {
	stat, err := w.Stat(remotePath)
	if err != nil {
		return false, err
	}
	return stat.IsDir, nil
}

// GetBaseURL returns the base WebDAV URL
func (w *WebDAVClient) GetBaseURL() string {
	return "https://webdav.debrid.it"
}
