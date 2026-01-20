package realdebrid

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
)

const (
	// File extensions for CineSync storage
	CineSyncExt     = ".cinesync"
	CineSyncDataExt = ".cinesyncdata"
	RepairExt       = ".repair"

	// Directory structure
	TorrentsDir = "db/torrents"
	InfoDir     = "db/torrents/info"
	RepairDir   = "db/torrents/repair"
)

// Buffer pool for efficient file I/O
var bufferPool = sync.Pool{
	New: func() interface{} {
		return bytes.NewBuffer(make([]byte, 0, 32*1024)) // 32KB initial capacity
	},
}

// CineSyncStore is a file-based store for torrent metadata
// Each torrent is stored as a separate JSON file for fast access
type CineSyncStore struct {
	baseDir   string
	infoDir   string
	repairDir string
	mu        sync.RWMutex
}

// CineSyncItem represents a lightweight torrent entry
type CineSyncItem struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	Bytes    int64  `json:"bytes"`
	Files    int    `json:"files"`
	Status   string `json:"status"`
	Added    string `json:"added"`
	Ended    string `json:"ended,omitempty"`
	Hash     string `json:"hash,omitempty"`
	Modified int64  `json:"modified,omitempty"`
	Version  string `json:"version"`
}

// DirEntry represents a directory-level entry for WebDAV
type DirEntry struct {
	ID       string
	Filename string
	Bytes    int64
	Files    int
	Status   string
	Added    string
	Modified int64
}

// CineSyncData represents full torrent info stored in .cinesyncdata files
type CineSyncData struct {
	*TorrentInfo
	StoredAt int64  `json:"stored_at"`
	Version  string `json:"version"`
}

// RepairEntry represents a torrent that needs repair
type RepairEntry struct {
	TorrentID string `json:"torrent_id"`
	Filename  string `json:"filename"`
	Hash      string `json:"hash"`
	Status    string `json:"status"`
	Progress  int    `json:"progress"`
	Reason    string `json:"reason"`
	UpdatedAt int64  `json:"updated_at"`
}

// RepairState tracks when a torrent was last checked
type RepairState struct {
	TorrentID   string `json:"torrent_id"`
	LastChecked int64  `json:"last_checked"`
	IsBroken    bool   `json:"is_broken"`
	BrokenCount int    `json:"broken_count"`
	LinkCount   int    `json:"link_count"`
}

// OpenCineSyncStore opens/creates the file-based store
func OpenCineSyncStore(baseDir string) (*CineSyncStore, error) {
	// Ensure directories exist
	infoDir := filepath.Join(baseDir, "info")
	repairDir := filepath.Join(baseDir, "repair")

	for _, dir := range []string{baseDir, infoDir, repairDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}

	store := &CineSyncStore{
		baseDir:   baseDir,
		infoDir:   infoDir,
		repairDir: repairDir,
	}

	logger.Info("[CineSyncStore] Initialized file-based store at %s", baseDir)
	return store, nil
}

// Close is a no-op for file-based store
func (s *CineSyncStore) Close() error {
	return nil
}

// sanitizeFilename makes a filename safe for the filesystem
func sanitizeFilename(name string) string {
	replacePairs := []string{"/", "_", "\\", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_", ":", "_"}
	r := strings.NewReplacer(replacePairs...)
	return r.Replace(name)
}

// getItemPath returns the file path for a torrent item (named by torrent name/accessKey)
func (s *CineSyncStore) getItemPath(name string) string {
	return filepath.Join(s.baseDir, sanitizeFilename(name)+CineSyncExt)
}

// getItemPathByID returns the file path for a torrent item by ID (for lookups)
func (s *CineSyncStore) getItemPathByID(id string) string {
	return filepath.Join(s.baseDir, sanitizeFilename(id)+CineSyncExt)
}

// getInfoPath returns the file path for torrent info (named by torrent ID)
func (s *CineSyncStore) getInfoPath(id string) string {
	return filepath.Join(s.infoDir, sanitizeFilename(id)+CineSyncDataExt)
}

// getRepairPath returns the file path for repair entry
func (s *CineSyncStore) getRepairPath(id string) string {
	return filepath.Join(s.repairDir, sanitizeFilename(id)+RepairExt)
}

// SaveItem saves a lightweight torrent item (file named by torrent name, not ID)
func (s *CineSyncStore) SaveItem(item TorrentItem) error {
	if item.ID == "" {
		return fmt.Errorf("item ID is required")
	}

	accessKey := GetDirectoryName(item.Filename)
	
	csi := CineSyncItem{
		ID:       item.ID,
		Filename: accessKey,
		Bytes:    item.Bytes,
		Files:    item.Files,
		Status:   item.Status,
		Added:    item.Added,
		Ended:    item.Ended,
		Modified: time.Now().Unix(),
		Version:  "1.0",
	}

	// File is named by torrent name (accessKey), not ID
	return s.writeJSON(s.getItemPath(accessKey), csi)
}

// LoadItem loads a torrent item from file by name (accessKey)
func (s *CineSyncStore) LoadItem(name string) (*CineSyncItem, error) {
	var item CineSyncItem
	if err := s.readJSON(s.getItemPath(name), &item); err != nil {
		return nil, err
	}
	return &item, nil
}

// LoadItemByID loads a torrent item by scanning all files for matching ID
func (s *CineSyncStore) LoadItemByID(id string) (*CineSyncItem, error) {
	items, err := s.LoadAllItems()
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.ID == id {
			return &item, nil
		}
	}
	return nil, os.ErrNotExist
}

// LoadAllItems loads all torrent items from the store
func (s *CineSyncStore) LoadAllItems() ([]CineSyncItem, error) {
	pattern := filepath.Join(s.baseDir, "*"+CineSyncExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob items: %w", err)
	}

	items := make([]CineSyncItem, 0, len(files))
	for _, filePath := range files {
		var item CineSyncItem
		if err := s.readJSON(filePath, &item); err != nil {
			logger.Warn("[CineSyncStore] Failed to load item from %s: %v", filePath, err)
			continue
		}
		items = append(items, item)
	}

	return items, nil
}

// DeleteItem removes a torrent item file by name
func (s *CineSyncStore) DeleteItem(name string) error {
	return os.Remove(s.getItemPath(name))
}

// DeleteItemByID removes a torrent item file by finding its name first
func (s *CineSyncStore) DeleteItemByID(id string) error {
	item, err := s.LoadItemByID(id)
	if err != nil {
		return err
	}
	return os.Remove(s.getItemPath(item.Filename))
}

// HasItem checks if an item exists by name
func (s *CineSyncStore) HasItem(name string) bool {
	_, err := os.Stat(s.getItemPath(name))
	return err == nil
}

// HasItemByID checks if an item exists by ID (scans all files)
func (s *CineSyncStore) HasItemByID(id string) bool {
	_, err := s.LoadItemByID(id)
	return err == nil
}

// --- Info Operations (full torrent info with files/links) ---

// SaveInfo saves full torrent info
func (s *CineSyncStore) SaveInfo(info *TorrentInfo) error {
	if info == nil || info.ID == "" {
		return fmt.Errorf("invalid info")
	}

	data := CineSyncData{
		TorrentInfo: info,
		StoredAt:    time.Now().Unix(),
		Version:     "1.0",
	}

	return s.writeJSON(s.getInfoPath(info.ID), data)
}

// LoadInfo loads full torrent info
func (s *CineSyncStore) LoadInfo(id string) (*TorrentInfo, error) {
	var data CineSyncData
	if err := s.readJSON(s.getInfoPath(id), &data); err != nil {
		return nil, err
	}
	return data.TorrentInfo, nil
}

// DeleteInfo removes torrent info file
func (s *CineSyncStore) DeleteInfo(id string) error {
	return os.Remove(s.getInfoPath(id))
}

// HasInfo checks if info exists
func (s *CineSyncStore) HasInfo(id string) bool {
	_, err := os.Stat(s.getInfoPath(id))
	return err == nil
}

// LoadAllInfoIDs returns all torrent IDs that have cached info
func (s *CineSyncStore) LoadAllInfoIDs() ([]string, error) {
	pattern := filepath.Join(s.infoDir, "*"+CineSyncDataExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(files))
	for _, f := range files {
		base := filepath.Base(f)
		id := strings.TrimSuffix(base, CineSyncDataExt)
		ids = append(ids, id)
	}
	return ids, nil
}

// LoadAllInfoParallel loads all .cinesyncdata files in parallel and returns a map[id]*TorrentInfo
// This is MUCH faster than loading one-by-one for large torrent counts
func (s *CineSyncStore) LoadAllInfoParallel() (map[string]*TorrentInfo, error) {
	pattern := filepath.Join(s.infoDir, "*"+CineSyncDataExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob info files: %w", err)
	}

	if len(files) == 0 {
		return make(map[string]*TorrentInfo), nil
	}

	type result struct {
		id   string
		info *TorrentInfo
	}

	// Use worker pool for parallel loading
	numWorkers := 32 // Parallel file readers
	if len(files) < numWorkers {
		numWorkers = len(files)
	}

	jobs := make(chan string, len(files))
	results := make(chan result, len(files))

	// Start workers
	var wg sync.WaitGroup
	for w := 0; w < numWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for filePath := range jobs {
				base := filepath.Base(filePath)
				id := strings.TrimSuffix(base, CineSyncDataExt)
				
				var data CineSyncData
				if err := s.readJSON(filePath, &data); err != nil {
					continue // Skip failed reads
				}
				if data.TorrentInfo != nil {
					results <- result{id: id, info: data.TorrentInfo}
				}
			}
		}()
	}

	// Send jobs
	for _, f := range files {
		jobs <- f
	}
	close(jobs)

	// Wait for workers to complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	infoMap := make(map[string]*TorrentInfo, len(files))
	for r := range results {
		infoMap[r.id] = r.info
	}

	return infoMap, nil
}

// --- Repair Operations ---

// SaveRepair saves a repair entry
func (s *CineSyncStore) SaveRepair(entry RepairEntry) error {
	if entry.TorrentID == "" {
		return fmt.Errorf("torrent ID is required")
	}
	entry.UpdatedAt = time.Now().Unix()
	return s.writeJSON(s.getRepairPath(entry.TorrentID), entry)
}

// LoadRepair loads a repair entry
func (s *CineSyncStore) LoadRepair(id string) (*RepairEntry, error) {
	var entry RepairEntry
	if err := s.readJSON(s.getRepairPath(id), &entry); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return &entry, nil
}

// DeleteRepair removes a repair entry
func (s *CineSyncStore) DeleteRepair(id string) error {
	path := s.getRepairPath(id)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// LoadAllRepairs loads all repair entries
func (s *CineSyncStore) LoadAllRepairs() ([]RepairEntry, error) {
	pattern := filepath.Join(s.repairDir, "*"+RepairExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	entries := make([]RepairEntry, 0, len(files))
	for _, filePath := range files {
		var entry RepairEntry
		if err := s.readJSON(filePath, &entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// GetRepairCount returns the number of repair entries
func (s *CineSyncStore) GetRepairCount() (int, error) {
	pattern := filepath.Join(s.repairDir, "*"+RepairExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return 0, err
	}
	return len(files), nil
}

// GetAllRepairs returns all repair entries (alias for LoadAllRepairs for API compatibility)
func (s *CineSyncStore) GetAllRepairs() ([]RepairEntry, error) {
	return s.LoadAllRepairs()
}

// BulkSaveItems saves multiple items efficiently
func (s *CineSyncStore) BulkSaveItems(items []TorrentItem, onProgress func(int)) error {
	for i, item := range items {
		if err := s.SaveItem(item); err != nil {
			logger.Warn("[CineSyncStore] Failed to save item %s: %v", item.ID, err)
		}
		if onProgress != nil && (i%100 == 0 || i == len(items)-1) {
			onProgress(i + 1)
		}
	}
	return nil
}

// GetAllIDs returns all torrent IDs in the store (reads from file contents, not filenames)
func (s *CineSyncStore) GetAllIDs() ([]string, error) {
	items, err := s.LoadAllItems()
	if err != nil {
		return nil, err
	}

	ids := make([]string, len(items))
	for i, item := range items {
		ids[i] = item.ID
	}
	return ids, nil
}

// GetAllNames returns all torrent names (filenames) in the store
func (s *CineSyncStore) GetAllNames() ([]string, error) {
	pattern := filepath.Join(s.baseDir, "*"+CineSyncExt)
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(files))
	for _, f := range files {
		base := filepath.Base(f)
		name := strings.TrimSuffix(base, CineSyncExt)
		names = append(names, name)
	}
	return names, nil
}

// DeleteByID removes all files for a torrent by ID
func (s *CineSyncStore) DeleteByID(id string) error {
	// Find and remove item file (named by torrent name)
	item, err := s.LoadItemByID(id)
	if err == nil && item != nil {
		if err := os.Remove(s.getItemPath(item.Filename)); err != nil && !os.IsNotExist(err) {
			logger.Warn("[CineSyncStore] Failed to remove item file: %v", err)
		}
	}
	// Remove info file (named by ID)
	if err := os.Remove(s.getInfoPath(id)); err != nil && !os.IsNotExist(err) {
		logger.Warn("[CineSyncStore] Failed to remove info file: %v", err)
	}
	// Remove repair file (named by ID)
	if err := os.Remove(s.getRepairPath(id)); err != nil && !os.IsNotExist(err) {
		logger.Warn("[CineSyncStore] Failed to remove repair file: %v", err)
	}
	return nil
}

// Count returns the number of items in the store
func (s *CineSyncStore) Count() int {
	pattern := filepath.Join(s.baseDir, "*"+CineSyncExt)
	files, _ := filepath.Glob(pattern)
	return len(files)
}

// writeJSON writes data to a file as JSON
func (s *CineSyncStore) writeJSON(filePath string, data interface{}) error {
	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufferPool.Put(buf)

	if err := json.NewEncoder(buf).Encode(data); err != nil {
		return fmt.Errorf("failed to encode JSON: %w", err)
	}

	// Write to temp file first, then rename (atomic)
	tmpPath := filePath + ".tmp"
	if err := os.WriteFile(tmpPath, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	if err := os.Rename(tmpPath, filePath); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to rename file: %w", err)
	}

	return nil
}

// readJSON reads JSON from a file
func (s *CineSyncStore) readJSON(filePath string, data interface{}) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	buf := bufferPool.Get().(*bytes.Buffer)
	buf.Reset()
	defer bufferPool.Put(buf)

	if _, err := io.Copy(buf, file); err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	if err := json.Unmarshal(buf.Bytes(), data); err != nil {
		return fmt.Errorf("failed to decode JSON: %w", err)
	}

	return nil
}

// GetIDsNeedingUpdate returns IDs that don't have cached info
func (s *CineSyncStore) GetIDsNeedingUpdate(limit int) ([]string, error) {
	itemIDs, err := s.GetAllIDs()
	if err != nil {
		return nil, err
	}

	infoIDs, err := s.LoadAllInfoIDs()
	if err != nil {
		return nil, err
	}

	// Create set of IDs with info
	hasInfo := make(map[string]struct{}, len(infoIDs))
	for _, id := range infoIDs {
		hasInfo[id] = struct{}{}
	}

	// Also exclude IDs in repair
	repairEntries, _ := s.LoadAllRepairs()
	inRepair := make(map[string]struct{}, len(repairEntries))
	for _, e := range repairEntries {
		inRepair[e.TorrentID] = struct{}{}
	}

	// Find IDs without info
	needingUpdate := make([]string, 0)
	for _, id := range itemIDs {
		if _, ok := hasInfo[id]; !ok {
			if _, inR := inRepair[id]; !inR {
				needingUpdate = append(needingUpdate, id)
				if limit > 0 && len(needingUpdate) >= limit {
					break
				}
			}
		}
	}

	return needingUpdate, nil
}

// GetUncheckedTorrents returns torrents that haven't been checked recently
func (s *CineSyncStore) GetUncheckedTorrents(maxAgeSeconds int64) ([]string, error) {
	items, err := s.LoadAllItems()
	if err != nil {
		return nil, err
	}

	cutoff := time.Now().Unix() - maxAgeSeconds
	unchecked := make([]string, 0)

	for _, item := range items {
		if item.Modified < cutoff {
			unchecked = append(unchecked, item.ID)
		}
	}

	return unchecked, nil
}

// GetItemByID returns a TorrentItem by ID
func (s *CineSyncStore) GetItemByID(id string) (TorrentItem, error) {
	item, err := s.LoadItemByID(id)
	if err != nil {
		return TorrentItem{}, err
	}

	return TorrentItem{
		ID:       item.ID,
		Filename: item.Filename,
		Bytes:    item.Bytes,
		Files:    item.Files,
		Status:   item.Status,
		Added:    item.Added,
		Ended:    item.Ended,
	}, nil
}

// GetAllItems returns all items as TorrentItem slice (compatibility method)
func (s *CineSyncStore) GetAllItems() ([]TorrentItem, error) {
	items, err := s.LoadAllItems()
	if err != nil {
		return nil, err
	}

	result := make([]TorrentItem, len(items))
	for i, item := range items {
		result[i] = TorrentItem{
			ID:       item.ID,
			Filename: item.Filename,
			Bytes:    item.Bytes,
			Files:    item.Files,
			Status:   item.Status,
			Added:    item.Added,
			Ended:    item.Ended,
		}
	}
	return result, nil
}

// UpsertRepair creates or updates a repair entry
func (s *CineSyncStore) UpsertRepair(torrentID, filename, hash, status string, progress int, reason string) error {
	entry := RepairEntry{
		TorrentID: torrentID,
		Filename:  filename,
		Hash:      hash,
		Status:    status,
		Progress:  progress,
		Reason:    reason,
		UpdatedAt: time.Now().Unix(),
	}
	return s.SaveRepair(entry)
}

// UpdateRepairState updates repair state for a torrent
func (s *CineSyncStore) UpdateRepairState(torrentID string, isBroken bool, brokenCount, linkCount int) error {
	item, err := s.LoadItemByID(torrentID)
	if err != nil {
		return nil
	}
	item.Modified = time.Now().Unix()
	return s.writeJSON(s.getItemPath(item.Filename), item)
}

// GetModifiedUnix returns the modified timestamp for a torrent
func (s *CineSyncStore) GetModifiedUnix(id string) (int64, bool, error) {
	item, err := s.LoadItemByID(id)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return item.Modified, true, nil
}

// GetRepair returns a repair entry
func (s *CineSyncStore) GetRepair(torrentID string) (*RepairEntry, error) {
	return s.LoadRepair(torrentID)
}

// NeedsUpdate checks if an item needs updating (no cached info or hash)
func (s *CineSyncStore) NeedsUpdate(item TorrentItem) (bool, error) {
	existing, err := s.LoadItemByID(item.ID)
	if err != nil {
		if os.IsNotExist(err) {
			return true, nil
		}
		return true, err
	}

	// Check if hash is missing
	if existing.Hash == "" {
		return true, nil
	}

	// Check if info exists
	if !s.HasInfo(item.ID) {
		return true, nil
	}

	return false, nil
}