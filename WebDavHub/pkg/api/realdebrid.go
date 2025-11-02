package api

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

// Global semaphore to limit concurrent streaming requests
var streamingSemaphore = make(chan struct{}, 32)

// Shared streaming client
var streamClient = &http.Client{
	Transport: &http.Transport{
		MaxIdleConns:          50,
		MaxIdleConnsPerHost:   10,
		MaxConnsPerHost:       15,
		IdleConnTimeout:       30 * time.Second,
		DisableKeepAlives:     false,
		ForceAttemptHTTP2:     false,
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
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, PROPFIND")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Depth")
	w.Header().Set("DAV", "1, 2")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	configManager := realdebrid.GetConfigManager()
	config := configManager.GetConfig()

	if !config.Enabled || config.APIKey == "" {
		http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
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

    configManager := realdebrid.GetConfigManager()
    cfg := configManager.GetConfig()
    if !cfg.Enabled || cfg.APIKey == "" {
        http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
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

	configManager := realdebrid.GetConfigManager()
	config := configManager.GetConfig()

	if !config.Enabled || config.APIKey == "" {
		http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
		return
	}

	tm := realdebrid.GetTorrentManager(config.APIKey)
	err := tm.RefreshTorrent(request.TorrentID)
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

    rcloneConfig.RemoteName = "CineSync"


    cfg := configManager.GetConfig()
    if !cfg.Enabled {
        http.Error(w, "Real-Debrid is not enabled", http.StatusBadRequest)
        return
    }

	// Start mount
	rcloneManager := realdebrid.GetRcloneManager()
	status, err := rcloneManager.Mount(rcloneConfig, cfg.APIKey)
	if err != nil {
		logger.Error("Mount failed: %v", err)
		response := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
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
            tm := realdebrid.GetTorrentManager(cfg.APIKey)
            tm.SetPrefetchedTorrents(torrents)
            if err := tm.PrefetchHttpDavData(); err != nil {
                logger.Warn("[RD] Failed to prefetch HTTP DAV data: %v", err)
            }
        }

        logger.Info("[RD] Prefetch completed")
    }()
}

// WebDAV XML structures for VFS PROPFIND responses
type multistatus struct {
	XMLName   xml.Name   `xml:"D:multistatus"`
	Xmlns     string     `xml:"xmlns:D,attr"`
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
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "1"
	}

	tm := realdebrid.GetTorrentManager(apiKey)
	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")
	
	var nodes []torrentNode
	var basePath string

	if reqPath == "" {
		basePath = "/api/realdebrid/webdav"
		nodes = append(nodes, torrentNode{
			Name:    realdebrid.ALL_TORRENTS,
			IsDir:   true,
			Size:    0,
			ModTime: time.Now(),
		})
	} else if parts[0] == realdebrid.ALL_TORRENTS && len(parts) == 1 {
		basePath = "/api/realdebrid/webdav/" + realdebrid.ALL_TORRENTS
		allTorrents := tm.GetAllTorrentsFromDirectory(realdebrid.ALL_TORRENTS)
		nodes = make([]torrentNode, 0, len(allTorrents))
		
		for _, t := range allTorrents {
			nodes = append(nodes, torrentNode{
				Name:    realdebrid.GetDirectoryName(t.Filename),
				IsDir:   true,
				Size:    t.Bytes,
				ModTime: parseTorrentTime(t.Added),
			})
		}
	} else if parts[0] == realdebrid.ALL_TORRENTS && len(parts) >= 2 {
		torrentName := parts[1]
		subPath := ""
		if len(parts) > 2 {
			subPath = strings.Join(parts[2:], "/")
		}

		torrentID, err := tm.FindTorrentByName(torrentName)
		if err != nil {
			logger.Error("[WebDAV] Torrent not found: %s", torrentName)
			http.Error(w, "Torrent not found", http.StatusNotFound)
			return
		}

		fileNodes, err := tm.ListTorrentFiles(torrentID, subPath)
		if err != nil {
			logger.Error("[WebDAV] Failed to list files for torrent %s: %v", torrentID, err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		basePath = "/api/realdebrid/webdav/" + reqPath
		nodes = make([]torrentNode, 0, len(fileNodes))
		
		for _, fn := range fileNodes {
			nodes = append(nodes, torrentNode{
				Name:      fn.Name,
				IsDir:     fn.IsDir,
				Size:      fn.Size,
				TorrentID: fn.TorrentID,
				FileID:    fn.FileID,
				ModTime:   fn.ModTime,
			})
		}
	} else {
		logger.Error("[WebDAV] Invalid path requested: %s", reqPath)
		http.Error(w, "Invalid path", http.StatusNotFound)
		return
	}

	// Build WebDAV response
	ms := multistatus{
		Xmlns:     "DAV:",
		Responses: []response{},
	}

	// Add current directory
	lastModified := tm.GetLastRefreshTime()
	if lastModified.IsZero() {
		lastModified = time.Now()
	}
	
	ms.Responses = append(ms.Responses, response{
		Href: basePath,
		Propstat: propstat{
			Prop: prop{
				DisplayName:      path.Base(basePath),
				CreationDate:     lastModified.Format(time.RFC3339),
				GetLastModified:  lastModified.Format(time.RFC1123),
				ResourceType:     &resourceType{Collection: &struct{}{}},
			},
			Status: "HTTP/1.1 200 OK",
		},
	})

	if depth != "0" {
		for _, node := range nodes {
			nodePath := path.Join(basePath, node.Name)

			nodeModTime := lastModified
			if !node.ModTime.IsZero() {
				nodeModTime = node.ModTime
			}

			resp := response{
				Href: nodePath,
				Propstat: propstat{
					Prop: prop{
						DisplayName:     node.Name,
						CreationDate:    nodeModTime.Format(time.RFC3339),
						GetLastModified: nodeModTime.Format(time.RFC1123),
					},
					Status: "HTTP/1.1 200 OK",
				},
			}

			if node.IsDir {
				resp.Propstat.Prop.ResourceType = &resourceType{Collection: &struct{}{}}
			} else {
				resp.Propstat.Prop.GetContentLength = node.Size
				resp.Propstat.Prop.GetContentType = "application/octet-stream"
			}

			ms.Responses = append(ms.Responses, resp)
		}
	}

	// Marshal XML
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)

	xmlData, err := xml.MarshalIndent(ms, "", "  ")
	if err != nil {
		logger.Error("[VFS] Failed to marshal XML: %v", err)
		return
	}

	w.Write([]byte(xml.Header))
	w.Write(xmlData)
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

	torrentID, err := tm.FindTorrentByName(torrentName)
	if err != nil {
		http.Error(w, "Torrent not found", http.StatusNotFound)
		return
	}

	downloadURL, fileSize, err := tm.GetFileDownloadURL(torrentID, filePath)
	if err != nil {
		// Try HTTP DAV fallback if configured
		config := configManager.GetConfig()
		if config.HttpDavSettings.Enabled && config.HttpDavSettings.UserID != "" {
			if tryHttpDavFallback(w, r, config, torrentName, filePath) {
				logger.Debug("[HTTPDav Fallback] Fallback successful for: %s", path.Base(filePath))
				return
			}
		}
		return
	}

	// For HEAD requests
	if r.Method == "HEAD" {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", fileSize))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		return
	}

	// For GET requests, stream the content
	select {
	case streamingSemaphore <- struct{}{}:
		defer func() { <-streamingSemaphore }()
		
	case <-time.After(5 * time.Second):
		http.Error(w, "Server too busy, please try again later", http.StatusServiceUnavailable)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), "GET", downloadURL, nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}

	// Set range header if present
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}

	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Accept-Encoding", "identity") // Disable compression for streaming
	req.Header.Set("Cache-Control", "no-cache")
	
	// Add retry mechanism for connection issues
	var resp *http.Response
	maxRetries := 3
	for attempt := 1; attempt <= maxRetries; attempt++ {
		resp, err = streamClient.Do(req)
		if err == nil {
			break
		}

		if attempt < maxRetries {
			logger.Warn("[Torrents] Connection attempt %d failed for %s: %v, retrying...", attempt, path.Base(filePath), err)
			time.Sleep(time.Duration(attempt) * 500 * time.Millisecond) // Progressive backoff
		} else {
			logger.Error("[Torrents] All connection attempts failed for %s: %v", path.Base(filePath), err)
			http.Error(w, "Failed to fetch file after retries", http.StatusBadGateway)
			return
		}
	}
	defer resp.Body.Close()

	if contentLength := resp.Header.Get("Content-Length"); contentLength != "" {
		w.Header().Set("Content-Length", contentLength)
	}
	if contentRange := resp.Header.Get("Content-Range"); contentRange != "" {
		w.Header().Set("Content-Range", contentRange)
	}
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Accept-Ranges", "bytes")

	// Set appropriate status code
	statusCode := resp.StatusCode
	if statusCode == http.StatusOK && r.Header.Get("Range") != "" {
		statusCode = http.StatusPartialContent
	}
	w.WriteHeader(statusCode)

	flusher, ok := w.(http.Flusher)
	if !ok {
		logger.Warn("[Torrents] Response writer doesn't support flushing, falling back to io.Copy")
		io.Copy(w, resp.Body)
		return
	}

	config := configManager.GetConfig()
	initialChunkSizeBytes := parseChunkSize(config.RcloneSettings.VfsReadChunkSize)
	maxChunkSizeBytes := parseChunkSize(config.RcloneSettings.VfsReadChunkSizeLimit)
	if initialChunkSizeBytes == 0 {
		initialChunkSizeBytes = 64 * 1024 * 1024
	}
	if maxChunkSizeBytes == 0 {
		maxChunkSizeBytes = initialChunkSizeBytes
	}

	streamBufferSizeBytes := parseChunkSize(config.RcloneSettings.StreamBufferSize)
	if streamBufferSizeBytes == 0 {
		streamBufferSizeBytes = 1024 * 1024
	}

	smallBuf := make([]byte, 64*1024)
	totalServed := int64(0)
	currentChunkSize := initialChunkSizeBytes
	lastLoggedAt := int64(0)
	if n, err := resp.Body.Read(smallBuf); n > 0 {
		if _, werr := w.Write(smallBuf[:n]); werr != nil {
			return
		}
		flusher.Flush()
		totalServed += int64(n)
	} else if err != nil && err != io.EOF {
		if totalServed == 0 {
			return
		}
	}

	buf := make([]byte, streamBufferSizeBytes)
	
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				return
			}
			flusher.Flush()
			totalServed += int64(n)
			
			if totalServed >= lastLoggedAt + currentChunkSize {
				logger.Info("[Stream] Served %s for %s", formatBytes(currentChunkSize), path.Base(filePath))
				lastLoggedAt = totalServed

				if currentChunkSize < maxChunkSizeBytes {
					currentChunkSize *= 2
					if currentChunkSize > maxChunkSizeBytes {
						currentChunkSize = maxChunkSizeBytes
					}
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return
			}
			if isClientDisconnection(readErr) {
				return
			}
			return
		}
	}
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

	configManager := realdebrid.GetConfigManager()
	cfg := configManager.GetConfig()
	if !cfg.Enabled || cfg.APIKey == "" {
		http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
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

// HandleRealDebridRefreshControl handles smart refresh control requests
func HandleRealDebridRefreshControl(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	configManager := realdebrid.GetConfigManager()
	cfg := configManager.GetConfig()
	if !cfg.Enabled || cfg.APIKey == "" {
		http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
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