package torbox

import (
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

var (
	tbDiskMu sync.Mutex
	tbStore  *realdebrid.CineSyncStore
)

func torBoxStoreAbsDir() (string, error) {
	return filepath.Abs(filepath.Join("..", realdebrid.TorrentsDir, "torbox"))
}

func torBoxStore() (*realdebrid.CineSyncStore, error) {
	if tbStore != nil {
		return tbStore, nil
	}
	dir, err := torBoxStoreAbsDir()
	if err != nil {
		return nil, err
	}
	st, err := realdebrid.OpenCineSyncStore(dir, false)
	if err != nil {
		return nil, err
	}
	tbStore = st
	return tbStore, nil
}

func ResetTorBoxStore() {
	tbDiskMu.Lock()
	defer tbDiskMu.Unlock()
	if tbStore != nil {
		_ = tbStore.Close()
		tbStore = nil
	}
}

func torBoxProgress(status string) float64 {
	s := strings.ToLower(strings.TrimSpace(status))
	for _, k := range []string{"completed", "cached", "seeding", "uploading", "finished", "downloaded"} {
		if strings.Contains(s, k) {
			return 100
		}
	}
	return 0
}

func toRDTorrentItem(it TorrentItem) realdebrid.TorrentItem {
	id := strconv.Itoa(it.ID)
	name := strings.TrimSpace(it.Name)
	if name == "" {
		name = "torrent-" + id
	}
	rdFiles := make([]realdebrid.TorrentFile, 0, len(it.Files))
	for _, f := range it.Files {
		p := strings.TrimSpace(f.Name)
		if p == "" {
			p = strings.TrimSpace(f.ShortName)
		}
		rdFiles = append(rdFiles, realdebrid.TorrentFile{
			ID:       f.ID,
			Path:     p,
			Bytes:    f.Size,
			Selected: 1,
		})
	}
	return realdebrid.TorrentItem{
		ID:       id,
		Filename: name,
		Bytes:    it.Size,
		Files:    len(it.Files),
		Added:    it.Added,
		Status:   it.Status,
		FileList: rdFiles,
	}
}

func toRDTorrentInfo(it TorrentItem) *realdebrid.TorrentInfo {
	id := strconv.Itoa(it.ID)
	name := strings.TrimSpace(it.Name)
	if name == "" {
		name = "torrent-" + id
	}
	rdFiles := make([]realdebrid.TorrentFile, 0, len(it.Files))
	for _, f := range it.Files {
		p := strings.TrimSpace(f.Name)
		if p == "" {
			p = strings.TrimSpace(f.ShortName)
		}
		rdFiles = append(rdFiles, realdebrid.TorrentFile{
			ID:       f.ID,
			Path:     p,
			Bytes:    f.Size,
			Selected: 1,
		})
	}
	return &realdebrid.TorrentInfo{
		ID:       id,
		Filename: name,
		Hash:     it.Hash,
		Bytes:    it.Size,
		Host:     "torbox",
		Split:    0,
		Progress: torBoxProgress(it.Status),
		Status:   it.Status,
		Added:    it.Added,
		Files:    rdFiles,
		Links:    []string{},
	}
}

func PersistTorrentList(items []TorrentItem) {
	tbDiskMu.Lock()
	defer tbDiskMu.Unlock()

	st, err := torBoxStore()
	if err != nil {
		logger.Warn("[TorBox] persist store: %v", err)
		return
	}

	newSet := make(map[string]struct{}, len(items))
	for _, it := range items {
		newSet[strconv.Itoa(it.ID)] = struct{}{}
	}
	existingIDs, err := st.GetAllIDs()
	if err == nil {
		for _, id := range existingIDs {
			if _, ok := newSet[id]; !ok {
				_ = st.DeleteByID(id)
			}
		}
	}

	rdItems := make([]realdebrid.TorrentItem, len(items))
	for i := range items {
		rdItems[i] = toRDTorrentItem(items[i])
	}
	_ = st.BulkSaveItems(rdItems, nil)
	for i := range items {
		if err := st.SaveInfo(toRDTorrentInfo(items[i])); err != nil {
			logger.Warn("[TorBox] persist info %d: %v", items[i].ID, err)
		}
	}
}

func LoadTorrentListFromStore() ([]TorrentItem, error) {
	tbDiskMu.Lock()
	defer tbDiskMu.Unlock()

	st, err := torBoxStore()
	if err != nil {
		return nil, err
	}
	citems, err := st.LoadAllItems()
	if err != nil {
		return nil, err
	}
	out := make([]TorrentItem, 0, len(citems))
	for _, ci := range citems {
		tid, err := strconv.Atoi(ci.ID)
		if err != nil || tid <= 0 {
			continue
		}
		t := TorrentItem{
			ID:     tid,
			Name:   ci.Filename,
			Hash:   ci.Hash,
			Status: ci.Status,
			Size:   ci.Bytes,
			Added:  ci.Added,
		}
		if info, err := st.LoadInfo(ci.ID); err == nil && info != nil {
			t.Files = make([]TorrentFile, 0, len(info.Files))
			for _, rf := range info.Files {
				t.Files = append(t.Files, TorrentFile{
					ID:        rf.ID,
					Name:      rf.Path,
					ShortName: rf.Path,
					Size:      rf.Bytes,
				})
			}
		}
		out = append(out, t)
	}
	return out, nil
}

func DeleteTorrentFromStore(torrentID string) {
	tbDiskMu.Lock()
	defer tbDiskMu.Unlock()

	st, err := torBoxStore()
	if err != nil || st == nil {
		return
	}
	_ = st.DeleteByID(torrentID)
}

func LoadTorrentByIDFromStore(tid int) (*TorrentItem, error) {
	idStr := strconv.Itoa(tid)
	tbDiskMu.Lock()
	defer tbDiskMu.Unlock()

	st, err := torBoxStore()
	if err != nil {
		return nil, err
	}
	ci, err := st.LoadItemByID(idStr)
	if err != nil {
		return nil, err
	}
	t := TorrentItem{
		ID:     tid,
		Name:   ci.Filename,
		Hash:   ci.Hash,
		Status: ci.Status,
		Size:   ci.Bytes,
		Added:  ci.Added,
	}
	if info, err := st.LoadInfo(idStr); err == nil && info != nil {
		t.Files = make([]TorrentFile, 0, len(info.Files))
		for _, rf := range info.Files {
			t.Files = append(t.Files, TorrentFile{
				ID:        rf.ID,
				Name:      rf.Path,
				ShortName: rf.Path,
				Size:      rf.Bytes,
			})
		}
	}
	return &t, nil
}
