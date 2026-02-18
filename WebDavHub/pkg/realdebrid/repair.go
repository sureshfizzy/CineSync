package realdebrid

import (
    "context"
    "fmt"
    "sync"
    "sync/atomic"
    "time"

    "cinesync/pkg/logger"
)

var (
    repairCtxCancel context.CancelFunc
    repairCtx       context.Context
)

func init() {
	repairCtx, repairCtxCancel = context.WithCancel(context.Background())
}

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
    IsRunning         bool      `json:"is_running"`
    CurrentTorrentID  string    `json:"current_torrent_id"`
    TotalTorrents     int64     `json:"total_torrents"`
    ProcessedTorrents int64     `json:"processed_torrents"`
    BrokenFound       int64     `json:"broken_found"`
    Validated         int64     `json:"validated"`
    QueueSize         int       `json:"queue_size"`
    LastRunTime       time.Time `json:"last_run_time"`
    NextRunTime       time.Time `json:"next_run_time"`
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
    
    if _, inQueue := repairInProgress.Load(torrentID); inQueue {
        logger.Debug("[RepairWorker] Torrent %s already queued/running, skipping duplicate enqueue", torrentID)
        return nil
    }
    
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
    
    repairShouldStop.Store(false)
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
    if !config.RepairSettings.Enabled || !config.RepairSettings.AutoFix {
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

    repairShouldStop.Store(false)
    repairRunning.Store(true)
    repairInProgress.Store(torrentID, true)
    repairRunningMu.Unlock()
    
    logger.Info("[RepairWorker] Triggering repair for torrent %s", torrentID)
    tm.triggerRepair(torrentID)
}

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
            RepairProgress.SetRunning(false, "")
        }()
        
        for {
            if repairShouldStop.Load() {
                logger.Info("[RepairWorker] Stop signal received, halting repair")
                repairInProgress.Delete(torrentID)
                break
            }
            
            var fixed bool
            var err error
            
            repairTimeout := 30 * time.Second
            ctx, cancel := context.WithTimeout(context.Background(), repairTimeout)
            
            resultChan := make(chan struct {
                fixed bool
                err   error
            }, 1)
            
            go func() {
                defer func() {
                    if r := recover(); r != nil {
                        logger.Error("[RepairWorker] PANIC during repairTorrentFiles for %s: %v", torrentID, r)
                        resultChan <- struct {
                            fixed bool
                            err   error
                        }{false, fmt.Errorf("panic during repair: %v", r)}
                    }
                }()
                fixedVal, errVal := tm.repairTorrentFiles(ctx, torrentID)
                select {
                case resultChan <- struct {
                    fixed bool
                    err   error
                }{fixedVal, errVal}:
                case <-ctx.Done():
                }
            }()
            
            select {
            case result := <-resultChan:
                fixed = result.fixed
                err = result.err
                cancel()
            case <-ctx.Done():
                cancel()
                err = fmt.Errorf("repair timeout after %v", repairTimeout)
                fixed = false
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
                    return
                }
                repairRunningMu.Unlock()
                torrentID = queuedTorrentID
                continue
            }
            
            if repairShouldStop.Load() {
                logger.Info("[RepairWorker] Stop signal received after repair, halting")
                break
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
            
            repairInProgress.Delete(torrentID)
            
            if repairShouldStop.Load() {
                logger.Info("[RepairWorker] Stop signal received, not processing next queued torrent")
                break
            }
            
            repairRunningMu.Lock()
            queuedTorrentID := repairQueue.Dequeue()
            RepairProgress.UpdateQueueSize(repairQueue.Len())
            if queuedTorrentID == "" {
                repairRunningMu.Unlock()
                break
            }
            repairRunningMu.Unlock()
            
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
    
    if repairCtxCancel != nil {
        repairCtxCancel()
    }
    
    return nil
}

func (tm *TorrentManager) ValidateStuckRepairsOnStartup() {
    
    cleanedCount := 0
    repairInProgress.Range(func(key, value interface{}) bool {
        if torrentID, ok := key.(string); ok {
            repairInProgress.Delete(torrentID)
            cleanedCount++
        }
        return true
    })
    
    if cleanedCount > 0 {
    }
    
    if repairRunning.Load() {
        repairRunning.Store(false)
    }
}

func (tm *TorrentManager) CleanupOrphanedRepairEntries() {
    repairInProgress.Range(func(key, value interface{}) bool {
        if torrentID, ok := key.(string); ok {
            queueItems := repairQueue.List()
            inQueue := false
            for _, queuedID := range queueItems {
                if queuedID == torrentID {
                    inQueue = true
                    break
                }
            }
            
            if !inQueue && !repairRunning.Load() {
                repairInProgress.Delete(torrentID)
            }
        }
        return true
    })
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

    logger.Debug("[RepairWorker] Attempting to acquire repair lock")
    if !repairRunning.CompareAndSwap(false, true) {
        logger.Warn("[RepairWorker] Repair already running, cannot start new scan")
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
        logger.Info("[RepairWorker] scanForBrokenTorrents exited, repairRunning reset to false")
    }()
    
    repairShouldStop.Store(false)
    RepairProgress.SetRunning(true, torrentID)

    if torrentID != "" {
        logger.Info("[RepairWorker] Starting on-demand repair for torrent %s", torrentID)
    }
    
    var items []TorrentItem
    
    if torrentID != "" {
        allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
        if !ok {
            return
        }
        
        item, ok := allTorrentsMap.Get(torrentID)
        if !ok {
            return
        }
        items = []TorrentItem{*item}
    } else {
        allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
        if !ok {
            logger.Warn("[RepairWorker] ALL_TORRENTS not found in DirectoryMap")
            return
        }
        
        if tm.store == nil {
            logger.Warn("[RepairWorker] Store is nil, cannot get broken torrents list")
            return
        }
        
        repairs, err := tm.store.GetAllRepairs()
        if err != nil {
            logger.Warn("[RepairWorker] Failed to get repair entries: %v", err)
            return
        }
        
        logger.Info("[RepairWorker] Found %d torrents in repair database", len(repairs))
        
        for _, repair := range repairs {
            if item, ok := allTorrentsMap.Get(repair.TorrentID); ok {
                items = append(items, *item)
            } else {
                logger.Debug("[RepairWorker] Torrent %s from repair DB not found in memory, may have been deleted", repair.TorrentID)
            }
        }
    }

    RepairProgress.SetTotals(int64(len(items)))
    logger.Info("[RepairWorker] Starting repair for %d broken torrents", len(items))

    var repairedCount int64

    for idx, item := range items {
        if repairShouldStop.Load() {
            logger.Info("[RepairWorker] Stop requested, halting repair")
            break
        }
        
        logger.Info("[RepairWorker] Repairing torrent %d/%d: %s", idx+1, len(items), item.ID)
        RepairProgress.UpdateProgress(int64(idx+1), 0, repairedCount)
        
        if item.Status == "downloading" || item.Status == "queued" || item.Status == "magnet_error" {
            logger.Debug("[RepairWorker] Skipping torrent %s in transient state: %s", item.ID, item.Status)
            continue
        }
        
        go tm.triggerRepair(item.ID)
        repairedCount++
    }

    logger.Info("[RepairWorker] Repair complete: triggered repair for %d torrents", repairedCount)
    
    tm.CleanupOrphanedRepairEntries()
}