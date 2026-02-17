package api

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

// validateRealDebridConfig validates that Real-Debrid is configured and enabled
// Returns (config, nil) if valid, or (nil, error) if invalid
func validateRealDebridConfig() (*realdebrid.Config, error) {
	configManager := realdebrid.GetConfigManager()
	cfg := configManager.GetConfig()
	if !cfg.Enabled || cfg.APIKey == "" {
		return nil, fmt.Errorf("Real-Debrid is not configured or enabled")
	}
	return cfg, nil
}

// effectiveModTime returns a stable modified time for a torrent:
func effectiveModTime(tm *realdebrid.TorrentManager, torrentID string, info *realdebrid.TorrentInfo) time.Time {
	if info != nil {
		if info.Ended != "" {
			if t, err := time.Parse(time.RFC3339, info.Ended); err == nil {
				return t
			}
		}
		if info.Added != "" {
			if t, err := time.Parse(time.RFC3339, info.Added); err == nil {
				return t
			}
		}
	}
	if tm != nil {
		if m := tm.GetModifiedUnix(torrentID); m > 0 {
			return time.Unix(m, 0)
		}
	}

	return time.Now()
}

// Shared streaming client for file downloads (optimized for maximum throughput)
var streamClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:          200,              // Maximum idle connections for better reuse
		MaxIdleConnsPerHost:   50,               // More connections per host for parallel streams
		MaxConnsPerHost:       0,                // Unlimited - let OS handle connection limits
		IdleConnTimeout:       45 * time.Second, // Reduced from 90s to prevent stale connections
		DisableKeepAlives:     false,
		ForceAttemptHTTP2:     true,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		DisableCompression:    true,
		ReadBufferSize:        128 * 1024, // 128KB read buffer for faster transfers
		WriteBufferSize:       128 * 1024, // 128KB write buffer
	},
	Timeout: 0,
}

// HandleRealDebridConfig handles Real-Debrid configuration requests
func HandleRealDebridConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	// Handle preflight requests
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	configManager := realdebrid.GetConfigManager()

	switch r.Method {
	case http.MethodGet:
		handleGetRealDebridConfig(w, r, configManager)
	case http.MethodPost, http.MethodPut:
		handleUpdateRealDebridConfig(w, r, configManager)
	case http.MethodDelete:
		handleResetRealDebridConfig(w, r, configManager)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetRealDebridConfig handles GET requests for Real-Debrid configuration
func handleGetRealDebridConfig(w http.ResponseWriter, r *http.Request, configManager *realdebrid.ConfigManager) {
	config := configManager.GetConfig()
	status := configManager.GetConfigStatus()

	// Get token statuses from global client if available
	var tokenStatuses []realdebrid.TokenStatus
	if config.Enabled && config.APIKey != "" {
		client := realdebrid.GetOrCreateClient()
		if client != nil && client.GetTokenManager() != nil {
			tokenStatuses = client.GetTokenManager().GetTokensStatus()
		}
	}

	response := map[string]interface{}{
		"config":        config,
		"status":        status,
		"tokenStatuses": tokenStatuses,
		"configPath":    realdebrid.GetRcloneConfigPath(),
		"serverInfo": map[string]interface{}{
			"os": realdebrid.GetServerOS(),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleUpdateRealDebridConfig handles POST/PUT requests for Real-Debrid configuration
func handleUpdateRealDebridConfig(w http.ResponseWriter, r *http.Request, configManager *realdebrid.ConfigManager) {
	var updates map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		logger.Warn("Failed to decode Real-Debrid config request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate API key if provided
	if apiKey, ok := updates["apiKey"].(string); ok && apiKey != "" {
		client := realdebrid.NewClient(apiKey)
		if !client.IsValidAPIKey(apiKey) {
			http.Error(w, "Invalid Real-Debrid API key", http.StatusBadRequest)
			return
		}
	}

	if err := configManager.UpdateConfig(updates); err != nil {
		logger.Warn("Failed to update Real-Debrid config: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	_, hasAPIKey := updates["apiKey"]
	_, hasAdditionalKeys := updates["additionalApiKeys"]
	tokenChanged := hasAPIKey || hasAdditionalKeys

	// Reset global client and torrent manager
	realdebrid.ResetGlobalClient()
	if tokenChanged {
		realdebrid.ResetTorrentManager()
	}

	// If API key was updated and enabled, trigger torrent prefetch
	if hasAPIKey {
		config := configManager.GetConfig()
		if config.Enabled && config.APIKey != "" {
			logger.Info("API key updated, triggering torrent fetch...")
			fetchAndLoadTorrents(config.APIKey)
		}
	}

	// Return updated configuration
	config := configManager.GetConfig()
	status := configManager.GetConfigStatus()

	// Get token statuses after update
	var tokenStatuses []realdebrid.TokenStatus
	if config.Enabled && config.APIKey != "" {
		client := realdebrid.GetOrCreateClient()
		if client != nil && client.GetTokenManager() != nil {
			tokenStatuses = client.GetTokenManager().GetTokensStatus()
		}
	}

	response := map[string]interface{}{
		"config":        config,
		"status":        status,
		"tokenStatuses": tokenStatuses,
		"message":       "Configuration updated successfully",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleResetRealDebridConfig handles DELETE requests to reset Real-Debrid configuration
func handleResetRealDebridConfig(w http.ResponseWriter, r *http.Request, configManager *realdebrid.ConfigManager) {
	if err := configManager.ResetConfig(); err != nil {
		logger.Warn("Failed to reset Real-Debrid config: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"message": "Configuration reset successfully",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRealDebridTest handles Real-Debrid connection testing
func HandleRealDebridTest(w http.ResponseWriter, r *http.Request) {
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

	var request struct {
		APIKey string `json:"apiKey"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if request.APIKey == "" {
		http.Error(w, "API key is required", http.StatusBadRequest)
		return
	}

	// Test REST API connection using API key as Bearer token
	// Reference: Real-Debrid API docs - GET /user
	// https://api.real-debrid.com/rest/1.0/
	client := realdebrid.NewClient(request.APIKey)
	userInfo, err := client.GetUserInfo()
	if err != nil {
		response := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	response := map[string]interface{}{
		"success":  true,
		"userInfo": userInfo,
		"message":  "API connection successful",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRealDebridHttpDavTest handles Real-Debrid HTTP DAV connection testing
func HandleRealDebridHttpDavTest(w http.ResponseWriter, r *http.Request) {
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

	var request struct {
		UserID   string `json:"userId"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if request.UserID == "" {
		http.Error(w, "User ID is required", http.StatusBadRequest)
		return
	}

	if request.Password == "" {
		http.Error(w, "Password is required", http.StatusBadRequest)
		return
	}

	httpDavClient := realdebrid.NewHttpDavClient(request.UserID, request.Password, "https://dav.real-debrid.com/")

	if err := httpDavClient.TestConnection(); err != nil {
		response := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	files, err := httpDavClient.ListDirectory("/")
	if err != nil {
		response := map[string]interface{}{
			"success": true,
			"message": "HTTP DAV connection successful, but directory listing failed",
			"warning": err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	response := map[string]interface{}{
		"success":   true,
		"message":   "HTTP DAV connection successful",
		"fileCount": len(files),
		"baseUrl":   "https://dav.real-debrid.com/",
		"directoryInfo": map[string]interface{}{
			"accessible": true,
			"fileCount":  len(files),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRealDebridHttpDav handles Real-Debrid HTTP DAV virtual browsing operations
func HandleRealDebridHttpDav(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	configManager := realdebrid.GetConfigManager()
	config := configManager.GetConfig()

	if !config.HttpDavSettings.Enabled || config.HttpDavSettings.UserID == "" || config.HttpDavSettings.Password == "" {
		http.Error(w, "HTTP DAV is not configured or enabled", http.StatusBadRequest)
		return
	}

	reqPath := strings.TrimPrefix(r.URL.Path, "/api/realdebrid/httpdav")
	if reqPath == "" {
		reqPath = "/"
	}

	httpDavClient := realdebrid.NewHttpDavClient(
		config.HttpDavSettings.UserID,
		config.HttpDavSettings.Password,
		"https://dav.real-debrid.com/",
	)

	switch r.Method {
	case http.MethodGet:
		if strings.HasSuffix(reqPath, "/") || reqPath == "/" {
			files, err := getHttpDavDirectoryWithPagination(httpDavClient, reqPath)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to list directory: %v", err), http.StatusInternalServerError)
				return
			}

			response := map[string]interface{}{
				"path":  reqPath,
				"files": files,
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)
		} else {
			reader, err := httpDavClient.ReadFileStream(reqPath)
			if err != nil {
				http.Error(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusInternalServerError)
				return
			}
			defer reader.Close()

			// Get file info for headers
			fileInfo, err := httpDavClient.Stat(reqPath)
			if err == nil {
				w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size))
				w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", fileInfo.Name))
			}

			// Stream the file
			w.Header().Set("Content-Type", "application/octet-stream")
			io.Copy(w, reader)
		}

	case http.MethodHead:
		fileInfo, err := httpDavClient.Stat(reqPath)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get file info: %v", err), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size))
		w.Header().Set("Last-Modified", fileInfo.ModTime.Format(http.TimeFormat))
		w.WriteHeader(http.StatusOK)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// getHttpDavDirectoryWithPagination handles automatic pagination for Real-Debrid HTTP DAV
func getHttpDavDirectoryWithPagination(httpDavClient *realdebrid.HttpDavClient, reqPath string) ([]realdebrid.HttpDavFileInfo, error) {
	switch reqPath {
	case "/torrents", "/torrents/":
		configManager := realdebrid.GetConfigManager()
		config := configManager.GetConfig()

		if !config.HttpDavSettings.Enabled {
			return nil, fmt.Errorf("HTTP DAV not enabled")
		}

		tm := realdebrid.GetTorrentManager(config.APIKey)
		return tm.GetHttpDavTorrents(), nil

	case "/links", "/links/":
		configManager := realdebrid.GetConfigManager()
		config := configManager.GetConfig()

		if !config.HttpDavSettings.Enabled {
			return nil, fmt.Errorf("HTTP DAV not enabled")
		}

		tm := realdebrid.GetTorrentManager(config.APIKey)
		return tm.GetHttpDavLinks(), nil
	}

	files, err := httpDavClient.ListDirectory(reqPath)
	if err != nil {
		return nil, err
	}

	validCount := 0
	for _, file := range files {
		if !strings.HasPrefix(file.Name, "_More_") {
			validCount++
		}
	}

	filteredFiles := make([]realdebrid.HttpDavFileInfo, 0, validCount)
	for _, file := range files {
		if !strings.HasPrefix(file.Name, "_More_") {
			filteredFiles = append(filteredFiles, file)
		}
	}

	return filteredFiles, nil
}

// HandleRealDebridWebDAV handles Real-Debrid WebDAV operations
func HandleRealDebridWebDAV(w http.ResponseWriter, r *http.Request) {
	// Set CORS and WebDAV headers
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, PROPFIND, DELETE, MOVE, COPY")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Depth")
	w.Header().Set("DAV", "1, 2")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	config, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Extract path from URL
	reqPath := strings.TrimPrefix(r.URL.Path, "/api/realdebrid/webdav")
	if reqPath == "" {
		reqPath = "/"
	}

	switch r.Method {
	case "PROPFIND":
		handleTorrentPropfind(w, r, config.APIKey, reqPath)
	case "GET", "HEAD":
		handleTorrentGet(w, r, config.APIKey, reqPath)
	case "DELETE":
		handleTorrentDelete(w, r, config.APIKey, reqPath)
	case "MOVE", "COPY":
		http.Error(w, "Not Implemented", http.StatusNotImplemented)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleRealDebridDownloads lists user's torrents from cache via REST API with pagination
func HandleRealDebridDownloads(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Parse pagination parameters
	query := r.URL.Query()
	page := 1
	limit := -1
	if p := query.Get("page"); p != "" {
		if parsed, err := fmt.Sscanf(p, "%d", &page); err == nil && parsed == 1 && page > 0 {
			// page is valid
		} else {
			page = 1
		}
	}
	if l := query.Get("limit"); l != "" {
		if parsed, err := fmt.Sscanf(l, "%d", &limit); err == nil && parsed == 1 && limit > 0 {
		}
	}

	// Get live data from TorrentManager's idToItemMap
	var items []realdebrid.TorrentItem
	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm != nil {
		items = tm.GetAllTorrentsFromCache()
		if len(items) > 0 {
			sort.Slice(items, func(i, j int) bool {
				return items[i].Added > items[j].Added
			})
		}
	}

	if len(items) == 0 && len(cachedTorrents) > 0 {
		items = cachedTorrents
	}

	if len(items) == 0 {
		client := realdebrid.NewClient(cfg.APIKey)
		var err error
		items, err = client.GetAllTorrents(1000, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		logger.Debug("[RD] Fetched %d torrents live from API", len(items))
	}

	// Calculate pagination
	total := len(items)
	var offset, end int
	if limit <= 0 {
		offset = 0
		end = total
	} else {
		offset = (page - 1) * limit
		end = offset + limit
		if offset >= total {
			offset = 0
			end = 0
		}
		if end > total {
			end = total
		}
	}

	// map to a simplified browser-like response with all local data
	type FileItem struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Path     string `json:"path"`
		Size     int64  `json:"size"`
		IsDir    bool   `json:"isDir"`
		ModTime  string `json:"modTime"`
		Added    string `json:"added"`
		Ended    string `json:"ended,omitempty"`
		Link     string `json:"link"`
		Download string `json:"download"`
		Status   string `json:"status"`
		Files    int    `json:"files"`
		Hash     string `json:"hash,omitempty"`
	}

	// Slice the items for this page
	pageItems := items[offset:end]
	files := make([]FileItem, 0, len(pageItems))
	for _, it := range pageItems {
		firstLink := ""
		if len(it.CachedLinks) > 0 {
			firstLink = it.CachedLinks[0]
		} else if len(it.Links) > 0 {
			firstLink = it.Links[0]
		}

		files = append(files, FileItem{
			ID:       it.ID,
			Name:     it.Filename,
			Path:     "/torrents/" + it.ID,
			Size:     it.Bytes,
			IsDir:    false,
			ModTime:  it.Added,
			Added:    it.Added,
			Ended:    it.Ended,
			Link:     firstLink,
			Download: firstLink,
			Status:   it.Status,
			Files:    it.Files,
		})
	}

	totalPages := 1
	if limit > 0 {
		totalPages = (total + limit - 1) / limit
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"path":       "/torrents",
		"files":      files,
		"total":      total,
		"page":       page,
		"limit":      limit,
		"totalPages": totalPages,
		"source":     "local",
	})
}

// HandleRealDebridTorrentFiles returns file links for a specific torrent
func HandleRealDebridTorrentFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	cfg, err := validateRealDebridConfig()
	if err != nil {
		logger.Warn("[RD] Torrent files config error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	torrentID := r.URL.Query().Get("id")
	if torrentID == "" {
		logger.Warn("[RD] Torrent files request missing id")
		http.Error(w, "Missing torrent id", http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		logger.Warn("[RD] Torrent files: TorrentManager not available")
		http.Error(w, "TorrentManager not available", http.StatusInternalServerError)
		return
	}

	files, links, _ := tm.GetTorrentFileList(torrentID)

	type FileLink struct {
		Name string `json:"name"`
		Size int64  `json:"size"`
		Link string `json:"link"`
	}

	result := make([]FileLink, 0, len(files))
	for i, f := range files {
		link := ""
		if i < len(links) {
			link = links[i]
		}
		result = append(result, FileLink{
			Name: f.Path,
			Size: f.Bytes,
			Link: link,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":    torrentID,
		"files": result,
	})
}

// HandleRealDebridUnrestrictFile returns an unrestricted download link for a specific torrent file
func HandleRealDebridUnrestrictFile(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		logger.Warn("[RD] Unrestrict config error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	torrentID := r.URL.Query().Get("id")
	if torrentID == "" {
		logger.Warn("[RD] Unrestrict request missing id")
		http.Error(w, "Missing torrent id", http.StatusBadRequest)
		return
	}

	fileParam := r.URL.Query().Get("file")
	if fileParam == "" {
		logger.Warn("[RD] Unrestrict request missing file name for torrent %s", torrentID)
		http.Error(w, "Missing file name", http.StatusBadRequest)
		return
	}

	fileParam = strings.TrimSpace(fileParam)
	if fileParam == "" {
		logger.Warn("[RD] Unrestrict invalid file name: empty (torrent %s)", torrentID)
		http.Error(w, "Invalid file name", http.StatusBadRequest)
		return
	}
	if strings.Contains(fileParam, "..") {
		logger.Warn("[RD] Unrestrict invalid file name (path traversal): %s (torrent %s)", fileParam, torrentID)
		http.Error(w, "Invalid file name", http.StatusBadRequest)
		return
	}
	cleanPath := path.Clean("/" + fileParam)
	fileName := strings.TrimPrefix(cleanPath, "/")
	if fileName == "" || fileName == "." || fileName == "/" {
		logger.Warn("[RD] Unrestrict invalid file name: %s (torrent %s)", fileParam, torrentID)
		http.Error(w, "Invalid file name", http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		logger.Warn("[RD] Unrestrict: TorrentManager not available")
		http.Error(w, "TorrentManager not available", http.StatusInternalServerError)
		return
	}

	downloadURL, size, err := tm.GetFileDownloadURL(torrentID, fileName)
	if err != nil {
		logger.Warn("[RD] Unrestrict failed for torrent %s file %s: %v", torrentID, fileName, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":   torrentID,
		"file": fileName,
		"url":  downloadURL,
		"size": size,
	})
}

// HandleRealDebridRefresh handles torrent refresh requests
func HandleRealDebridRefresh(w http.ResponseWriter, r *http.Request) {
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

	var request struct {
		TorrentID string `json:"torrentId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if request.TorrentID == "" {
		http.Error(w, "Torrent ID is required", http.StatusBadRequest)
		return
	}

	config, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(config.APIKey)
	refreshErr := tm.RefreshTorrent(request.TorrentID)
	if refreshErr != nil {
		response := map[string]interface{}{
			"success": false,
			"error":   refreshErr.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	response := map[string]interface{}{
		"success": true,
		"message": "Torrent refreshed successfully",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRealDebridStatus handles Real-Debrid status requests
func HandleRealDebridStatus(w http.ResponseWriter, r *http.Request) {
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

	configManager := realdebrid.GetConfigManager()
	status := configManager.GetConfigStatus()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// HandleRcloneMount handles rclone mount requests
func HandleRcloneMount(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		logger.Warn("Invalid method for rclone mount: %s", r.Method)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var rcloneConfigMap map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&rcloneConfigMap); err != nil {
		logger.Error("Failed to decode rclone config: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Merge with defaults from config
	configManager := realdebrid.GetConfigManager()
	defaultConfig := configManager.GetConfig().RcloneSettings
	rcloneConfig := defaultConfig

	// Apply only non-empty values from the request
	if enabled, ok := rcloneConfigMap["enabled"].(bool); ok {
		rcloneConfig.Enabled = enabled
	}
	if mountPath, ok := rcloneConfigMap["mountPath"].(string); ok && mountPath != "" {
		rcloneConfig.MountPath = mountPath
	}

	if vfsCacheMode, ok := rcloneConfigMap["vfsCacheMode"].(string); ok && vfsCacheMode != "" {
		rcloneConfig.VfsCacheMode = vfsCacheMode
	}
	if vfsCacheMaxSize, ok := rcloneConfigMap["vfsCacheMaxSize"].(string); ok && vfsCacheMaxSize != "" {
		rcloneConfig.VfsCacheMaxSize = vfsCacheMaxSize
	}
	if vfsCacheMaxAge, ok := rcloneConfigMap["vfsCacheMaxAge"].(string); ok && vfsCacheMaxAge != "" {
		rcloneConfig.VfsCacheMaxAge = vfsCacheMaxAge
	}
	if CachePath, ok := rcloneConfigMap["CachePath"].(string); ok {
		rcloneConfig.CachePath = CachePath // Allow empty string to clear cache path
	}
	if bufferSize, ok := rcloneConfigMap["bufferSize"].(string); ok && bufferSize != "" {
		rcloneConfig.BufferSize = bufferSize
	}
	if dirCacheTime, ok := rcloneConfigMap["dirCacheTime"].(string); ok && dirCacheTime != "" {
		rcloneConfig.DirCacheTime = dirCacheTime
	}
	if pollInterval, ok := rcloneConfigMap["pollInterval"].(string); ok && pollInterval != "" {
		rcloneConfig.PollInterval = pollInterval
	}
	if vfsReadChunkSize, ok := rcloneConfigMap["vfsReadChunkSize"].(string); ok && vfsReadChunkSize != "" {
		rcloneConfig.VfsReadChunkSize = vfsReadChunkSize
	}
	if vfsReadChunkSizeLimit, ok := rcloneConfigMap["vfsReadChunkSizeLimit"].(string); ok && vfsReadChunkSizeLimit != "" {
		rcloneConfig.VfsReadChunkSizeLimit = vfsReadChunkSizeLimit
	}
	if streamBufferSize, ok := rcloneConfigMap["streamBufferSize"].(string); ok && streamBufferSize != "" {
		rcloneConfig.StreamBufferSize = streamBufferSize
	}
	if logLevel, ok := rcloneConfigMap["logLevel"].(string); ok {
		rcloneConfig.LogLevel = logLevel
	}
	if logFile, ok := rcloneConfigMap["logFile"].(string); ok {
		rcloneConfig.LogFile = logFile
	}

	rcloneConfig.RemoteName = "CineSync"

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Start mount
	rcloneManager := realdebrid.GetRcloneManager()
	status, mountErr := rcloneManager.Mount(rcloneConfig, cfg.APIKey)
	if mountErr != nil {
		logger.Error("Mount failed: %v", mountErr)
		response := map[string]interface{}{
			"success": false,
			"error":   mountErr.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Check if mount is waiting
	if status.Waiting {
		logger.Info("%s", status.WaitingReason)
		response := map[string]interface{}{
			"success": true,
			"status":  status,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Check if mount actually succeeded
	if status.Error != "" {
		logger.Error("Mount status indicates error: %s", status.Error)
		response := map[string]interface{}{
			"success": false,
			"error":   status.Error,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	logger.Info("Mount completed successfully")

	response := map[string]interface{}{
		"success": true,
		"status":  status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRcloneUnmount handles rclone unmount requests
func HandleRcloneUnmount(w http.ResponseWriter, r *http.Request) {
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

	// Get mount path from query parameter or request body
	mountPath := r.URL.Query().Get("path")
	if mountPath == "" {
		var request struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err == nil {
			mountPath = request.Path
		}
	}

	if mountPath == "" {
		http.Error(w, "Mount path is required", http.StatusBadRequest)
		return
	}

	rcloneManager := realdebrid.GetRcloneManager()
	status, err := rcloneManager.Unmount(mountPath)
	if err != nil {
		response := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	response := map[string]interface{}{
		"success": true,
		"status":  status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRcloneStatus handles rclone status requests
func HandleRcloneStatus(w http.ResponseWriter, r *http.Request) {
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

	// Get mount path from query parameter
	mountPath := r.URL.Query().Get("path")
	if mountPath == "" {
		http.Error(w, "Mount path is required", http.StatusBadRequest)
		return
	}

	rcloneManager := realdebrid.GetRcloneManager()
	status := rcloneManager.GetStatus(mountPath)

	response := map[string]interface{}{
		"status": status,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Background prefetch on server start (called from main)
var rdPrefetchOnce bool
var cachedTorrents []realdebrid.TorrentItem

// PrefetchRealDebridData fetches counts and batches logs
func PrefetchRealDebridData() {
	if rdPrefetchOnce {
		return
	}
	rdPrefetchOnce = true

	cfg := realdebrid.GetConfigManager().GetConfig()
	if !cfg.Enabled || cfg.APIKey == "" {
		logger.Info("[RD] Prefetch skipped: disabled or missing API key")
		return
	}

	fetchAndLoadTorrents(cfg.APIKey)
}

// fetchAndLoadTorrents is the internal function that actually fetches and loads torrents
func fetchAndLoadTorrents(apiKey string) {
	go func() {
		logger.Info("[RD] Prefetch started")
		client := realdebrid.NewClient(apiKey)
		tm := realdebrid.GetTorrentManager(apiKey)

		// Fetch all torrents in batches
		torrents, err := client.GetAllTorrents(1000, func(current, total int) {
			if current%1000 == 0 || current == total {
				logger.Info("[RD] Progress: %d torrents fetched", current)
			}
		})
		if err != nil {
			logger.Warn("[RD] Failed to fetch torrents: %v", err)
		} else {
			existing := 0
			if tm != nil {
				existing = len(tm.GetAllTorrentsFromCache())
			}

			if len(torrents) == 0 {
				if existing > 0 || len(cachedTorrents) > 0 {
					logger.Warn("[RD] Torrents fetched: 0 (transient) - skipping cache reconcile to avoid purge")
					logger.Info("[RD] Prefetch completed")
					return
				}
			}

			if len(torrents) < existing/2 && existing > 100 {
				return
			}

			cachedTorrents = torrents
			logger.Info("[RD] Torrents fetched: %d", len(torrents))
			tm.SetPrefetchedTorrents(torrents)
			if err := tm.PrefetchHttpDavData(); err != nil {
				logger.Warn("[RD] Failed to prefetch HTTP DAV data: %v", err)
			}
			go tm.SaveAllTorrents()
		}

		logger.Info("[RD] Prefetch completed")
	}()
}

// WebDAV XML structures for VFS PROPFIND responses
type multistatus struct {
	XMLName   xml.Name   `xml:"D:multistatus"`
	Xmlns     string     `xml:"xmlns:D,attr"`
	CsXmlns   string     `xml:"xmlns:cs,attr,omitempty"`
	Responses []response `xml:"D:response"`
}

type response struct {
	Href     string   `xml:"D:href"`
	Propstat propstat `xml:"D:propstat"`
}

type propstat struct {
	Prop   prop   `xml:"D:prop"`
	Status string `xml:"D:status"`
}

type prop struct {
	DisplayName      string        `xml:"D:displayname,omitempty"`
	CreationDate     string        `xml:"D:creationdate,omitempty"`
	GetLastModified  string        `xml:"D:getlastmodified,omitempty"`
	GetContentLength int64         `xml:"D:getcontentlength,omitempty"`
	GetContentType   string        `xml:"D:getcontenttype,omitempty"`
	TorrentID        string        `xml:"cs:torrentid,omitempty"`
	FileID           int           `xml:"cs:fileid,omitempty"`
	FileSize         int64         `xml:"cs:filesize,omitempty"`
	RdLink           string        `xml:"cs:rdlink,omitempty"`
	Downloadable     bool          `xml:"cs:downloadable,omitempty"`
	ResourceType     *resourceType `xml:"D:resourcetype,omitempty"`
}

type resourceType struct {
	Collection *struct{} `xml:"D:collection,omitempty"`
}

type torrentNode struct {
	Name      string
	IsDir     bool
	Size      int64
	TorrentID string
	FileID    int
	ModTime   time.Time
	RdLink    string
}

func parseTorrentTime(added string) time.Time {
	if added != "" {
		if parsedTime, err := time.Parse(time.RFC3339, added); err == nil {
			return parsedTime
		}
	}
	return time.Now()
}

// handleTorrentPropfind handles PROPFIND requests to list torrents
func handleTorrentPropfind(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
	tm := realdebrid.GetTorrentManager(apiKey)
	depthHeader := strings.TrimSpace(r.Header.Get("Depth"))
	includeChildren := depthHeader == "" || depthHeader == "1" || depthHeader == "infinity"

	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}

	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")

	if reqPath == "" {
		buf := realdebrid.GetResponseBuffer()
		defer realdebrid.PutResponseBuffer(buf)
		buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">")
		basePath := "/api/realdebrid/webdav/"
		realdebrid.DirectoryResponse(buf, basePath, "")
		if includeChildren {
			realdebrid.DirectoryResponse(buf, basePath+realdebrid.ALL_TORRENTS+"/", "")
		}
		buf.WriteString("</d:multistatus>")

		w.Header().Set("Content-Type", "text/xml; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
		w.WriteHeader(http.StatusMultiStatus)
		w.Write(buf.Bytes())
	} else if parts[0] == realdebrid.ALL_TORRENTS && len(parts) == 1 {
		basePath := "/api/realdebrid/webdav/" + realdebrid.ALL_TORRENTS + "/"
		var torrentCount int
		if tm != nil {
			if allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS); ok {
				torrentCount = allTorrents.Count()
			}
		}
		var buf *bytes.Buffer
		if torrentCount > 500 {
			buf = realdebrid.GetLargeResponseBuffer()
			defer realdebrid.PutLargeResponseBuffer(buf)
		} else {
			buf = realdebrid.GetResponseBuffer()
			defer realdebrid.PutResponseBuffer(buf)
		}
		buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">")
		realdebrid.DirectoryResponse(buf, basePath, "")

		if includeChildren && tm != nil {
			if allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS); ok {
				defaultModTime := time.Now().Format(time.RFC3339)

				for entry := range allTorrents.IterBuffered() {
					if entry.Val == nil {
						continue
					}
					if _, isBroken := tm.GetBrokenTorrentCache().Get(entry.Val.ID); isBroken {
						continue
					}
					modTime := entry.Val.Added
					if modTime == "" {
						modTime = defaultModTime
					}
					realdebrid.DirectoryResponse(buf, basePath+entry.Key+"/", modTime)
				}
			}
		}
		buf.WriteString("</d:multistatus>")

		w.Header().Set("Content-Type", "text/xml; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
		w.WriteHeader(http.StatusMultiStatus)
		w.Write(buf.Bytes())
	} else if parts[0] == realdebrid.ALL_TORRENTS && len(parts) >= 2 {
		torrentName := parts[1]

		allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS)
		if !ok {
			logger.Error("DirectoryMap not initialized")
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}

		item, found := allTorrents.Get(torrentName)
		if !found {
			logger.Error("Torrent not found in DirectoryMap: %s", torrentName)
			http.Error(w, "Torrent not found", http.StatusNotFound)
			return
		}

		basePath := "/api/realdebrid/webdav/" + realdebrid.ALL_TORRENTS + "/" + torrentName + "/"
		dirModTime := item.Added
		if dirModTime == "" {
			dirModTime = time.Now().Format(time.RFC3339)
		}

		fileList := item.CachedFiles
		if includeChildren && len(fileList) == 0 && tm != nil {
			if cached, ok := tm.InfoMap.Get(item.ID); ok && cached != nil {
				fileList = cached.Files
			} else if store := tm.GetStore(); store != nil {
				if cached, err := store.LoadInfo(item.ID); err == nil && cached != nil {
					fileList = cached.Files
					if cached.Progress == 100 {
						tm.InfoMap.Set(item.ID, cached)
					}
				}
			}
		}

		fileModTime := item.Ended
		if fileModTime == "" {
			fileModTime = item.Added
		}
		if fileModTime == "" {
			fileModTime = time.Now().Format(time.RFC3339)
		}

		cacheKey := ""
		if includeChildren {
			cacheKey = fmt.Sprintf("%s|%s|%s|%d|%d", item.ID, dirModTime, fileModTime, len(fileList), item.Files)
			if cached, ok := tm.GetDavCacheEntry(item.ID); ok && cached != nil && cached.Key == cacheKey && len(cached.XML) > 0 {
				w.Header().Set("Content-Type", "text/xml; charset=utf-8")
				w.Header().Set("Content-Length", strconv.Itoa(len(cached.XML)))
				w.WriteHeader(http.StatusMultiStatus)
				w.Write(cached.XML)
				return
			}
		}

		buf := realdebrid.GetResponseBuffer()
		defer realdebrid.PutResponseBuffer(buf)

		buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">")
		realdebrid.DirectoryResponse(buf, basePath, dirModTime)

		_, isTorrentBroken := tm.GetBrokenTorrentCache().Get(item.ID)

		if includeChildren && !isTorrentBroken && len(fileList) > 0 {
			failedFileCache := tm.GetFailedFileCache()

			for _, file := range fileList {
				if file.Selected != 1 {
					continue
				}
				baseName := path.Base(file.Path)

				cacheKey := realdebrid.MakeCacheKey(item.ID, baseName)
				if _, isFileBroken := failedFileCache.Get(cacheKey); isFileBroken {
					continue
				}

				realdebrid.FileResponse(buf, basePath+baseName, file.Bytes, fileModTime)
			}
		}

		buf.WriteString("</d:multistatus>")

		w.Header().Set("Content-Type", "text/xml; charset=utf-8")
		w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
		w.WriteHeader(http.StatusMultiStatus)
		w.Write(buf.Bytes())

		if includeChildren && cacheKey != "" {
			cachedXML := make([]byte, buf.Len())
			copy(cachedXML, buf.Bytes())
			tm.SetDavCacheEntry(item.ID, &realdebrid.DavCacheEntry{
				Key: cacheKey,
				XML: cachedXML,
			})
		}

	} else {
		logger.Error("Invalid WebDAV path requested: %s", reqPath)
		w.Header().Set("Content-Type", "text/xml; charset=utf-8")
		w.WriteHeader(http.StatusMultiStatus)
		w.Write([]byte("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\"></d:multistatus>"))
		return
	}
}

// tryHttpDavFallback attempts to serve file from HTTP DAV when API fails
func tryHttpDavFallback(w http.ResponseWriter, r *http.Request, config *realdebrid.Config, torrentName, filePath string) bool {
	logger.Debug("[HTTPDav Fallback] Attempting fallback for: %s", path.Base(filePath))

	httpDavClient := realdebrid.NewHttpDavClient(config.HttpDavSettings.UserID, config.HttpDavSettings.Password, "https://dav.real-debrid.com/")
	httpDavPath := "/torrents/" + torrentName + "/" + filePath

	fileInfo, err := httpDavClient.Stat(httpDavPath)
	if err != nil {
		logger.Debug("[HTTPDav Fallback] Failed to stat file: %v", err)
		return false
	}

	if r.Method == "HEAD" {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		logger.Debug("[HTTPDav Fallback] HEAD request successful for: %s", path.Base(filePath))
		return true
	}

	reader, err := httpDavClient.ReadFileStream(httpDavPath)
	if err != nil {
		logger.Warn("[HTTPDav Fallback] Failed to open stream: %v", err)
		return false
	}
	defer reader.Close()

	w.Header().Set("Content-Length", fmt.Sprintf("%d", fileInfo.Size))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Accept-Ranges", "bytes")
	w.WriteHeader(http.StatusOK)

	logger.Debug("[HTTPDav Fallback] Serving file via HTTP DAV: %s", path.Base(filePath))

	buf := make([]byte, 512*1024)
	if _, err := io.CopyBuffer(w, reader, buf); err != nil && !isClientDisconnection(err) {
		logger.Warn("[HTTPDav Fallback] Stream error: %v", err)
	} else {
		logger.Debug("[HTTPDav Fallback] Successfully streamed file: %s", path.Base(filePath))
	}
	return true
}

// handleTorrentGet handles GET/HEAD requests to download files from torrents
func handleTorrentGet(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
	tm := realdebrid.GetTorrentManager(apiKey)
	configManager := realdebrid.GetConfigManager()

	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}

	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")

	if len(parts) < 3 || parts[0] != realdebrid.ALL_TORRENTS {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	torrentName := parts[1]
	filePath := strings.Join(parts[2:], "/")
	baseName := path.Base(filePath)

	torrentID, err := tm.FindTorrentByName(torrentName)
	if err != nil {
		http.Error(w, "Torrent not found", http.StatusNotFound)
		return
	}

	if r.Method == "HEAD" {
		if _, broken := tm.GetBrokenTorrentCache().Get(torrentID); broken {
			http.Error(w, "File is not available (being repaired)", http.StatusNotFound)
			return
		}

		cacheKey := realdebrid.MakeCacheKey(torrentID, baseName)
		if _, fileBroken := tm.GetFailedFileCache().Get(cacheKey); fileBroken {
			http.Error(w, "File is not available", http.StatusNotFound)
			return
		}

		if allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS); ok {
			if item, found := allTorrents.Get(torrentName); found {
				fileList, _, _ := tm.GetTorrentFileList(item.ID)
				if len(fileList) > 0 {
					var target *realdebrid.TorrentFile
					for i := range fileList {
						if fileList[i].Selected == 1 {
							if path.Base(fileList[i].Path) == baseName {
								target = &fileList[i]
								break
							}
						}
					}

					if target != nil {
						modTime := time.Now()
						if item.Ended != "" {
							if t, err := time.Parse(time.RFC3339, item.Ended); err == nil {
								modTime = t
							}
						} else if item.Added != "" {
							if t, err := time.Parse(time.RFC3339, item.Added); err == nil {
								modTime = t
							}
						}

						etag := fmt.Sprintf("\"%s-%d-%d-%d\"", torrentID, target.ID, target.Bytes, modTime.Unix())
						if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
							w.WriteHeader(http.StatusNotModified)
							return
						}
						w.Header().Set("ETag", etag)
						w.Header().Set("Content-Length", fmt.Sprintf("%d", target.Bytes))
						w.Header().Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
						w.Header().Set("Accept-Ranges", "bytes")
						w.WriteHeader(http.StatusOK)
						return
					}
				}
			}
		}

		info, infoErr := tm.GetTorrentInfo(torrentID)
		if infoErr != nil {
			http.Error(w, "Failed to resolve file", http.StatusNotFound)
			return
		}
		var target *realdebrid.TorrentFile
		for i := range info.Files {
			if info.Files[i].Selected == 1 {
				clean := strings.Trim(info.Files[i].Path, "/")
				if path.Base(clean) == baseName {
					target = &info.Files[i]
					break
				}
			}
		}
		if target == nil {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		modTime := effectiveModTime(tm, torrentID, info)
		etag := fmt.Sprintf("\"%s-%d-%d-%d\"", torrentID, target.ID, target.Bytes, modTime.Unix())
		if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Length", fmt.Sprintf("%d", target.Bytes))
		w.Header().Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		return
	}

	reqRange := r.Header.Get("Range")
	if _, broken := tm.GetBrokenTorrentCache().Get(torrentID); broken {
		http.Error(w, "File is not available (being repaired)", http.StatusNotFound)
		return
	}

	// Resolve download URL with token rotation retry
	var downloadURL string
	var usedToken string
	var resp *http.Response
	maxRetries := 3

	for attempt := 0; attempt < maxRetries; attempt++ {
		var err error
		downloadURL, _, err = tm.GetFileDownloadURL(torrentID, filePath)
		if err != nil {
			config := configManager.GetConfig()
			if config.HttpDavSettings.Enabled && config.HttpDavSettings.UserID != "" {
				if tryHttpDavFallback(w, r, config, torrentName, filePath) {
					return
				}
			}
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}

		if cached, ok := tm.GetCachedDownloadLink(torrentID, filePath); ok && cached.Token != "" {
			usedToken = cached.Token
		}

		req, err := http.NewRequestWithContext(r.Context(), "GET", downloadURL, nil)
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return
		}

		if reqRange != "" {
			req.Header.Set("Range", reqRange)
		}

		req.Header.Set("Connection", "keep-alive")

		resp, err = streamClient.Do(req)
		if err != nil {
			tm.GetBrokenTorrentCache().Set(torrentID, &realdebrid.FailedFileEntry{
				Error:     err,
				Timestamp: time.Now(),
			})

			if isTimeoutError(err) {
				if transport, ok := streamClient.Transport.(*http.Transport); ok {
					transport.CloseIdleConnections()
				}
			}

			http.Error(w, "Failed to fetch file", http.StatusBadGateway)
			return
		}

		if resp.StatusCode >= 400 {
			if dlErr := realdebrid.CheckDownloadResponse(resp); dlErr != nil {
				resp.Body.Close()

				if realdebrid.IsBytesLimitReached(dlErr) {
					client := realdebrid.GetOrCreateClient()
					if client != nil {
						tokenMgr := client.GetTokenManager()

						if usedToken != "" {
							client.HandleBandwidthLimit(usedToken, dlErr)
						} else {
							if token, tokenErr := tokenMgr.GetCurrentToken(); tokenErr == nil {
								client.HandleBandwidthLimit(token, dlErr)
							}
						}

						tm.ClearDownloadLinkCache(torrentID, filePath)
						client.ClearUnrestrictCache()

						if tokenMgr.AreAllTokensExpired() {
							logger.Error("[Bandwidth] All tokens exhausted - no more bandwidth available")
							http.Error(w, "All Real-Debrid tokens have exceeded bandwidth limits", http.StatusServiceUnavailable)
							return
						}

						logger.Warn("[Bandwidth] Token bandwidth exceeded, rotating to next token (attempt %d/%d)", attempt+1, maxRetries)
						continue
					}
				}

				// Non-bandwidth error, don't retry
				tm.GetBrokenTorrentCache().Set(torrentID, &realdebrid.FailedFileEntry{
					Error:     dlErr,
					Timestamp: time.Now(),
				})
				logger.Warn("RD download failed for %s: %v", torrentID, dlErr)
				http.Error(w, fmt.Sprintf("File not available: %v", dlErr), resp.StatusCode)
				return
			}

			// Generic error without X-Error header
			resp.Body.Close()
			tm.GetBrokenTorrentCache().Set(torrentID, &realdebrid.FailedFileEntry{
				Error:     fmt.Errorf("download failed with status %d", resp.StatusCode),
				Timestamp: time.Now(),
			})
			logger.Warn("RD download failed for %s with status %d", torrentID, resp.StatusCode)
			http.Error(w, fmt.Sprintf("File not available (status %d)", resp.StatusCode), resp.StatusCode)
			return
		}
		break
	}

	if resp == nil {
		http.Error(w, "All tokens exhausted or request failed", http.StatusServiceUnavailable)
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	w.WriteHeader(resp.StatusCode)
	buf := make([]byte, 512*1024)
	n, err := io.CopyBuffer(w, resp.Body, buf)
	if err != nil && !isClientDisconnection(err) {
		tm.GetBrokenTorrentCache().Set(torrentID, &realdebrid.FailedFileEntry{
			Error:     fmt.Errorf("stream failed: %w", err),
			Timestamp: time.Now(),
		})
	}
	if err == nil && n > 0 && reqRange == "" {
		mb := float64(n) / (1024.0 * 1024.0)
		logger.Info("[WebDAV] Served %.2f MB %s", mb, reqPath)
	}

	_ = n
}

func handleTorrentDelete(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
	tm := realdebrid.GetTorrentManager(apiKey)

	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}

	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")
	if len(parts) < 2 || parts[0] != realdebrid.ALL_TORRENTS {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	torrentName := parts[1]
	torrentID, err := tm.FindTorrentByName(torrentName)
	if err != nil || torrentID == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if len(parts) == 2 {
		tm.DeleteFromDBByID(torrentID)
		w.WriteHeader(http.StatusNoContent)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// formatBytes formats byte count into human readable format
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// isClientDisconnection checks if an error is due to client disconnection (normal for range requests)
func isClientDisconnection(err error) bool {
	if err == nil {
		return false
	}

	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "broken pipe") ||
		strings.Contains(errStr, "connection reset by peer") ||
		strings.Contains(errStr, "connection reset") ||
		strings.Contains(errStr, "context canceled") ||
		strings.Contains(errStr, "context deadline exceeded") ||
		strings.Contains(errStr, "client disconnected") ||
		strings.Contains(errStr, "wsasend") || // Windows-specific
		strings.Contains(errStr, "eof")
}

// isTimeoutError checks
func isTimeoutError(err error) bool {
	if err == nil {
		return false
	}

	errStr := strings.ToLower(err.Error())
	return strings.Contains(errStr, "timeout") ||
		strings.Contains(errStr, "deadline exceeded") ||
		strings.Contains(errStr, "i/o timeout")
}

// parseChunkSize parses chunk size string
func parseChunkSize(sizeStr string) int64 {
	if sizeStr == "" {
		return 0
	}

	sizeStr = strings.ToUpper(strings.TrimSpace(sizeStr))

	var multiplier int64 = 1
	var size int64

	if strings.HasSuffix(sizeStr, "K") {
		multiplier = 1024
		sizeStr = strings.TrimSuffix(sizeStr, "K")
	} else if strings.HasSuffix(sizeStr, "M") {
		multiplier = 1024 * 1024
		sizeStr = strings.TrimSuffix(sizeStr, "M")
	} else if strings.HasSuffix(sizeStr, "G") {
		multiplier = 1024 * 1024 * 1024
		sizeStr = strings.TrimSuffix(sizeStr, "G")
	}

	if parsedSize, err := fmt.Sscanf(sizeStr, "%d", &size); err != nil || parsedSize != 1 {
		return 0
	}

	return size * multiplier
}

// Error logging rate limiter to prevent spam
var (
	errorLogMutex sync.Mutex
	lastErrorLog  = make(map[string]time.Time)
)

// shouldLogError checks if we should log an error
func shouldLogError(key string, interval time.Duration) bool {
	errorLogMutex.Lock()
	defer errorLogMutex.Unlock()

	lastTime, exists := lastErrorLog[key]
	if !exists || time.Since(lastTime) > interval {
		lastErrorLog[key] = time.Now()
		return true
	}
	return false
}

// HandleDebridDashboardStats handles requests for debrid dashboard statistics
func HandleDebridDashboardStats(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	client := realdebrid.NewClient(cfg.APIKey)

	// Get user info
	userInfo, err := client.GetUserInfo()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get user info: %v", err), http.StatusBadGateway)
		return
	}

	// Get torrents count and stats from torrent manager
	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	currentState := tm.GetCurrentState()
	statusCounts, totalSize := tm.GetTorrentStatistics()

	// Get traffic information
	trafficInfo, err := client.GetTrafficInfo()
	if err != nil {
		trafficInfo = &realdebrid.TrafficInfo{
			TodayBytes: 0,
		}
	}

	// Prepare response
	response := map[string]interface{}{
		"account": map[string]interface{}{
			"username":   userInfo.Username,
			"email":      userInfo.Email,
			"points":     userInfo.Points,
			"type":       userInfo.Type,
			"expiration": userInfo.Expiration,
		},
		"torrents": map[string]interface{}{
			"total":        currentState.TotalCount,
			"totalSize":    totalSize,
			"statusCounts": statusCounts,
			"lastUpdated":  currentState.LastUpdated.Format(time.RFC3339),
		},
		"workers": map[string]interface{}{
			"io":       realdebrid.CineSyncIOWorkers,
			"api":      realdebrid.CineSyncAPIWorkers,
			"ioInUse":  realdebrid.CineSyncIOInUse.Load(),
			"apiInUse": realdebrid.CineSyncAPIInUse.Load(),
		},
		"enrich": func() map[string]interface{} {
			total := realdebrid.EnrichTotal.Load()
			processed := realdebrid.EnrichProcessed.Load()
			remaining := total - processed
			if remaining < 0 {
				remaining = 0
			}
			return map[string]interface{}{
				"total":     total,
				"processed": processed,
				"saved":     realdebrid.EnrichSaved.Load(),
				"remaining": remaining,
			}
		}(),
		"traffic": map[string]interface{}{
			"today": trafficInfo.TodayBytes,
		},
		"refresh": map[string]interface{}{
			"initialized": tm.IsInitialized(),
			"lastUpdate":  currentState.LastUpdated.Format(time.RFC3339),
		},
		"lastUpdated": time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleTorrentManagerStats handles requests for torrent manager statistics and memory usage
func HandleTorrentManagerStats(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	currentState := tm.GetCurrentState()

	// Get concurrent map statistics
	allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS)
	torrentCount := 0
	if ok {
		torrentCount = allTorrents.Count()
	}

	infoMapCount := tm.InfoMap.Count()
	downloadCacheCount := tm.GetDownloadLinkCacheCount()
	failedCacheCount := tm.GetFailedFileCacheCount()

	// Calculate approximate memory usage
	const (
		torrentItemSize  = 200  // bytes per TorrentItem
		torrentInfoSize  = 7700 // bytes per TorrentInfo (with ~50 files)
		downloadLinkSize = 272  // bytes per cached download link
		failedEntrySize  = 150  // bytes per failed entry
	)

	torrentMapMemory := int64(torrentCount * torrentItemSize)
	infoMapMemory := int64(infoMapCount * torrentInfoSize)
	downloadCacheMemory := int64(downloadCacheCount * downloadLinkSize)
	failedCacheMemory := int64(failedCacheCount * failedEntrySize)
	totalMemory := torrentMapMemory + infoMapMemory + downloadCacheMemory + failedCacheMemory

	// Get refresh statistics
	lastRefresh := tm.GetLastRefreshTime()

	response := map[string]interface{}{
		"directoryMap": map[string]interface{}{
			"totalTorrents": torrentCount,
			"memoryBytes":   torrentMapMemory,
			"description":   "ALL_TORRENTS map (accessKey → TorrentItem*)",
		},
		"infoMap": map[string]interface{}{
			"completeTorrents": infoMapCount,
			"memoryBytes":      infoMapMemory,
			"description":      "Complete torrent info loaded in memory (progress==100%)",
		},
		"downloadCache": map[string]interface{}{
			"cachedLinks": downloadCacheCount,
			"memoryBytes": downloadCacheMemory,
			"ttl":         "24h",
			"description": "Unrestricted download links with 24h TTL",
		},
		"failedCache": map[string]interface{}{
			"failedFiles": failedCacheCount,
			"memoryBytes": failedCacheMemory,
			"ttl":         "24h",
			"description": "Failed file unrestriction attempts",
		},
		"memoryUsage": map[string]interface{}{
			"totalBytes":         totalMemory,
			"torrentMapBytes":    torrentMapMemory,
			"infoMapBytes":       infoMapMemory,
			"downloadCacheBytes": downloadCacheMemory,
			"failedCacheBytes":   failedCacheMemory,
		},
		"refresh": map[string]interface{}{
			"initialized":     tm.IsInitialized(),
			"lastRefresh":     lastRefresh.Format(time.RFC3339),
			"refreshInterval": tm.GetRefreshInterval().Seconds(),
		},
		"state": map[string]interface{}{
			"totalCount":  currentState.TotalCount,
			"lastUpdated": currentState.LastUpdated.Format(time.RFC3339),
		},
		"lastUpdated": time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRealDebridRefreshControl handles smart refresh control requests
func HandleRealDebridRefreshControl(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)

	switch r.Method {
	case http.MethodGet:
		// Get refresh status
		currentState := tm.GetCurrentState()
		response := map[string]interface{}{
			"initialized":    tm.IsInitialized(),
			"currentState":   currentState,
			"totalTorrents":  currentState.TotalCount,
			"firstTorrentId": currentState.FirstTorrentID,
			"lastUpdated":    currentState.LastUpdated.Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)

	case http.MethodPost:
		// Handle refresh control actions
		var request struct {
			Action   string `json:"action"`
			Interval int    `json:"interval,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		switch request.Action {
		case "force_refresh":
			tm.ForceRefresh()

			response := map[string]interface{}{
				"success": true,
				"message": "Force refresh initiated",
				"action":  "force_refresh",
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)

		case "set_interval":
			if request.Interval < 10 {
				http.Error(w, "Minimum refresh interval is 10 seconds", http.StatusBadRequest)
				return
			}

			interval := time.Duration(request.Interval) * time.Second
			tm.SetRefreshInterval(interval)
			logger.Info("[API] Refresh interval updated to %v via API", interval)

			response := map[string]interface{}{
				"success":  true,
				"message":  fmt.Sprintf("Refresh interval set to %v", interval),
				"action":   "set_interval",
				"interval": interval.String(),
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(response)

		default:
			http.Error(w, "Unknown action", http.StatusBadRequest)
		}

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleRepairStatus handles requests for real-time repair progress and status
func HandleRepairStatus(w http.ResponseWriter, r *http.Request) {
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

	// Get repair status
	status := realdebrid.GetRepairStatus()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"is_running":          status.IsRunning,
		"current_torrent_id":  status.CurrentTorrentID,
		"total_torrents":      status.TotalTorrents,
		"processed_torrents":  status.ProcessedTorrents,
		"broken_found":        status.BrokenFound,
		"validated":           status.Validated,
		"queue_size":          status.QueueSize,
		"last_run_time":       status.LastRunTime.Unix(),
		"next_run_time":       status.NextRunTime.Unix(),
		"progress_percentage": calculateProgress(status.ProcessedTorrents, status.TotalTorrents),
	})
}

// HandleRepairQueue returns the list of torrents currently queued for repair
func HandleRepairQueue(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	store := tm.GetStore()
	queueIDs := realdebrid.GetQueuedTorrents()
	total := len(queueIDs)

	page := 1
	pageSize := 50
	if pv := r.URL.Query().Get("page"); pv != "" {
		if n, e := strconv.Atoi(pv); e == nil && n > 0 {
			page = n
		}
	}
	if sv := r.URL.Query().Get("page_size"); sv != "" {
		if n, e := strconv.Atoi(sv); e == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > 500 {
		pageSize = 500
	}

	start := (page - 1) * pageSize
	if start < 0 {
		start = 0
	}
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}

	pageIDs := queueIDs[start:end]

	type queueEntry struct {
		TorrentID string `json:"torrent_id"`
		Filename  string `json:"filename"`
		Hash      string `json:"hash"`
		Status    string `json:"status"`
		Progress  int    `json:"progress"`
		Reason    string `json:"reason"`
		UpdatedAt int64  `json:"updated_at"`
		Position  int    `json:"position"`
	}

	entries := make([]queueEntry, 0, len(pageIDs))
	for idx, id := range pageIDs {
		entry := queueEntry{
			TorrentID: id,
			Position:  start + idx + 1,
		}
		if store != nil {
			if rep, getErr := store.GetRepair(id); getErr != nil {
				logger.Warn("[API] Failed to load repair entry for %s: %v", id, getErr)
			} else if rep != nil {
				entry.Filename = rep.Filename
				entry.Hash = rep.Hash
				entry.Status = rep.Status
				entry.Progress = rep.Progress
				entry.Reason = rep.Reason
				entry.UpdatedAt = rep.UpdatedAt
			}
		}
		entries = append(entries, entry)
	}

	response := map[string]interface{}{
		"count":     total,
		"page":      page,
		"page_size": pageSize,
		"queue":     entries,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRepairQueueDelete removes torrents from the repair queue
func HandleRepairQueueDelete(w http.ResponseWriter, r *http.Request) {
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

	var request struct {
		TorrentIDs       []string `json:"torrent_ids"`
		DeleteFromDebrid bool     `json:"delete_from_debrid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(request.TorrentIDs) == 0 {
		http.Error(w, "No torrent IDs provided", http.StatusBadRequest)
		return
	}

	removed := realdebrid.RemoveQueuedTorrents(request.TorrentIDs)
	removedSet := make(map[string]struct{}, len(removed))
	for _, id := range removed {
		removedSet[id] = struct{}{}
	}

	skipped := make([]string, 0, len(request.TorrentIDs)-len(removed))
	for _, id := range request.TorrentIDs {
		if _, ok := removedSet[id]; !ok {
			skipped = append(skipped, id)
		}
	}

	response := map[string]interface{}{
		"success": len(removed) > 0,
		"removed": removed,
		"skipped": skipped,
		"message": fmt.Sprintf("Removed %d torrents from queue (%d not found or running)", len(removed), len(skipped)),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func calculateProgress(processed, total int64) float64 {
	if total == 0 {
		return 0
	}
	return float64(processed) / float64(total) * 100
}

var notCachedPrefixes = []string{
	"no_links",
	"complete_but_no_links",
	"unavailable_file",
	"infringing_file",
	"not_cached",
	"reinsert_failed",
}

func isNotCachedReason(reason string) bool {
	reason = strings.TrimSpace(reason)
	for _, prefix := range notCachedPrefixes {
		if reason == prefix || strings.HasPrefix(reason, prefix) {
			return true
		}
	}
	return false
}

// HandleRepairAllFiltered queues repairs for all torrents except the ones that are not cached
func HandleRepairAllFiltered(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	store := tm.GetStore()
	if store == nil {
		http.Error(w, "Store not initialized", http.StatusInternalServerError)
		return
	}

	entries, err := store.GetAllRepairs()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load repairs: %v", err), http.StatusInternalServerError)
		return
	}

	type result struct {
		Queued   []string `json:"queued"`
		Skipped  []string `json:"skipped"`
		Failures []string `json:"failures"`
	}

	outcome := result{
		Queued:   make([]string, 0),
		Skipped:  make([]string, 0),
		Failures: make([]string, 0),
	}

	for _, entry := range entries {
		if isNotCachedReason(entry.Reason) {
			outcome.Skipped = append(outcome.Skipped, entry.TorrentID)
			continue
		}

		if entry.TorrentID == "" {
			continue
		}

		if err := tm.RepairTorrent(entry.TorrentID); err != nil {
			logger.Warn("[API] Failed to queue repair for %s: %v", entry.TorrentID, err)
			outcome.Failures = append(outcome.Failures, entry.TorrentID)
			continue
		}
		outcome.Queued = append(outcome.Queued, entry.TorrentID)
	}

	response := map[string]interface{}{
		"success":  true,
		"queued":   len(outcome.Queued),
		"skipped":  len(outcome.Skipped),
		"failed":   len(outcome.Failures),
		"message":  fmt.Sprintf("Queued %d torrents for repair (%d skipped, %d failed)", len(outcome.Queued), len(outcome.Skipped), len(outcome.Failures)),
		"details":  outcome,
		"prefixes": notCachedPrefixes,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRepairStats handles requests for repair statistics and broken torrents list
func HandleRepairStats(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	store := tm.GetStore()
	if store == nil {
		// Return empty stats if store is not initialized
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"total":        0,
			"repairs":      []realdebrid.RepairEntry{},
			"reasonCounts": map[string]int{},
			"lastUpdated":  time.Now().Format(time.RFC3339),
		})
		return
	}

	// Get all repair entries
	repairs, err := store.GetAllRepairs()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get repair entries: %v", err), http.StatusInternalServerError)
		return
	}

	// Ensure repairs is never nil, always return empty array
	if repairs == nil {
		repairs = []realdebrid.RepairEntry{}
	}

	// Get repair count
	repairCount, err := store.GetRepairCount()
	if err != nil {
		repairCount = len(repairs)
	}

	var reasonFilter map[string]bool
	if rv := r.URL.Query().Get("reason"); rv != "" {
		reasonFilter = make(map[string]bool)
		for _, v := range strings.Split(rv, ",") {
			v = strings.TrimSpace(v)
			if v != "" {
				reasonFilter[v] = true
			}
		}
	}
	if len(reasonFilter) > 0 {
		filtered := repairs[:0]
		for _, rep := range repairs {
			matched := false
			for key := range reasonFilter {
				if key == rep.Reason || strings.HasPrefix(rep.Reason, key) {
					matched = true
					break
				}
			}
			if matched {
				filtered = append(filtered, rep)
			}
		}
		repairs = filtered
		repairCount = len(repairs)
	}

	page := 1
	pageSize := 50
	if pv := r.URL.Query().Get("page"); pv != "" {
		if n, e := strconv.Atoi(pv); e == nil && n > 0 {
			page = n
		}
	}
	if sv := r.URL.Query().Get("page_size"); sv != "" {
		if n, e := strconv.Atoi(sv); e == nil && n > 0 {
			pageSize = n
		}
	}
	if pageSize > 500 {
		pageSize = 500
	}
	start := (page - 1) * pageSize
	if start < 0 {
		start = 0
	}
	end := start + pageSize
	if start > len(repairs) {
		start = len(repairs)
	}
	if end > len(repairs) {
		end = len(repairs)
	}
	pagedRepairs := repairs[start:end]

	reasonCounts := make(map[string]int)
	for _, repair := range repairs {
		reasonCounts[repair.Reason]++
	}

	response := map[string]interface{}{
		"total":        repairCount,
		"repairs":      pagedRepairs,
		"reasonCounts": reasonCounts,
		"lastUpdated":  time.Now().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleRepairStart handles requests to start a repair scan
func HandleRepairStart(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	store := tm.GetStore()
	if store == nil {
		http.Error(w, "Store not initialized", http.StatusInternalServerError)
		return
	}

	// Start repair scan
	err = tm.RepairAllTorrents()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to start repair: %v", err), http.StatusInternalServerError)
		return
	}

	// Get current stats
	stats := realdebrid.GetRepairStatus()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"message":       "Repair scan started successfully",
		"totalTorrents": stats.TotalTorrents,
	})
}

// HandleRepairStop handles requests to stop an ongoing repair scan
func HandleRepairStop(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	// Stop repair scan
	err = tm.StopRepair()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to stop repair: %v", err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Repair stop signal sent",
	})
}

// HandleRepairTorrent handles requests to repair specific torrent(s)
func HandleRepairTorrent(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	// Parse request body
	var request struct {
		TorrentIDs       []string `json:"torrent_ids"`
		DeleteFromDebrid bool     `json:"delete_from_debrid"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(request.TorrentIDs) == 0 {
		http.Error(w, "No torrent IDs provided", http.StatusBadRequest)
		return
	}

	// Repair each torrent
	repaired := 0
	failed := 0
	errors := []string{}

	for _, torrentID := range request.TorrentIDs {
		if err := tm.RepairTorrent(torrentID); err != nil {
			failed++
			errors = append(errors, fmt.Sprintf("%s: %v", torrentID, err))
		} else {
			repaired++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success":  true,
		"message":  fmt.Sprintf("Repair initiated for %d torrent(s)", repaired),
		"repaired": repaired,
		"failed":   failed,
	}

	if len(errors) > 0 {
		response["errors"] = errors
	}

	json.NewEncoder(w).Encode(response)
}

// HandleRepairDelete handles requests to delete torrent(s) from repair table
func HandleRepairDelete(w http.ResponseWriter, r *http.Request) {
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

	cfg, err := validateRealDebridConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(cfg.APIKey)
	if tm == nil {
		http.Error(w, "Torrent manager not initialized", http.StatusInternalServerError)
		return
	}

	var request struct {
		TorrentIDs       []string `json:"torrent_ids"`
		DeleteFromDebrid bool     `json:"delete_from_debrid"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(request.TorrentIDs) == 0 {
		http.Error(w, "No torrent IDs provided", http.StatusBadRequest)
		return
	}

	store := tm.GetStore()
	if store == nil {
		http.Error(w, "Store not initialized", http.StatusInternalServerError)
		return
	}

	deleted := 0
	failed := 0
	rdRemoved := 0
	rdFailed := 0
	errors := []string{}

	for _, torrentID := range request.TorrentIDs {
		if err := store.DeleteRepair(torrentID); err != nil {
			failed++
			errors = append(errors, fmt.Sprintf("%s: %v", torrentID, err))
			continue
		}

		deleted++
		tm.GetBrokenTorrentCache().Remove(torrentID)

		if request.DeleteFromDebrid {
			if err := tm.DeleteFromRealDebrid(torrentID); err != nil {
				rdFailed++
				errors = append(errors, fmt.Sprintf("%s (Real-Debrid): %v", torrentID, err))
			} else {
				rdRemoved++
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	message := fmt.Sprintf("Deleted %d torrent(s) from repair table", deleted)
	if request.DeleteFromDebrid {
		message = fmt.Sprintf("%s, removed %d from Real-Debrid", message, rdRemoved)
	}
	response := map[string]interface{}{
		"success": true,
		"message": message,
		"deleted": deleted,
		"failed":  failed,
	}
	if request.DeleteFromDebrid {
		response["removed_from_debrid"] = rdRemoved
		response["rd_failed"] = rdFailed
	}

	if len(errors) > 0 {
		response["errors"] = errors
	}

	json.NewEncoder(w).Encode(response)
}
