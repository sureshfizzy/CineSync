package api

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
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
			if t, err := time.Parse(time.RFC3339, info.Ended); err == nil { return t }
		}
		if info.Added != "" {
			if t, err := time.Parse(time.RFC3339, info.Added); err == nil { return t }
		}
	}
	if tm != nil {
		if m := tm.GetModifiedUnix(torrentID); m > 0 {
			return time.Unix(m, 0)
		}
	}

	return time.Now()
}

// Global semaphore to limit concurrent streaming requests
var streamingSemaphore = make(chan struct{}, 32)

// Shared streaming client
var streamClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:          100,         // Total idle connections across all hosts
		MaxIdleConnsPerHost:   100,         // High number for better connection reuse
		MaxConnsPerHost:       0,           // Unlimited - optimized for large file streaming from RD download servers
		IdleConnTimeout:       90 * time.Second,
		DisableKeepAlives:     false,
		ForceAttemptHTTP2:     true,
		ResponseHeaderTimeout: 30 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		DisableCompression:    true,
	},
	Timeout: 60 * time.Second,
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

	// Reset global client so it picks up new config on next request
	realdebrid.ResetGlobalClient()

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
        "success": true,
        "userInfo": userInfo,
        "message": "API connection successful",
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
		"success":     true,
		"message":     "HTTP DAV connection successful",
		"fileCount":   len(files),
		"baseUrl":     "https://dav.real-debrid.com/",
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
    limit := 100
    if p := query.Get("page"); p != "" {
        if parsed, err := fmt.Sscanf(p, "%d", &page); err == nil && parsed == 1 && page > 0 {
            // page is valid
        } else {
            page = 1
        }
    }
    if l := query.Get("limit"); l != "" {
        if parsed, err := fmt.Sscanf(l, "%d", &limit); err == nil && parsed == 1 && limit > 0 && limit <= 1000 {
            // limit is valid
        } else {
            limit = 100
        }
    }

    // Use cached torrents if available, otherwise fetch fresh
    var items []realdebrid.TorrentItem
    if len(cachedTorrents) > 0 {
        items = cachedTorrents
        logger.Debug("[RD] Serving page %d (limit %d) from cache of %d torrents", page, limit, len(items))
    } else {
        client := realdebrid.NewClient(cfg.APIKey)
        var err error
        items, err = client.GetAllTorrents(1000, nil)
        if err != nil {
            http.Error(w, err.Error(), http.StatusBadGateway)
            return
        }
        logger.Debug("[RD] Fetched %d torrents live", len(items))
    }

    // Calculate pagination
    total := len(items)
    offset := (page - 1) * limit
    end := offset + limit
    if offset >= total {
        offset = 0
        end = 0
    }
    if end > total {
        end = total
    }

    // map to a simplified browser-like response
    type FileItem struct {
        Name   string `json:"name"`
        Path   string `json:"path"`
        Size   int64  `json:"size"`
        IsDir  bool   `json:"isDir"`
        ModTime string `json:"modTime"`
        Link   string `json:"link"`
        Download string `json:"download"`
        Status string `json:"status"`
        Files  int    `json:"files"`
    }

    // Slice the items for this page
    pageItems := items[offset:end]
    files := make([]FileItem, 0, len(pageItems))
    for _, it := range pageItems {
        files = append(files, FileItem{
            Name: it.Filename,
            Path: "/torrents/" + it.ID,
            Size: it.Bytes,
            IsDir: false,
            ModTime: it.Added,
            Link: "",
            Download: "",
            Status: it.Status,
            Files: it.Files,
        })
    }

    totalPages := (total + limit - 1) / limit

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{
        "path": "/torrents",
        "files": files,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": totalPages,
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
	if rclonePath, ok := rcloneConfigMap["rclonePath"].(string); ok {
		rcloneConfig.RclonePath = rclonePath
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

// HandleRcloneTest handles rclone test requests
func HandleRcloneTest(w http.ResponseWriter, r *http.Request) {
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
		RclonePath string `json:"rclonePath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	rcloneManager := realdebrid.GetRcloneManager()
	isAvailable := rcloneManager.IsRcloneAvailable(request.RclonePath)

	if isAvailable {
		response := map[string]interface{}{
			"success": true,
			"message": "Rclone is available",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	} else {
		response := map[string]interface{}{
			"success": false,
			"error":   "Rclone is not available at the specified path",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}
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

    go func() {
        logger.Info("[RD] Prefetch started")
        client := realdebrid.NewClient(cfg.APIKey)
        tm := realdebrid.GetTorrentManager(cfg.APIKey)

        // Fetch all torrents in batches
        torrents, err := client.GetAllTorrents(1000, func(current, total int) {
            if current%1000 == 0 || current == total {
                logger.Info("[RD] Progress: %d torrents fetched", current)
            }
        })
        if err != nil {
            logger.Warn("[RD] Failed to fetch torrents: %v", err)
        } else {
            cachedTorrents = torrents
            logger.Info("[RD] Torrents fetched: %d", len(torrents))
            tm.SetPrefetchedTorrents(torrents)
            if err := tm.PrefetchHttpDavData(); err != nil {
                logger.Warn("[RD] Failed to prefetch HTTP DAV data: %v", err)
            }
            rdIDs := make([]string, 0, len(torrents))
            for i := range torrents { rdIDs = append(rdIDs, torrents[i].ID) }
            tm.ReconcileDBWithRD(rdIDs)
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
	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")
	
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	
	flusher, canFlush := w.(http.Flusher)
	
    if reqPath == "" {
		buf := realdebrid.GetResponseBuffer()
		defer realdebrid.PutResponseBuffer(buf)
		buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">")
		basePath := "/api/realdebrid/webdav/"
		realdebrid.DirectoryResponse(buf, basePath, time.Now().Format(time.RFC3339))
		realdebrid.DirectoryResponse(buf, basePath+realdebrid.ALL_TORRENTS+"/", time.Now().Format(time.RFC3339))
		buf.WriteString("</d:multistatus>")
		w.Write(buf.Bytes())
		if canFlush {
			flusher.Flush()
		}
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
		realdebrid.DirectoryResponse(buf, basePath, time.Now().Format(time.RFC3339))
		
		if tm != nil {
			if allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS); ok {
				torrentNames := allTorrents.Keys()
				sort.Strings(torrentNames)
				
				for _, name := range torrentNames {
					if item, found := allTorrents.Get(name); found {
						fakeInfo := &realdebrid.TorrentInfo{Added: item.Added}
						modTimeUnix := effectiveModTime(tm, item.ID, fakeInfo)
						modTime := modTimeUnix.Format(time.RFC3339)
						realdebrid.DirectoryResponse(buf, basePath+name+"/", modTime)
					}
				}
			}
		}
		
		buf.WriteString("</d:multistatus>")
		w.Write(buf.Bytes())
		if canFlush {
			flusher.Flush()
		}
    } else if parts[0] == realdebrid.ALL_TORRENTS && len(parts) >= 2 {
        torrentName := parts[1]

		allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS)
		if !ok {
			logger.Error("[WebDAV] DirectoryMap not initialized")
			http.Error(w, "Not found", http.StatusNotFound)
			return
		}
		
		item, found := allTorrents.Get(torrentName)
		if !found {
			logger.Error("[WebDAV] Torrent not found in DirectoryMap: %s", torrentName)
			http.Error(w, "Torrent not found", http.StatusNotFound)
			return
		}

		basePath := "/api/realdebrid/webdav/" + realdebrid.ALL_TORRENTS + "/" + torrentName + "/"
		
		modTime := time.Now().Format(time.RFC3339)
		if item.Ended != "" {
			modTime = item.Ended
		} else if item.Added != "" {
			modTime = item.Added
		}

		fileCount := 0
		for _, file := range item.FileList {
			if file.Selected == 1 {
				fileCount++
			}
		}
		
		var buf *bytes.Buffer
		if fileCount > 500 {
			buf = realdebrid.GetLargeResponseBuffer()
			defer realdebrid.PutLargeResponseBuffer(buf)
		} else {
			buf = realdebrid.GetResponseBuffer()
			defer realdebrid.PutResponseBuffer(buf)
		}
		
		buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?><d:multistatus xmlns:d=\"DAV:\">")
		realdebrid.DirectoryResponse(buf, basePath, modTime)
		
		if len(item.FileList) > 0 {
			type sortableFile struct {
				baseName string
				fullPath string
				size     int64
			}
			var files []sortableFile
			
			for _, file := range item.FileList {
				if file.Selected == 1 {
					baseName := path.Base(file.Path)
					fullPath := basePath + baseName
					files = append(files, sortableFile{
						baseName: baseName,
						fullPath: fullPath,
						size:     file.Bytes,
					})
				}
			}
			sort.Slice(files, func(i, j int) bool {
				return files[i].baseName < files[j].baseName
			})
			for _, file := range files {
				realdebrid.FileResponse(buf, file.fullPath, file.size, modTime)
			}
		}
		
		buf.WriteString("</d:multistatus>")
		
		w.Write(buf.Bytes())
		if canFlush {
			flusher.Flush()
		}
	} else {
		logger.Error("[WebDAV] Invalid path requested: %s", reqPath)
		w.Write([]byte("</d:multistatus>"))
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

	if _, err := io.Copy(w, reader); err != nil && !isClientDisconnection(err) {
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
	
	// Parse path: /__all__/torrent_name/file_path
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
		if allTorrents, ok := tm.DirectoryMap.Get(realdebrid.ALL_TORRENTS); ok {
			if item, found := allTorrents.Get(torrentName); found && len(item.FileList) > 0 {
				var target *realdebrid.TorrentFile
				for i := range item.FileList {
					if item.FileList[i].Selected == 1 {
						if path.Base(item.FileList[i].Path) == baseName {
							target = &item.FileList[i]
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

	downloadURL, _, err := tm.GetFileDownloadURL(torrentID, filePath)
	if err != nil {
		config := configManager.GetConfig()
		if config.HttpDavSettings.Enabled && config.HttpDavSettings.UserID != "" {
			if tryHttpDavFallback(w, r, config, torrentName, filePath) {
				return
			}
		}
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", downloadURL, nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := streamClient.Do(req)
	if err != nil {
		http.Error(w, "Failed to fetch file", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	
	w.WriteHeader(resp.StatusCode)
	
	io.Copy(w, resp.Body)
}

func handleTorrentDelete(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
    tm := realdebrid.GetTorrentManager(apiKey)
    // Normalize and parse path: /__all__/torrent_name[/optional/subpath]
    reqPath = strings.Trim(reqPath, "/")
    parts := strings.Split(reqPath, "/")
    if len(parts) < 2 || parts[0] != realdebrid.ALL_TORRENTS {
        http.Error(w, "Invalid path", http.StatusBadRequest)
        return
    }

    torrentName := parts[1]
    torrentID, err := tm.FindTorrentByName(torrentName)
    if err != nil || torrentID == "" {
        // If not found, treat as already gone
        w.WriteHeader(http.StatusNoContent)
        return
    }

    if len(parts) == 2 {
        // DELETE the torrent folder: remove from local DB/cache
        tm.DeleteFromDBByID(torrentID)
        w.WriteHeader(http.StatusNoContent)
        return
    }

    // File-level DELETE: acknowledge without changing RD state
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
            "io":        realdebrid.CineSyncIOWorkers,
            "api":       realdebrid.CineSyncAPIWorkers,
            "ioInUse":   realdebrid.CineSyncIOInUse.Load(),
            "apiInUse":  realdebrid.CineSyncAPIInUse.Load(),
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
		torrentItemSize = 200   // bytes per TorrentItem
		torrentInfoSize = 7700  // bytes per TorrentInfo (with ~50 files)
		downloadLinkSize = 272  // bytes per cached download link
		failedEntrySize = 150   // bytes per failed entry
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
		"fixed":               status.Fixed,
		"validated":           status.Validated,
		"queue_size":          status.QueueSize,
		"last_run_time":       status.LastRunTime.Unix(),
		"next_run_time":       status.NextRunTime.Unix(),
		"progress_percentage": calculateProgress(status.ProcessedTorrents, status.TotalTorrents),
	})
}

func calculateProgress(processed, total int64) float64 {
	if total == 0 {
		return 0
	}
	return float64(processed) / float64(total) * 100
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

	// Get all repair entries
	repairs, err := tm.GetStore().GetAllRepairs()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get repair entries: %v", err), http.StatusInternalServerError)
		return
	}

	// Ensure repairs is never nil, always return empty array
	if repairs == nil {
		repairs = []realdebrid.RepairEntry{}
	}

	// Get repair count
	repairCount, err := tm.GetStore().GetRepairCount()
	if err != nil {
		repairCount = len(repairs)
	}

	// Group repairs by reason
	reasonCounts := make(map[string]int)
	for _, repair := range repairs {
		reasonCounts[repair.Reason]++
	}

	response := map[string]interface{}{
		"total":        repairCount,
		"repairs":      repairs,
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

	// Start repair scan
	err = tm.RepairAllTorrents()
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to start repair: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Repair scan started",
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
