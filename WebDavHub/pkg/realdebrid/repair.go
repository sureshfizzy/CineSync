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
    repairShouldStop      atomic.Bool
    repairQueue           sync.Map
    CurrentRepairStrategy = RepairStrategyPerFile
    RepairProgress        = &RepairStatus{}
)

type RepairStatus struct {
    mu                sync.RWMutex
    IsRunning         bool
    CurrentTorrentID  string
    TotalTorrents     int64
    ProcessedTorrents int64
    BrokenFound       int64
    Fixed             int64
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
        Fixed:             rs.Fixed,
        Validated:         rs.Validated,
        QueueSize:         rs.QueueSize,
        LastRunTime:       rs.LastRunTime,
        NextRunTime:       rs.NextRunTime,
    }
}

func (rs *RepairStatus) UpdateProgress(processed, broken, fixed, validated int64) {
    rs.mu.Lock()
    defer rs.mu.Unlock()
    rs.ProcessedTorrents = processed
    rs.BrokenFound = broken
    rs.Fixed = fixed
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
    
    queueSize := 0
    repairQueue.Range(func(_, _ interface{}) bool {
        queueSize++
        return true
    })
    status.QueueSize = queueSize
    
    return status
}

func (tm *TorrentManager) RepairTorrent(torrentID string) error {
    if tm == nil || tm.store == nil {
        return fmt.Errorf("manager or store not initialized")
    }
    
    if torrentID == "" {
        return fmt.Errorf("torrent ID cannot be empty")
    }
    
    logger.Info("[RepairWorker] On-demand repair requested for torrent %s", torrentID)
    
    repairQueue.Store(torrentID, true)
    go tm.scanForBrokenTorrents(torrentID)
    
    return nil
}

func (tm *TorrentManager) RepairAllTorrents() error {
    if tm == nil || tm.store == nil {
        return fmt.Errorf("manager or store not initialized")
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

    if !repairRunning.CompareAndSwap(false, true) {
        if torrentID != "" {
            logger.Info("[RepairWorker] Repair already running, queueing torrent %s", torrentID)
            repairQueue.Store(torrentID, true)
            
            queueSize := 0
            repairQueue.Range(func(_, _ interface{}) bool {
                queueSize++
                return true
            })
            RepairProgress.UpdateQueueSize(queueSize)
        }
        return
    }
    defer repairRunning.Store(false)
    
    repairShouldStop.Store(false)
    RepairProgress.SetRunning(true, torrentID)
    defer RepairProgress.SetRunning(false, "")

    if torrentID != "" {
        logger.Info("[RepairWorker] Starting on-demand repair for torrent %s", torrentID)
    }
    
    var items []TorrentItem
    
    if torrentID != "" {
        item, err := tm.store.GetItemByID(torrentID)
        if err != nil {
            logger.Warn("[RepairWorker] Failed to get torrent %s: %v", torrentID, err)
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

    var brokenCount, fixedCount, validatedCount int64

    for _, item := range items {
        if repairShouldStop.Load() {
            logger.Info("[RepairWorker] Stop requested, halting repair scan")
            break
        }
        
        if item.Status != "downloaded" && item.Status != "error" && item.Status != "virus" && item.Status != "dead" {
            continue
        }

        var info *TorrentInfo
        if tm.infoStore != nil {
            cachedInfo, found, err := tm.infoStore.Get(item.ID)
            if err == nil && found {
                info = cachedInfo
            }
        }

        if info == nil {
            apiInfo, err := tm.GetTorrentInfo(item.ID)
            if err != nil {
                continue
            }
            info = apiInfo
        }

        if info == nil {
            continue
        }

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
                        
                        // Early exit if per_torrent strategy and already failed
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
            logger.Info("[RepairWorker] 🔧 Marked as broken: %s (%s) - Reason: %s", 
                item.ID, info.Filename, reason)
            brokenLinks := len(info.Links)
            _ = tm.store.UpdateRepairState(info.ID, true, brokenLinks, len(info.Links))
        } else {
            wasInRepair := false
            if tm.store != nil {
                repairs, err := tm.store.GetAllRepairs()
                if err == nil {
                    for _, r := range repairs {
                        if r.TorrentID == info.ID {
                            wasInRepair = true
                            break
                        }
                    }
                }
            }
            _ = tm.store.DeleteRepair(info.ID)
            if wasInRepair {
                fixedCount++
            }
            _ = tm.store.UpdateRepairState(info.ID, false, 0, len(info.Links))
        }
        
        processed := brokenCount + fixedCount
        RepairProgress.UpdateProgress(processed, brokenCount, fixedCount, validatedCount)
    }

    if torrentID != "" {
        logger.Info("[RepairWorker] On-demand repair complete for %s: %d broken, %d fixed, %d validated", 
            torrentID, brokenCount, fixedCount, validatedCount)
    } else if brokenCount > 0 || fixedCount > 0 {
        logger.Info("[RepairWorker] Scan complete: found %d broken, fixed %d, validated %d torrents", 
            brokenCount, fixedCount, validatedCount)
    }
    
    tm.processRepairQueue()
}

func (tm *TorrentManager) processRepairQueue() {
    var queuedIDs []string
    
    repairQueue.Range(func(key, value interface{}) bool {
        if torrentID, ok := key.(string); ok {
            queuedIDs = append(queuedIDs, torrentID)
            repairQueue.Delete(key)
        }
        return true
    })
    
    if len(queuedIDs) == 0 {
        return
    }
    
    logger.Info("[RepairWorker] Processing %d queued repair(s)", len(queuedIDs))
    
    for _, torrentID := range queuedIDs {
        tm.scanForBrokenTorrents(torrentID)
    }
}
