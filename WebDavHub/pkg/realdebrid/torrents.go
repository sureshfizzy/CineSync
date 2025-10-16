package realdebrid

import (
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
)

// TorrentManager manages cached torrent listings
type TorrentManager struct {
	client        *Client
	torrentCache  map[string]*TorrentInfo
	torrentList   []TorrentItem
	cacheMutex    sync.RWMutex
	lastCacheTime time.Time
	cacheDuration time.Duration
}

var (
	torrentManager *TorrentManager
	torrentMutex   sync.RWMutex
)

// GetTorrentManager returns the singleton torrent manager
func GetTorrentManager(apiKey string) *TorrentManager {
	torrentMutex.RLock()
	if torrentManager != nil && torrentManager.client.apiKey == apiKey {
		torrentMutex.RUnlock()
		return torrentManager
	}
	torrentMutex.RUnlock()

	torrentMutex.Lock()
	defer torrentMutex.Unlock()

	if torrentManager != nil && torrentManager.client.apiKey == apiKey {
		return torrentManager
	}

	torrentManager = &TorrentManager{
		client:        NewClient(apiKey),
		torrentCache:  make(map[string]*TorrentInfo),
		torrentList:   []TorrentItem{},
		cacheDuration: 5 * time.Minute,
	}

	return torrentManager
}

// RefreshTorrentList refreshes the list of torrents
func (tm *TorrentManager) RefreshTorrentList() error {
	tm.cacheMutex.Lock()
	defer tm.cacheMutex.Unlock()

	if time.Since(tm.lastCacheTime) < tm.cacheDuration && len(tm.torrentList) > 0 {
		return nil
	}

    logger.Debug("[Torrents] Refreshing torrent list...")
	torrents, err := tm.client.GetAllTorrents(1000)
	if err != nil {
		return fmt.Errorf("failed to fetch torrents: %w", err)
	}

	tm.torrentList = torrents
	tm.lastCacheTime = time.Now()
    logger.Debug("[Torrents] Cached %d torrents", len(torrents))

	return nil
}

// GetTorrentInfo gets detailed torrent information
func (tm *TorrentManager) GetTorrentInfo(torrentID string) (*TorrentInfo, error) {
	tm.cacheMutex.RLock()
	if info, ok := tm.torrentCache[torrentID]; ok {
		tm.cacheMutex.RUnlock()
		return info, nil
	}
	tm.cacheMutex.RUnlock()

	info, err := tm.client.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	tm.cacheMutex.Lock()
	tm.torrentCache[torrentID] = info
	tm.cacheMutex.Unlock()

	return info, nil
}

// ListTorrents lists all available torrents
func (tm *TorrentManager) ListTorrents() []TorrentItem {
	tm.cacheMutex.RLock()
	defer tm.cacheMutex.RUnlock()

	var result []TorrentItem
	for _, torrent := range tm.torrentList {
		if torrent.Status == "downloaded" || torrent.Status == "uploading" || torrent.Status == "seeding" {
			result = append(result, torrent)
		}
	}
	return result
}

// FindTorrentByName finds a torrent by sanitized name
func (tm *TorrentManager) FindTorrentByName(name string) (string, error) {
	tm.cacheMutex.RLock()
	defer tm.cacheMutex.RUnlock()

	for _, torrent := range tm.torrentList {
		if SanitizeFilename(torrent.Filename) == name {
			return torrent.ID, nil
		}
	}
	return "", fmt.Errorf("torrent not found: %s", name)
}

// ListTorrentFiles lists files in a torrent
func (tm *TorrentManager) ListTorrentFiles(torrentID string, subPath string) ([]FileNode, error) {
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return nil, err
	}

	var selectedFiles []TorrentFile
	for _, file := range info.Files {
		if file.Selected == 1 {
			selectedFiles = append(selectedFiles, file)
		}
	}

	// Single file - return directly
	if len(selectedFiles) == 1 && subPath == "" {
		file := selectedFiles[0]
		cleanPath := strings.Trim(file.Path, "/")
		fileName := path.Base(cleanPath)

		return []FileNode{{
			Name:      fileName,
			IsDir:     false,
			Size:      file.Bytes,
			TorrentID: torrentID,
			FileID:    file.ID,
		}}, nil
	}

	// Multiple files or subdirectory
	dirMap := make(map[string]bool)
	fileMap := make(map[string]TorrentFile)

	for _, file := range selectedFiles {
		cleanPath := strings.Trim(file.Path, "/")

		// Filter by subpath if specified
		if subPath != "" {
			if !strings.HasPrefix(cleanPath, subPath+"/") {
				continue
			}
			cleanPath = strings.TrimPrefix(cleanPath, subPath+"/")
		}

		parts := strings.Split(cleanPath, "/")
		if len(parts) > 1 {
			dirMap[parts[0]] = true
		} else {
			fileMap[cleanPath] = file
		}
	}

	var nodes []FileNode
	for dirName := range dirMap {
		nodes = append(nodes, FileNode{
			Name:  dirName,
			IsDir: true,
		})
	}
	for fileName, file := range fileMap {
		nodes = append(nodes, FileNode{
			Name:      fileName,
			IsDir:     false,
			Size:      file.Bytes,
			TorrentID: torrentID,
			FileID:    file.ID,
		})
	}

	return nodes, nil
}

// GetFileDownloadURL gets the download URL for a file
func (tm *TorrentManager) GetFileDownloadURL(torrentID, filePath string) (string, int64, error) {
	info, err := tm.GetTorrentInfo(torrentID)
	if err != nil {
		return "", 0, err
	}

	// Find the file
	var targetFile *TorrentFile
	for i, file := range info.Files {
		cleanFilePath := strings.Trim(file.Path, "/")
		if cleanFilePath == filePath || file.Path == filePath || file.Path == "/"+filePath {
			targetFile = &info.Files[i]
			break
		}
	}

	if targetFile == nil {
		return "", 0, fmt.Errorf("file not found: %s", filePath)
	}

	if len(info.Links) == 0 {
		return "", 0, fmt.Errorf("no links available")
	}

	// Use the link corresponding to the file ID
	var downloadLink string
	if targetFile.ID-1 < len(info.Links) {
		downloadLink = info.Links[targetFile.ID-1]
	} else {
		downloadLink = info.Links[0]
	}

	// Unrestrict the link
	unrestrictedLink, err := tm.client.UnrestrictLink(downloadLink)
	if err != nil {
		return "", 0, fmt.Errorf("failed to unrestrict link: %w", err)
	}

	return unrestrictedLink.Download, targetFile.Bytes, nil
}

// FileNode represents a file or directory node
type FileNode struct {
	Name      string
	IsDir     bool
	Size      int64
	TorrentID string
	FileID    int
}

// SanitizeFilename sanitizes a filename for use in paths
func SanitizeFilename(name string) string {
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	return replacer.Replace(name)
}