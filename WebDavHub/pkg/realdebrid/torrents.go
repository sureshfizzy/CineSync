package realdebrid

import (
	"fmt"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/db"
	"cinesync/pkg/logger"
	cmap "github.com/orcaman/concurrent-map/v2"
	"golang.org/x/sync/singleflight"
)

const (
	ALL_TORRENTS = "__all__"
)

// SanitizeFilename sanitizes a filename for use in paths
func SanitizeFilename(name string) string {
	r := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return r.Replace(name)
}

// FailedFileEntry represents a failed file unrestriction
type FailedFileEntry struct {
	Error     error
	Timestamp time.Time
}

// TorrentManager manages cached torrent listings
type TorrentManager struct {
	client        *Client
	torrentCache  map[string]*TorrentInfo
	torrentList   []TorrentItem
	cacheMutex    sync.RWMutex
	lastCacheTime time.Time
	DirectoryMap cmap.ConcurrentMap[string, cmap.ConcurrentMap[string, *TorrentItem]]
	downloadLinkCache map[string]*DownloadLink
	downloadCacheMutex sync.RWMutex
	failedFileCache map[string]*FailedFileEntry
	failedFileMutex sync.RWMutex
	downloadSG singleflight.Group
	
	// HTTP DAV
	httpDavTorrentsCache []HttpDavFileInfo
	httpDavLinksCache    []HttpDavFileInfo
	httpDavCacheMutex    sync.RWMutex
	httpDavLastCacheTime time.Time
}

var (
	torrentManager *TorrentManager
	torrentMutex   sync.RWMutex
)

// GetTorrentManager returns the singleton torrent manager
func GetTorrentManager(apiKey string) *TorrentManager {
	torrentMutex.RLock()
	if torrentManager != nil && torrentManager.client.apiKey == apiKey {
		torrentMutex.RUnlock()
		return torrentManager
	}
	torrentMutex.RUnlock()

	torrentMutex.Lock()
	defer torrentMutex.Unlock()

	if torrentManager != nil && torrentManager.client.apiKey == apiKey {
		return torrentManager
	}

	torrentManager = &TorrentManager{
		client:        NewClient(apiKey),
		torrentCache:  make(map[string]*TorrentInfo),
		torrentList:   []TorrentItem{},
		DirectoryMap:  cmap.New[cmap.ConcurrentMap[string, *TorrentItem]](),
		downloadLinkCache: make(map[string]*DownloadLink),
		failedFileCache: make(map[string]*FailedFileEntry),
	}
	
	// Initialize special directories
	torrentManager.initializeDirectoryMaps()

	return torrentManager
}

// initializeDirectoryMaps initializes the special directories
func (tm *TorrentManager) initializeDirectoryMaps() {
	tm.DirectoryMap.Set(ALL_TORRENTS, cmap.New[*TorrentItem]())
}

// SetPrefetchedTorrents seeds the torrent manager with prefetched data
func (tm *TorrentManager) SetPrefetchedTorrents(torrents []TorrentItem) {
	tm.cacheMutex.Lock()
	defer tm.cacheMutex.Unlock()

	tm.torrentList = torrents
	tm.lastCacheTime = time.Now()

	// Update directory maps
	tm.updateDirectoryMaps(torrents)

	logger.Info("[Torrents] Initialized with prefetched data: %d torrents loaded", len(torrents))
	
	// Trigger pending mount
	triggerPendingMount()
}


// updateDirectoryMaps updates the directory maps with torrents
func (tm *TorrentManager) updateDirectoryMaps(torrents []TorrentItem) {
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		logger.Error("[Torrents] ALL_TORRENTS directory not found")
		return
	}

	logger.Info("[Torrents] Updating directory maps with %d torrents", len(torrents))

	// Clear existing torrents
	allTorrents.Clear()

	for i := range torrents {
		torrent := &torrents[i]
		accessKey := SanitizeFilename(torrent.Filename)
		allTorrents.Set(accessKey, torrent)
		individualDir := cmap.New[*TorrentItem]()
		individualDir.Set(accessKey, torrent)
		tm.DirectoryMap.Set(accessKey, individualDir)
	}
}


// GetAllTorrentsFromDirectory returns all torrents from a specific directory
func (tm *TorrentManager) GetAllTorrentsFromDirectory(directory string) []TorrentItem {
	dirTorrents, ok := tm.DirectoryMap.Get(directory)
	if !ok {
		return []TorrentItem{}
	}

	// Pre-allocate slice with capacity for better performance
	count := dirTorrents.Count()
	result := make([]TorrentItem, 0, count)
	
	for item := range dirTorrents.IterBuffered() {
		result = append(result, *item.Val)
	}
	return result
}


// GetTorrentInfo gets detailed torrent information
func (tm *TorrentManager) GetTorrentInfo(torrentID string) (*TorrentInfo, error) {
	tm.cacheMutex.RLock()
	if info, ok := tm.torrentCache[torrentID]; ok {
		tm.cacheMutex.RUnlock()
		return info, nil
	}
	tm.cacheMutex.RUnlock()

	info, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	tm.cacheMutex.Lock()
	tm.torrentCache[torrentID] = info
	tm.cacheMutex.Unlock()

	return info, nil
}


// FindTorrentByName finds a torrent by sanitized name
func (tm *TorrentManager) FindTorrentByName(name string) (string, error) {
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		return "", fmt.Errorf("__all__ directory not found")
	}
	torrent, ok := allTorrents.Get(name)
	if !ok {
		return "", fmt.Errorf("torrent not found: %s", name)
	}
	
	return torrent.ID, nil
}

// ListTorrentFiles lists files in a torrent
func (tm *TorrentManager) ListTorrentFiles(torrentID string, subPath string) ([]FileNode, error) {
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	var selectedFiles []TorrentFile
	for _, file := range info.Files {
		if file.Selected == 1 {
			selectedFiles = append(selectedFiles, file)
		}
	}

	// Flatten all files to a single level
	// Use only the filename, ignoring directory structure
	fileMap := make(map[string]TorrentFile)
	duplicateCount := make(map[string]int)

	for _, file := range selectedFiles {
		cleanPath := strings.Trim(file.Path, "/")
		fileName := path.Base(cleanPath)

		// Handle duplicate filenames by adding a counter
		if existingFile, exists := fileMap[fileName]; exists {
			duplicateCount[fileName]++
			ext := path.Ext(fileName)
			nameWithoutExt := strings.TrimSuffix(fileName, ext)
			fileName = fmt.Sprintf("%s (%d)%s", nameWithoutExt, existingFile.ID, ext)
		}

		fileMap[fileName] = file
	}

	var nodes []FileNode
	for fileName, file := range fileMap {
		nodes = append(nodes, FileNode{
			Name:      fileName,
			IsDir:     false,
			Size:      file.Bytes,
			TorrentID: torrentID,
			FileID:    file.ID,
		})
	}

	return nodes, nil
}

// GetFileDownloadURL gets the download URL for a file with caching
func (tm *TorrentManager) GetFileDownloadURL(torrentID, filePath string) (string, int64, error) {
	// Create cache key
	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)

	tm.failedFileMutex.RLock()
	if failedEntry, exists := tm.failedFileCache[cacheKey]; exists {
		if time.Since(failedEntry.Timestamp) < 24*time.Hour {
			tm.failedFileMutex.RUnlock()
			return "", 0, failedEntry.Error
		}
	}
	tm.failedFileMutex.RUnlock()

	// Check if file is marked as removed in the database
	debridDB := db.GetDebridDB()
	if isRemoved, removedRecord, err := debridDB.IsFileRemoved(torrentID, filePath); err != nil {
		logger.Error("[Torrents] Failed to check removed files database: %v", err)
		return "", 0, fmt.Errorf("database error: %w", err)
	} else if isRemoved {
		logger.Info("[Torrents] File %s is marked as REMOVED in database (detected at %v)", 
			filePath, removedRecord.DetectedAt)
		removedErr := fmt.Errorf("file has been removed from Real-Debrid (detected: %v)", removedRecord.DetectedAt)
		tm.failedFileMutex.Lock()
		tm.failedFileCache[cacheKey] = &FailedFileEntry{
			Error:     removedErr,
			Timestamp: time.Now(),
		}
		tm.failedFileMutex.Unlock()
		
		return "", 0, removedErr
	}
	
	// Use singleflight to deduplicate concurrent requests
	v, err, _ := tm.downloadSG.Do(cacheKey, func() (interface{}, error) {
		// Check cache first
		tm.downloadCacheMutex.RLock()
		if cached, exists := tm.downloadLinkCache[cacheKey]; exists {
			tm.downloadCacheMutex.RUnlock()
			return []interface{}{cached.Download, cached.Filesize}, nil
		}
		tm.downloadCacheMutex.RUnlock()

		info, err := tm.GetTorrentInfo(torrentID)
		if err != nil {
			return nil, err
		}

		// Find the file
		var targetFile *TorrentFile
		for i, file := range info.Files {
			if file.Selected == 1 {
				cleanPath := strings.Trim(file.Path, "/")
				fileName := path.Base(cleanPath)
				if fileName == filePath {
					targetFile = &info.Files[i]
					break
				}
			}
		}

		if targetFile == nil {
			return nil, fmt.Errorf("file not found: %s", filePath)
		}

		if len(info.Links) == 0 {
			logger.Warn("[Torrents] No links available for torrent %s", torrentID)
			return nil, fmt.Errorf("no links available")
		}

		// Use the link corresponding to the file ID
		var downloadLink string
		if targetFile.ID-1 < len(info.Links) {
			downloadLink = info.Links[targetFile.ID-1]
		} else {
			downloadLink = info.Links[0]
		}

		if downloadLink == "" {
			logger.Warn("[Torrents] Empty download link for torrent %s, file %s", torrentID, filePath)
			return nil, fmt.Errorf("empty download link")
		}

		logger.Debug("[Torrents] Attempting to unrestrict link for: %s", filePath)
		
		// Unrestrict the link
		unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
		if err != nil {
			logger.Error("[Torrents] Failed to unrestrict link for %s: %v", filePath, err)

			webdavVerified, webdavErr := tm.verifyFileViaWebDAV(torrentID, filePath, targetFile)
			if webdavVerified {
				logger.Info("[Torrents] File %s verified via HTTP WebDAV despite unrestrict failure", filePath)
			} else {
				logger.Warn("[Torrents] File %s also not accessible via HTTP WebDAV: %v", filePath, webdavErr)
			}

			wrappedErr := fmt.Errorf("failed to unrestrict link: %w", err)
			tm.failedFileMutex.Lock()
			tm.failedFileCache[cacheKey] = &FailedFileEntry{
				Error:     wrappedErr,
				Timestamp: time.Now(),
			}
			tm.failedFileMutex.Unlock()

			return nil, wrappedErr
		}

		if unrestrictedLink.Download == "" {
			logger.Warn("[Torrents] Unrestrict returned empty download URL")
			emptyErr := fmt.Errorf("unrestrict returned empty download URL")

			// Cache this error too
			tm.failedFileMutex.Lock()
			tm.failedFileCache[cacheKey] = &FailedFileEntry{
				Error:     emptyErr,
				Timestamp: time.Now(),
			}
			tm.failedFileMutex.Unlock()

			return nil, emptyErr
		}

		logger.Debug("[Torrents] Successfully unrestricted link for: %s", filePath)
		
		// Clear any cached failures for this file since it succeeded
		tm.failedFileMutex.Lock()
		delete(tm.failedFileCache, cacheKey)
		tm.failedFileMutex.Unlock()

		// Cache the result
		tm.downloadCacheMutex.Lock()
		tm.downloadLinkCache[cacheKey] = unrestrictedLink
		tm.downloadCacheMutex.Unlock()
		
		return []interface{}{unrestrictedLink.Download, targetFile.Bytes}, nil
	})

	if err != nil {
		return "", 0, err
	}

	result := v.([]interface{})
	return result[0].(string), result[1].(int64), nil
}

// FileNode represents a file or directory node
type FileNode struct {
	Name      string
	IsDir     bool
	Size      int64
	TorrentID string
	FileID    int
}

// RefreshTorrent refreshes torrent information from Real-Debrid API
func (tm *TorrentManager) RefreshTorrent(torrentID string) error {
	logger.Debug("[Torrents] Refreshing torrent %s", torrentID)
	
	// Clear cached info for this torrent
	tm.cacheMutex.Lock()
	delete(tm.torrentCache, torrentID)
	tm.cacheMutex.Unlock()
	
	// Fetch fresh torrent info
	info, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		return fmt.Errorf("failed to refresh torrent %s: %w", torrentID, err)
	}
	
	// Update cache with fresh data
	tm.cacheMutex.Lock()
	tm.torrentCache[torrentID] = info
	tm.cacheMutex.Unlock()
	
	logger.Debug("[Torrents] Successfully refreshed torrent %s", torrentID)
	return nil
}

// PrefetchHttpDavData prefetches and aggregates HTTP DAV directory data
func (tm *TorrentManager) PrefetchHttpDavData() error {
	configManager := GetConfigManager()
	config := configManager.GetConfig()
	
	if !config.HttpDavSettings.Enabled || config.HttpDavSettings.UserID == "" || config.HttpDavSettings.Password == "" {
		return nil
	}
	
	httpDavClient := NewHttpDavClient(
		config.HttpDavSettings.UserID,
		config.HttpDavSettings.Password,
		"https://dav.real-debrid.com/",
	)
	
	// Prefetch torrents with pagination aggregation
	torrentsFiles, err := tm.aggregateHttpDavTorrents(httpDavClient)
	if err != nil {
		return err
	}
	
	// Prefetch links
	linksFiles, err := httpDavClient.ListDirectory("/links")
	if err != nil {
		return err
	}
	
	// Filter out pagination directories from links
	filteredLinks := make([]HttpDavFileInfo, 0, len(linksFiles))
	for _, file := range linksFiles {
		if !strings.HasPrefix(file.Name, "_More_") {
			filteredLinks = append(filteredLinks, file)
		}
	}
	
	// Store in cache
	tm.httpDavCacheMutex.Lock()
	tm.httpDavTorrentsCache = torrentsFiles
	tm.httpDavLinksCache = filteredLinks
	tm.httpDavLastCacheTime = time.Now()
	tm.httpDavCacheMutex.Unlock()
	
	logger.Info("[HTTP DAV] Prefetch completed: %d torrents, %d links", len(torrentsFiles), len(filteredLinks))
	return nil
}

// aggregateHttpDavTorrents aggregates all paginated torrent directories
func (tm *TorrentManager) aggregateHttpDavTorrents(httpDavClient *HttpDavClient) ([]HttpDavFileInfo, error) {
	files, err := httpDavClient.ListDirectory("/torrents")
	if err != nil {
		return nil, err
	}
	
	// Pre-allocate slices with estimated capacity
	contentFiles := make([]HttpDavFileInfo, 0, len(files)*4)
	paginationDirs := make([]HttpDavFileInfo, 0, 20)
	
	// Separate content files from pagination directories
	for _, file := range files {
		if strings.HasPrefix(file.Name, "_More_") {
			paginationDirs = append(paginationDirs, file)
		} else {
			contentFiles = append(contentFiles, file)
		}
	}
	
	// Process pagination directories concurrently with worker pool pattern
	type pageResult struct {
		files []HttpDavFileInfo
		err   error
	}

	const maxWorkers = 3
	results := make(chan pageResult, len(paginationDirs))
	semaphore := make(chan struct{}, maxWorkers)
	
	for _, pageDir := range paginationDirs {
		go func(dir HttpDavFileInfo) {
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			pagePath := path.Join("/torrents", dir.Name)
			pageFiles, err := httpDavClient.ListDirectory(pagePath)
			if err != nil {
				results <- pageResult{nil, err}
				return
			}
			
			// Pre-allocate and filter efficiently
			validFiles := make([]HttpDavFileInfo, 0, len(pageFiles))
			for _, pageFile := range pageFiles {
				if !strings.HasPrefix(pageFile.Name, "_More_") {
					pageFile.Path = path.Join("/torrents", pageFile.Name)
					validFiles = append(validFiles, pageFile)
				}
			}
			
			results <- pageResult{validFiles, nil}
		}(pageDir)
	}
	
	// Collect results
	for i := 0; i < len(paginationDirs); i++ {
		result := <-results
		if result.err != nil {
			logger.Warn("[HTTP DAV] Failed to read pagination directory: %v", result.err)
			continue
		}
		contentFiles = append(contentFiles, result.files...)
	}
	
	return contentFiles, nil
}

// GetHttpDavTorrents returns cached HTTP DAV torrents
func (tm *TorrentManager) GetHttpDavTorrents() []HttpDavFileInfo {
	tm.httpDavCacheMutex.RLock()
	defer tm.httpDavCacheMutex.RUnlock()
	result := make([]HttpDavFileInfo, len(tm.httpDavTorrentsCache))
	copy(result, tm.httpDavTorrentsCache)
	return result
}

// GetHttpDavLinks returns cached HTTP DAV links
func (tm *TorrentManager) GetHttpDavLinks() []HttpDavFileInfo {
	tm.httpDavCacheMutex.RLock()
	defer tm.httpDavCacheMutex.RUnlock()
	result := make([]HttpDavFileInfo, len(tm.httpDavLinksCache))
	copy(result, tm.httpDavLinksCache)
	return result
}

// verifyFileViaWebDAV attempts to verify if a file exists via HTTP WebDAV endpoint
func (tm *TorrentManager) verifyFileViaWebDAV(torrentID, filePath string, targetFile *TorrentFile) (bool, error) {
	configManager := GetConfigManager()
	config := configManager.GetConfig()

	if !config.HttpDavSettings.Enabled || config.HttpDavSettings.UserID == "" || config.HttpDavSettings.Password == "" {
		return false, fmt.Errorf("HTTP DAV not configured")
	}

	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		logger.Error("[WebDAV Verify] Failed to get torrent info for %s: %v", torrentID, err)
		return false, fmt.Errorf("failed to get torrent info: %w", err)
	}

	sanitizedTorrentName := SanitizeFilename(info.Filename)
	exactPath := fmt.Sprintf("/torrents/%s/%s", sanitizedTorrentName, filePath)

	httpClient := &http.Client{Timeout: 15 * time.Second}
	
	// Make HEAD request to check if file exists without downloading content
	apiURL := fmt.Sprintf("http://localhost:8082/api/realdebrid/httpdav%s", exactPath)
	req, err := http.NewRequest("HEAD", apiURL, nil)
	if err != nil {
		logger.Error("[WebDAV Verify] Failed to create request for %s: %v", apiURL, err)
		return false, fmt.Errorf("failed to create request: %w", err)
	}
	
	resp, err := httpClient.Do(req)
	if err != nil {
		logger.Error("[WebDAV Verify] Error making HEAD request to %s: %v", apiURL, err)
		return false, fmt.Errorf("error making request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == 404 {
		logger.Error("[WebDAV Verify] File not accessible via HTTP WebDAV - marking as REMOVED from Real-Debrid")
		tm.markFileAsRemoved(torrentID, filePath, targetFile, info)
		
		return false, fmt.Errorf("file not found at exact WebDAV path")
	}
	
	if resp.StatusCode != 200 {
		logger.Error("[WebDAV Verify] Unexpected HTTP status %d for path: %s", resp.StatusCode, exactPath)
		return false, fmt.Errorf("unexpected HTTP status: %d", resp.StatusCode)
	}

	contentLength := resp.Header.Get("Content-Length")
	lastModified := resp.Header.Get("Last-Modified")

	if contentLength != "" {
		if size, parseErr := strconv.ParseInt(contentLength, 10, 64); parseErr == nil {
			if size == 0 {
				logger.Error("[WebDAV Verify]File has 0 bytes - marking as REMOVED from Real-Debrid")
				tm.markFileAsRemoved(torrentID, filePath, targetFile, info)
				
				return false, fmt.Errorf("file has been removed from Real-Debrid (0 bytes)")
			}

			if targetFile != nil && targetFile.Bytes > 0 {
				if size != targetFile.Bytes {
					if size == 0 {
						logger.Error("[WebDAV Verify] File has 0 bytes - marking as REMOVED from Real-Debrid")
						tm.markFileAsRemoved(torrentID, filePath, targetFile, info)
						return false, fmt.Errorf("file has been removed from Real-Debrid (0 bytes)")
					}
				}
			}
		}
	}
	
	return true, nil
}

// markFileAsRemoved tracks a file that has been removed from Real-Debrid
func (tm *TorrentManager) markFileAsRemoved(torrentID, filePath string, targetFile *TorrentFile, torrentInfo *TorrentInfo) {
	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)
	
	originalSize := int64(0)
	if targetFile != nil {
		originalSize = targetFile.Bytes
	}
	
	torrentName := torrentID
	torrentHash := ""
	if torrentInfo != nil {
		torrentName = torrentInfo.Filename
		torrentHash = torrentInfo.Hash
	}
	
	// Store in database with torrent hash
	debridDB := db.GetDebridDB()
	if err := debridDB.AddRemovedFile(torrentID, torrentHash, torrentName, filePath, originalSize, true); err != nil {
		logger.Error("[Removed Files] Failed to store removed file in database: %v", err)
	} else {
		logger.Error("[Removed Files] File marked as REMOVED in database: %s from torrent '%s' (Original size: %d bytes)", 
			filePath, torrentName, originalSize)
	}

	tm.downloadCacheMutex.Lock()
	delete(tm.downloadLinkCache, cacheKey)
	tm.downloadCacheMutex.Unlock()

	removedErr := fmt.Errorf("file has been removed from Real-Debrid")
	tm.failedFileMutex.Lock()
	tm.failedFileCache[cacheKey] = &FailedFileEntry{
		Error:     removedErr,
		Timestamp: time.Now(),
	}
	tm.failedFileMutex.Unlock()
}

// IsFileRemoved checks if a file has been marked as removed in the database
func (tm *TorrentManager) IsFileRemoved(torrentID, filePath string) (bool, *db.RemovedFileRecord) {
	debridDB := db.GetDebridDB()
	
	isRemoved, record, err := debridDB.IsFileRemoved(torrentID, filePath)
	if err != nil {
		logger.Error("[Removed Files] Error checking if file is removed: %v", err)
		return false, nil
	}
	
	return isRemoved, record
}

// GetRemovedFiles returns all files that have been marked as removed from the database
func (tm *TorrentManager) GetRemovedFiles() ([]db.RemovedFileRecord, error) {
	debridDB := db.GetDebridDB()
	return debridDB.GetAllRemovedFiles()
}

// ClearRemovedFileEntry removes a specific file from the removed files database
func (tm *TorrentManager) ClearRemovedFileEntry(torrentID, filePath string) error {
	debridDB := db.GetDebridDB()
	
	if err := debridDB.RemoveFileRecord(torrentID, filePath); err != nil {
		logger.Error("[Removed Files] Failed to clear removed file entry: %v", err)
		return err
	}
	return nil
}

// GetRemovedFilesCount returns the number of files marked as removed in the database
func (tm *TorrentManager) GetRemovedFilesCount() int {
	debridDB := db.GetDebridDB()
	
	count, err := debridDB.GetRemovedFilesCount()
	if err != nil {
		logger.Error("[Removed Files] Error getting removed files count: %v", err)
		return 0
	}
	
	return count
}

// CleanupOldRemovedFiles removes removed file records older than the specified duration
func (tm *TorrentManager) CleanupOldRemovedFiles(olderThan time.Duration) (int, error) {
	debridDB := db.GetDebridDB()
	return debridDB.CleanupOldRecords(olderThan)
}

// GetRemovedFilesStats returns database statistics for removed files
func (tm *TorrentManager) GetRemovedFilesStats() (map[string]interface{}, error) {
	debridDB := db.GetDebridDB()
	return debridDB.GetDatabaseStats()
}

// ExtractTorrentHashFromMagnet extracts the torrent hash from a magnet link
func ExtractTorrentHashFromMagnet(magnetLink string) string {
	if !strings.HasPrefix(magnetLink, "magnet:") {
		return ""
	}

	xtStart := strings.Index(magnetLink, "xt=urn:btih:")
	if xtStart == -1 {
		return ""
	}

	hashStart := xtStart + 12
	hashEnd := strings.IndexAny(magnetLink[hashStart:], "&")
	
	if hashEnd == -1 {
		return strings.ToLower(magnetLink[hashStart:])
	}
	
	return strings.ToLower(magnetLink[hashStart : hashStart+hashEnd])
}

// CheckFileRemovedByHash checks if a file is marked as removed using torrent hash
func (tm *TorrentManager) CheckFileRemovedByHash(magnetLink, filePath string) (bool, *db.RemovedFileRecord) {
	torrentHash := ExtractTorrentHashFromMagnet(magnetLink)
	if torrentHash == "" {
		return false, nil
	}
	
	debridDB := db.GetDebridDB()
	isRemoved, record, err := debridDB.IsFileRemovedByHash(torrentHash, filePath)
	if err != nil {
		logger.Error("[Removed Files] Error checking if file is removed by hash: %v", err)
		return false, nil
	}
	
	return isRemoved, record
}