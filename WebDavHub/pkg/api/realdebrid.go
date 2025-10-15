package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

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

	response := map[string]interface{}{
		"config": config,
		"status": status,
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

	// Return updated configuration
	config := configManager.GetConfig()
	status := configManager.GetConfigStatus()

	response := map[string]interface{}{
		"config": config,
		"status": status,
		"message": "Configuration updated successfully",
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

// HandleRealDebridWebDAV handles Real-Debrid WebDAV operations
func HandleRealDebridWebDAV(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

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

	webdavClient := realdebrid.NewWebDAVClient(config.APIKey)

	// Extract path from URL
	path := strings.TrimPrefix(r.URL.Path, "/api/realdebrid/webdav")
	if path == "" {
		path = "/"
	}

	switch r.Method {
	case http.MethodGet:
		handleWebDAVGet(w, r, webdavClient, path)
	case http.MethodPost:
		handleWebDAVPost(w, r, webdavClient, path)
	case http.MethodPut:
		handleWebDAVPut(w, r, webdavClient, path)
	case http.MethodDelete:
		handleWebDAVDelete(w, r, webdavClient, path)
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
        items, err = client.GetAllTorrents(1000)
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

// handleWebDAVGet handles GET requests for WebDAV operations
func handleWebDAVGet(w http.ResponseWriter, r *http.Request, client *realdebrid.WebDAVClient, path string) {
	// Check if it's a directory listing request
	if r.URL.Query().Get("list") == "true" || strings.HasSuffix(path, "/") {
		files, err := client.ListDirectory(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"path":  path,
			"files": files,
		})
		return
	}

	// Check if it's a file info request
	if r.URL.Query().Get("info") == "true" {
		info, err := client.Stat(path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(info)
		return
	}

	// Stream file content
	reader, err := client.ReadFileStream(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer reader.Close()

	// Set appropriate headers for file download
	filename := strings.TrimPrefix(path, "/")
	if filename == "" {
		filename = "file"
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	w.Header().Set("Content-Type", "application/octet-stream")

	// Stream the file
	_, err = w.Write([]byte{})
	if err != nil {
		logger.Warn("Failed to write file content: %v", err)
		return
	}

	// Copy file content to response
	buffer := make([]byte, 32*1024) // 32KB buffer
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				logger.Warn("Failed to write file chunk: %v", writeErr)
				break
			}
		}
		if err != nil {
			break
		}
	}
}

// handleWebDAVPost handles POST requests for WebDAV operations
func handleWebDAVPost(w http.ResponseWriter, r *http.Request, client *realdebrid.WebDAVClient, path string) {
	// Handle directory creation
	if r.URL.Query().Get("mkdir") == "true" {
		if err := client.MkdirAll(path); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Directory created successfully",
		})
		return
	}

	http.Error(w, "Invalid POST request", http.StatusBadRequest)
}

// handleWebDAVPut handles PUT requests for WebDAV operations
func handleWebDAVPut(w http.ResponseWriter, r *http.Request, client *realdebrid.WebDAVClient, path string) {
	// Handle file upload
	data, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	if err := client.WriteFile(path, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "File uploaded successfully",
	})
}

// handleWebDAVDelete handles DELETE requests for WebDAV operations
func handleWebDAVDelete(w http.ResponseWriter, r *http.Request, client *realdebrid.WebDAVClient, path string) {
	if err := client.DeleteFile(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "File deleted successfully",
	})
}

// HandleRealDebridUnrestrict handles link unrestriction
func HandleRealDebridUnrestrict(w http.ResponseWriter, r *http.Request) {
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
		Link string `json:"link"`
	}

	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if request.Link == "" {
		http.Error(w, "Link is required", http.StatusBadRequest)
		return
	}

	configManager := realdebrid.GetConfigManager()
	config := configManager.GetConfig()

	if !config.Enabled || config.APIKey == "" {
		http.Error(w, "Real-Debrid is not configured or enabled", http.StatusBadRequest)
		return
	}

	client := realdebrid.NewClient(config.APIKey)
	downloadLink, err := client.UnrestrictLink(request.Link)
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
		"downloadLink": downloadLink,
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

// Background prefetch on server start (called from main)
var rdPrefetchOnce bool
var cachedTorrents []realdebrid.TorrentItem
var cachedDownloads []realdebrid.DownloadItem

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
        torrents, err := client.GetAllTorrents(1000)
        if err != nil {
            logger.Warn("[RD] Failed to fetch torrents: %v", err)
        } else {
            cachedTorrents = torrents
            logger.Info("[RD] Torrents fetched: %d", len(torrents))
            // Progress logs in 1000 batches
            total := len(torrents)
            processed := 0
            batch := 1000
            for processed < total {
                next := processed + batch
                if next > total { next = total }
                logger.Info("[RD] Progress: %d/%d torrents processed", next, total)
                processed = next
            }
        }

        // Fetch downloads in batches of 1000 using pagination when available
        downloads, err := client.GetAllDownloads(1000)
        if err != nil {
            logger.Warn("[RD] Failed to fetch downloads: %v", err)
        } else {
            cachedDownloads = downloads
            logger.Info("[RD] Downloads fetched: %d", len(downloads))
            batchSize := 1000
            for i := 0; i < len(downloads); i += batchSize {
                end := i + batchSize
                if end > len(downloads) { end = len(downloads) }
                batch := downloads[i:end]
                logger.Info("[RD] Processing batch %d-%d/%d", i+1, end, len(downloads))
                // Here we could cache/index, for now just log first item
                if len(batch) > 0 {
                    logger.Debug("[RD] Batch sample: %s", batch[0].Filename)
                }
            }
        }

        logger.Info("[RD] Prefetch completed")
    }()
}