package realdebrid

import (
    "strings"
    "sync"
    "sync/atomic"

    "cinesync/pkg/logger"
)

// CineSync worker configuration (exported for API/metrics)
var (
    CineSyncIOWorkers  = 32
    CineSyncAPIWorkers = 8
    CineSyncIOInUse    atomic.Int64
    CineSyncAPIInUse   atomic.Int64
    EnrichTotal        atomic.Int64
    EnrichProcessed    atomic.Int64
    EnrichSaved        atomic.Int64
    enrichRunning      atomic.Bool
)

// saveCineSync writes full TorrentInfo to the file-based store
func (tm *TorrentManager) saveCineSync(info *TorrentInfo) {
	if info == nil || tm.store == nil {
		return
	}

	if existing, err := tm.store.LoadInfo(info.ID); err != nil || existing == nil {
		tm.initializeFileStates(info)
	} else {
		tm.preserveFileStates(info, existing)
	}
	if err := tm.store.SaveInfo(info); err != nil {
		logger.Warn("[CineSync] Failed to save info for %s: %v", info.ID, err)
	}
}

// saveCineSyncItem writes a lightweight TorrentItem to the file-based store
func (tm *TorrentManager) saveCineSyncItem(item TorrentItem) {
	if tm.store == nil {
		return
	}
	if err := tm.store.SaveItem(item); err != nil {
		logger.Warn("[CineSync] Failed to save item for %s: %v", item.ID, err)
	}
}

func (tm *TorrentManager) saveAllTorrents(list []TorrentItem) {
	if len(list) == 0 || tm.store == nil {
		return
	}

	if existingIDs, err := tm.store.GetAllIDs(); err == nil {
		exist := make(map[string]struct{}, len(existingIDs))
		for _, id := range existingIDs { exist[id] = struct{}{} }
		missing := make([]TorrentItem, 0, len(list))
		for i := range list {
			if _, ok := exist[list[i].ID]; !ok {
				missing = append(missing, list[i])
			}
		}
		if len(missing) == 0 {
			list = nil
		} else {
			list = missing
		}
	}

	missingTotal := len(list)
	var last int
	if missingTotal > 0 {
		if err := tm.store.BulkSaveItems(list, func(n int) {
			last = n
		}); err != nil {
			logger.Warn("[CineSync] Bulk save failed, falling back to per-item: %v", err)
			var written int64
			for i := range list {
				tm.saveCineSyncItem(list[i])
				atomic.AddInt64(&written, 1)
			}
			last = int(written)
		}
		logger.Info("[CineSync] Directory update complete: %d items", last)
	}

	go func(items []TorrentItem) {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("[CineSync] PANIC in enrich goroutine: %v", r)
				enrichRunning.Store(false)
			}
		}()
		if !enrichRunning.CompareAndSwap(false, true) {
			return
		}
		defer enrichRunning.Store(false)

		ids, err := tm.store.GetIDsNeedingUpdate(0)
		if err != nil {
			logger.Warn("[CineSync] Failed to load worklist: %v", err)
			return
		}
		if len(ids) == 0 {
			return
		}
		logger.Info("[CineSync] Enrich: queued %d ids", len(ids))

		EnrichTotal.Store(int64(len(ids)))
		EnrichProcessed.Store(0)
		EnrichSaved.Store(0)

		idToItem := make(map[string]TorrentItem, len(items))
		for i := range items { idToItem[items[i].ID] = items[i] }
		toUpdate := make([]TorrentItem, 0, len(ids))
		for _, id := range ids {
			if it, ok := idToItem[id]; ok {
				toUpdate = append(toUpdate, it)
			} else {
				toUpdate = append(toUpdate, TorrentItem{ID: id})
			}
		}
		if len(toUpdate) == 0 { return }

		apiWorkers := CineSyncAPIWorkers
		apiJobs := make(chan TorrentItem, len(toUpdate))
		var apiWg sync.WaitGroup
		var saved int64
		var processed int64
		total2 := len(toUpdate)

		worker := func() {
			defer apiWg.Done()
			for it := range apiJobs {
				CineSyncAPIInUse.Add(1)
				if need, err := tm.store.NeedsUpdate(it); err == nil && !need {
					_ = atomic.AddInt64(&processed, 1)
					CineSyncAPIInUse.Add(-1)
					continue
				}
				if info, err := tm.GetTorrentInfo(it.ID); err == nil && info != nil {
					if len(info.Links) == 0 {
						_ = tm.store.UpsertRepair(it.ID, info.Filename, info.Hash, info.Status, int(info.Progress), "no_links")
					} else {
						tm.saveCineSync(info)
						_ = tm.store.DeleteRepair(it.ID)
						_ = atomic.AddInt64(&saved, 1)
						EnrichSaved.Add(1)
					}
				} else if err != nil && IsTorrentNotFound(err) {
					// Torrent no longer exists on Real-Debrid, delete from cache
					logger.Debug("[CineSync] Torrent %s not found, deleting from cache", it.ID)
					tm.deleteTorrentFromCache(it.ID)
				}
				if v := atomic.AddInt64(&processed, 1); v%1000 == 0 || int(v) == total2 {
					logger.Info("[CineSync] Enrich progress: %d/%d (saved %d)", v, total2, saved)
				}
				EnrichProcessed.Add(1)
				CineSyncAPIInUse.Add(-1)
			}
		}

		for i := 0; i < apiWorkers; i++ { apiWg.Add(1); go worker() }
		for _, it := range toUpdate { apiJobs <- it }
		close(apiJobs)
		apiWg.Wait()
		logger.Info("[CineSync] Enrich complete: processed %d, saved %d", processed, saved)
	}(list)
}

// isVideoFile checks if a file is a video file based on its extension
func isVideoFile(filename string) bool {
    videoExtensions := map[string]bool{
        ".mkv": true, ".mp4": true, ".avi": true, ".mov": true, ".wmv": true,
        ".flv": true, ".webm": true, ".m4v": true, ".mpg": true, ".mpeg": true,
        ".3gp": true, ".ogv": true, ".ts": true, ".m2ts": true, ".mts": true,
    }

    ext := ""
    for i := len(filename) - 1; i >= 0; i-- {
        if filename[i] == '.' {
            ext = strings.ToLower(filename[i:])
            break
        }
    }
    
    return videoExtensions[ext]
}

// SaveAllTorrents writes placeholders using the current torrent list from DirectoryMap.
func (tm *TorrentManager) SaveAllTorrents() {
    allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
    if !ok {
        logger.Warn("[CineSync] Directory map not initialized")
        return
    }
    
    keys := allTorrentsMap.Keys()
    list := make([]TorrentItem, 0, len(keys))
    for _, key := range keys {
        if item, ok := allTorrentsMap.Get(key); ok && item != nil {
            list = append(list, *item)
        }
    }
    
    tm.saveAllTorrents(list)
}

// GetDirs returns directory entries from in-memory cache
func (tm *TorrentManager) GetDirs(readyOnly bool) []DirEntry {
	if tm == nil {
		return nil
	}
	
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		return nil
	}
	
	keys := allTorrents.Keys()
	dirs := make([]DirEntry, 0, len(keys))
	
	for _, key := range keys {
		if item, ok := allTorrents.Get(key); ok && item != nil {
			if readyOnly && len(item.CachedLinks) == 0 {
				continue
			}
			
			dirs = append(dirs, DirEntry{
				ID:       item.ID,
				Filename: item.Filename,
				Bytes:    item.Bytes,
				Files:    item.Files,
				Status:   item.Status,
				Added:    item.Added,
			})
		}
	}
	
	return dirs
}

// ReconcileDBWithRD removes file entries that are no longer present in RD list
func (tm *TorrentManager) ReconcileDBWithRD(rdIDs []string) {
	if tm == nil || tm.store == nil { return }
	dbIDs, err := tm.store.GetAllIDs()
	if err != nil { return }
	present := make(map[string]struct{}, len(rdIDs))
	for _, id := range rdIDs { present[id] = struct{}{} }
	for _, id := range dbIDs {
		if _, ok := present[id]; !ok {
			_ = tm.store.DeleteByID(id)
			tm.InfoMap.Remove(id)
		}
	}
}

// DeleteFromDBByID removes a torrent by ID from file-based store
func (tm *TorrentManager) DeleteFromDBByID(id string) {
	if tm == nil || tm.store == nil { return }
	_ = tm.store.DeleteByID(id)
	tm.InfoMap.Remove(id)
}

// deleteTorrentFromCache removes a torrent from all caches and file-based store
func (tm *TorrentManager) deleteTorrentFromCache(torrentID string) {
	if tm == nil {
		return
	}
	
	// Delete from file-based store
	if tm.store != nil {
		_ = tm.store.DeleteByID(torrentID)
	}
	
	// Remove from in-memory caches
	tm.InfoMap.Remove(torrentID)
	tm.idToItemMap.Remove(torrentID)
	
	// Remove from directory maps
	allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if ok {
		// Find and remove from ALL_TORRENTS map
		keys := allTorrents.Keys()
		for _, key := range keys {
			if item, found := allTorrents.Get(key); found && item != nil && item.ID == torrentID {
				allTorrents.Remove(key)
				break
			}
		}
	}
	
	// Remove from download link cache (keys contain torrentID)
	tm.downloadLinkCache.IterCb(func(key string, val *DownloadLinkEntry) {
		if strings.Contains(key, torrentID) {
			tm.downloadLinkCache.Remove(key)
		}
	})
	
	// Remove from failed file cache
	tm.failedFileCache.IterCb(func(key string, val *FailedFileEntry) {
		if strings.Contains(key, torrentID) {
			tm.failedFileCache.Remove(key)
		}
	})
}