package api

import (
	"crypto/md5"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"

	"cinesync/pkg/logger"
)

const (
	IMAGE_CACHE_DIR     = "cache/images"
	MAX_IMAGE_SIZE      = 2 * 1024 * 1024  // 2MB max per image (reduced from 10MB)
	MAX_CACHE_SIZE_MB   = 1024              // 1GB total cache limit
	MAX_CACHE_FILES     = 5000              // Maximum number of cached files
	CLEANUP_THRESHOLD   = 0.8               // Cleanup when 80% of limit is reached
	DEFAULT_IMAGE_SIZE  = "w342"            // Default size to cache
)

// Environment variable overrides
func getMaxCacheSizeMB() int {
	if envSize := os.Getenv("IMAGE_CACHE_SIZE_MB"); envSize != "" {
		if size, err := strconv.Atoi(envSize); err == nil && size > 0 {
			return size
		}
	}
	return MAX_CACHE_SIZE_MB
}

func getMaxCacheFiles() int {
	if envFiles := os.Getenv("IMAGE_CACHE_MAX_FILES"); envFiles != "" {
		if files, err := strconv.Atoi(envFiles); err == nil && files > 0 {
			return files
		}
	}
	return MAX_CACHE_FILES
}



func isImageCacheEnabled() bool {
	return os.Getenv("IMAGE_CACHE_ENABLED") != "false"
}

// windowsSafeRename performs a Windows-compatible atomic file rename
func windowsSafeRename(oldPath, newPath string) error {
	// On Windows, ensure target doesn't exist before rename
	if _, err := os.Stat(newPath); err == nil {
		if removeErr := os.Remove(newPath); removeErr != nil {
			return fmt.Errorf("failed to remove existing target: %w", removeErr)
		}
	}

	// Retry the rename operation
	var lastErr error
	for i := 0; i < 5; i++ {
		lastErr = os.Rename(oldPath, newPath)
		if lastErr == nil {
			return nil
		}

		// Wait progressively longer between retries
		time.Sleep(time.Millisecond * time.Duration(50*(i+1)))
	}

	return fmt.Errorf("rename failed after retries: %w", lastErr)
}

// ImageCacheService handles downloading and serving cached images
type ImageCacheService struct {
	cacheDir     string
	enabled      bool
	maxSizeMB    int
	maxFiles     int
	downloadMutex sync.Map
}

// NewImageCacheService creates a new image cache service
func NewImageCacheService(projectDir string) *ImageCacheService {
	cacheDir := filepath.Join(projectDir, IMAGE_CACHE_DIR)
	enabled := isImageCacheEnabled()

	if enabled {
		if err := os.MkdirAll(cacheDir, 0755); err != nil {
			logger.Warn("Failed to create image cache directory: %v", err)
			enabled = false
		} else {
			logger.Info("Image cache initialized in project folder: %s (max: %dMB, %d files)", cacheDir, getMaxCacheSizeMB(), getMaxCacheFiles())
		}
	} else {
		logger.Info("Image cache disabled via IMAGE_CACHE_ENABLED=false")
	}

	return &ImageCacheService{
		cacheDir:  cacheDir,
		enabled:   enabled,
		maxSizeMB: getMaxCacheSizeMB(),
		maxFiles:  getMaxCacheFiles(),
	}
}

// GetCachedImagePath returns the local path for a cached image at specific size
func (ics *ImageCacheService) GetCachedImagePath(posterPath string, size string) string {
	if posterPath == "" {
		return ""
	}

	// Create a unique filename based on poster path and size
	// This avoids duplicates while storing only the requested size
	hash := md5.Sum([]byte(posterPath + "_" + size))
	filename := fmt.Sprintf("%x.jpg", hash)
	return filepath.Join(ics.cacheDir, filename)
}

// DownloadAndCacheImage downloads an image from TMDB at the requested size and stores it locally
func (ics *ImageCacheService) DownloadAndCacheImage(posterPath string, size string) (string, error) {
	if !ics.enabled {
		return "", fmt.Errorf("image cache is disabled")
	}

	if posterPath == "" {
		return "", fmt.Errorf("empty poster path")
	}

	localPath := ics.GetCachedImagePath(posterPath, size)

	// Check if already cached (double-check after potential wait)
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil
	}

	// Use per-file mutex to prevent concurrent downloads of the same image
	cacheKey := fmt.Sprintf("%s_%s", posterPath, size)
	mutexInterface, _ := ics.downloadMutex.LoadOrStore(cacheKey, &sync.Mutex{})
	mutex := mutexInterface.(*sync.Mutex)

	mutex.Lock()
	defer func() {
		mutex.Unlock()
		ics.downloadMutex.Delete(cacheKey)
	}()

	// Double-check if file was created while waiting for lock
	if _, err := os.Stat(localPath); err == nil {
		return localPath, nil
	}

	// Check cache limits before downloading
	totalSize, fileCount, err := ics.GetCacheStats()
	if err == nil {
		maxSizeBytes := int64(ics.maxSizeMB) * 1024 * 1024
		if totalSize > maxSizeBytes || fileCount > ics.maxFiles {
			if cleanupErr := ics.CleanupCache(); cleanupErr != nil {
				logger.Warn("Cache cleanup failed: %v", cleanupErr)
			}
		}
	}

	// Download from TMDB at the requested size
	tmdbURL := fmt.Sprintf("https://image.tmdb.org/t/p/%s%s", size, posterPath)

	resp, err := http.Get(tmdbURL)
	if err != nil {
		return "", fmt.Errorf("failed to download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	// Create temporary file with unique name to avoid conflicts
	tempFile := fmt.Sprintf("%s.tmp.%d", localPath, time.Now().UnixNano())
	file, err := os.Create(tempFile)
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}

	// Copy with size limit
	_, err = io.CopyN(file, resp.Body, MAX_IMAGE_SIZE)
	if err != nil && err != io.EOF {
		file.Close()
		os.Remove(tempFile)
		return "", fmt.Errorf("failed to write image: %w", err)
	}

	// Close file before rename (Windows requirement)
	file.Close()

	// Final check for race condition
	if _, err := os.Stat(localPath); err == nil {
		os.Remove(tempFile)
		return localPath, nil
	}

	// Use Windows-safe rename with retries
	if err := windowsSafeRename(tempFile, localPath); err != nil {
		os.Remove(tempFile)
		return "", fmt.Errorf("failed to move image: %w", err)
	}
	return localPath, nil
}



// GetCacheStats returns current cache statistics
func (ics *ImageCacheService) GetCacheStats() (int64, int, error) {
	if !ics.enabled {
		return 0, 0, nil
	}

	var totalSize int64
	var fileCount int

	err := filepath.Walk(ics.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			totalSize += info.Size()
			fileCount++
		}
		return nil
	})

	return totalSize, fileCount, err
}

// CleanupCache removes old images if cache exceeds limits
func (ics *ImageCacheService) CleanupCache() error {
	if !ics.enabled {
		return nil
	}

	totalSize, fileCount, err := ics.GetCacheStats()
	if err != nil {
		return err
	}

	maxSizeBytes := int64(ics.maxSizeMB) * 1024 * 1024
	sizeThreshold := int64(float64(maxSizeBytes) * CLEANUP_THRESHOLD)
	fileThreshold := int(float64(ics.maxFiles) * CLEANUP_THRESHOLD)

	// Check if cleanup is needed
	if totalSize < sizeThreshold && fileCount < fileThreshold {
		return nil
	}

	logger.Info("Cache cleanup needed: %dMB/%dMB, %d/%d files",
		totalSize/(1024*1024), ics.maxSizeMB, fileCount, ics.maxFiles)

	// Get all files with their access times
	type fileInfo struct {
		path    string
		modTime time.Time
		size    int64
	}

	var files []fileInfo
	err = filepath.Walk(ics.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return err
		}
		files = append(files, fileInfo{
			path:    path,
			modTime: info.ModTime(),
			size:    info.Size(),
		})
		return nil
	})

	if err != nil {
		return err
	}

	// Sort by modification time (oldest first)
	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.Before(files[j].modTime)
	})

	// Remove oldest files until we're under threshold
	var removedSize int64
	var removedCount int

	for _, file := range files {
		if totalSize-removedSize < sizeThreshold && fileCount-removedCount < fileThreshold {
			break
		}

		// Windows-safe file removal with retry
		var removeErr error
		for i := 0; i < 3; i++ {
			removeErr = os.Remove(file.path)
			if removeErr == nil {
				removedSize += file.size
				removedCount++
				break
			}
			// Wait and retry for Windows file locking issues
			time.Sleep(time.Millisecond * 100)
		}

		if removeErr != nil {
			logger.Warn("Failed to remove cached image %s after retries: %v", file.path, removeErr)
		}
	}

	if removedCount > 0 {
		logger.Info("Cache cleanup completed: removed %d files (%dMB)",
			removedCount, removedSize/(1024*1024))
	}

	return nil
}

// ServeImage serves a cached image or downloads it if not cached
func (ics *ImageCacheService) ServeImage(w http.ResponseWriter, r *http.Request) {
	posterPath := r.URL.Query().Get("poster")
	size := r.URL.Query().Get("size")

	if !ics.enabled {
		if size == "" {
			size = DEFAULT_IMAGE_SIZE
		}
		if posterPath != "" {
			tmdbURL := fmt.Sprintf("https://image.tmdb.org/t/p/%s%s", size, posterPath)
			http.Redirect(w, r, tmdbURL, http.StatusTemporaryRedirect)
		} else {
			http.Error(w, "Missing poster parameter", http.StatusBadRequest)
		}
		return
	}

	if posterPath == "" {
		http.Error(w, "Missing poster parameter", http.StatusBadRequest)
		return
	}

	if size == "" {
		size = DEFAULT_IMAGE_SIZE
	}

	// Try to get cached image at requested size
	localPath := ics.GetCachedImagePath(posterPath, size)

	// Check if cached
	if _, err := os.Stat(localPath); err != nil {
		var downloadErr error
		localPath, downloadErr = ics.DownloadAndCacheImage(posterPath, size)
		if downloadErr != nil {
			logger.Warn("Failed to download image %s: %v", posterPath, downloadErr)
			tmdbURL := fmt.Sprintf("https://image.tmdb.org/t/p/%s%s", size, posterPath)
			http.Redirect(w, r, tmdbURL, http.StatusTemporaryRedirect)
			return
		}
	}

	// Serve the cached file
	file, err := os.Open(localPath)
	if err != nil {
		tmdbURL := fmt.Sprintf("https://image.tmdb.org/t/p/%s%s", size, posterPath)
		http.Redirect(w, r, tmdbURL, http.StatusTemporaryRedirect)
		return
	}
	defer file.Close()

	// Set appropriate headers
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")

	// Get file info for Last-Modified header
	if stat, err := file.Stat(); err == nil {
		w.Header().Set("Last-Modified", stat.ModTime().UTC().Format(http.TimeFormat))
	}

	// Serve the file
	http.ServeContent(w, r, "", time.Now(), file)
}

// PreloadImagesForTmdbData downloads common image sizes in background for TMDB data
func (ics *ImageCacheService) PreloadImagesForTmdbData(tmdbID int, mediaType string, posterPath string) {
	if posterPath == "" {
		return
	}

	// Preload only the most common size (w342) to save storage
	go func() {
		if _, err := ics.DownloadAndCacheImage(posterPath, "w342"); err != nil {
			logger.Warn("Failed to preload image %s: %v", posterPath, err)
		}
	}()
}

// CleanupOldImages removes cached images older than specified days
func (ics *ImageCacheService) CleanupOldImages(maxAgeDays int) error {
	cutoff := time.Now().AddDate(0, 0, -maxAgeDays)
	
	return filepath.Walk(ics.cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		
		if !info.IsDir() && info.ModTime().Before(cutoff) {
			logger.Info("Removing old cached image: %s", path)
			return os.Remove(path)
		}
		
		return nil
	})
}

// Global image cache service instance
var imageCacheService *ImageCacheService

// InitImageCache initializes the global image cache service
func InitImageCache(projectDir string) {
	imageCacheService = NewImageCacheService(projectDir)
}

// HandleImageCache serves cached images
func HandleImageCache(w http.ResponseWriter, r *http.Request) {
	if imageCacheService == nil {
		http.Error(w, "Image cache not initialized", http.StatusInternalServerError)
		return
	}

	imageCacheService.ServeImage(w, r)
}
