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
	
	logger.Info("[Refresh] Changes detected (count: %d -> %d)", 
		currentState.TotalCount, newState.TotalCount)
	tm.performFullRefresh(ctx)
	
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
	
	allTorrentsMap.Clear()
	tm.idToItemMap.Clear()
	
	for i := range allTorrents {
		item := &allTorrents[i]
		accessKey := GetDirectoryName(item.Filename)
		allTorrentsMap.Set(accessKey, item)
		tm.idToItemMap.Set(item.ID, item)
	}
	
	go tm.SaveAllTorrents()
	
	if len(newTorrents) > 0 && len(cachedTorrents) > 0 {
		for i, torrent := range newTorrents {
			if i < 3 {
				logger.Info("New file added: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("... and %d more new files", len(newTorrents)-3)
				break
			}
		}

		go tm.PrefetchFileDownloadLinks(newTorrents)
	}
	
	if len(removedTorrents) > 0 {
		for i, torrent := range removedTorrents {
			if i < 3 {
				logger.Info("File removed: %s", truncateFilename(torrent.Filename))
			} else if i == 3 {
				logger.Info("... and %d more files removed", len(removedTorrents)-3)
				break
			}
		}
		
		for i := range removedTorrents {
			tm.DeleteFromDBByID(removedTorrents[i].ID)
		}
	}

	triggerPendingMount()
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

