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
		
		if tm.infoStore != nil {
			_ = tm.infoStore.Upsert(refreshedInfo)
		}
		
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
	
	if tm.infoStore != nil {
		_ = tm.infoStore.Upsert(refreshedInfo)
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
	for _, file := range videoFiles {
		cleanPath := strings.Trim(file.Path, "/")
		fileName := path.Base(cleanPath)
		
		// Check if torrent ID changed due to reinsertion
		if newID, ok := torrentIDMapping.Get(torrentID); ok {
			torrentID = newID
		}
		
		_, _, err := tm.fetchDownloadLink(torrentID, fileName)
		if err != nil {
			brokenCount++
		}
	}

	// If reinsertion happened and all files work, delete the old torrent
	if newID, ok := torrentIDMapping.Get(originalTorrentID); ok {
		if brokenCount == 0 {
			// Use concurrent-safe check-and-set to ensure only one goroutine deletes
			if alreadyDeleted, _ := deletedOldTorrents.Get(originalTorrentID); !alreadyDeleted {
				// Mark as being deleted to prevent concurrent deletion
				deletedOldTorrents.Set(originalTorrentID, true)
				
				if err := tm.client.DeleteTorrent(originalTorrentID); err != nil {
					logger.Warn("[Repair] Failed to delete old torrent %s: %v", originalTorrentID, err)
					// If deletion failed, allow retry
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
	
	var newInfo *TorrentInfo
	for {
		checkInfo, err := tm.client.GetTorrentInfo(newTorrentID)
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
				if err := tm.client.SelectFiles(newTorrentID, selectedFileIDs); err != nil {
					_ = tm.client.DeleteTorrent(newTorrentID)
					failedToReinsert.Set(oldID, true)
					req.Complete(nil, fmt.Errorf("failed to select files: %w", err))
					return nil, fmt.Errorf("failed to select files: %w", err)
				}
			} else {
				_ = tm.client.DeleteTorrent(newTorrentID)
				failedToReinsert.Set(oldID, true)
				req.Complete(nil, fmt.Errorf("no valid files found"))
				return nil, fmt.Errorf("no valid files found")
			}
		} else if status == "downloaded" {
			newInfo = checkInfo
			break
		} else if status == "downloading" || status == "queued" || status == "magnet_error" {
			time.Sleep(2 * time.Second)
			continue
		} else if status == "error" || status == "dead" || status == "virus" {
			_ = tm.client.DeleteTorrent(newTorrentID)
			failedToReinsert.Set(oldID, true)
			req.Complete(nil, fmt.Errorf("torrent has error status: %s", status))
			return nil, fmt.Errorf("torrent has error status: %s", status)
		} else {
			time.Sleep(2 * time.Second)
			continue
		}
	}
	
	if newInfo == nil {
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		req.Complete(nil, fmt.Errorf("torrent did not complete in time"))
		return nil, fmt.Errorf("torrent did not complete in time")
	}
	
	if len(newInfo.Links) == 0 {
		_ = tm.client.DeleteTorrent(newTorrentID)
		failedToReinsert.Set(oldID, true)
		req.Complete(nil, fmt.Errorf("failed to reinsert torrent: empty links"))
		return nil, fmt.Errorf("failed to reinsert torrent: empty links")
	}
	
	if tm.infoStore != nil {
		_ = tm.infoStore.Upsert(newInfo)
	}
	
	if tm.store != nil {
		_ = tm.store.UpsertInfo(newInfo)
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
