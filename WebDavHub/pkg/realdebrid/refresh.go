package realdebrid

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"cinesync/pkg/logger"
)

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
	
	needsFullRefresh := false
	if currentState.LastUpdated.IsZero() || time.Since(currentState.LastUpdated) > time.Hour {
		needsFullRefresh = true
		logger.Info("[Refresh] Performing full refresh (periodic, last: %v ago)", time.Since(currentState.LastUpdated))
	} else if currentState.TotalCount != newState.TotalCount {
		needsFullRefresh = true
		logger.Info("[Refresh] Changes detected (count: %d -> %d)", currentState.TotalCount, newState.TotalCount)
	}
	
	if needsFullRefresh {
	tm.performFullRefresh(ctx)
	}
	
	tm.updateCurrentState(newState)
}

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

func (tm *TorrentManager) fetchFirstPageWithTotal(ctx context.Context, pageSize int) ([]TorrentItem, int, error) {
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
	
    totalCount := 0
    if totalHeader := resp.Header.Get("X-Total-Count"); totalHeader != "" {
        if count, convErr := strconv.Atoi(totalHeader); convErr == nil {
            totalCount = count
        }
    }

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
    if totalCount == 0 {
        totalCount = len(items)
    }
	return items, totalCount, nil
}

func (tm *TorrentManager) performFullRefresh(ctx context.Context) {
	allTorrentsMap, ok := tm.DirectoryMap.Get(ALL_TORRENTS)
	if !ok {
		return
	}
	
	keys := allTorrentsMap.Keys()
	if len(keys) == 0 {
		return
	}

	oldTorrents := make(map[string]TorrentItem)
	cachedTorrents := make([]TorrentItem, 0, len(keys))
	
	idKeys := tm.idToItemMap.Keys()
	for _, id := range idKeys {
		if item, ok := tm.idToItemMap.Get(id); ok && item != nil {
			oldTorrents[id] = *item
		}
	}
	
	for _, key := range keys {
		if item, ok := allTorrentsMap.Get(key); ok && item != nil {
			cachedTorrents = append(cachedTorrents, *item)
		}
	}
	
	firstPage, totalCount, err := tm.fetchFirstPageWithTotal(ctx, 1000)
	if err != nil || len(firstPage) == 0 {
		if err != nil {
			logger.Error("[Refresh] Failed to fetch first page: %v", err)
		}
		return
	}

	currentState := tm.currentState.Load()
	oldTotalCount := currentState.TotalCount
	
	var allTorrents []TorrentItem
	newTorrents := make([]TorrentItem, 0, 10)
	removedTorrents := make([]TorrentItem, 0, 10)
	
	if totalCount < oldTotalCount {
		logger.Info("[Refresh] Count decreased (%d -> %d), fetching all torrents", oldTotalCount, totalCount)
		allTorrents, err = tm.client.GetAllTorrents(1000, nil)
		if err != nil {
			logger.Error("[Refresh] Failed to fetch all torrents: %v", err)
			return
		}
		
		currentTorrentsMap := make(map[string]bool, len(allTorrents))
		for i := range allTorrents {
			currentTorrentsMap[allTorrents[i].ID] = true
		}
		
		for id, torrent := range oldTorrents {
			if !currentTorrentsMap[id] {
				removedTorrents = append(removedTorrents, torrent)
			}
		}
	} else {
		freshIDs := make(map[string]bool, len(firstPage))
		for i := range firstPage {
			freshIDs[firstPage[i].ID] = true
		}
		existingIDs := make(map[string]bool, len(oldTorrents))
		for id := range oldTorrents {
			existingIDs[id] = true
		}
		
		allTorrents = make([]TorrentItem, 0, totalCount)
		allTorrents = append(allTorrents, firstPage...)
		for i := range cachedTorrents {
			if !freshIDs[cachedTorrents[i].ID] {
				allTorrents = append(allTorrents, cachedTorrents[i])
			}
		}
		
		if totalCount > oldTotalCount {
			for i := range firstPage {
				if _, exists := oldTorrents[firstPage[i].ID]; !exists {
					newTorrents = append(newTorrents, firstPage[i])
				}
			}
		}
	}
	logger.Debug("[Refresh] Building new maps with %d torrents", len(allTorrents))
	updatingIDs := make(map[string]bool, len(allTorrents))
	for i := range allTorrents {
		updatingIDs[allTorrents[i].ID] = true
	}
	for i := range allTorrents {
		item := &allTorrents[i]
		accessKey := GetDirectoryName(item.Filename)
		oldItem, existsInIDMap := tm.idToItemMap.Get(item.ID)
		existingItem, existsInDirMap := allTorrentsMap.Get(accessKey)
		if existsInDirMap && existingItem != nil && existingItem.ID != item.ID {
			continue
		}
		if existsInIDMap && oldItem != nil && oldItem.ID == item.ID {
			oldItem.Filename = item.Filename
			oldItem.Bytes = item.Bytes
			oldItem.Files = item.Files
			oldItem.Status = item.Status
			oldItem.Added = item.Added
			if item.Ended != "" {
				oldItem.Ended = item.Ended
			}

			if len(item.CachedFiles) == 0 && len(oldItem.CachedFiles) > 0 {
			} else if len(item.CachedFiles) > 0 {
				oldItem.CachedFiles = item.CachedFiles
				oldItem.CachedLinks = item.CachedLinks
			}
			allTorrentsMap.Set(accessKey, oldItem)
		} else {
			if existsInIDMap && oldItem != nil {
				if len(item.CachedFiles) == 0 && len(oldItem.CachedFiles) > 0 {
					item.CachedFiles = oldItem.CachedFiles
					item.CachedLinks = oldItem.CachedLinks
				}
			}
		allTorrentsMap.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
		}
	}

	if totalCount >= oldTotalCount {
		allKeys := allTorrentsMap.Keys()
		preservedCount := 0
		for _, key := range allKeys {
			if existingItem, exists := allTorrentsMap.Get(key); exists && existingItem != nil {
				if !updatingIDs[existingItem.ID] {
					preservedCount++
				}
			}
		}
		if preservedCount > 0 {
			logger.Debug("[Refresh] Preserved %d existing entries not in first page", preservedCount)
		}
	}

	if totalCount < oldTotalCount && len(removedTorrents) > 0 {
		logger.Debug("[Refresh] Cleaning up %d removed torrents from maps", len(removedTorrents))
		for i := range removedTorrents {
			torrent := &removedTorrents[i]
			accessKey := GetDirectoryName(torrent.Filename)

			if existingItem, exists := allTorrentsMap.Get(accessKey); exists && existingItem != nil {
				if existingItem.ID == torrent.ID {
					allTorrentsMap.Remove(accessKey)
				} else {
					logger.Debug("[Refresh] Skipping directory removal for %s (key reused by %s)", torrent.ID[:8], existingItem.ID[:8])
				}
			}

			tm.idToItemMap.Remove(torrent.ID)
		}
	} else if totalCount < oldTotalCount {
		logger.Warn("[Refresh] Count decreased but no removed torrents detected")
	}
	
	go tm.SaveAllTorrents()
	
	if len(newTorrents) > 0 {
		logger.Info("[Refresh] Processing %d new torrents", len(newTorrents))
		
		for i, torrent := range newTorrents {
			if i < 3 {
				logger.Info("[Refresh] New file added: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("[Refresh] ... and %d more new files", len(newTorrents)-3)
				break
			}
		}

		logger.Debug("[Refresh] Loading file lists for %d new torrents", len(newTorrents))
		type loadResult struct {
			index int
			item  *TorrentItem
		}
		resultChan := make(chan loadResult, len(newTorrents))
		
		// Semaphore to limit concurrent API calls
		const maxConcurrent = 50
		sem := make(chan struct{}, maxConcurrent)
		
		for i := range newTorrents {
			sem <- struct{}{}
			
			go func(idx int, torrent *TorrentItem) {
				defer func() { <-sem }()
				if len(torrent.CachedFiles) > 0 {
					resultChan <- loadResult{index: idx, item: torrent}
					return
				}
				if tm.infoStore != nil {
					if cached, ok, err := tm.infoStore.Get(torrent.ID); err == nil && ok && cached != nil {
						torrent.CachedFiles = cached.Files
						torrent.CachedLinks = cached.Links
						torrent.Ended = cached.Ended
						resultChan <- loadResult{index: idx, item: torrent}
						return
					}
				}
				info, err := tm.client.GetTorrentInfo(torrent.ID)
				if err == nil && info != nil {
					torrent.CachedFiles = info.Files
					torrent.CachedLinks = info.Links
					torrent.Ended = info.Ended
					if tm.infoStore != nil {
						_ = tm.infoStore.Upsert(info)
					}
					
					logger.Debug("[Refresh] Loaded %d files for new torrent %s", len(info.Files), torrent.ID[:8])
				} else {
					logger.Warn("[Refresh] Failed to load files for new torrent %s: %v", torrent.ID[:8], err)
				}
				
				resultChan <- loadResult{index: idx, item: torrent}
			}(i, &newTorrents[i])
		}
		timeout := time.After(30 * time.Second)
		completed := 0
		for completed < len(newTorrents) {
			select {
			case result := <-resultChan:
				accessKey := GetDirectoryName(result.item.Filename)
				if existingItem, exists := allTorrentsMap.Get(accessKey); exists && existingItem != nil {
					existingItem.CachedFiles = result.item.CachedFiles
					existingItem.CachedLinks = result.item.CachedLinks
					if result.item.Ended != "" {
						existingItem.Ended = result.item.Ended
					}
				} else {
					allTorrentsMap.Set(accessKey, result.item)
				}
				if existingItem, exists := tm.idToItemMap.Get(result.item.ID); exists && existingItem != nil {
					existingItem.CachedFiles = result.item.CachedFiles
					existingItem.CachedLinks = result.item.CachedLinks
					if result.item.Ended != "" {
						existingItem.Ended = result.item.Ended
					}
				} else {
					tm.idToItemMap.Set(result.item.ID, result.item)
				}
				completed++
				if completed%50 == 0 || completed == len(newTorrents) {
					logger.Info("[Refresh] Progress: %d/%d new torrents loaded", completed, len(newTorrents))
				}
			case <-timeout:
				logger.Warn("[Refresh] Timeout waiting for file lists (%d/%d completed)", completed, len(newTorrents))
				goto done
			}
		}
		done:
		logger.Debug("[Refresh] File lists loaded for %d new torrents (unrestrict on-demand)", len(newTorrents))
	}
	
	if len(removedTorrents) > 0 {
		logger.Info("[Refresh] Processing %d removed torrents", len(removedTorrents))
		
		for i, torrent := range removedTorrents {
			if i < 3 {
				logger.Info("[Refresh] File removed: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("[Refresh] ... and %d more files removed", len(removedTorrents)-3)
				break
			}
		}
		
		for i := range removedTorrents {
			tm.DeleteFromDBByID(removedTorrents[i].ID)
		}
		
		logger.Debug("[Refresh] Cleanup complete for removed torrents")
	}

	triggerPendingMount()
	
	logger.Info("[Refresh] Full refresh complete - New: %d, Removed: %d, Total: %d", 
		len(newTorrents), len(removedTorrents), len(allTorrents))
}

func (tm *TorrentManager) updateCurrentState(newState *LibraryState) {
	tm.currentState.Store(newState)
}

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