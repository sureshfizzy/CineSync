package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
	"cinesync/pkg/torbox"
)

func validateTorBoxConfig() (*torbox.Config, error) {
	cfg := torbox.GetConfigManager().GetConfig()
	if !cfg.Enabled || cfg.APIKey == "" {
		return nil, fmt.Errorf("TorBox is not configured or enabled")
	}
	return cfg, nil
}

var (
	tbDiffMu       sync.Mutex
	tbLastSeen     []torbox.TorrentItem
	tbHaveSeen     bool
	tbPrefetchOnce sync.Once
)

const tbBackgroundRefreshInt = 15 * time.Second

func applyTorBoxDiff(items []torbox.TorrentItem, reason string) {
	tbDiffMu.Lock()
	prev := tbLastSeen
	hadPrev := tbHaveSeen
	tbLastSeen = items
	tbHaveSeen = true
	tbDiffMu.Unlock()

	var newTorrents, removedTorrents []torbox.TorrentItem
	if !hadPrev {
		logger.Info("[TorBox] Baseline loaded: %d torrents (%s)", len(items), reason)
	} else {
		prevByID := make(map[int]struct{}, len(prev))
		for _, t := range prev {
			prevByID[t.ID] = struct{}{}
		}
		newByID := make(map[int]struct{}, len(items))
		for _, t := range items {
			newByID[t.ID] = struct{}{}
			if _, ok := prevByID[t.ID]; !ok {
				logger.Info("New file added: %s", truncateTorBoxName(t.Name))
				newTorrents = append(newTorrents, t)
			}
		}
		for _, t := range prev {
			if _, ok := newByID[t.ID]; !ok {
				logger.Info("File removed: %s", truncateTorBoxName(t.Name))
				removedTorrents = append(removedTorrents, t)
			}
		}
	}
	torbox.PersistTorrentList(items)

	if hadPrev && len(newTorrents) > 0 {
		realdebrid.NotifyNewTorrentDirs(torbox.AdaptTorrentItems(newTorrents))
	}
	if hadPrev && len(removedTorrents) > 0 && realdebrid.OnRemovedTorrentsDetected != nil {
		filenames := make([]string, 0, len(removedTorrents))
		for _, t := range removedTorrents {
			if name := strings.TrimSpace(t.Name); name != "" {
				filenames = append(filenames, name)
			}
		}
		if len(filenames) > 0 {
			go realdebrid.OnRemovedTorrentsDetected(filenames)
		}
	}
}

func truncateTorBoxName(name string) string {
	name = strings.TrimSpace(name)
	const max = 80
	if len(name) > max {
		return name[:max-3] + "..."
	}
	return name
}

func runTorBoxListRefresh(apiKey, reason string, warnOnErr bool) {
	client := torbox.NewClient(apiKey)
	items, err := client.GetTorrentList(1000, 0, true, nil)
	if err != nil {
		if warnOnErr {
			logger.Warn("[TorBox] Failed to fetch torrents (%s): %v", reason, err)
		} else {
			logger.Debug("[TorBox] Background refresh failed: %v", err)
		}
		return
	}
	applyTorBoxDiff(items, reason)
}

func startTorBoxRefreshLoop() {
	go func() {
		ticker := time.NewTicker(tbBackgroundRefreshInt)
		defer ticker.Stop()
		for range ticker.C {
			cfg := torbox.GetConfigManager().GetConfig()
			if !cfg.Enabled || cfg.APIKey == "" {
				continue
			}
			runTorBoxListRefresh(cfg.APIKey, "background", false)
		}
	}()
}

func PrefetchTorBoxData() {
	tbPrefetchOnce.Do(func() {
		cfg := torbox.GetConfigManager().GetConfig()
		if !cfg.Enabled || cfg.APIKey == "" {
			return
		}
		if disk, err := torbox.LoadTorrentListFromStore(); err == nil && len(disk) > 0 {
			tbDiffMu.Lock()
			tbLastSeen = append([]torbox.TorrentItem(nil), disk...)
			tbHaveSeen = true
			tbDiffMu.Unlock()
		}
		go runTorBoxListRefresh(cfg.APIKey, "startup", true)
		startTorBoxRefreshLoop()
	})
}

func HandleTorBoxConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	cm := torbox.GetConfigManager()
	switch r.Method {
	case http.MethodGet:
		cfg := cm.GetConfig()
		status := cm.GetConfigStatus()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"config": cfg,
			"status": status,
		})
	case http.MethodPost, http.MethodPut:
		var updates map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if apiKey, ok := updates["apiKey"].(string); ok && apiKey != "" {
			client := torbox.NewClient(apiKey)
			if st := client.GetAPIKeyStatus(); st["valid"] != true {
				http.Error(w, "Invalid TorBox API key", http.StatusBadRequest)
				return
			}
		}

		if err := cm.UpdateConfig(updates); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		_, hasAPIKey := updates["apiKey"]
		_, hasEnabled := updates["enabled"]
		if hasAPIKey || hasEnabled {
			tbDiffMu.Lock()
			tbLastSeen = nil
			tbHaveSeen = false
			tbDiffMu.Unlock()
			newCfg := cm.GetConfig()
			if newCfg.Enabled && newCfg.APIKey != "" {
				go runTorBoxListRefresh(newCfg.APIKey, "config-update", true)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"config":  cm.GetConfig(),
			"status":  cm.GetConfigStatus(),
			"message": "Configuration updated successfully",
		})
	case http.MethodDelete:
		if err := cm.ResetConfig(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		tbDiffMu.Lock()
		tbLastSeen = nil
		tbHaveSeen = false
		tbDiffMu.Unlock()
		torbox.ResetTorBoxStore()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"message": "Configuration reset successfully",
		})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func HandleTorBoxTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		APIKey string `json:"apiKey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.APIKey) == "" {
		http.Error(w, "API key is required", http.StatusBadRequest)
		return
	}

	client := torbox.NewClient(strings.TrimSpace(req.APIKey))
	status := client.GetAPIKeyStatus()
	if status["valid"] != true {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   status["error"],
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "API connection successful",
	})
}

func HandleTorBoxDownloads(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s := strings.TrimSpace(r.URL.Query().Get("force"))
	force := false
	if s != "" {
		if b, err := strconv.ParseBool(s); err == nil {
			force = b
		}
	}

	client := torbox.NewClient(cfg.APIKey)
	items, err := client.GetTorrentList(1000, 0, force, nil)
	if err != nil {
		fallback, ferr := torbox.LoadTorrentListFromStore()
		if ferr != nil || len(fallback) == 0 {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		items = fallback
		if force {
			applyTorBoxDiff(items, "force")
		}
	} else {
		if force {
			applyTorBoxDiff(items, "force")
		} else {
			torbox.PersistTorrentList(items)
		}
	}

	type FileItem struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		IsDir    bool   `json:"isDir"`
		ModTime  string `json:"modTime"`
		Added    string `json:"added"`
		Link     string `json:"link"`
		Download string `json:"download"`
		Status   string `json:"status"`
		Files    int    `json:"files"`
		Hash     string `json:"hash,omitempty"`
	}

	files := make([]FileItem, 0, len(items))
	for _, it := range items {
		files = append(files, FileItem{
			ID:       strconv.Itoa(it.ID),
			Name:     it.Name,
			Path:     "/torrents/" + strconv.Itoa(it.ID),
			Size:     it.Size,
			IsDir:    false,
			ModTime:  it.Added,
			Added:    it.Added,
			Link:     "",
			Download: "",
			Status:   it.Status,
			Files:    len(it.Files),
			Hash:     it.Hash,
		})
	}

	source := "torbox"
	if force {
		source = "torbox-fresh"
	} else if err != nil {
		source = "torbox-store"
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"path":   "/torrents",
		"files":  files,
		"total":  len(files),
		"source": source,
	})
}

func HandleTorBoxTorrentFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tidStr := strings.TrimSpace(r.URL.Query().Get("id"))
	if tidStr == "" {
		http.Error(w, "Missing torrent id", http.StatusBadRequest)
		return
	}
	tid, err := strconv.Atoi(tidStr)
	if err != nil || tid <= 0 {
		http.Error(w, "Invalid torrent id", http.StatusBadRequest)
		return
	}

	client := torbox.NewClient(cfg.APIKey)
	items, err := client.GetTorrentList(1, 0, true, &tid)
	var item torbox.TorrentItem
	if err == nil && len(items) > 0 && items[0].ID == tid {
		item = items[0]
	} else {
		stItem, stErr := torbox.LoadTorrentByIDFromStore(tid)
		if stErr != nil || stItem == nil || len(stItem.Files) == 0 {
			if err != nil {
				logger.Warn("[TorBox] torrent-files id=%d: %v", tid, err)
			}
			http.Error(w, "Torrent not found", http.StatusNotFound)
			return
		}
		item = *stItem
	}

	type FileLink struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
		Size int64  `json:"size"`
		Link string `json:"link"`
	}

	out := make([]FileLink, 0, len(item.Files))
	for _, f := range item.Files {
		out = append(out, FileLink{
			ID:   f.ID,
			Name: f.Name,
			Size: f.Size,
			Link: client.MakeRequestDLPermalink(item.ID, f.ID),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":    tidStr,
		"files": out,
	})
}

func HandleTorBoxUnrestrictFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tidStr := strings.TrimSpace(r.URL.Query().Get("id"))
	if tidStr == "" {
		http.Error(w, "Missing torrent id", http.StatusBadRequest)
		return
	}
	tid, err := strconv.Atoi(tidStr)
	if err != nil || tid <= 0 {
		http.Error(w, "Invalid torrent id", http.StatusBadRequest)
		return
	}

	fidStr := strings.TrimSpace(r.URL.Query().Get("fileId"))
	if fidStr == "" {
		http.Error(w, "Missing fileId", http.StatusBadRequest)
		return
	}
	fid, err := strconv.Atoi(fidStr)
	if err != nil || fid < 0 {
		http.Error(w, "Invalid fileId", http.StatusBadRequest)
		return
	}

	client := torbox.NewClient(cfg.APIKey)
	downloadURL, err := client.RequestDownloadLink(tid, fid)
	if err != nil {
		logger.Warn("[TorBox] requestdl torrent=%d file=%d: %v", tid, fid, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":     tidStr,
		"fileId": fid,
		"url":    downloadURL,
	})
}

func HandleTorBoxDeleteTorrent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var req struct {
		TorrentID int    `json:"torrent_id"`
		ID        string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	tid := req.TorrentID
	if tid <= 0 && strings.TrimSpace(req.ID) != "" {
		tid, err = strconv.Atoi(strings.TrimSpace(req.ID))
		if err != nil {
			http.Error(w, "Invalid torrent id", http.StatusBadRequest)
			return
		}
	}
	if tid <= 0 {
		http.Error(w, "torrent_id or id is required", http.StatusBadRequest)
		return
	}

	client := torbox.NewClient(cfg.APIKey)
	if err := client.DeleteTorrent(tid); err != nil {
		logger.Warn("[TorBox] delete torrent %d: %v", tid, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	torbox.DeleteTorrentFromStore(strconv.Itoa(tid))

	if cfg.Enabled && cfg.APIKey != "" {
		go runTorBoxListRefresh(cfg.APIKey, "after-delete", true)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"torrent_id": tid,
		"message":    "Torrent deleted from TorBox",
	})
}

func HandleTorBoxDashboardStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	client := torbox.NewClient(cfg.APIKey)
	items, err := client.GetTorrentList(1000, 0, false, nil)
	if err != nil {
		fallback, ferr := torbox.LoadTorrentListFromStore()
		if ferr != nil || len(fallback) == 0 {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		items = fallback
	}

	statusCounts := map[string]int{}
	var totalSize int64
	for _, it := range items {
		s := strings.TrimSpace(it.Status)
		if s == "" {
			s = "unknown"
		}
		statusCounts[s]++
		totalSize += it.Size
	}

	resp := map[string]interface{}{
		"account": map[string]interface{}{
			"username":   "TorBox",
			"email":      "",
			"points":     0,
			"type":       "n/a",
			"expiration": "",
		},
		"torrents": map[string]interface{}{
			"total":        len(items),
			"totalSize":    totalSize,
			"statusCounts": statusCounts,
		},
		"traffic": map[string]interface{}{
			"today": int64(0),
		},
		"lastUpdated": time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
