package realdebrid

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "path"
    "path/filepath"
    "strings"
    "sync"
    "sync/atomic"
    "time"

    "cinesync/pkg/logger"
    "golang.org/x/sync/singleflight"
)

const (
	ALL_TORRENTS = "__all__"
	// Refresh intervals
	DEFAULT_REFRESH_INTERVAL = 15 * time.Second
	CHECKSUM_TIMEOUT = 10 * time.Second
)

// LibraryState represents the current state of the torrent library for change detection
type LibraryState struct {
	TotalCount         int       `json:"totalCount"`
	FirstTorrentID     string    `json:"firstTorrentId"`
	FirstTorrentName   string    `json:"firstTorrentName"`
	LastUpdated        time.Time `json:"lastUpdated"`
}

// Eq compares two library states for equality
func (ls *LibraryState) Eq(other *LibraryState) bool {
	if other == nil {
		return false
	}
	
	if ls.TotalCount != other.TotalCount {
		return false
	}
	
	if ls.FirstTorrentID != other.FirstTorrentID {
		return false
	}
	
	return true
}

// truncateFilename truncates long filenames
func truncateFilename(filename string) string {
	if len(filename) > 80 {
		return filename[:77] + "..."
	}
	return filename
}

// SanitizeFilename sanitizes a filename for use in paths
func SanitizeFilename(name string) string {
	r := strings.NewReplacer("/", "_", "\\", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	return r.Replace(name)
}

// GetDirectoryName returns the directory name for a torrent
func GetDirectoryName(filename string) string {
	configManager := GetConfigManager()
	config := configManager.GetConfig()
	
	dirName := filename
	if !config.RcloneSettings.RetainFolderExtension {
		lastDotIndex := strings.LastIndex(dirName, ".")
		if lastDotIndex > 0 && lastDotIndex < len(dirName)-1 {
			ext := strings.ToLower(dirName[lastDotIndex+1:])
			knownExtensions := map[string]bool{
				// Video formats
				"mkv": true, "mp4": true, "avi": true, "mov": true, "wmv": true, "flv": true, "webm": true,
				"m4v": true, "mpg": true, "mpeg": true, "m2ts": true, "ts": true, "vob": true,
				// Audio formats
				"mp3": true, "flac": true, "wav": true, "aac": true, "m4a": true, "ogg": true, "wma": true,
				"opus": true, "ape": true, "alac": true, "aiff": true, "ac3": true, "dts": true,
				// Book/Document formats
				"epub": true, "mobi": true, "azw": true, "azw3": true, "pdf": true, "djvu": true, "cbr": true, "cbz": true,
				// Archive formats
				"zip": true, "rar": true, "7z": true, "tar": true, "gz": true, "bz2": true, "iso": true,
				// Other
				"nfo": true, "torrent": true, "txt": true,
			}

			if knownExtensions[ext] {
				dirName = dirName[:lastDotIndex]
			}
		}
	}
	
	return SanitizeFilename(dirName)
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
	downloadLinkCache map[string]*DownloadLink
	downloadCacheMutex sync.RWMutex
	failedFileCache map[string]*FailedFileEntry
	failedFileMutex sync.RWMutex
	downloadSG singleflight.Group
	currentState      atomic.Pointer[LibraryState]
	refreshTicker     *time.Ticker
	refreshCancel     context.CancelFunc
	refreshInterval   time.Duration
	initialized       chan struct{}
	isRunning         atomic.Bool
	prefetchCompleted atomic.Bool
	
	// HTTP DAV
	httpDavTorrentsCache []HttpDavFileInfo
	httpDavLinksCache    []HttpDavFileInfo
	httpDavCacheMutex    sync.RWMutex
	httpDavLastCacheTime time.Time
    store *TorrentStore
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
		downloadLinkCache: make(map[string]*DownloadLink),
		failedFileCache: make(map[string]*FailedFileEntry),
		refreshInterval: DEFAULT_REFRESH_INTERVAL,
		initialized:     make(chan struct{}),
	}

	initialState := &LibraryState{
		TotalCount:       0,
		FirstTorrentID:   "",
		FirstTorrentName: "",
		LastUpdated:      time.Now(),
	}
	torrentManager.currentState.Store(initialState)
	
    // Open SQLite store and load cached items
    if store, err := OpenTorrentStore(filepath.Join("..", "db", "torrents.db")); err == nil {
        torrentManager.store = store
        torrentManager.loadCachedCineSync()
    } else {
        logger.Warn("[Torrents] Failed to open store: %v - falling back to file cache", err)
        torrentManager.loadCachedCineSync()
    }
	
    // Start background refresh job
	torrentManager.startRefreshJob()

    // Start background catalog sync
    torrentManager.StartCatalogSyncJob(60 * time.Second)

	return torrentManager
}

// loadCachedCineSync loads cached torrent infos from db/data/*.cinesync and seeds in-memory caches
func (tm *TorrentManager) loadCachedCineSync() {
    if tm.store != nil {
        items, err := tm.store.GetAllItems()
        if err == nil && len(items) > 0 {
            tm.cacheMutex.Lock()
            tm.torrentList = items
            tm.lastCacheTime = time.Now()
            tm.cacheMutex.Unlock()
            logger.Info("[Torrents] Loaded %d cached entries from SQLite", len(items))
            return
        }
    }

    return
}

// SetPrefetchedTorrents seeds the torrent manager with prefetched data
func (tm *TorrentManager) SetPrefetchedTorrents(torrents []TorrentItem) {
	tm.cacheMutex.Lock()
	defer tm.cacheMutex.Unlock()

	tm.torrentList = torrents
	tm.lastCacheTime = time.Now()
	tm.prefetchCompleted.Store(true)

	// Update state after prefetch
	newState := &LibraryState{
		TotalCount:     len(torrents),
		FirstTorrentID: "",
		FirstTorrentName: "",
		LastUpdated:    time.Now(),
	}
	
	if len(torrents) > 0 {
		newState.FirstTorrentID = torrents[0].ID
		newState.FirstTorrentName = torrents[0].Filename
	}
	
	tm.updateCurrentState(newState)

	logger.Info("[Torrents] Initialized with prefetched data: %d torrents loaded", 
		len(torrents))
	
	// Trigger pending mount
	triggerPendingMount()
}


// GetTorrentStatistics returns status counts and total size from cached torrents
func (tm *TorrentManager) GetTorrentStatistics() (map[string]int, int64) {
	tm.cacheMutex.RLock()
	defer tm.cacheMutex.RUnlock()
	
	statusCounts := make(map[string]int)
	var totalSize int64
	
	for _, torrent := range tm.torrentList {
		statusCounts[torrent.Status]++
		totalSize += torrent.Bytes
	}
	
	return statusCounts, totalSize
}

// GetTorrentInfo gets detailed torrent information
func (tm *TorrentManager) GetTorrentInfo(torrentID string) (*TorrentInfo, error) {
    tm.cacheMutex.RLock()
    if info, ok := tm.torrentCache[torrentID]; ok {
        if len(info.Links) > 0 {
            tm.cacheMutex.RUnlock()
            return info, nil
        }

        tm.cacheMutex.RUnlock()
        logger.Debug("[Torrents] Cached info missing links for %s, refreshing", torrentID)
    } else {
        tm.cacheMutex.RUnlock()
    }

    info, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	tm.cacheMutex.Lock()
	tm.torrentCache[torrentID] = info
	tm.cacheMutex.Unlock()
    tm.saveCineSync(info)

	return info, nil
}


// FindTorrentByName finds a torrent by sanitized name
func (tm *TorrentManager) FindTorrentByName(name string) (string, error) {
	tm.cacheMutex.RLock()
	defer tm.cacheMutex.RUnlock()
	
	for i := range tm.torrentList {
		if GetDirectoryName(tm.torrentList[i].Filename) == name {
			return tm.torrentList[i].ID, nil
		}
	}
	
	return "", fmt.Errorf("torrent not found: %s", name)
}

// ListTorrentFiles lists files in a torrent
func (tm *TorrentManager) ListTorrentFiles(torrentID string, subPath string) ([]FileNode, error) {
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	modTime := time.Now()
	if info.Ended != "" {
		if parsedTime, parseErr := time.Parse(time.RFC3339, info.Ended); parseErr == nil {
			modTime = parsedTime
		}
	} else if info.Added != "" {
		if parsedTime, parseErr := time.Parse(time.RFC3339, info.Added); parseErr == nil {
			modTime = parsedTime
		}
	}

	var selectedFiles []TorrentFile
	for _, file := range info.Files {
		if file.Selected == 1 {
			selectedFiles = append(selectedFiles, file)
		}
	}

	fileMap := make(map[string]TorrentFile)
	duplicateCount := make(map[string]int)

	for _, file := range selectedFiles {
		cleanPath := strings.Trim(file.Path, "/")
		fileName := path.Base(cleanPath)

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
			ModTime:   modTime,
		})
	}

	return nodes, nil
}

// PrefetchFileDownloadLinks prefetches unrestricted links for all files in the given torrents in parallel
func (tm *TorrentManager) PrefetchFileDownloadLinks(torrents []TorrentItem) {
	if len(torrents) == 0 {
		return
	}

	var wg sync.WaitGroup
	for _, torrent := range torrents {
		wg.Add(1)
		go func(torrentID string) {
			defer wg.Done()

			info, err := tm.GetTorrentInfo(torrentID)
			if err != nil || len(info.Files) == 0 || len(info.Links) == 0 {
				return
			}

			var fileWg sync.WaitGroup
			for _, file := range info.Files {
				if file.Selected != 1 {
					continue
				}

				fileWg.Add(1)
				go func(f TorrentFile, tid string, links []string) {
					defer fileWg.Done()

					fileName := path.Base(strings.Trim(f.Path, "/"))
					cacheKey := fmt.Sprintf("%s:%s", tid, fileName)

					tm.downloadCacheMutex.RLock()
					if _, exists := tm.downloadLinkCache[cacheKey]; exists {
						tm.downloadCacheMutex.RUnlock()
						return
					}
					tm.downloadCacheMutex.RUnlock()

					downloadLink := ""
					if f.ID-1 < len(links) {
						downloadLink = links[f.ID-1]
					} else if len(links) > 0 {
						downloadLink = links[0]
					}

					if downloadLink == "" {
						return
					}

					unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
					if err != nil || unrestrictedLink.Download == "" {
						return
					}

					if f.Bytes > 0 {
						unrestrictedLink.Filesize = f.Bytes
					}

					tm.downloadCacheMutex.Lock()
					tm.downloadLinkCache[cacheKey] = unrestrictedLink
					tm.downloadCacheMutex.Unlock()
				}(file, torrentID, info.Links)
			}
			fileWg.Wait()
		}(torrent.ID)
	}
	wg.Wait()
}

// GetFileDownloadURL gets the download URL for a file with caching
func (tm *TorrentManager) GetFileDownloadURL(torrentID, filePath string) (string, int64, error) {
	// Create cache key
	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)

	tm.downloadCacheMutex.RLock()
	if cached, exists := tm.downloadLinkCache[cacheKey]; exists {
		tm.downloadCacheMutex.RUnlock()
		return cached.Download, cached.Filesize, nil
	}
	tm.downloadCacheMutex.RUnlock()

	tm.failedFileMutex.RLock()
	if failedEntry, exists := tm.failedFileCache[cacheKey]; exists {
		if time.Since(failedEntry.Timestamp) < 24*time.Hour {
			tm.failedFileMutex.RUnlock()
			return "", 0, failedEntry.Error
		}
	}
	tm.failedFileMutex.RUnlock()

	// Use singleflight to deduplicate concurrent requests
	v, err, _ := tm.downloadSG.Do(cacheKey, func() (interface{}, error) {
		// Double-check cache inside singleflight (another goroutine might have filled it)
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
	ModTime   time.Time
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
    tm.saveCineSync(info)
	
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
	
	tm.cacheMutex.RLock()
	torrentSizeMap := make(map[string]int64, len(tm.torrentList))
	for _, torrent := range tm.torrentList {
		dirName := GetDirectoryName(torrent.Filename)
		torrentSizeMap[dirName] = torrent.Bytes
	}
	tm.cacheMutex.RUnlock()

	for i := range torrentsFiles {
		if torrentsFiles[i].IsDir {
			normalizedName := GetDirectoryName(torrentsFiles[i].Name)
			if size, exists := torrentSizeMap[normalizedName]; exists {
				torrentsFiles[i].Size = size
			}
		}
	}
	
	// Store in cache
	tm.httpDavCacheMutex.Lock()
	tm.httpDavTorrentsCache = torrentsFiles
	tm.httpDavLinksCache = nil
	tm.httpDavLastCacheTime = time.Now()
	tm.httpDavCacheMutex.Unlock()
	
    logger.Info("[HTTP DAV] Prefetch completed: %d torrents", len(torrentsFiles))
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
	if tm.httpDavLinksCache == nil {
		return []HttpDavFileInfo{}
	}
	result := make([]HttpDavFileInfo, len(tm.httpDavLinksCache))
	copy(result, tm.httpDavLinksCache)
	return result
}

// startRefreshJob starts the background job
func (tm *TorrentManager) startRefreshJob() {
	if tm.isRunning.Load() {
		logger.Debug("[Refresh] Refresh job already running")
		return
	}
	
	tm.isRunning.Store(true)

	go func() {
		ctx, cancel := context.WithCancel(context.Background())
		tm.refreshCancel = cancel
		
		defer func() {
			if tm.refreshTicker != nil {
				tm.refreshTicker.Stop()
			}
			tm.isRunning.Store(false)
			logger.Info("[Refresh] Torrent refresh job stopped")
		}()

		close(tm.initialized)

		waitTicker := time.NewTicker(1 * time.Second)
		defer waitTicker.Stop()
		for !tm.prefetchCompleted.Load() {
			select {
			case <-ctx.Done():
				return
			case <-waitTicker.C:
				// Continue waiting until prefetch completes
			}
		}

		tm.refreshTicker = time.NewTicker(tm.refreshInterval)
		
		for {
			select {
			case <-ctx.Done():
				return
			case <-tm.refreshTicker.C:
				tm.performSmartRefresh(ctx)
			}
		}
	}()
}

// performSmartRefresh
func (tm *TorrentManager) performSmartRefresh(ctx context.Context) {
	newState, err := tm.getCurrentLibraryState(ctx)
	if err != nil {
		logger.Warn("[Refresh] Failed to get library state for change detection: %v", err)
		return
	}
	
	currentState := tm.currentState.Load()

	if currentState.Eq(newState) {
		return
	}
	
	logger.Info("[Refresh] Changes detected (count: %d -> %d)", 
		currentState.TotalCount, newState.TotalCount)
	tm.performFullRefresh(ctx)
	
	tm.updateCurrentState(newState)
}

// getCurrentLibraryState gets a lightweight state fingerprint for change detection
func (tm *TorrentManager) getCurrentLibraryState(ctx context.Context) (*LibraryState, error) {
	ctx, cancel := context.WithTimeout(ctx, CHECKSUM_TIMEOUT)
	defer cancel()
	
	state := &LibraryState{
		LastUpdated: time.Now(),
	}

	torrents, totalCount, err := tm.client.GetTorrentsLightweight(10)
	if err != nil {
		return nil, fmt.Errorf("failed to get lightweight torrents for state: %w", err)
	}
	
	state.TotalCount = totalCount
	if len(torrents) > 0 {
		state.FirstTorrentID = torrents[0].ID
		state.FirstTorrentName = torrents[0].Filename
	}
	
	return state, nil
}

// fetchFirstPageWithTotal fetches the first page using page parameter and returns total count
func (tm *TorrentManager) fetchFirstPageWithTotal(ctx context.Context, pageSize int) ([]TorrentItem, int, error) {
	_, totalCount, err := tm.client.GetTorrentsLightweight(10)
	if err != nil {
		return nil, 0, err
	}
	
	url := fmt.Sprintf("%s/torrents?_t=%d&page=1&limit=%d", tm.client.baseURL, time.Now().Unix(), pageSize)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+tm.client.apiKey)
	
	resp, err := tm.client.doWithLimit(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	
	if resp.StatusCode == http.StatusNoContent {
		return []TorrentItem{}, totalCount, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	
	var items []TorrentItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, 0, err
	}
	return items, totalCount, nil
}

// performFullRefresh performs a refresh using cached data + first page changes
// Fetches only first page to detect changes, then merges with cached/prefetched torrents
func (tm *TorrentManager) performFullRefresh(ctx context.Context) {
	tm.cacheMutex.RLock()
	cachedTorrents := make([]TorrentItem, len(tm.torrentList))
	copy(cachedTorrents, tm.torrentList)
	tm.cacheMutex.RUnlock()
	
	if len(cachedTorrents) == 0 {
		logger.Debug("[Refresh] No cached/prefetched torrents available, skipping refresh")
		return
	}

	oldTorrents := make(map[string]TorrentItem, len(cachedTorrents))
	for i := range cachedTorrents {
		oldTorrents[cachedTorrents[i].ID] = cachedTorrents[i]
	}
	
	firstPage, totalCount, err := tm.fetchFirstPageWithTotal(ctx, 1000)
	if err != nil || len(firstPage) == 0 {
		if err != nil {
			logger.Error("[Refresh] Failed to fetch first page: %v", err)
		}
		return
	}

	var allTorrents []TorrentItem
	cachedLen := len(cachedTorrents)
	
	matchLoop:
	for cIdx, cached := range cachedTorrents {
		cIdxFromEnd := cachedLen - 1 - cIdx
		for fIdx, fresh := range firstPage {
			if fresh.ID == cached.ID {
				positionDiff := (totalCount - 1 - fIdx) - cIdxFromEnd
				if positionDiff >= -1 && positionDiff <= 1 {
					allTorrents = make([]TorrentItem, 0, totalCount)
					allTorrents = append(allTorrents, firstPage[:fIdx]...)
					allTorrents = append(allTorrents, cachedTorrents[cIdx:]...)
					if len(allTorrents) >= totalCount-10 && len(allTorrents) <= totalCount+10 {
						break matchLoop
					}
				}
			}
		}
	}

	if allTorrents == nil {
		allTorrents = firstPage
		if totalCount > len(firstPage) && cachedLen > len(firstPage) {
			allTorrents = append(allTorrents, cachedTorrents[len(firstPage):]...)
		}
	}
	
	// Analyze new/removed torrents
	newTorrents := make([]TorrentItem, 0, 10)
	removedTorrents := make([]TorrentItem, 0, 10)
	newTorrentsMap := make(map[string]bool, len(allTorrents))
	
	for i := range allTorrents {
		id := allTorrents[i].ID
		newTorrentsMap[id] = true
		if _, exists := oldTorrents[id]; !exists {
			newTorrents = append(newTorrents, allTorrents[i])
		}
	}
	
	for id, torrent := range oldTorrents {
		if !newTorrentsMap[id] {
			removedTorrents = append(removedTorrents, torrent)
		}
	}
	
	// Update torrent list with merged data
	tm.cacheMutex.Lock()
	tm.torrentList = allTorrents
	tm.lastCacheTime = time.Now()
	tm.cacheMutex.Unlock()
	
	go tm.SaveAllTorrents()
	
	// Log new torrents (but not during initial load)
	if len(newTorrents) > 0 && len(cachedTorrents) > 0 {
		for i, torrent := range newTorrents {
			if i < 3 {
				logger.Info("New file added: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("... and %d more new files", len(newTorrents)-3)
				break
			}
		}

		// Prefetch unrestricted links for all new torrents in parallel
		go tm.PrefetchFileDownloadLinks(newTorrents)
	}
	
	// Log removed torrents
	if len(removedTorrents) > 0 {
		for i, torrent := range removedTorrents {
			if i < 3 {
				logger.Info("File removed: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("... and %d more files removed", len(removedTorrents)-3)
				break
			}
		}
	}

	triggerPendingMount()
}

// updateCurrentState atomically updates the current library state
func (tm *TorrentManager) updateCurrentState(newState *LibraryState) {
	tm.currentState.Store(newState)
}

// GetCurrentState returns the current library state
func (tm *TorrentManager) GetCurrentState() *LibraryState {
	state := tm.currentState.Load()
	if state == nil {
		return &LibraryState{}
	}

	return &LibraryState{
		TotalCount:       state.TotalCount,
		FirstTorrentID:   state.FirstTorrentID,
		FirstTorrentName: state.FirstTorrentName,
		LastUpdated:      state.LastUpdated,
	}
}

// SetRefreshInterval updates the refresh interval
func (tm *TorrentManager) SetRefreshInterval(interval time.Duration) {
	if interval < 10*time.Second {
		interval = 10 * time.Second
		logger.Warn("[Refresh] Minimum refresh interval is 10 seconds, adjusted")
	}
	
	tm.refreshInterval = interval
	
	if tm.refreshTicker != nil {
		tm.refreshTicker.Reset(interval)
		logger.Info("[Refresh] Refresh interval updated to %v", interval)
	}
}

// ForceRefresh forces an immediate full refresh
func (tm *TorrentManager) ForceRefresh() {
	logger.Info("[Refresh] Force refresh requested")
	ctx := context.Background()
	tm.performFullRefresh(ctx)
	
	// Update state after forced refresh
	if newState, err := tm.getCurrentLibraryState(ctx); err == nil {
		tm.updateCurrentState(newState)
	}
}

// Stop stops the background refresh job
func (tm *TorrentManager) Stop() {
	if tm.refreshCancel != nil {
		tm.refreshCancel()
		logger.Info("[Refresh] Torrent manager stopped")
	}
}

// WaitForInitialization waits for the initial load to complete
func (tm *TorrentManager) WaitForInitialization() {
	<-tm.initialized
}

// IsInitialized returns whether the manager has completed initial loading
func (tm *TorrentManager) IsInitialized() bool {
	select {
	case <-tm.initialized:
		return true
	default:
		return false
	}
}

// GetLastRefreshTime returns the timestamp of the last successful refresh
func (tm *TorrentManager) GetLastRefreshTime() time.Time {
	tm.cacheMutex.RLock()
	defer tm.cacheMutex.RUnlock()
	return tm.lastCacheTime
}
// StartCatalogSyncJob runs a lightweight periodic job.
func (tm *TorrentManager) StartCatalogSyncJob(interval time.Duration) {
    if interval < 10*time.Second {
        interval = 10 * time.Second
    }
    go func() {
        ticker := time.NewTicker(interval)
        defer ticker.Stop()
        for range ticker.C {
            tm.cacheMutex.RLock()
            listCopy := make([]TorrentItem, len(tm.torrentList))
            copy(listCopy, tm.torrentList)
            tm.cacheMutex.RUnlock()
            rdIDs := make([]string, 0, len(listCopy))
            for i := range listCopy { rdIDs = append(rdIDs, listCopy[i].ID) }
            tm.ReconcileDBWithRD(rdIDs)
            tm.SaveAllTorrents()
        }
    }()}