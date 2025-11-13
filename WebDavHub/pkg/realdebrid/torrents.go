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
	brokenTorrentCache cmap.ConcurrentMap[string, *FailedFileEntry]
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
	torrentManager atomic.Pointer[TorrentManager]
	torrentOnce    sync.Once
	torrentApiKey  atomic.Value
)

// GetTorrentManager returns the singleton torrent manager
func GetTorrentManager(apiKey string) *TorrentManager {
	if tm := torrentManager.Load(); tm != nil {
		if storedKey, ok := torrentApiKey.Load().(string); ok && storedKey == apiKey {
			return tm
		}
	}

	torrentOnce.Do(func() {
		tm := &TorrentManager{
			client:             NewClient(apiKey),
			downloadLinkCache:  cmap.New[*DownloadLinkEntry](),
			failedFileCache:    cmap.New[*FailedFileEntry](),
			brokenTorrentCache: cmap.New[*FailedFileEntry](),
			idToItemMap:        cmap.New[*TorrentItem](),
			refreshInterval:    DEFAULT_REFRESH_INTERVAL,
			initialized:        make(chan struct{}),
		}

		tm.initializeDirectoryMaps()

	initialState := &LibraryState{
		TotalCount:       0,
		FirstTorrentID:   "",
		FirstTorrentName: "",
		LastUpdated:      time.Now(),
	}
		tm.currentState.Store(initialState)
	
    // Open SQLite stores
    dbPath, _ := filepath.Abs(filepath.Join("..", "db", "torrents.db"))
    if store, err := OpenTorrentStore(dbPath); err == nil {
			tm.store = store
    } else {
        logger.Warn("[Torrents] Failed to open store at %s: %v", dbPath, err)
    }

    // Open detailed info store
    infoDBPath, _ := filepath.Abs(filepath.Join("..", "db", "torrents-info.db"))
    if infoStore, err := OpenTorrentInfoStore(infoDBPath); err == nil {
			tm.infoStore = infoStore
    } else {
        logger.Warn("[Torrents] Failed to open torrents-info.db at %s: %v", infoDBPath, err)
    }
    
    // load cached data
		tm.loadCachedCineSync()
	
    // Start background refresh job
		tm.startRefreshJob()

    // Start background catalog sync
		tm.StartCatalogSyncJob(60 * time.Second)

    // Start repair worker to scan for broken torrents
		tm.StartRepairWorker()

		// Store atomically
		torrentManager.Store(tm)
		torrentApiKey.Store(apiKey)
	})

	return torrentManager.Load()
}

// initializeDirectoryMaps creates the concurrent directory maps
func (tm *TorrentManager) initializeDirectoryMaps() {
	tm.DirectoryMap = cmap.New[cmap.ConcurrentMap[string, *TorrentItem]]()
	tm.InfoMap = cmap.New[*TorrentInfo]()
	tm.DirectoryMap.Set(ALL_TORRENTS, cmap.New[*TorrentItem]())
}

// loadCachedTorrents loads from SQLite and AGGRESSIVELY populates ALL file lists in memory
func (tm *TorrentManager) loadCachedTorrents() {
	logger.Info("[LoadCache] Starting to load cached torrents from SQLite")
	
	if tm.store == nil {
		logger.Warn("[LoadCache] Store not available for loading cached torrents")
		return
	}
	
	logger.Debug("[LoadCache] Fetching all items from SQLite...")
	items, err := tm.store.GetAllItems()
	if err != nil {
		logger.Error("[LoadCache] Failed to get items from store: %v", err)
		return
	}
	
	if len(items) == 0 {
		logger.Info("[LoadCache] No items found in store")
		return
	}
	
	logger.Info("[LoadCache] Found %d torrents in SQLite, loading file lists into memory", len(items))
	
	// Get directory map
	allTorrents, _ := tm.DirectoryMap.Get(ALL_TORRENTS)
	
	// Load torrents with file lists FULLY cached in memory
	loadedCount := 0
	missingCount := 0
	startTime := time.Now()
	
	for i := range items {
		item := &items[i]
		accessKey := GetDirectoryName(item.Filename)
		if tm.infoStore != nil {
			if cached, ok, cerr := tm.infoStore.Get(item.ID); cerr == nil && ok && cached != nil {
				item.CachedFiles = cached.Files
				item.CachedLinks = cached.Links
				item.Ended = cached.Ended
				loadedCount++
			} else {
				info, apiErr := tm.client.GetTorrentInfo(item.ID)
				if apiErr == nil && info != nil {
					item.CachedFiles = info.Files
					item.CachedLinks = info.Links
					item.Ended = info.Ended
					if tm.infoStore != nil {
						_ = tm.infoStore.Upsert(info)
					}
					loadedCount++
				} else {
					missingCount++
					logger.Warn("[LoadCache] Torrent %d: Failed to load files for %s: %v", i+1, item.ID, apiErr)
				}
			}
		}
		
		allTorrents.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
	}
	
	elapsed := time.Since(startTime)
	logger.Info("[LoadCache] COMPLETED in %.1fs - %d torrents: %d with files in RAM, %d missing", 
		elapsed.Seconds(), len(items), loadedCount, missingCount)
}

// loadCachedCineSync loads cached torrent infos from db/data/*.cinesync and seeds in-memory caches
func (tm *TorrentManager) loadCachedCineSync() {
	tm.loadCachedTorrents()
}

// SetPrefetchedTorrents seeds the torrent manager with prefetched data and caches files in memory
func (tm *TorrentManager) SetPrefetchedTorrents(torrents []TorrentItem) {
	logger.Info("[SetPrefetch] Starting to prefetch %d torrents with ALL file lists into memory", len(torrents))
	
	allTorrents, _ := tm.DirectoryMap.Get(ALL_TORRENTS)
	
	loadedCount := 0
	missingCount := 0
	alreadyCachedCount := 0
	startTime := time.Now()
	
	for i := range torrents {
		item := &torrents[i]
		accessKey := GetDirectoryName(item.Filename)
		// AGGRESSIVELY load file lists into memory for instant access
		if len(item.CachedFiles) == 0 {
			if tm.infoStore != nil {
				if cached, ok, cerr := tm.infoStore.Get(item.ID); cerr == nil && ok && cached != nil {
					item.CachedFiles = cached.Files
					item.CachedLinks = cached.Links
					item.Ended = cached.Ended
					loadedCount++
				} else {
					info, apiErr := tm.client.GetTorrentInfo(item.ID)
					if apiErr == nil && info != nil {
						item.CachedFiles = info.Files
						item.CachedLinks = info.Links
						item.Ended = info.Ended
						_ = tm.infoStore.Upsert(info)
						loadedCount++
					} else {
						missingCount++
						logger.Warn("[SetPrefetch] Torrent %d: Failed to prefetch files for %s: %v", i+1, item.ID, apiErr)
					}
				}
			}
		} else {
			alreadyCachedCount++
		}
		
		allTorrents.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
	}
	
	elapsed := time.Since(startTime)
	logger.Info("[SetPrefetch] COMPLETED in %.1fs - %d torrents: %d loaded, %d already cached, %d missing", 
		elapsed.Seconds(), len(torrents), loadedCount, alreadyCachedCount, missingCount)
	
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

// GetTorrentFileList loads file list - first from in-memory cache, then DB, then API
func (tm *TorrentManager) GetTorrentFileList(torrentID string) ([]TorrentFile, []string, string) {
	torrentID = resolveTorrentID(torrentID)
	
	if item, ok := tm.idToItemMap.Get(torrentID); ok && item != nil {
		if len(item.CachedFiles) > 0 {
			return item.CachedFiles, item.CachedLinks, item.Ended
		}

		var files []TorrentFile
		var links []string
		var ended string
		
		// Try DB first
	if tm.infoStore != nil {
			if cached, cacheOk, err := tm.infoStore.Get(torrentID); err == nil && cacheOk && cached != nil {
				files = cached.Files
				links = cached.Links
				ended = cached.Ended
			}
		}
		
		// If DB miss, try API
		if len(files) == 0 {
			info, err := tm.GetTorrentInfo(torrentID)
			if err != nil {
				return nil, nil, ""
			}
			files = info.Files
			links = info.Links
			ended = info.Ended
		}

		item.CachedFiles = files
		item.CachedLinks = links
		if ended != "" {
			item.Ended = ended
		}
		
		return files, links, ended
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

// GetBrokenTorrentCache returns the broken torrent cache for filtering
func (tm *TorrentManager) GetBrokenTorrentCache() cmap.ConcurrentMap[string, *FailedFileEntry] {
	return tm.brokenTorrentCache
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
		logger.Info("[Prefetch] No torrents to prefetch")
		return
	}

	startTime := time.Now()
	logger.Info("[Prefetch] Starting prefetch for %d torrents", len(torrents))
	const maxConcurrentTorrents = 50
	const maxConcurrentFiles = 100
	sem := make(chan struct{}, maxConcurrentTorrents)
	var processed, cached, fetched, failed atomic.Int32

	var wg sync.WaitGroup
	for idx, torrent := range torrents {
		wg.Add(1)
		sem <- struct{}{}
		
		go func(torrentID string, torrentIdx int, totalTorrents int) {
			defer func() {
				wg.Done()
				<-sem
				currentProcessed := processed.Add(1)
				if currentProcessed%10 == 0 || currentProcessed == int32(totalTorrents) {
					logger.Info("[Prefetch] Progress: %d/%d torrents processed (cached: %d, fetched: %d, failed: %d)",
						currentProcessed, totalTorrents, cached.Load(), fetched.Load(), failed.Load())
				}
				
				if r := recover(); r != nil {
					logger.Error("[Prefetch] PANIC in torrent %d: %v", torrentIdx, r)
				}
			}()
			
			logger.Debug("[Prefetch] Processing torrent %d/%d (ID: %s)", torrentIdx+1, totalTorrents, torrentID[:8])
			info, err := tm.GetTorrentInfo(torrentID)
			if err != nil {
				logger.Warn("[Prefetch] Failed to get info for torrent %d: %v", torrentIdx, err)
				failed.Add(int32(1))
				return
			}

			if len(info.Files) == 0 {
				logger.Debug("[Prefetch] Torrent %d has no files", torrentIdx)
				return
			}
			
			if len(info.Links) == 0 {
				logger.Warn("[Prefetch] Torrent %d has no links", torrentIdx)
				failed.Add(int32(1))
				return
			}
			
			logger.Debug("[Prefetch] Torrent %d: %d files, %d links", torrentIdx, len(info.Files), len(info.Links))
			fileSem := make(chan struct{}, maxConcurrentFiles)
			var fileWg sync.WaitGroup
			
			fileCount := 0
			for _, file := range info.Files {
				if file.Selected != 1 {
					continue
				}
				fileCount++

				fileWg.Add(1)
				fileSem <- struct{}{}
				
				go func(f TorrentFile, tid string, links []string) {
					defer func() {
						fileWg.Done()
						<-fileSem
						
						if r := recover(); r != nil {
							logger.Error("[Prefetch] PANIC in file processing: %v", r)
						}
					}()

					fileName := path.Base(strings.Trim(f.Path, "/"))
					cacheKey := MakeCacheKey(tid, fileName)
					if _, exists := tm.downloadLinkCache.Get(cacheKey); exists {
						cached.Add(1)
						return
					}
					downloadLink := ""
					if f.ID-1 < len(links) {
						downloadLink = links[f.ID-1]
					} else if len(links) > 0 {
						downloadLink = links[0]
					}

					if downloadLink == "" {
						logger.Debug("[Prefetch] No download link for file: %s", fileName)
						failed.Add(1)
						return
					}
					unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
					if err != nil {
						logger.Debug("[Prefetch] Failed to unrestrict %s: %v", fileName, err)
						failed.Add(1)
						return
					}
					
					if unrestrictedLink.Download == "" {
						logger.Debug("[Prefetch] Empty unrestrict URL for %s", fileName)
						failed.Add(1)
						return
					}

					if f.Bytes > 0 {
						unrestrictedLink.Filesize = f.Bytes
					}

					tm.downloadLinkCache.Set(cacheKey, &DownloadLinkEntry{
						DownloadLink: unrestrictedLink,
						GeneratedAt:  time.Now(),
					})
					
					fetched.Add(1)
				}(file, torrentID, info.Links)
			}
			
			logger.Debug("[Prefetch] Torrent %d: waiting for %d files to complete", torrentIdx, fileCount)
			fileWg.Wait()
			logger.Debug("[Prefetch] Torrent %d: all files completed", torrentIdx)
			
		}(torrent.ID, idx, len(torrents))
	}
	
	logger.Info("[Prefetch] Waiting for all torrents to complete...")
	wg.Wait()
	
	elapsed := time.Since(startTime)
	logger.Info("[Prefetch] COMPLETED in %.1fs - Processed: %d, Cached: %d, Fetched: %d, Failed: %d",
		elapsed.Seconds(), processed.Load(), cached.Load(), fetched.Load(), failed.Load())
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
	if _, broken := tm.brokenTorrentCache.Get(torrentID); broken {
		return "", 0, fmt.Errorf("torrent is in repair queue")
	}
	
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

	if brokenEntry, exists := tm.brokenTorrentCache.Get(torrentID); exists {
		return "", 0, brokenEntry.Error
	}

	v, err, _ := tm.downloadSG.Do(cacheKey, func() (interface{}, error) {
		if cached, exists := tm.downloadLinkCache.Get(cacheKey); exists {
			if time.Since(cached.GeneratedAt) < 24*time.Hour {
				return []interface{}{cached.Download, cached.Filesize}, nil
			}
		}

		var downloadLink string
		var filesize int64
		var info *TorrentInfo
		
		if restrictedLink != "" {
			downloadLink = restrictedLink
			filesize = targetFileBytes
		} else {
			var err error
			info, err = tm.GetTorrentInfo(torrentID)
			if err != nil {
				tm.downloadSG.Forget(cacheKey)
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
				tm.downloadSG.Forget(cacheKey)
				return nil, fmt.Errorf("file not found: %s", filePath)
			}

			if len(info.Links) == 0 {
				noLinksErr := fmt.Errorf("no links available")
				tm.brokenTorrentCache.Set(torrentID, &FailedFileEntry{
					Error:     noLinksErr,
					Timestamp: time.Now(),
				})

				if tm.store != nil {
					reason := "no_links_available"
					if saveErr := tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), reason); saveErr != nil {
						logger.Warn("[Torrents] Failed to save no links error to repair table for %s: %v", torrentID, saveErr)
					} else {
						logger.Info("[Torrents] Saved no links error to repair table for %s: %s", torrentID, reason)
					}
				}
				
				logger.Warn("[Torrents] No links available for torrent %s (will retry only if repair succeeds)", torrentID)
				tm.TriggerAutoRepair(torrentID)
				return nil, noLinksErr
			}

			if targetFile.ID-1 < len(info.Links) {
				downloadLink = info.Links[targetFile.ID-1]
			} else {
				downloadLink = info.Links[0]
			}
			
			filesize = targetFile.Bytes
		}

		if downloadLink == "" {
			emptyLinkErr := fmt.Errorf("empty download link")
			logger.Warn("[Torrents] Empty download link for torrent %s, file %s", torrentID, filePath)
			if tm.store != nil {
				if info == nil {
					info, _ = tm.GetTorrentInfo(torrentID)
				}
				if info != nil {
					reason := "empty_download_link"
					if saveErr := tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), reason); saveErr != nil {
						logger.Warn("[Torrents] Failed to save empty link error to repair table for %s: %v", torrentID, saveErr)
					} else {
						logger.Info("[Torrents] Saved empty link error to repair table for %s: %s", torrentID, reason)
					}
				}
			}
			
			tm.TriggerAutoRepair(torrentID)
			
			tm.brokenTorrentCache.Set(torrentID, &FailedFileEntry{
				Error:     emptyLinkErr,
				Timestamp: time.Now(),
			})
			tm.downloadSG.Forget(cacheKey)
			return nil, emptyLinkErr
		}
		
		// Unrestrict the link
		unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
		
		if err != nil {
			wrappedErr := fmt.Errorf("failed to unrestrict link: %w", err)
			if isBrokenLinkError(err) {
				logger.Info("[Torrents] File %s marked as broken (unrestrict failed: %v)", filePath, err)
				if tm.store != nil {
					if info == nil {
						info, _ = tm.GetTorrentInfo(torrentID)
					}
					if info != nil {
						reason := fmt.Sprintf("unrestrict_failed: %v", err)
						if saveErr := tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), reason); saveErr != nil {
							logger.Warn("[Torrents] Failed to save unrestrict error to repair table for %s: %v", torrentID, saveErr)
						} else {
						}
					}
				}
				
				tm.TriggerAutoRepair(torrentID)
				
				tm.brokenTorrentCache.Set(torrentID, &FailedFileEntry{
					Error:     fmt.Errorf("unrestrict failed: %v", err),
					Timestamp: time.Now(),
				})
			}
			
			tm.failedFileCache.Set(cacheKey, &FailedFileEntry{
				Error:     wrappedErr,
				Timestamp: time.Now(),
			})
			tm.downloadSG.Forget(cacheKey)
			return nil, wrappedErr
		}

		if unrestrictedLink.Download == "" {
			emptyErr := fmt.Errorf("unrestrict returned empty download URL")
			logger.Info("[Torrents] File %s marked as broken (empty download URL)", filePath)
			
			if tm.store != nil {
				if info == nil {
					info, _ = tm.GetTorrentInfo(torrentID)
				}
				if info != nil {
					reason := "empty_download_url"
					if saveErr := tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), reason); saveErr != nil {
						logger.Warn("[Torrents] Failed to save empty URL error to repair table for %s: %v", torrentID, saveErr)
					} else {
						logger.Info("[Torrents] Saved empty URL error to repair table for %s: %s", torrentID, reason)
					}
				}
			}
			
			tm.TriggerAutoRepair(torrentID)

			tm.brokenTorrentCache.Set(torrentID, &FailedFileEntry{
				Error:     emptyErr,
				Timestamp: time.Now(),
			})

			tm.failedFileCache.Set(cacheKey, &FailedFileEntry{
				Error:     emptyErr,
				Timestamp: time.Now(),
			})
			tm.downloadSG.Forget(cacheKey)
			return nil, emptyErr
		}
		
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

	const maxWorkers = 16
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
	return tm.httpDavTorrentsCache
}

// GetHttpDavLinks returns cached HTTP DAV links
func (tm *TorrentManager) GetHttpDavLinks() []HttpDavFileInfo {
	tm.httpDavCacheMutex.RLock()
	defer tm.httpDavCacheMutex.RUnlock()
	if tm.httpDavLinksCache == nil {
		return []HttpDavFileInfo{}
	}
	return tm.httpDavLinksCache
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
			if r := recover(); r != nil {
				logger.Error("[Refresh] PANIC in refresh goroutine: %v", r)
			}
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
        defer func() {
            if r := recover(); r != nil {
                logger.Error("[Torrents] PANIC in reconcile goroutine: %v", r)
            }
        }()
        
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