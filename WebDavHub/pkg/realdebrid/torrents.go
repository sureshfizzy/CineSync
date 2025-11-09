package realdebrid

import (
    "context"
    "fmt"
    "path"
    "path/filepath"
    "strings"
    "sync"
    "sync/atomic"
    "time"

    "cinesync/pkg/logger"
    cmap "github.com/orcaman/concurrent-map/v2"
    "golang.org/x/sync/singleflight"
)

const (
	ALL_TORRENTS = "__all__"
	// Refresh intervals
	DEFAULT_REFRESH_INTERVAL = 15 * time.Second
	CHECKSUM_TIMEOUT = 10 * time.Second
    INFO_CACHE_TTL = 24 * time.Hour
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

// MakeCacheKey creates a standardized cache key for torrent file downloads
func MakeCacheKey(torrentID, filePath string) string {
	return fmt.Sprintf("%s:%s", torrentID, filePath)
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
	DirectoryMap cmap.ConcurrentMap[string, cmap.ConcurrentMap[string, *TorrentItem]]
	InfoMap      cmap.ConcurrentMap[string, *TorrentInfo]
	idToItemMap  cmap.ConcurrentMap[string, *TorrentItem]
	downloadLinkCache cmap.ConcurrentMap[string, *DownloadLinkEntry]
	failedFileCache   cmap.ConcurrentMap[string, *FailedFileEntry]
	downloadSG singleflight.Group
	infoSG     singleflight.Group
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
    store     *TorrentStore
    infoStore *TorrentInfoStore
}

// DownloadLinkEntry includes TTL tracking
type DownloadLinkEntry struct {
	*DownloadLink
	GeneratedAt time.Time
}

type infoCacheEntry struct {
    info *TorrentInfo
    storedAt time.Time
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
		client:            NewClient(apiKey),
		downloadLinkCache: cmap.New[*DownloadLinkEntry](),
		failedFileCache:   cmap.New[*FailedFileEntry](),
		idToItemMap:       cmap.New[*TorrentItem](),
		refreshInterval:   DEFAULT_REFRESH_INTERVAL,
		initialized:       make(chan struct{}),
	}

	torrentManager.initializeDirectoryMaps()

	initialState := &LibraryState{
		TotalCount:       0,
		FirstTorrentID:   "",
		FirstTorrentName: "",
		LastUpdated:      time.Now(),
	}
	torrentManager.currentState.Store(initialState)
	
    // Open SQLite stores
    dbPath, _ := filepath.Abs(filepath.Join("..", "db", "torrents.db"))
    if store, err := OpenTorrentStore(dbPath); err == nil {
        torrentManager.store = store
    } else {
        logger.Warn("[Torrents] Failed to open store at %s: %v", dbPath, err)
    }

    // Open detailed info store
    infoDBPath, _ := filepath.Abs(filepath.Join("..", "db", "torrents-info.db"))
    if infoStore, err := OpenTorrentInfoStore(infoDBPath); err == nil {
        torrentManager.infoStore = infoStore
    } else {
        logger.Warn("[Torrents] Failed to open torrents-info.db at %s: %v", infoDBPath, err)
    }
    
    // load cached data
    torrentManager.loadCachedCineSync()
	
    // Start background refresh job
	torrentManager.startRefreshJob()

    // Start background catalog sync
    torrentManager.StartCatalogSyncJob(60 * time.Second)

    // Start repair worker to scan for broken torrents
    torrentManager.StartRepairWorker()

	return torrentManager
}

// initializeDirectoryMaps creates the concurrent directory maps
func (tm *TorrentManager) initializeDirectoryMaps() {
	tm.DirectoryMap = cmap.New[cmap.ConcurrentMap[string, *TorrentItem]]()
	tm.InfoMap = cmap.New[*TorrentInfo]()
	tm.DirectoryMap.Set(ALL_TORRENTS, cmap.New[*TorrentItem]())
}

// loadCachedTorrents loads from SQLite and populates concurrent maps
func (tm *TorrentManager) loadCachedTorrents() {
	if tm.store == nil {
		logger.Warn("[Torrents] Store not available for loading cached torrents")
		return
	}
	
	items, err := tm.store.GetAllItems()
	if err != nil || len(items) == 0 {
		return
	}
	
	// Get directory map
	allTorrents, _ := tm.DirectoryMap.Get(ALL_TORRENTS)
	for i := range items {
		item := &items[i]
		accessKey := GetDirectoryName(item.Filename)
		allTorrents.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
	}
	
	logger.Info("[Torrents] Loaded %d torrents into concurrent maps", len(items))
}

// loadCachedCineSync loads cached torrent infos from db/data/*.cinesync and seeds in-memory caches
func (tm *TorrentManager) loadCachedCineSync() {
	tm.loadCachedTorrents()
}

// SetPrefetchedTorrents seeds the torrent manager with prefetched data
func (tm *TorrentManager) SetPrefetchedTorrents(torrents []TorrentItem) {
	allTorrents, _ := tm.DirectoryMap.Get(ALL_TORRENTS)
	for i := range torrents {
		item := &torrents[i]
		accessKey := GetDirectoryName(item.Filename)
		allTorrents.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
	}
	
	logger.Info("[Torrents] Initialized with prefetched data: %d torrents loaded", 
		len(torrents))
	
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
	
	// Trigger pending mount
	triggerPendingMount()
}

// GetTorrentFileList loads file list on demand from DB
func (tm *TorrentManager) GetTorrentFileList(torrentID string) ([]TorrentFile, []string, string) {
	torrentID = resolveTorrentID(torrentID)
	
	if tm.infoStore != nil {
		if cached, ok, err := tm.infoStore.Get(torrentID); err == nil && ok && cached != nil {
			return cached.Files, cached.Links, cached.Ended
		}
	}

	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, nil, ""
	}
	
	return info.Files, info.Links, info.Ended
}

// GetTorrentStatistics returns status counts and total size from cached torrents
func (tm *TorrentManager) GetTorrentStatistics() (map[string]int, int64) {
	statusCounts := make(map[string]int)
	var totalSize int64
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		return statusCounts, 0
	}
	
	keys := allTorrents.Keys()
	for _, key := range keys {
		if torrent, ok := allTorrents.Get(key); ok && torrent != nil {
			statusCounts[torrent.Status]++
			totalSize += torrent.Bytes
		}
	}
	
	return statusCounts, totalSize
}

// GetTorrentInfo gets detailed torrent information
func (tm *TorrentManager) GetTorrentInfo(torrentID string) (*TorrentInfo, error) {
	torrentID = resolveTorrentID(torrentID)
	
	v, err, shared := tm.infoSG.Do("info:"+torrentID, func() (interface{}, error) {
		if tm.infoStore != nil {
			if cached, ok, derr := tm.infoStore.Get(torrentID); derr == nil && ok && cached != nil {
				return cached, nil
			}
		}
		fetched, ferr := tm.client.GetTorrentInfo(torrentID)
		if ferr != nil {
			// If torrent not found, delete it from our database/cache
			if IsTorrentNotFound(ferr) {
				tm.deleteTorrentFromCache(torrentID)
				return nil, ferr
			}
			return nil, ferr
		}
		
		// Save to both databases for future fast access
		if tm.infoStore != nil {
			_ = tm.infoStore.Upsert(fetched)
		}
		if tm.store != nil {
			_ = tm.store.UpsertInfo(fetched)
		}

		return fetched, nil
	})

	if err != nil {
		return nil, err
	}
	_ = shared
	return v.(*TorrentInfo), nil
}


// FindTorrentByName finds a torrent by sanitized name
func (tm *TorrentManager) FindTorrentByName(name string) (string, error) {
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		return "", fmt.Errorf("directory map not initialized")
	}
	if item, found := allTorrents.Get(name); found {
		return item.ID, nil
	}
	
	return "", fmt.Errorf("torrent not found: %s", name)
}

// ListTorrentFiles lists files in a torrent
func (tm *TorrentManager) ListTorrentFiles(torrentID string, subPath string) ([]FileNode, error) {
	torrentID = resolveTorrentID(torrentID)
	
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
					cacheKey := MakeCacheKey(tid, fileName)

					if _, exists := tm.downloadLinkCache.Get(cacheKey); exists {
						return
					}

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

					tm.downloadLinkCache.Set(cacheKey, &DownloadLinkEntry{
						DownloadLink: unrestrictedLink,
						GeneratedAt:  time.Now(),
					})
				}(file, torrentID, info.Links)
			}
			fileWg.Wait()
		}(torrent.ID)
	}
	wg.Wait()
}

// isBrokenLinkError checks if an error indicates a broken link that needs repair
func isBrokenLinkError(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()

	if strings.Contains(errStr, "code: 21") || 
		strings.Contains(errStr, "code: 19") || 
		strings.Contains(errStr, "code: 28") {
		return true
	}

	if strings.Contains(errStr, "no links available") ||
		strings.Contains(errStr, "empty download link") ||
		strings.Contains(errStr, "unavailable_file") ||
		strings.Contains(errStr, "hoster_unavailable") ||
		strings.Contains(errStr, "hoster_not_supported") ||
		strings.Contains(errStr, "link expired") ||
		strings.Contains(errStr, "file removed") {
		return true
	}
	
	return false
}


// GetFileDownloadURL gets the download URL for a file with caching
func (tm *TorrentManager) GetFileDownloadURL(torrentID, filePath string) (string, int64, error) {
	torrentID = resolveTorrentID(torrentID)
	
	cacheKey := MakeCacheKey(torrentID, filePath)

	var restrictedLink string
	var targetFileBytes int64
	
	files, links, _ := tm.GetTorrentFileList(torrentID)
	if len(links) > 0 && len(files) > 0 {
		var targetFile *TorrentFile
		for i := range files {
			if files[i].Selected == 1 {
				baseName := path.Base(files[i].Path)
				if baseName == filePath {
					targetFile = &files[i]
					break
				}
			}
		}
		
		if targetFile != nil {
			if targetFile.ID-1 < len(links) {
				restrictedLink = links[targetFile.ID-1]
			} else if len(links) > 0 {
				restrictedLink = links[0]
			}
			targetFileBytes = targetFile.Bytes
			
			if restrictedLink != "" {
				processedLink := restrictedLink
				if strings.HasPrefix(restrictedLink, "https://real-debrid.com/d/") && len(restrictedLink) > 39 {
					processedLink = restrictedLink[0:39]
				}
				
				if cached, exists := tm.client.unrestrictCache.Get(processedLink); exists {
					if time.Since(cached.Generated) < 24*time.Hour {
						return cached.Download.Download, cached.Download.Filesize, nil
					}
				}
			}
		}
	}

	if cached, exists := tm.downloadLinkCache.Get(cacheKey); exists {
		if time.Since(cached.GeneratedAt) < 24*time.Hour {
			return cached.Download, cached.Filesize, nil
		}
		tm.downloadLinkCache.Remove(cacheKey)
	}

	if failedEntry, exists := tm.failedFileCache.Get(cacheKey); exists {
		if time.Since(failedEntry.Timestamp) < 24*time.Hour {
			return "", 0, failedEntry.Error
		}
		tm.failedFileCache.Remove(cacheKey)
	}

	// Use singleflight to deduplicate concurrent requests
	v, err, _ := tm.downloadSG.Do(cacheKey, func() (interface{}, error) {
		// Double-check cache inside singleflight (another goroutine might have filled it)
		if cached, exists := tm.downloadLinkCache.Get(cacheKey); exists {
			if time.Since(cached.GeneratedAt) < 24*time.Hour {
				return []interface{}{cached.Download, cached.Filesize}, nil
			}
		}

		var downloadLink string
		var filesize int64
		if restrictedLink != "" {
			downloadLink = restrictedLink
			filesize = targetFileBytes
		} else {
			info, err := tm.GetTorrentInfo(torrentID)
			if err != nil {
				return nil, err
			}

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
				tm.TriggerAutoRepair(torrentID)
				return nil, fmt.Errorf("no links available")
			}

			if targetFile.ID-1 < len(info.Links) {
				downloadLink = info.Links[targetFile.ID-1]
			} else {
				downloadLink = info.Links[0]
			}
			
			filesize = targetFile.Bytes
		}

		if downloadLink == "" {
			logger.Warn("[Torrents] Empty download link for torrent %s, file %s", torrentID, filePath)
			tm.TriggerAutoRepair(torrentID)
			return nil, fmt.Errorf("empty download link")
		}

		logger.Debug("[Torrents] Attempting to unrestrict link for: %s", filePath)
		
		// Unrestrict the link
		unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
		if err != nil {
			wrappedErr := fmt.Errorf("failed to unrestrict link: %w", err)
			
			if isBrokenLinkError(err) {
				tm.TriggerAutoRepair(torrentID)
			}
			
			tm.failedFileCache.Set(cacheKey, &FailedFileEntry{
				Error:     wrappedErr,
				Timestamp: time.Now(),
			})
			return nil, wrappedErr
		}

		if unrestrictedLink.Download == "" {
			logger.Warn("[Torrents] Unrestrict returned empty download URL")
			emptyErr := fmt.Errorf("unrestrict returned empty download URL")
			
			tm.TriggerAutoRepair(torrentID)

			// Cache this error too
			tm.failedFileCache.Set(cacheKey, &FailedFileEntry{
				Error:     emptyErr,
				Timestamp: time.Now(),
			})
			return nil, emptyErr
		}

		logger.Debug("[Torrents] Successfully unrestricted link for: %s", filePath)
		
		// Clear any cached failures for this file since it succeeded
		tm.failedFileCache.Remove(cacheKey)

		// Cache the result
		tm.downloadLinkCache.Set(cacheKey, &DownloadLinkEntry{
			DownloadLink: unrestrictedLink,
			GeneratedAt:  time.Now(),
		})
		
		return []interface{}{unrestrictedLink.Download, filesize}, nil
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
	torrentID = resolveTorrentID(torrentID)
	
	logger.Debug("[Torrents] Refreshing torrent %s", torrentID)
	
	// Fetch fresh torrent info
    info, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		return fmt.Errorf("failed to refresh torrent %s: %w", torrentID, err)
	}
	
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
	
	allTorrents, _ := tm.DirectoryMap.Get(ALL_TORRENTS)
	torrentSizeMap := make(map[string]int64)
	keys := allTorrents.Keys()
	for _, dirName := range keys {
		if item, ok := allTorrents.Get(dirName); ok && item != nil {
			torrentSizeMap[dirName] = item.Bytes
		}
	}

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
	allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok || allTorrentsMap.Count() == 0 {
		return time.Time{}
	}
	return time.Now()
}

// GetModifiedUnix returns the stored modified unix timestamp.
func (tm *TorrentManager) GetModifiedUnix(id string) int64 {
    if tm == nil || tm.store == nil { return 0 }
    if m, ok, err := tm.store.GetModifiedUnix(id); err == nil && ok { return m }
    return 0
}

// GetStore returns the TorrentStore instance
func (tm *TorrentManager) GetStore() *TorrentStore {
    if tm == nil { return nil }
    return tm.store
}

// GetDownloadLinkCacheCount returns the number of cached download links
func (tm *TorrentManager) GetDownloadLinkCacheCount() int {
	return tm.downloadLinkCache.Count()
}

// GetFailedFileCacheCount returns the number of cached failed file entries
func (tm *TorrentManager) GetFailedFileCacheCount() int {
	return tm.failedFileCache.Count()
}

// GetRefreshInterval returns the current refresh interval
func (tm *TorrentManager) GetRefreshInterval() time.Duration {
	return tm.refreshInterval
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
            allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
            if !ok {
                continue
            }

            keys := allTorrentsMap.Keys()
            rdIDs := make([]string, 0, len(keys))
            for _, key := range keys {
                if item, ok := allTorrentsMap.Get(key); ok && item != nil {
                    rdIDs = append(rdIDs, item.ID)
                }
            }
            tm.ReconcileDBWithRD(rdIDs)
            tm.SaveAllTorrents()
        }
    }()}