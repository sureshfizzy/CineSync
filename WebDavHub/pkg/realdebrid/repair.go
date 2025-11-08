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
    
    queueSize := 0
    repairQueue.Range(func(_, _ interface{}) bool {
        queueSize++
        return true
    })
    status.QueueSize = queueSize
    
    return status
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
    tm.triggerRepair(torrentID)
    return nil
}

// TriggerAutoRepair triggers an automatic on-demand repair
func (tm *TorrentManager) TriggerAutoRepair(torrentID string) {
    if tm == nil || tm.store == nil {
        return
    }

    config := GetConfigManager().GetConfig()
    if !config.RepairSettings.Enabled || !config.RepairSettings.OnDemand {
        return
    }
    
    logger.Debug("[RepairWorker] On-demand repair triggered for torrent %s", torrentID)
    tm.triggerRepair(torrentID)
}

// triggerRepair
func (tm *TorrentManager) triggerRepair(torrentID string) {
    go func() {
        fixed, err := tm.repairTorrentFiles(torrentID)
        if err != nil {
            logger.Debug("[RepairWorker] Initial repair attempt for %s: %v", torrentID, err)
            _, getErr := tm.GetTorrentInfo(torrentID)
            if getErr != nil && IsTorrentNotFound(getErr) {
                logger.Info("[RepairWorker] Torrent %s was successfully replaced with new ID", torrentID)
                _ = tm.store.DeleteRepair(torrentID)
                _ = tm.store.UpdateRepairState(torrentID, false, 0, 0)
                return
            }
            tm.scanForBrokenTorrents(torrentID)
            return
        }
        
        if fixed {
            logger.Info("[RepairWorker] Torrent %s successfully repaired and removed from queue", torrentID)
            _ = tm.store.DeleteRepair(torrentID)
            _ = tm.store.UpdateRepairState(torrentID, false, 0, 0)
        } else {
            tm.scanForBrokenTorrents(torrentID)
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

    if !repairRunning.CompareAndSwap(false, true) {
        if torrentID != "" {
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
            
            // If AutoFix is enabled, automatically trigger repair for broken torrents
            config := GetConfigManager().GetConfig()
            if config.RepairSettings.AutoFix {
                logger.Info("[RepairWorker] AutoFix enabled, triggering repair for broken torrent %s", info.ID)
                go func(id string) {
                    _, err := tm.repairTorrentFiles(id)
                    if err != nil {
                        logger.Warn("[RepairWorker] AutoFix repair failed for %s: %v", id, err)
                    } else {
                        logger.Info("[RepairWorker] AutoFix successfully repaired torrent %s", id)
                        _ = tm.store.DeleteRepair(id)
                        _ = tm.store.UpdateRepairState(id, false, 0, 0)
                    }
                }(info.ID)
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
