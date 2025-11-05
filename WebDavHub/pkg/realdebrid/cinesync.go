package realdebrid

import (
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

// saveCineSync writes full TorrentInfo to the SQLite store
func (tm *TorrentManager) saveCineSync(info *TorrentInfo) {
    if info == nil || tm.store == nil {
        return
    }
    if err := tm.store.UpsertInfo(info); err != nil {
        logger.Warn("[CineSync] Store upsert info failed for %s: %v", info.ID, err)
    }
}

// saveCineSyncItem writes a lightweight TorrentItem to the SQLite store
func (tm *TorrentManager) saveCineSyncItem(item TorrentItem) {
    if tm.store == nil {
        return
    }
    if err := tm.store.UpsertItem(item); err != nil {
        logger.Warn("[CineSync] Store upsert item failed for %s: %v", item.ID, err)
    }
}

// saveAllTorrents persists placeholders fast and then schedules background detail updates
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
        if err := tm.store.BulkUpsertItems(list, func(n int) {
            last = n
            logger.Info("[CineSync] Directory progress: %d/%d", n, missingTotal)
        }); err != nil {
            logger.Warn("[CineSync] Bulk upsert failed, falling back to per-item: %v", err)
            var written int64
            for i := range list {
                tm.saveCineSyncItem(list[i])
                if v := atomic.AddInt64(&written, 1); v%2000 == 0 || int(v) == missingTotal {
                    logger.Info("[CineSync] Directory progress: %d/%d", v, missingTotal)
                }
            }
            last = int(written)
        }
        logger.Info("[CineSync] Directory update complete: %d items", last)
    }

    go func(items []TorrentItem) {
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
            logger.Info("[CineSync] Enrich: nothing to queue")
            return
        }
        logger.Info("[CineSync] Enrich: queued %d ids", len(ids))

        // Initialize enrichment counters only when starting a new run
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
                        _ = tm.store.UpsertRepair(it.ID, info.Filename, info.Status, int(info.Progress), "no_links")
                    } else {
                        tm.saveCineSync(info)
                        _ = tm.store.DeleteRepair(it.ID)
                        _ = atomic.AddInt64(&saved, 1)
                        EnrichSaved.Add(1)
                    }
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

// SaveAllTorrents writes placeholders using the current torrent list and WebDAV cache.
func (tm *TorrentManager) SaveAllTorrents() {
    tm.cacheMutex.RLock()
    list := make([]TorrentItem, len(tm.torrentList))
    copy(list, tm.torrentList)
    tm.cacheMutex.RUnlock()
    tm.saveAllTorrents(list)
}

// GetDirs returns DB-backed directory entries; readyOnly restricts to entries with links.
func (tm *TorrentManager) GetDirs(readyOnly bool) []DirEntry {
    if tm == nil || tm.store == nil {
        return nil
    }
    dirs, err := tm.store.GetDirs(readyOnly)
    if err != nil {
        return nil
    }
    return dirs
}

// ReconcileDBWithRD removes DB entries that are no longer present in RD list
func (tm *TorrentManager) ReconcileDBWithRD(rdIDs []string) {
    if tm == nil || tm.store == nil { return }
    dbIDs, err := tm.store.GetAllIDs()
    if err != nil { return }
    present := make(map[string]struct{}, len(rdIDs))
    for _, id := range rdIDs { present[id] = struct{}{} }
    for _, id := range dbIDs {
        if _, ok := present[id]; !ok {
            _ = tm.store.DeleteByID(id)
            if tm.infoStore != nil { _ = tm.infoStore.Delete(id) }
            tm.cacheMutex.Lock()
            delete(tm.infoCache, id)
            tm.cacheMutex.Unlock()
        }
    }
}

// DeleteFromDBByID removes a torrent row by ID
func (tm *TorrentManager) DeleteFromDBByID(id string) {
    if tm == nil || tm.store == nil { return }
    _ = tm.store.DeleteByID(id)
    if tm.infoStore != nil { _ = tm.infoStore.Delete(id) }
    tm.cacheMutex.Lock()
    delete(tm.infoCache, id)
    tm.cacheMutex.Unlock()
}