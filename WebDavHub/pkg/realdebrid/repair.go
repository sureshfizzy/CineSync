package realdebrid

import (
    "context"
    "fmt"
    "sync"
    "sync/atomic"
    "time"

    "cinesync/pkg/logger"
)

type RepairStrategy string

const (
    RepairStrategyPerTorrent RepairStrategy = "per_torrent"
    RepairStrategyPerFile    RepairStrategy = "per_file"
)

var (
    repairRunning         atomic.Bool
	repairRunningMu       sync.Mutex
    repairShouldStop      atomic.Bool
	repairQueue           = newRepairQueueList()
	repairInProgress      sync.Map
    CurrentRepairStrategy = RepairStrategyPerFile
    RepairProgress        = &RepairStatus{}
)

type repairQueueList struct {
	mu    sync.Mutex
	items []string
	set   map[string]struct{}
}

func newRepairQueueList() *repairQueueList {
	return &repairQueueList{
		items: make([]string, 0),
		set:   make(map[string]struct{}),
	}
}

func (q *repairQueueList) Enqueue(torrentID string) bool {
	if torrentID == "" {
		return false
	}

	q.mu.Lock()
	defer q.mu.Unlock()

	if _, exists := q.set[torrentID]; exists {
		return false
	}

	q.items = append(q.items, torrentID)
	q.set[torrentID] = struct{}{}
	return true
}

func (q *repairQueueList) Dequeue() string {
	q.mu.Lock()
	defer q.mu.Unlock()

	if len(q.items) == 0 {
		return ""
	}

	next := q.items[0]
	q.items = q.items[1:]
	delete(q.set, next)
	return next
}

func (q *repairQueueList) Remove(torrentID string) bool {
	if torrentID == "" {
		return false
	}
	
	q.mu.Lock()
	defer q.mu.Unlock()
	
	if _, exists := q.set[torrentID]; !exists {
		return false
	}
	
	delete(q.set, torrentID)
	for idx, item := range q.items {
		if item == torrentID {
			q.items = append(q.items[:idx], q.items[idx+1:]...)
			break
		}
	}
	return true
}

func (q *repairQueueList) List() []string {
	q.mu.Lock()
	defer q.mu.Unlock()

	out := make([]string, len(q.items))
	copy(out, q.items)
	return out
}

func (q *repairQueueList) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}

type RepairStatus struct {
    mu                sync.RWMutex
    IsRunning         bool
    CurrentTorrentID  string
    TotalTorrents     int64
    ProcessedTorrents int64
    BrokenFound       int64
    Validated         int64
    QueueSize         int
    LastRunTime       time.Time
    NextRunTime       time.Time
}

func (rs *RepairStatus) GetStatus() RepairStatus {
    rs.mu.RLock()
    defer rs.mu.RUnlock()
    return RepairStatus{
        IsRunning:         rs.IsRunning,
        CurrentTorrentID:  rs.CurrentTorrentID,
        TotalTorrents:     rs.TotalTorrents,
        ProcessedTorrents: rs.ProcessedTorrents,
        BrokenFound:       rs.BrokenFound,
        Validated:         rs.Validated,
        QueueSize:         rs.QueueSize,
        LastRunTime:       rs.LastRunTime,
        NextRunTime:       rs.NextRunTime,
    }
}

func (rs *RepairStatus) UpdateProgress(processed, broken, validated int64) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.ProcessedTorrents = processed
    rs.BrokenFound = broken
    rs.Validated = validated
}

func (rs *RepairStatus) SetRunning(running bool, torrentID string) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.IsRunning = running
    rs.CurrentTorrentID = torrentID
    if running {
        rs.LastRunTime = time.Time{}
    } else {
        rs.LastRunTime = time.Now()
        rs.CurrentTorrentID = ""
    }
}

func (rs *RepairStatus) SetTotals(total int64) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.TotalTorrents = total
}

func (rs *RepairStatus) UpdateQueueSize(size int) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.QueueSize = size
}

func (rs *RepairStatus) SetNextRun(nextRun time.Time) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.NextRunTime = nextRun
}

func (tm *TorrentManager) StartRepairWorker() {
    // Check if auto start repair is enabled
    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled || !config.RepairSettings.AutoStartRepair {
        logger.Debug("[RepairWorker] Auto start repair is disabled in settings")
        return
    }
    
    scanInterval := config.RepairSettings.ScanIntervalHours
    if scanInterval <= 0 {
        scanInterval = 48
    }
    
    initialDelay := 5 * time.Minute
    logger.Info("[RepairWorker] Auto repair monitor started - will scan every %d hours (first scan in %v)", scanInterval, initialDelay)
    
    // Start periodic repair scans
    go func() {
        defer func() {
            // CRITICAL: Always recover from panic
            if r := recover(); r != nil {
                logger.Error("[RepairWorker] PANIC in periodic repair scan goroutine: %v", r)
            }
        }()
        
        ticker := time.NewTicker(time.Duration(scanInterval) * time.Hour)
        defer ticker.Stop()

        time.Sleep(initialDelay)
        logger.Info("[RepairWorker] Running initial automatic repair scan")
        _ = tm.RepairAllTorrents()

        for range ticker.C {
            currentConfig := GetConfigManager().GetConfig()
            if !currentConfig.RepairSettings.Enabled || !currentConfig.RepairSettings.AutoStartRepair {
                logger.Info("[RepairWorker] Auto start repair disabled, stopping periodic scans")
                return
            }

            logger.Info("[RepairWorker] Running scheduled automatic repair scan")
            _ = tm.RepairAllTorrents()
        }
    }()
}

func SetRepairStrategy(strategy RepairStrategy) {
    CurrentRepairStrategy = strategy
    logger.Info("[RepairWorker] Repair strategy changed to: %s", strategy)
}

func GetRepairStrategy() RepairStrategy {
    return CurrentRepairStrategy
}

func GetRepairStatus() RepairStatus {
    status := RepairProgress.GetStatus()
	status.QueueSize = repairQueue.Len()
    
    return status
}

// GetQueuedTorrents returns the current repair queue (FIFO order)
func GetQueuedTorrents() []string {
	return repairQueue.List()
}

// RemoveQueuedTorrents removes the provided torrent IDs from the pending queue (if not currently running)
func RemoveQueuedTorrents(ids []string) []string {
	if len(ids) == 0 {
		return []string{}
	}

	removed := make([]string, 0, len(ids))
	statusSnapshot := RepairProgress.GetStatus()
	currentID := statusSnapshot.CurrentTorrentID
	isRunning := statusSnapshot.IsRunning

	for _, torrentID := range ids {
		if torrentID == "" {
			continue
		}
		if isRunning && currentID == torrentID {
			// Skip the torrent currently being processed
			continue
		}
		if repairQueue.Remove(torrentID) {
			repairInProgress.Delete(torrentID)
			removed = append(removed, torrentID)
		}
	}

	if len(removed) > 0 {
		RepairProgress.UpdateQueueSize(repairQueue.Len())
	}

	return removed
}

// RepairTorrent triggers a manual repair for a specific torrent
func (tm *TorrentManager) RepairTorrent(torrentID string) error {
    if tm == nil || tm.store == nil {
        return fmt.Errorf("manager or store not initialized")
    }
    
    if torrentID == "" {
        return fmt.Errorf("torrent ID cannot be empty")
    }
    
    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled {
        logger.Debug("[RepairWorker] Repair is disabled in settings")
        return fmt.Errorf("repair is disabled in settings")
    }
    
    logger.Info("[RepairWorker] Starting manual repair for torrent %s", torrentID)
    // If this specific torrent is already queued/running, do nothing
    if _, inQueue := repairInProgress.Load(torrentID); inQueue {
        logger.Debug("[RepairWorker] Torrent %s already queued/running, skipping duplicate enqueue", torrentID)
        return nil
    }
    // If a repair job is already running, enqueue this ID
    repairRunningMu.Lock()
    if repairRunning.Load() {
		if repairQueue.Enqueue(torrentID) {
			RepairProgress.UpdateQueueSize(repairQueue.Len())
		}
        repairInProgress.Store(torrentID, true)
        repairRunningMu.Unlock()
        logger.Debug("[RepairWorker] Repair already running, queued torrent %s", torrentID)
        return nil
    }
    // Otherwise start a new repair job with this ID
    repairRunning.Store(true)
    repairInProgress.Store(torrentID, true)
    repairRunningMu.Unlock()
    tm.triggerRepair(torrentID)
    return nil
}

// TriggerAutoRepair triggers automatic repair for broken torrents
func (tm *TorrentManager) TriggerAutoRepair(torrentID string) {
    if tm == nil || tm.store == nil {
        return
    }

    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled {
        return
    }
    
    if _, inQueue := repairInProgress.Load(torrentID); inQueue {
        return
    }

    repairRunningMu.Lock()
    if repairRunning.Load() {
		if repairQueue.Enqueue(torrentID) {
			RepairProgress.UpdateQueueSize(repairQueue.Len())
		}
        repairInProgress.Store(torrentID, true)
        repairRunningMu.Unlock()
        logger.Debug("[RepairWorker] Repair already running, queued torrent %s", torrentID)
        return
    }

    repairRunning.Store(true)
    repairInProgress.Store(torrentID, true)
    repairRunningMu.Unlock()
    
    logger.Info("[RepairWorker] Triggering repair for torrent %s", torrentID)
    tm.triggerRepair(torrentID)
}

// triggerRepair processes torrents one at a time
func (tm *TorrentManager) triggerRepair(torrentID string) {
    go func() {
        defer func() {
            if r := recover(); r != nil {
                logger.Error("[RepairWorker] PANIC in repair goroutine: %v", r)
            }
            repairInProgress.Delete(torrentID)
			repairRunningMu.Lock()
			repairRunning.Store(false)
			repairRunningMu.Unlock()
        }()
        for {
            var fixed bool
            var err error
            
            repairTimeout := 30 * time.Second
            repairDone := make(chan struct{})
            
            go func() {
                defer func() {
                    if r := recover(); r != nil {
                        logger.Error("[RepairWorker] PANIC during repairTorrentFiles for %s: %v", torrentID, r)
                        err = fmt.Errorf("panic during repair: %v", r)
                    }
                    close(repairDone)
                }()
                fixed, err = tm.repairTorrentFiles(torrentID)
            }()
            
            timedOut := false
            select {
            case <-repairDone:
            case <-time.After(repairTimeout):
                err = fmt.Errorf("repair timeout after %v", repairTimeout)
                fixed = false
                timedOut = true
            }
            
            if timedOut {
                if tm.store != nil {
                    if info, infoErr := tm.GetTorrentInfo(torrentID); infoErr == nil && info != nil {
                        _ = tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), "repair_timeout")
                    }
                }
                repairInProgress.Delete(torrentID)
                repairRunningMu.Lock()
                queuedTorrentID := repairQueue.Dequeue()
                RepairProgress.UpdateQueueSize(repairQueue.Len())
                if queuedTorrentID == "" {
                    repairRunningMu.Unlock()
                    break
                }
                repairRunningMu.Unlock()
                torrentID = queuedTorrentID
                continue
            }
            
        if err != nil {
                logger.Debug("[RepairWorker] Repair attempt for %s completed with: %v", torrentID, err)
            if newID, ok := torrentIDMapping.Get(torrentID); ok && newID != "" {
                    logger.Info("[RepairWorker] Torrent %s was replaced with new ID %s", torrentID, newID)
                    if delErr := tm.client.DeleteTorrent(torrentID); delErr != nil {
                        logger.Debug("[RepairWorker] Delete torrent %s from Real-Debrid returned: %v", torrentID, delErr)
                    }
                    if err := tm.store.DeleteRepair(torrentID); err != nil {
                        logger.Error("[RepairWorker] Failed to delete repair entry for %s: %v", torrentID, err)
                    } else {
                        logger.Info("[RepairWorker] Removed torrent %s from repair table", torrentID)
                    }
                    _ = tm.store.UpdateRepairState(torrentID, false, 0, 0)
                    tm.brokenTorrentCache.Remove(torrentID)
            } else {
            _, getErr := tm.GetTorrentInfo(torrentID)
            if getErr != nil && IsTorrentNotFound(getErr) {
                        logger.Info("[RepairWorker] Torrent %s was successfully replaced with a new ID", torrentID)
                        if delErr := tm.client.DeleteTorrent(torrentID); delErr != nil {
                            logger.Debug("[RepairWorker] Delete torrent %s from Real-Debrid returned: %v", torrentID, delErr)
                        }
                        if err := tm.store.DeleteRepair(torrentID); err != nil {
                            logger.Error("[RepairWorker] Failed to delete repair entry for %s: %v", torrentID, err)
                        }
                        _ = tm.store.UpdateRepairState(torrentID, false, 0, 0)
                        tm.brokenTorrentCache.Remove(torrentID)
                    } else {
                        logger.Debug("[RepairWorker] Torrent %s not found after repair attempt", torrentID)
                    }
            }
            } else if fixed {
                logger.Info("[RepairWorker] Torrent %s successfully repaired and removed from queue", torrentID)
                if err := tm.store.DeleteRepair(torrentID); err != nil {
                    logger.Error("[RepairWorker] Failed to delete repair entry for %s: %v", torrentID, err)
                } else {
                    logger.Info("[RepairWorker] Removed torrent %s from repair table (repair successful)", torrentID)
                }
                _ = tm.store.UpdateRepairState(torrentID, false, 0, 0)
                tm.brokenTorrentCache.Remove(torrentID)
            } else {
                logger.Debug("[RepairWorker] Torrent %s repair failed, marked as broken", torrentID)
            }
            
            // Mark current torrent as done processing
            repairInProgress.Delete(torrentID)
            
			// Check if there are more torrents in queue
			repairRunningMu.Lock()
			queuedTorrentID := repairQueue.Dequeue()
			RepairProgress.UpdateQueueSize(repairQueue.Len())
			if queuedTorrentID == "" {
				// No more torrents to repair
				repairRunningMu.Unlock()
				break
			}
			repairRunningMu.Unlock()
            
            // Process next queued torrent
            torrentID = queuedTorrentID
            logger.Info("[RepairWorker] Processing next queued torrent: %s", torrentID)
        }
    }()
}

func (tm *TorrentManager) RepairAllTorrents() error {
    if tm == nil || tm.store == nil {
        return fmt.Errorf("manager or store not initialized")
    }
    
    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled {
        return fmt.Errorf("repair is disabled in settings")
    }
    
    logger.Info("[RepairWorker] On-demand repair requested for all torrents")
    go tm.scanForBrokenTorrents("")
    
    return nil
}

func (tm *TorrentManager) StopRepair() error {
    if !repairRunning.Load() {
        return fmt.Errorf("no repair is currently running")
    }
    
    logger.Info("[RepairWorker] Stop signal received, will halt after current torrent")
    repairShouldStop.Store(true)
    
    return nil
}

func (tm *TorrentManager) scanForBrokenTorrents(torrentID string) {
    if tm == nil || tm.store == nil {
        return
    }

    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled {
        logger.Debug("[RepairWorker] Repair is disabled, skipping scan for broken torrents")
        return
    }

    if !repairRunning.CompareAndSwap(false, true) {
        if torrentID != "" {
			if repairQueue.Enqueue(torrentID) {
				RepairProgress.UpdateQueueSize(repairQueue.Len())
			}
        }
        return
    }
    defer func() {
        if r := recover(); r != nil {
            logger.Error("[RepairWorker] PANIC in scanForBrokenTorrents: %v", r)
        }
        repairRunning.Store(false)
        RepairProgress.SetRunning(false, "")
        logger.Debug("[RepairWorker] scanForBrokenTorrents exited, repairRunning reset to false")
    }()
    
    repairShouldStop.Store(false)
    RepairProgress.SetRunning(true, torrentID)

    if torrentID != "" {
        logger.Info("[RepairWorker] Starting on-demand repair for torrent %s", torrentID)
    }
    
    var items []TorrentItem
    
    if torrentID != "" {
        item, err := tm.store.GetItemByID(torrentID)
        if err != nil {
            return
        }
        items = []TorrentItem{item}
    } else {
        uncheckedIDs, err := tm.store.GetUncheckedTorrents(3600)
        if err != nil {
            logger.Warn("[RepairWorker] Failed to get unchecked torrents: %v", err)
            items, err = tm.store.GetAllItems()
            if err != nil {
                logger.Warn("[RepairWorker] Failed to get all items: %v", err)
                return
            }
        } else if len(uncheckedIDs) > 0 {
            logger.Info("[RepairWorker] Found %d unchecked/stale torrents to validate", len(uncheckedIDs))
            for _, id := range uncheckedIDs {
                item, getErr := tm.store.GetItemByID(id)
                if getErr == nil {
                    items = append(items, item)
                }
            }
        } else {
            return
        }
    }

    RepairProgress.SetTotals(int64(len(items)))

    var brokenCount, validatedCount int64

    for _, item := range items {
        if repairShouldStop.Load() {
            logger.Info("[RepairWorker] Stop requested, halting repair scan")
            break
        }
        if item.Status == "downloading" || item.Status == "queued" || item.Status == "magnet_error" {
            logger.Debug("[RepairWorker] Skipping torrent %s in transient state: %s", item.ID, item.Status)
            continue
        }
        
        if item.Status != "downloaded" && item.Status != "error" && item.Status != "virus" && item.Status != "dead" {
            continue
        }

        refreshedInfo, err := tm.client.GetTorrentInfo(item.ID)
        if err != nil {
            if IsTorrentNotFound(err) {
                tm.deleteTorrentFromCache(item.ID)
            } else {
                logger.Warn("[RepairWorker] Failed to refresh torrent %s: %v", item.ID, err)
            }
            continue
        }
        
        if refreshedInfo == nil {
            continue
        }

        if tm.infoStore != nil {
            _ = tm.infoStore.Upsert(refreshedInfo)
        }

        if refreshedInfo.Progress == 100 {
            tm.InfoMap.Set(item.ID, refreshedInfo)
        }
        
        info := refreshedInfo

        selectedVideoFileCount := 0
        var videoFiles []TorrentFile
        for _, file := range info.Files {
            if file.Selected != 1 {
                continue
            }
            
            // Only count video files
            if !isVideoFile(file.Path) {
                continue
            }
            
            selectedVideoFileCount++
            videoFiles = append(videoFiles, file)
        }

        isBroken := false
        reason := ""

        if info.Status == "error" {
            isBroken = true
            reason = "error_status"
        } else if info.Status == "virus" {
            isBroken = true
            reason = "virus_detected"
        } else if info.Status == "dead" {
            isBroken = true
            reason = "dead_torrent"
        } else if info.Status == "downloaded" {
            if len(info.Links) == 0 {
                isBroken = true
                reason = "no_links_downloaded"
            } else if selectedVideoFileCount == 0 && len(info.Links) == 0 {
                isBroken = false
            } else if len(info.Links) > 0 {
                totalLinks := len(info.Links)
                strategy := CurrentRepairStrategy
                
                ctx, cancel := context.WithCancel(context.Background())
                defer cancel()
                
                var wg sync.WaitGroup
                var brokenLinkCount int64
                var torrentWideFailed atomic.Bool
                
                wg.Add(totalLinks)
                
                for i := 0; i < totalLinks; i++ {
                    go func(index int, link string) {
                        defer wg.Done()

                        select {
                        case <-ctx.Done():
                            return
                        default:
                        }
                        
                        if err := tm.client.CheckLink(link); err != nil {
                            atomic.AddInt64(&brokenLinkCount, 1)
                            
                            if strategy == RepairStrategyPerTorrent {
                                if torrentWideFailed.CompareAndSwap(false, true) {
                                    cancel()
                                }
                            }
                        }
                    }(i, info.Links[i])
                }
                
                wg.Wait()
                
                validatedCount++
                
                if strategy == RepairStrategyPerTorrent && torrentWideFailed.Load() {
                    isBroken = true
                    reason = fmt.Sprintf("link_validation_failed_per_torrent_%d_of_%d", brokenLinkCount, totalLinks)
                } else if strategy == RepairStrategyPerFile && brokenLinkCount > 0 {
                    isBroken = true
                    reason = fmt.Sprintf("link_validation_failed_per_file_%d_of_%d", brokenLinkCount, totalLinks)
                }
            }
        }

        if info.Progress >= 100 && info.Status != "downloaded" && len(info.Links) == 0 && selectedVideoFileCount > 0 {
            isBroken = true
            if reason == "" {
                reason = "complete_but_no_links"
            }
        }

        if isBroken {
            _ = tm.store.UpsertRepair(info.ID, info.Filename, info.Hash, info.Status, int(info.Progress), reason)
            brokenCount++
            brokenLinks := len(info.Links)
            _ = tm.store.UpdateRepairState(info.ID, true, brokenLinks, len(info.Links))
            
            // If AutoFix is enabled, queue repair for broken torrents
            config := GetConfigManager().GetConfig()
            if config.RepairSettings.AutoFix {
                tm.TriggerAutoRepair(info.ID)
            }
        } else {
            _ = tm.store.DeleteRepair(info.ID)
            _ = tm.store.UpdateRepairState(info.ID, false, 0, len(info.Links))
        }
        
        RepairProgress.UpdateProgress(brokenCount, brokenCount, validatedCount)
    }

    if torrentID == "" && brokenCount > 0 {
        logger.Info("[RepairWorker] Scan complete: found %d broken torrents", brokenCount)
    }
}