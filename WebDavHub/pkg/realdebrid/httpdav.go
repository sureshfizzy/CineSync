package realdebrid

import (
	"fmt"
	"io"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/studio-b12/gowebdav"
)

// HttpDavClientPool manages a pool of HTTP DAV clients for better resource utilization
type HttpDavClientPool struct {
	pool    sync.Pool
	userID  string
	password string
	baseURL string
}

// NewHttpDavClientPool creates a new client pool
func NewHttpDavClientPool(userID, password, baseURL string) *HttpDavClientPool {
	if baseURL == "" {
		baseURL = "https://dav.real-debrid.com/"
	}
	
	pool := &HttpDavClientPool{
		userID:  userID,
		password: password,
		baseURL: baseURL,
	}
	
	pool.pool.New = func() interface{} {
		client := gowebdav.NewClient(baseURL, userID, password)
		client.SetTimeout(15 * time.Second)
		return client
	}
	
	return pool
}

// Get retrieves a client from the pool
func (p *HttpDavClientPool) Get() *gowebdav.Client {
	return p.pool.Get().(*gowebdav.Client)
}

// Put returns a client to the pool
func (p *HttpDavClientPool) Put(client *gowebdav.Client) {
	p.pool.Put(client)
}

// HttpDavClient wraps the gowebdav client for Real-Debrid HTTP DAV
type HttpDavClient struct {
	client   *gowebdav.Client
	pool     *HttpDavClientPool
	userID   string
	password string
	baseURL  string
}

// normalizePath ensures the path starts with / and is cleaned
func normalizePath(remotePath string) string {
	if !strings.HasPrefix(remotePath, "/") {
		remotePath = "/" + remotePath
	}
	return path.Clean(remotePath)
}

// validateCredentials checks if credentials are set
func (h *HttpDavClient) validateCredentials() error {
	if h.userID == "" || h.password == "" {
		return fmt.Errorf("credentials not set")
	}
	return nil
}

// HttpDavFileInfo represents file information from HTTP DAV
type HttpDavFileInfo struct {
	Name    string    `json:"name"`
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	IsDir   bool      `json:"isDir"`
	ModTime time.Time `json:"modTime"`
}
func NewHttpDavClient(userID, password, baseURL string) *HttpDavClient {
	if baseURL == "" {
		baseURL = "https://dav.real-debrid.com/"
	}
	
	client := gowebdav.NewClient(baseURL, userID, password)
	client.SetTimeout(15 * time.Second)
	
	return &HttpDavClient{
		client:   client,
		userID:   userID,
		password: password,
		baseURL:  baseURL,
	}
}

// SetCredentials updates the credentials and reinitializes the client
func (h *HttpDavClient) SetCredentials(userID, password, baseURL string) {
	if baseURL == "" {
		baseURL = "https://dav.real-debrid.com/"
	}
	
	h.userID = userID
	h.password = password
	h.baseURL = baseURL
	h.client = gowebdav.NewClient(baseURL, userID, password)
	h.client.SetTimeout(30 * time.Second)
}

// TestConnection tests the HTTP DAV connection
func (h *HttpDavClient) TestConnection() error {
	if err := h.validateCredentials(); err != nil {
		return err
	}

	// Try to list the root directory to test connection
	_, err := h.client.ReadDir("/")
	if err != nil {
		return fmt.Errorf("failed to connect to Real-Debrid HTTP DAV: %w", err)
	}

	return nil
}

// ListDirectory lists files and directories in the specified path
func (h *HttpDavClient) ListDirectory(remotePath string) ([]HttpDavFileInfo, error) {
	if err := h.validateCredentials(); err != nil {
		return nil, err
	}

	remotePath = normalizePath(remotePath)
	remotePath = strings.TrimSuffix(remotePath, "/")

	files, err := h.client.ReadDir(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory %s: %w", remotePath, err)
	}

	// Pre-allocate slice for better performance
	fileInfos := make([]HttpDavFileInfo, 0, len(files))
	for _, file := range files {
		filePath := path.Join(remotePath, file.Name())
		fileInfos = append(fileInfos, HttpDavFileInfo{
			Name:    file.Name(),
			Path:    filePath,
			Size:    file.Size(),
			IsDir:   file.IsDir(),
			ModTime: file.ModTime(),
		})
	}

	return fileInfos, nil
}

// ReadFile reads a file from the HTTP DAV server
func (h *HttpDavClient) ReadFile(remotePath string) ([]byte, error) {
	if err := h.validateCredentials(); err != nil {
		return nil, err
	}

	remotePath = normalizePath(remotePath)

	data, err := h.client.Read(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", remotePath, err)
	}

	return data, nil
}

// ReadFileStream returns a reader for streaming file content
func (h *HttpDavClient) ReadFileStream(remotePath string) (io.ReadCloser, error) {
	if err := h.validateCredentials(); err != nil {
		return nil, err
	}

	remotePath = normalizePath(remotePath)

	// Check file size first to detect 0KB files
	fileInfo, err := h.Stat(remotePath)
	if err == nil && fileInfo != nil && !fileInfo.IsDir && fileInfo.Size == 0 {
		return nil, fmt.Errorf("file has 0 bytes (removed from Real-Debrid): %s", remotePath)
	}

	reader, err := h.client.ReadStream(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file stream %s: %w", remotePath, err)
	}

	return reader, nil
}

// Exists checks if a file or directory exists on the HTTP DAV server
func (h *HttpDavClient) Exists(remotePath string) (bool, error) {
	if err := h.validateCredentials(); err != nil {
		return false, err
	}

	remotePath = normalizePath(remotePath)

	_, err := h.client.Stat(remotePath)
	if err != nil {
		return false, nil
	}

	return true, nil
}

// Stat returns file information
func (h *HttpDavClient) Stat(remotePath string) (*HttpDavFileInfo, error) {
	if err := h.validateCredentials(); err != nil {
		return nil, err
	}

	remotePath = normalizePath(remotePath)

	file, err := h.client.Stat(remotePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info %s: %w", remotePath, err)
	}

	return &HttpDavFileInfo{
		Name:    file.Name(),
		Path:    remotePath,
		Size:    file.Size(),
		IsDir:   file.IsDir(),
		ModTime: file.ModTime(),
	}, nil
}

// GetFileSize returns the size of a file
func (h *HttpDavClient) GetFileSize(remotePath string) (int64, error) {
	stat, err := h.Stat(remotePath)
	if err != nil {
		return 0, err
	}
	return stat.Size, nil
}

// IsDirectory checks if the path is a directory
func (h *HttpDavClient) IsDirectory(remotePath string) (bool, error) {
	stat, err := h.Stat(remotePath)
	if err != nil {
		return false, err
	}
	return stat.IsDir, nil
}

// GetBaseURL returns the base HTTP DAV URL
func (h *HttpDavClient) GetBaseURL() string {
	return h.baseURL
}

// GetCredentials returns the current credentials
func (h *HttpDavClient) GetCredentials() (userID, password string) {
	return h.userID, h.password
}

// IsConfigured returns whether the client is properly configured
func (h *HttpDavClient) IsConfigured() bool {
	return h.userID != "" && h.password != "" && h.baseURL != ""
}