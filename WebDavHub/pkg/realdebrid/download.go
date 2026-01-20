package realdebrid

import (
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"cinesync/pkg/logger"
	cmap "github.com/orcaman/concurrent-map/v2"
)

var (
	// Track reinsert attempts to prevent infinite loops
	failedToReinsert = cmap.New[bool]()
	repairRequest    = cmap.New[*reInsertRequest]()
	// Track torrent ID changes after reinsertion (oldID -> newID)
	torrentIDMapping = cmap.New[string]()
	// Track which old torrents have been deleted (to prevent duplicate deletion)
	deletedOldTorrents = cmap.New[bool]()
)

type reInsertRequest struct {
	done chan struct{}
	result *TorrentInfo
	err error
}

func newReInsertRequest() *reInsertRequest {
	return &reInsertRequest{
		done: make(chan struct{}),
	}
}

func (r *reInsertRequest) Wait() (*TorrentInfo, error) {
	<-r.done
	return r.result, r.err
}

func (r *reInsertRequest) Complete(result *TorrentInfo, err error) {
	r.result = result
	r.err = err
	close(r.done)
}

func constructMagnet(infoHash, name string) string {
	name = url.QueryEscape(strings.TrimSpace(name))
	return fmt.Sprintf("magnet:?xt=urn:btih:%s&dn=%s", infoHash, name)
}

// updateCachesAfterRepair updates in-memory caches after a successful repair
func (tm *TorrentManager) updateCachesAfterRepair(oldID string, newInfo *TorrentInfo) {
	oldItem, oldExists := tm.idToItemMap.Get(oldID)
	if !oldExists {
		return
	}

	newItem := &TorrentItem{
		ID:       newInfo.ID,
		Filename: oldItem.Filename,
		Bytes:    oldItem.Bytes,
		Files:    oldItem.Files,
		Status:   newInfo.Status,
		Added:    oldItem.Added,
		Ended:    newInfo.Ended,
		CachedFiles: newInfo.Files,
		CachedLinks: newInfo.Links,
	}
	
	// Update DirectoryMap with the new torrent
	if allTorrents, ok := tm.DirectoryMap.Get(ALL_TORRENTS); ok {
		dirName := GetDirectoryName(oldItem.Filename)
		allTorrents.Set(dirName, newItem)
	}

	tm.idToItemMap.Set(newInfo.ID, newItem)
	tm.idToItemMap.Set(oldID, newItem)
}

// resolveTorrentID resolves a torrent ID, checking the mapping for repaired torrents
func resolveTorrentID(torrentID string) string {
	if newID, ok := torrentIDMapping.Get(torrentID); ok {
		return newID
	}
	return torrentID
}

func (tm *TorrentManager) fetchDownloadLink(torrentID, filePath string) (string, int64, error) {
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return "", 0, fmt.Errorf("failed to get torrent info: %w", err)
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
		return "", 0, fmt.Errorf("file %s not found in torrent %s", filePath, torrentID)
	}

	var restrictedLink string
	if targetFile.ID-1 < len(info.Links) {
		restrictedLink = info.Links[targetFile.ID-1]
	} else if len(info.Links) > 0 {
		restrictedLink = info.Links[0]
	}

	if restrictedLink == "" || len(info.Links) == 0 {
		refreshedInfo, err := tm.client.GetTorrentInfo(torrentID)
		if err != nil {
			if IsTorrentNotFound(err) {
				tm.deleteTorrentFromCache(torrentID)
			}
			return "", 0, fmt.Errorf("failed to refresh torrent: %w", err)
		}
		
		if refreshedInfo == nil {
			return "", 0, fmt.Errorf("refreshed torrent info is nil")
		}
		
		if tm.store != nil {
			if existing, err := tm.store.LoadInfo(torrentID); err == nil && existing != nil {
				tm.preserveFileStates(refreshedInfo, existing)
			} else {
				tm.initializeFileStates(refreshedInfo)
			}
			_ = tm.store.SaveInfo(refreshedInfo)
		}
		
		if refreshedInfo.Progress == 100 {
			tm.InfoMap.Set(torrentID, refreshedInfo)
		}
		
		info = refreshedInfo
		
		if refreshedInfo.Progress == 100 {
			tm.InfoMap.Set(torrentID, refreshedInfo)
		}
		
		info = refreshedInfo
		
		targetFile = nil
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
			return "", 0, fmt.Errorf("file %s not found in refreshed torrent %s", filePath, torrentID)
		}
		
		if targetFile.ID-1 < len(info.Links) {
			restrictedLink = info.Links[targetFile.ID-1]
		} else if len(info.Links) > 0 {
			restrictedLink = info.Links[0]
		}
	}

	if restrictedLink == "" {
		newInfo, err := tm.reInsertTorrent(info)
		if err != nil {
			return "", 0, fmt.Errorf("failed to reinsert torrent: %w", err)
		}
		info = newInfo
		
		targetFile = nil
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
			return "", 0, fmt.Errorf("file %s not found in reinserted torrent %s", filePath, torrentID)
		}
		
		if targetFile.ID-1 < len(info.Links) {
			restrictedLink = info.Links[targetFile.ID-1]
		} else if len(info.Links) > 0 {
			restrictedLink = info.Links[0]
		}
		
		if restrictedLink == "" {
			return "", 0, fmt.Errorf("file link is still empty after reinsert for %s in torrent %s", filePath, torrentID)
		}
	}

	unrestrictedLink, err := tm.client.UnrestrictLink(restrictedLink)
	if err != nil {
		if isBrokenLinkError(err) {
			logger.Info("[Download] Unrestrict failed, verifying with CheckLink: %v", err)
			if tm.verifyLinkIsActuallyBroken(restrictedLink) {
				logger.Info("[Download] CheckLink confirmed link is broken, attempting reinsert")
				newInfo, err := tm.reInsertTorrent(info)
				if err != nil {
					return "", 0, fmt.Errorf("failed to reinsert torrent: %w", err)
				}
				info = newInfo
				
				targetFile = nil
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
					return "", 0, fmt.Errorf("file %s not found in reinserted torrent %s", filePath, torrentID)
				}
				
				if targetFile.ID-1 < len(info.Links) {
					restrictedLink = info.Links[targetFile.ID-1]
				} else if len(info.Links) > 0 {
					restrictedLink = info.Links[0]
				}
				
				unrestrictedLink, err = tm.client.UnrestrictLink(restrictedLink)
				if err != nil {
					return "", 0, fmt.Errorf("retry failed to get download link: %w", err)
				}
				if unrestrictedLink.Download == "" {
					return "", 0, fmt.Errorf("download link is empty after retry")
				}
			}
		} else {
			return "", 0, fmt.Errorf("failed to unrestrict link: %w", err)
		}
	}

	if unrestrictedLink.Download == "" {
		return "", 0, fmt.Errorf("unrestrict returned empty download URL")
	}

	return unrestrictedLink.Download, targetFile.Bytes, nil
}

func (tm *TorrentManager) repairTorrentFiles(torrentID string) (bool, error) {
	originalTorrentID := torrentID
	
	// Get torrent info
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return false, fmt.Errorf("failed to get torrent info: %w", err)
	}

	refreshedInfo, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		if IsTorrentNotFound(err) {
			tm.deleteTorrentFromCache(torrentID)
		}
		return false, fmt.Errorf("failed to refresh torrent: %w", err)
	}
	
	if refreshedInfo == nil {
		return false, fmt.Errorf("refreshed torrent info is nil")
	}
	
	if tm.store != nil {
		if existing, err := tm.store.LoadInfo(torrentID); err == nil && existing != nil {
			tm.preserveFileStates(refreshedInfo, existing)
		}
		_ = tm.store.SaveInfo(refreshedInfo)
	}
	
	if refreshedInfo.Progress == 100 {
		tm.InfoMap.Set(torrentID, refreshedInfo)
	}
	
	info = refreshedInfo

	var videoFiles []TorrentFile
	for _, file := range info.Files {
		if file.Selected == 1 && isVideoFile(file.Path) {
			videoFiles = append(videoFiles, file)
		}
	}

	if len(videoFiles) == 0 {
		return true, nil
	}

	brokenCount := 0
	brokenFiles := []string{}
	
	if len(info.Links) == 0 {
		logger.Warn("[Repair] Torrent %s has no links, all %d files are broken", torrentID, len(videoFiles))
		brokenCount = len(videoFiles)
	} else {
	for _, file := range videoFiles {
		cleanPath := strings.Trim(file.Path, "/")
		fileName := path.Base(cleanPath)
			cacheKey := MakeCacheKey(torrentID, fileName)
			if _, exists := tm.failedFileCache.Get(cacheKey); exists {
				brokenCount++
				brokenFiles = append(brokenFiles, fileName)
			}
		}
		if brokenCount == 0 {
			for _, file := range videoFiles {
				if file.ID-1 >= len(info.Links) || file.ID <= 0 {
			brokenCount++
					cleanPath := strings.Trim(file.Path, "/")
					brokenFiles = append(brokenFiles, path.Base(cleanPath))
				}
			}
		}
	}
	
	if brokenCount > 0 {
		newInfo, reinsertErr := tm.reInsertTorrent(info)
		if reinsertErr != nil {
			logger.Warn("[Repair] Failed to reinsert torrent %s: %v", torrentID, reinsertErr)
			if tm.store != nil && !strings.Contains(reinsertErr.Error(), "not cached") && 
			   !strings.Contains(reinsertErr.Error(), "error status") {
				reason := fmt.Sprintf("reinsert_failed_%d_files", brokenCount)
				if strings.Contains(strings.ToLower(reinsertErr.Error()), "infringing_file") || strings.Contains(reinsertErr.Error(), "code: 35") {
					reason = "infringing_file"
				}
			_ = tm.store.UpsertRepair(torrentID, info.Filename, info.Hash, info.Status, int(info.Progress), reason)
			}
			
			return false, fmt.Errorf("torrent has %d broken files, reinsert failed: %w", brokenCount, reinsertErr)
		}
		newBrokenCount := 0
		for _, file := range videoFiles {
			if file.ID-1 >= len(newInfo.Links) || file.ID <= 0 {
				newBrokenCount++
			}
		}
		
        if newBrokenCount == 0 {
			brokenCount = 0
		} else {
			return false, fmt.Errorf("torrent has %d broken files after reinsert", newBrokenCount)
		}
	}

	if newID, ok := torrentIDMapping.Get(originalTorrentID); ok {
		if brokenCount == 0 {
			if alreadyDeleted, _ := deletedOldTorrents.Get(originalTorrentID); !alreadyDeleted {
				deletedOldTorrents.Set(originalTorrentID, true)
				
				if err := tm.client.DeleteTorrent(originalTorrentID); err != nil {
					logger.Warn("[Repair] Failed to delete old torrent %s: %v", originalTorrentID, err)
					deletedOldTorrents.Remove(originalTorrentID)
				} else {
					tm.deleteTorrentFromCache(originalTorrentID)
					tm.idToItemMap.Remove(originalTorrentID)
					torrentIDMapping.Remove(originalTorrentID)
				}
			}
		} else {
			logger.Warn("[Repair] New torrent %s still has %d broken files, keeping both torrents", newID, brokenCount)
		}
	}

	if brokenCount == 0 {
		for _, file := range videoFiles {
			cleanPath := strings.Trim(file.Path, "/")
			fileName := path.Base(cleanPath)
			tm.markFileAsOk(originalTorrentID, fileName)
		}
		return true, nil
	}

	return false, fmt.Errorf("torrent has %d broken files", brokenCount)
}

func (tm *TorrentManager) reInsertTorrent(info *TorrentInfo) (*TorrentInfo, error) {
	oldID := info.ID
	
	if failed, ok := failedToReinsert.Get(oldID); ok && failed {
		return nil, fmt.Errorf("can't retry re-insert for %s", oldID)
	}
	
	if req, inFlight := repairRequest.Get(oldID); inFlight {
		return req.Wait()
	}
	
	req := newReInsertRequest()
	repairRequest.Set(oldID, req)
	
	defer func() {
		repairRequest.Remove(oldID)
	}()
	
	if info.Hash == "" {
		failedToReinsert.Set(oldID, true)
		return nil, fmt.Errorf("torrent hash is empty, cannot construct magnet")
	}
	
	magnet := constructMagnet(info.Hash, info.Filename)
	addResult, err := tm.client.AddMagnet(magnet)
	if err != nil {
		failedToReinsert.Set(oldID, true)
		req.Complete(nil, fmt.Errorf("failed to submit magnet: %w", err))
		return nil, fmt.Errorf("failed to submit magnet: %w", err)
	}
	
	if addResult == nil || addResult.ID == "" {
		failedToReinsert.Set(oldID, true)
		req.Complete(nil, fmt.Errorf("failed to submit magnet: empty torrent"))
		return nil, fmt.Errorf("failed to submit magnet: empty torrent")
	}
	
	newTorrentID := addResult.ID
	
		checkInfo, err := tm.client.GetTorrentInfoForRepair(newTorrentID)
		if err != nil {
			if IsTorrentNotFound(err) {
				_ = tm.client.DeleteTorrent(newTorrentID)
				failedToReinsert.Set(oldID, true)
				req.Complete(nil, fmt.Errorf("new torrent %s not found: %w", newTorrentID, err))
				return nil, fmt.Errorf("new torrent %s not found: %w", newTorrentID, err)
			}
			_ = tm.client.DeleteTorrent(newTorrentID)
			failedToReinsert.Set(oldID, true)
			req.Complete(nil, fmt.Errorf("failed to check torrent: %w", err))
			return nil, fmt.Errorf("failed to check torrent: %w", err)
		}
		
		status := checkInfo.Status
		
		if status == "waiting_files_selection" {
			selectedFileIDs := make([]string, 0)
			for _, file := range checkInfo.Files {
				if isVideoFile(file.Path) {
					selectedFileIDs = append(selectedFileIDs, fmt.Sprintf("%d", file.ID))
				}
			}
			
			if len(selectedFileIDs) > 0 {
				if err := tm.client.SelectFilesForRepair(newTorrentID, selectedFileIDs); err != nil {
					_ = tm.client.DeleteTorrent(newTorrentID)
					failedToReinsert.Set(oldID, true)
					req.Complete(nil, fmt.Errorf("failed to select files: %w", err))
					return nil, fmt.Errorf("failed to select files: %w", err)
				}
			checkInfo, err = tm.client.GetTorrentInfoForRepair(newTorrentID)
			if err != nil {
				_ = tm.client.DeleteTorrent(newTorrentID)
				failedToReinsert.Set(oldID, true)
				req.Complete(nil, fmt.Errorf("failed to check torrent after selection: %w", err))
				return nil, fmt.Errorf("failed to check torrent after selection: %w", err)
			}
		} else {
			_ = tm.client.DeleteTorrent(newTorrentID)
			failedToReinsert.Set(oldID, true)
			req.Complete(nil, fmt.Errorf("no valid files found"))
			return nil, fmt.Errorf("no valid files found")
		}
	}

	if checkInfo.Status == "downloading" || checkInfo.Status == "queued" {
		logger.Warn("[Repair] Torrent %s is not cached (status: %s), marking as unrepairable", oldID, checkInfo.Status)
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		tm.brokenTorrentCache.Set(oldID, &FailedFileEntry{
			Error:     fmt.Errorf("torrent not cached, status: %s", checkInfo.Status),
			Timestamp: time.Now(),
		})

		if tm.store != nil {
			_ = tm.store.UpsertRepair(oldID, info.Filename, info.Hash, checkInfo.Status, int(checkInfo.Progress), "not_cached")
		} else {
			logger.Warn("[Repair] Store is nil, cannot save unrepairable torrent %s to DB", oldID)
		}
		
		req.Complete(nil, fmt.Errorf("torrent not cached, status: %s", checkInfo.Status))
		return nil, fmt.Errorf("torrent not cached, status: %s", checkInfo.Status)
	}
	if checkInfo.Status == "error" || checkInfo.Status == "dead" || checkInfo.Status == "virus" || checkInfo.Status == "magnet_error" {
		logger.Warn("[Repair] Torrent %s has error status: %s, marking as unrepairable", oldID, checkInfo.Status)
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		tm.brokenTorrentCache.Set(oldID, &FailedFileEntry{
			Error:     fmt.Errorf("torrent has error status: %s", checkInfo.Status),
			Timestamp: time.Now(),
		})

		if tm.store != nil {
			reason := fmt.Sprintf("reinsert_error_%s", checkInfo.Status)
			_ = tm.store.UpsertRepair(oldID, info.Filename, info.Hash, checkInfo.Status, int(checkInfo.Progress), reason)
		} else {
			logger.Warn("[Repair] Store is nil, cannot save unrepairable torrent %s to DB", oldID)
		}
		
		req.Complete(nil, fmt.Errorf("torrent has error status: %s", checkInfo.Status))
		return nil, fmt.Errorf("torrent has error status: %s", checkInfo.Status)
	}
	
	newInfo := checkInfo
	
	if newInfo == nil {
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		req.Complete(nil, fmt.Errorf("torrent did not complete in time"))
		return nil, fmt.Errorf("torrent did not complete in time")
	}

	if enriched, err := tm.GetTorrentInfo(newInfo.ID); err == nil && enriched != nil && len(enriched.Links) > 0 {
		newInfo = enriched
	}
	if newInfo.Hash == "" && info.Hash != "" {
		newInfo.Hash = info.Hash
	}
	if newInfo.Bytes == 0 && info.Bytes > 0 {
		newInfo.Bytes = info.Bytes
	}
	if newInfo.Added == "" && info.Added != "" {
		newInfo.Added = info.Added
	}
	if newInfo.Filename == "" && info.Filename != "" {
		newInfo.Filename = info.Filename
	}
	if len(newInfo.Files) == 0 && len(info.Files) > 0 {
		newInfo.Files = info.Files
	}
	
	if len(newInfo.Links) == 0 {
		logger.Warn("[Repair] Torrent %s reinserted but has no links, marking as unrepairable", oldID)
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		tm.brokenTorrentCache.Set(oldID, &FailedFileEntry{
			Error:     fmt.Errorf("no links after reinsert"),
			Timestamp: time.Now(),
		})
		if tm.store != nil {
			_ = tm.store.UpsertRepair(oldID, info.Filename, info.Hash, newInfo.Status, int(newInfo.Progress), "no_links_after_reinsert")
		} else {
			logger.Warn("[Repair] Store is nil, cannot save unrepairable torrent %s to DB", oldID)
		}
		
		req.Complete(nil, fmt.Errorf("failed to reinsert torrent: empty links"))
		return nil, fmt.Errorf("failed to reinsert torrent: empty links")
	}
	
	if tm.store != nil {
		_ = tm.store.SaveInfo(newInfo)
		if oldID != "" && oldID != newInfo.ID {
			_ = tm.store.DeleteByID(oldID)
		}
	}
	
	if newInfo.Progress == 100 {
		tm.InfoMap.Set(newInfo.ID, newInfo)
	}

	newInfo.OriginalID = oldID
	
	// Track the ID mapping for repair logic
	if oldID != "" && oldID != newInfo.ID {
		torrentIDMapping.Set(oldID, newInfo.ID)
	}
	tm.updateCachesAfterRepair(oldID, newInfo)
	
	req.Complete(newInfo, nil)
	
	return newInfo, nil
}
