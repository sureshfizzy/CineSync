package spoofing

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	"github.com/gorilla/websocket"
)

var processStartTime = time.Now()

// PanicRecoveryMiddleware wraps handlers with panic recovery to prevent crashes
func PanicRecoveryMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger.Error("Panic recovered in spoofing handler %s %s: %v", r.Method, r.URL.Path, err)

				buf := make([]byte, 1024)
				for {
					n := runtime.Stack(buf, false)
					if n < len(buf) {
						buf = buf[:n]
						break
					}
					buf = make([]byte, 2*len(buf))
				}
				logger.Error("Stack trace: %s", string(buf))

				handleErrorResponse(w, "Service temporarily unavailable due to internal error", http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(w, r)
	}
}

// HandlerWrapper wraps handlers with timeout and error handling
func HandlerWrapper(handler http.HandlerFunc, timeoutSeconds int) http.HandlerFunc {
	return PanicRecoveryMiddleware(func(w http.ResponseWriter, r *http.Request) {
		done := make(chan bool, 1)
		errChan := make(chan error, 1)

		go func() {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("Handler panic for %s %s: %v", r.Method, r.URL.Path, err)
					errChan <- fmt.Errorf("handler panic: %v", err)
				}
				done <- true
			}()

			handler(w, r)
		}()

		// Wait for completion or timeout
		select {
		case <-done:
			return
		case err := <-errChan:
			logger.Error("Handler error for %s %s: %v", r.Method, r.URL.Path, err)
			handleErrorResponse(w, "Service error occurred", http.StatusInternalServerError)
		case <-time.After(time.Duration(timeoutSeconds) * time.Second):
			logger.Warn("Handler timeout for %s %s after %d seconds", r.Method, r.URL.Path, timeoutSeconds)
			handleErrorResponse(w, "Service is temporarily slow, please try again", http.StatusRequestTimeout)
		}
	})
}

func handleErrorResponse(w http.ResponseWriter, message string, statusCode int) {
	if _, ok := w.(http.Hijacker); ok {
		defer func() {
			if r := recover(); r != nil {
				return
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	errorResponse := map[string]interface{}{
		"error":   http.StatusText(statusCode),
		"message": message,
		"status":  statusCode,
	}

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		logger.Error("Failed to encode error response: %v", err)
	}
}

// RetryHandlerWrapper wraps handlers
func RetryHandlerWrapper(handler http.HandlerFunc, maxRetries int) http.HandlerFunc {
	return PanicRecoveryMiddleware(func(w http.ResponseWriter, r *http.Request) {
		var lastErr error

		for attempt := 0; attempt <= maxRetries; attempt++ {
			recorder := &responseRecorder{
				ResponseWriter: w,
				statusCode:     200,
				headerWritten:  false,
			}

			func() {
				defer func() {
					if err := recover(); err != nil {
						lastErr = fmt.Errorf("handler panic: %v", err)
					}
				}()

				handler(recorder, r)
				lastErr = nil
			}()

			if lastErr == nil || attempt == maxRetries {
				break
			}

			logger.Warn("Retrying %s %s (attempt %d/%d) due to error: %v",
				r.Method, r.URL.Path, attempt+1, maxRetries, lastErr)

			backoffDuration := time.Duration(100*(1<<uint(attempt))) * time.Millisecond
			if backoffDuration > 5*time.Second {
				backoffDuration = 5 * time.Second
			}
			time.Sleep(backoffDuration)
		}

		if lastErr != nil {
			logger.Error("Handler failed after %d retries for %s %s: %v",
				maxRetries, r.Method, r.URL.Path, lastErr)
			handleErrorResponse(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
		}
	})
}

// responseRecorder captures response data to enable retries
type responseRecorder struct {
	http.ResponseWriter
	statusCode    int
	headerWritten bool
}

func (r *responseRecorder) WriteHeader(statusCode int) {
	if !r.headerWritten {
		r.statusCode = statusCode
		r.headerWritten = true
		r.ResponseWriter.WriteHeader(statusCode)
	}
}

func (r *responseRecorder) Write(data []byte) (int, error) {
	if !r.headerWritten {
		r.WriteHeader(200)
	}
	return r.ResponseWriter.Write(data)
}

// HandleCircuitBreakerStatus provides circuit breaker status information
func HandleCircuitBreakerStatus(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleCircuitBreakerStatus: %v", err)
			handleErrorResponse(w, "Status check failed", http.StatusInternalServerError)
		}
	}()

	status := getCircuitBreakerStatus()

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		logger.Error("Failed to encode circuit breaker status: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSystemStatus handles the /api/v3/system/status endpoint for both Radarr and Sonarr
func HandleSystemStatus(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSystemStatus: %v", err)
			handleErrorResponse(w, "Failed to get system status", http.StatusInternalServerError)
		}
	}()

	config := GetConfig()
	if config == nil {
		logger.Error("Failed to get spoofing config in HandleSystemStatus")
		handleErrorResponse(w, "Configuration unavailable", http.StatusServiceUnavailable)
		return
	}

	// Determine app name based on service type for Prowlarr compatibility
	appName := "Radarr"
	if config.ServiceType == "sonarr" {
		appName = "Sonarr"
	} else if config.ServiceType == "auto" {
		appName = "Radarr"
	}

	status := SystemStatusResponse{
		AppName:                appName,
		Version:                config.Version,
		BuildTime:              processStartTime.Format(time.RFC3339),
		AppGuid:                config.AppGuid,
		InstanceName:           config.InstanceName,
		IsDebug:                false,
		IsProduction:           true,
		IsAdmin:                true,
		IsUserInteractive:      false,
		StartupPath:            "/app",
		AppData:                "/config",
		OsName:                 runtime.GOOS,
		OsVersion:              "10.0.19045.0",
		IsMonoRuntime:          false,
		IsMono:                 false,
		IsLinux:                runtime.GOOS == "linux",
		IsOsx:                  runtime.GOOS == "darwin",
		IsWindows:              runtime.GOOS == "windows",
		Mode:                   "production",
		Branch:                 config.Branch,
		Authentication:         "external",
		SqliteVersion:          "3.40.1",
		MigrationVersion:       209,
		UrlBase:                "",
		RuntimeVersion:         "6.0.16",
		RuntimeName:            ".NET 6.0",
		StartTime:              processStartTime.Format(time.RFC3339),
		PackageVersion:         config.Version,
		PackageAuthor:          "linuxserver.io",
		PackageUpdateMechanism: "docker",
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		logger.Error("Failed to encode system status response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSystemStatusV1 handles the /api/system/status endpoint (v1 API)
func HandleSystemStatusV1(w http.ResponseWriter, r *http.Request) {
	HandleSystemStatus(w, r)
}

// HandleSpoofedMovies handles the /api/v3/movie endpoint for Radarr
func HandleSpoofedMovies(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	// Check if this is a request for a specific movie by ID
	path := strings.TrimPrefix(r.URL.Path, "/api/v3/movie")
	if path != "" && path != "/" {
		// Extract movie ID from path
		movieIDStr := strings.Trim(path, "/")
		if movieID, err := strconv.Atoi(movieIDStr); err == nil {
			HandleSpoofedMovieByID(w, r, movieID)
			return
		}
	}

	var movies []MovieResource
	var err error

	// Check if folder mode is enabled and get folder from request
	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "radarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				movies, err = getMoviesFromDatabaseByFolder(folderMapping.FolderPath)
			} else {
				movies = []MovieResource{}
			}
		} else {
			movies = []MovieResource{}
		}
	} else {
		movies, err = getMoviesFromDatabase()
	}

	if err != nil {
		logger.Error("Failed to get movies: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(movies)
}

// HandleSpoofedSeries handles the /api/v3/series endpoint for Sonarr
func HandleSpoofedSeries(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	// Check if this is a request for a specific series by ID
	path := strings.TrimPrefix(r.URL.Path, "/api/v3/series")
	if path != "" && path != "/" {
		seriesIDStr := strings.Trim(path, "/")
		if seriesID, err := strconv.Atoi(seriesIDStr); err == nil {
			HandleSpoofedSeriesByID(w, r, seriesID)
			return
		}
	}

	var series []SeriesResource
	var err error

	// Check if folder mode is enabled and get folder from request
	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "sonarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				series, err = getSeriesFromDatabaseByFolder(folderMapping.FolderPath)
			} else {
				series = []SeriesResource{}
			}
		} else {
			series = []SeriesResource{}
		}
	} else {
		series, err = getSeriesFromDatabase()
	}

	if err != nil {
		logger.Error("Failed to get series: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(series)
}

// HandleSpoofedEpisode handles the /api/v3/episode endpoint for Sonarr
func HandleSpoofedEpisode(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	// Get seriesId from query parameters
	seriesId := r.URL.Query().Get("seriesId")

	var episodes []interface{}
	var err error

	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil && seriesId != "" {
			if folderMapping.ServiceType == "sonarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				episodes, err = getEpisodesFromDatabaseByFolder(folderMapping.FolderPath, seriesId)
			} else {
				episodes = []interface{}{}
			}
		} else {
			episodes = []interface{}{}
		}
	} else {
		if seriesId != "" {
			episodes, err = getEpisodesFromDatabase(seriesId)
		} else {
			episodes = []interface{}{}
		}
	}

	if err != nil {
		logger.Error("Failed to get episodes: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(episodes)
}

// HandleSpoofedEpisodeFiles handles the /api/v3/episodefile endpoint for Sonarr
func HandleSpoofedEpisodeFiles(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSpoofedEpisodeFiles: %v", err)
			handleErrorResponse(w, "Failed to get episode files", http.StatusInternalServerError)
		}
	}()

	config := GetConfig()

	// Get seriesId from query parameters
	seriesId := r.URL.Query().Get("seriesId")

	var episodeFiles []interface{}
	var err error

	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil && seriesId != "" {
			if folderMapping.ServiceType == "sonarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				episodeFiles, err = getEpisodeFilesFromDatabaseByFolder(folderMapping.FolderPath, seriesId)
			} else {
				episodeFiles = []interface{}{}
			}
		} else {
			episodeFiles = []interface{}{}
		}
	} else {
		if seriesId != "" {
			episodeFiles, err = getEpisodeFilesFromDatabase(seriesId)
		} else {
			episodeFiles = []interface{}{}
		}
	}

	if err != nil {
		logger.Error("Failed to get episode files: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(episodeFiles); err != nil {
		logger.Error("Failed to encode episode files response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSpoofedHealth handles the /api/v3/health endpoint for both Radarr and Sonarr
func HandleSpoofedHealth(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSpoofedHealth: %v", err)
			handleErrorResponse(w, "Health check failed", http.StatusInternalServerError)
		}
	}()

	health, err := getHealthStatusFromDatabase()
	if err != nil {
		logger.Error("Failed to get health status: %v", err)
		if strings.Contains(err.Error(), "circuit breaker is open") {
			handleErrorResponse(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
			return
		}

		handleErrorResponse(w, "Health check failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(health); err != nil {
		logger.Error("Failed to encode health response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSpoofedRootFolder handles the /api/v3/rootfolder endpoint for both Radarr and Sonarr
func HandleSpoofedRootFolder(w http.ResponseWriter, r *http.Request) {
	rootFolders, err := GetRootFoldersFromDatabase()
	if err != nil {
		logger.Error("Failed to get root folders: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(rootFolders)
}

// HandleSpoofedQualityProfile handles the /api/v3/qualityprofile endpoint for both Radarr and Sonarr
func HandleSpoofedQualityProfile(w http.ResponseWriter, r *http.Request) {
	qualityProfiles, err := getQualityProfilesFromDatabase()
	if err != nil {
		logger.Error("Failed to get quality profiles: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(qualityProfiles)
}

// HandleSpoofedLanguage handles the /api/v3/language endpoint for both Radarr and Sonarr
func HandleSpoofedLanguage(w http.ResponseWriter, r *http.Request) {
	languages := getLanguagesFromDatabase("")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(languages)
}

// HandleMediaCover serves poster and fanart images for Bazarr and WebDavHub
func HandleMediaCover(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/v3/MediaCover/") {
		path = strings.TrimPrefix(path, "/api/v3/MediaCover/")
	} else {
		http.NotFound(w, r)
		return
	}

	parts := strings.Split(path, "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}

	tmdbID, imageFile := parts[0], parts[1]
	var baseImageFile string

	// Handle various image file formats that Bazarr might request
	if strings.Contains(imageFile, "poster") {
		baseImageFile = "poster.jpg"
	} else if strings.Contains(imageFile, "fanart") {
		baseImageFile = "fanart.jpg"
	} else {
		http.NotFound(w, r)
		return
	}

	filePath := filepath.Join("../db", "MediaCover", tmdbID, baseImageFile)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}

	// Set appropriate headers
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=86400")

	http.ServeFile(w, r, filePath)
}

// HandleSpoofedLanguageProfile handles the /api/v3/languageprofile endpoint for Sonarr
func HandleSpoofedLanguageProfile(w http.ResponseWriter, r *http.Request) {
	languageProfiles, err := getLanguageProfilesFromDatabase()
	if err != nil {
		logger.Error("Failed to get language profiles: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(languageProfiles)
}

// HandleSpoofedTag handles the /api/v3/tag endpoint for both Radarr and Sonarr
func HandleSpoofedTag(w http.ResponseWriter, r *http.Request) {
	tags, err := getTagsFromDatabase()
	if err != nil {
		logger.Error("Failed to get tags: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tags)
}

// HandleSpoofedAPI handles the /api endpoint for both Radarr and Sonarr
func HandleSpoofedAPI(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	response := map[string]interface{}{
		"current": config.Version,
		"version": config.Version,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleSpoofedFilesystem handles the /api/v3/filesystem endpoint for both Radarr and Sonarr
func HandleSpoofedFilesystem(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	includeFiles := r.URL.Query().Get("includeFiles") == "true"

	// Handle special filesystem endpoints
	if strings.HasSuffix(r.URL.Path, "/type") {
		response := map[string]interface{}{
			"driveType": "Fixed",
			"type":      "Drive",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	if strings.HasSuffix(r.URL.Path, "/mediafiles") {
		if path == "" {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]interface{}{})
			return
		}

		filesystemItems, err := getFilesystemContents(path, true)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode([]map[string]interface{}{})
			return
		}

		// Filter to only return media files
		var mediaFiles []map[string]interface{}
		for _, item := range filesystemItems {
			if item["type"] == "video" {
				mediaFiles = append(mediaFiles, item)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mediaFiles)
		return
	}

	// If no path specified, return root folders
	if path == "" {
		rootFolders, err := GetRootFoldersFromDatabase()
		if err != nil {
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		var filesystemItems []map[string]interface{}
		for _, folder := range rootFolders {
			filesystemItems = append(filesystemItems, map[string]interface{}{
				"path":        folder.Path,
				"name":        filepath.Base(folder.Path),
				"type":        "folder",
				"isDirectory": true,
				"size":        0,
			})
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(filesystemItems)
		return
	}

	// Return directory contents
	filesystemItems, err := getFilesystemContents(path, includeFiles)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]map[string]interface{}{})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(filesystemItems)
}

// getFilesystemContents returns the contents of a directory in filesystem API format
func getFilesystemContents(dirPath string, includeFiles bool) ([]map[string]interface{}, error) {
	cleanPath := filepath.Clean(dirPath)

	rootFolders, err := GetRootFoldersFromDatabase()
	if err != nil {
		return nil, err
	}

	allowed := false
	for _, rootFolder := range rootFolders {
		if strings.HasPrefix(cleanPath, filepath.Clean(rootFolder.Path)) {
			allowed = true
			break
		}
	}

	if !allowed {
		return nil, fmt.Errorf("access denied")
	}

	info, err := os.Stat(cleanPath)
	if err != nil || !info.IsDir() {
		return nil, err
	}

	entries, err := os.ReadDir(cleanPath)
	if err != nil {
		return nil, err
	}

	var filesystemItems []map[string]interface{}
	for _, entry := range entries {
		entryInfo, err := entry.Info()
		if err != nil {
			continue
		}

		isDir := entry.IsDir()
		if !includeFiles && !isDir {
			continue
		}

		filesystemItems = append(filesystemItems, map[string]interface{}{
			"path":        filepath.Join(cleanPath, entry.Name()),
			"name":        entry.Name(),
			"type":        getFileType(isDir, entry.Name()),
			"isDirectory": isDir,
			"size":        entryInfo.Size(),
		})
	}

	return filesystemItems, nil
}

// getFileType returns the appropriate type string for filesystem items
func getFileType(isDirectory bool, name string) string {
	if isDirectory {
		return "folder"
	}

	ext := strings.ToLower(filepath.Ext(name))
	if strings.Contains(".mp4.mkv.avi.mov.wmv.flv.webm.m4v.mpg.mpeg.3gp.ogv", ext) {
		return "video"
	}
	if strings.Contains(".srt.ass.ssa.vtt.sub.idx", ext) {
		return "subtitle"
	}
	return "file"
}

// HandleSpoofedUtils handles the /api/v3/utils endpoint for both Radarr and Sonarr
func HandleSpoofedUtils(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v3/utils")

	w.Header().Set("Content-Type", "application/json")
	if strings.HasPrefix(path, "/backup") || strings.HasPrefix(path, "/logs") {
		json.NewEncoder(w).Encode([]map[string]interface{}{})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
	}
}

// HandleSpoofedNotification handles the /api/v3/notification endpoint for both Radarr and Sonarr
func HandleSpoofedNotification(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{})
}

// HandleSpoofedDownloadClient handles the /api/v3/downloadclient endpoint for both Radarr and Sonarr
func HandleSpoofedDownloadClient(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{})
}

// HandleSpoofedIndexer handles the /api/v3/indexer endpoint for both Radarr and Sonarr
func HandleSpoofedIndexer(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSpoofedIndexer: %v", err)
			handleErrorResponse(w, "Indexer request failed", http.StatusInternalServerError)
		}
	}()

	// Return indexer schemas that Prowlarr expects for BuildRadarrIndexer
	// Prowlarr calls this to get available indexer types/schemas
	indexers := []map[string]interface{}{
		{
			"id":               1,
			"name":             "Newznab",
			"implementation":   "Newznab",
			"configContract":   "NewznabSettings",
			"infoLink":         "https://github.com/Prowlarr/Prowlarr",
			"tags":             []int{},
			"fields": []map[string]interface{}{
				{"name": "baseUrl", "label": "URL", "type": "textbox"},
				{"name": "apiPath", "label": "API Path", "type": "textbox"},
				{"name": "apiKey", "label": "API Key", "type": "textbox"},
				{"name": "categories", "label": "Categories", "type": "select"},
				{"name": "minimumSeeders", "label": "Minimum Seeders", "type": "number"},
				{"name": "seedCriteria.seedRatio", "label": "Seed Ratio", "type": "number"},
				{"name": "seedCriteria.seedTime", "label": "Seed Time", "type": "number"},
				{"name": "rejectBlocklistedTorrentHashesWhileGrabbing", "label": "Reject Blocklisted", "type": "checkbox"},
				{"name": "multiLanguages", "label": "Multi Languages", "type": "checkbox"},
				{"name": "removeYear", "label": "Remove Year", "type": "checkbox"},
				{"name": "requiredFlags", "label": "Required Flags", "type": "select"},
				{"name": "additionalParameters", "label": "Additional Parameters", "type": "textbox"},
			},
			"enable":           true,
			"protocol":         "usenet",
			"priority":         25,
			"supportsRss":      true,
			"supportsSearch":   true,
			"downloadClientId": 0,
		},
		{
			"id":               2,
			"name":             "Torznab",
			"implementation":   "Torznab",
			"configContract":   "TorznabSettings",
			"infoLink":         "https://github.com/Prowlarr/Prowlarr",
			"tags":             []int{},
			"fields": []map[string]interface{}{
				{"name": "baseUrl", "label": "URL", "type": "textbox"},
				{"name": "apiPath", "label": "API Path", "type": "textbox"},
				{"name": "apiKey", "label": "API Key", "type": "textbox"},
				{"name": "categories", "label": "Categories", "type": "select"},
				{"name": "minimumSeeders", "label": "Minimum Seeders", "type": "number"},
				{"name": "seedCriteria.seedRatio", "label": "Seed Ratio", "type": "number"},
				{"name": "seedCriteria.seedTime", "label": "Seed Time", "type": "number"},
				{"name": "rejectBlocklistedTorrentHashesWhileGrabbing", "label": "Reject Blocklisted", "type": "checkbox"},
				{"name": "multiLanguages", "label": "Multi Languages", "type": "checkbox"},
				{"name": "removeYear", "label": "Remove Year", "type": "checkbox"},
				{"name": "requiredFlags", "label": "Required Flags", "type": "select"},
				{"name": "additionalParameters", "label": "Additional Parameters", "type": "textbox"},
			},
			"enable":           true,
			"protocol":         "torrent",
			"priority":         25,
			"supportsRss":      true,
			"supportsSearch":   true,
			"downloadClientId": 0,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(indexers); err != nil {
		logger.Error("Failed to encode indexers response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSpoofedIndexerSchema handles the /api/v3/indexer/schema endpoint that Prowlarr calls
func HandleSpoofedIndexerSchema(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSpoofedIndexerSchema: %v", err)
			handleErrorResponse(w, "Indexer schema request failed", http.StatusInternalServerError)
		}
	}()

	// It needs to return Newznab and Torznab schemas with proper fields
	schemas := []map[string]interface{}{
		{
			"id":               0,
			"name":             "Newznab",
			"Implementation":   "Newznab",
			"configContract":   "NewznabSettings",
			"infoLink":         "https://github.com/Prowlarr/Prowlarr",
			"tags":             []int{},
			"fields": []map[string]interface{}{
				{"name": "baseUrl", "label": "URL", "type": "textbox", "value": ""},
				{"name": "apiPath", "label": "API Path", "type": "textbox", "value": "/api"},
				{"name": "apiKey", "label": "API Key", "type": "textbox", "value": ""},
				{"name": "categories", "label": "Categories", "type": "select", "value": []int{}},
				{"name": "animeCategories", "label": "Anime Categories", "type": "select", "value": []int{}},
				{"name": "animeStandardFormatSearch", "label": "Anime Standard Format Search", "type": "checkbox", "value": false},
				{"name": "minimumSeeders", "label": "Minimum Seeders", "type": "number", "value": 1},
				{"name": "seedCriteria.seedRatio", "label": "Seed Ratio", "type": "number", "value": 1.0},
				{"name": "seedCriteria.seedTime", "label": "Seed Time", "type": "number", "value": 0},
				{"name": "seedCriteria.seasonPackSeedTime", "label": "Season Pack Seed Time", "type": "number", "value": 0},
				{"name": "rejectBlocklistedTorrentHashesWhileGrabbing", "label": "Reject Blocklisted", "type": "checkbox", "value": false},
				{"name": "multiLanguages", "label": "Multi Languages", "type": "checkbox", "value": false},
				{"name": "removeYear", "label": "Remove Year", "type": "checkbox", "value": false},
				{"name": "requiredFlags", "label": "Required Flags", "type": "select", "value": []int{}},
				{"name": "additionalParameters", "label": "Additional Parameters", "type": "textbox", "value": ""},
			},
		},
		{
			"id":               0,
			"name":             "Torznab",
			"Implementation":   "Torznab",
			"configContract":   "TorznabSettings",
			"infoLink":         "https://github.com/Prowlarr/Prowlarr",
			"tags":             []int{},
			"fields": []map[string]interface{}{
				{"name": "baseUrl", "label": "URL", "type": "textbox", "value": ""},
				{"name": "apiPath", "label": "API Path", "type": "textbox", "value": "/api"},
				{"name": "apiKey", "label": "API Key", "type": "textbox", "value": ""},
				{"name": "categories", "label": "Categories", "type": "select", "value": []int{}},
				{"name": "animeCategories", "label": "Anime Categories", "type": "select", "value": []int{}},
				{"name": "animeStandardFormatSearch", "label": "Anime Standard Format Search", "type": "checkbox", "value": false},
				{"name": "minimumSeeders", "label": "Minimum Seeders", "type": "number", "value": 1},
				{"name": "seedCriteria.seedRatio", "label": "Seed Ratio", "type": "number", "value": 1.0},
				{"name": "seedCriteria.seedTime", "label": "Seed Time", "type": "number", "value": 0},
				{"name": "seedCriteria.seasonPackSeedTime", "label": "Season Pack Seed Time", "type": "number", "value": 0},
				{"name": "rejectBlocklistedTorrentHashesWhileGrabbing", "label": "Reject Blocklisted", "type": "checkbox", "value": false},
				{"name": "multiLanguages", "label": "Multi Languages", "type": "checkbox", "value": false},
				{"name": "removeYear", "label": "Remove Year", "type": "checkbox", "value": false},
				{"name": "requiredFlags", "label": "Required Flags", "type": "select", "value": []int{}},
				{"name": "additionalParameters", "label": "Additional Parameters", "type": "textbox", "value": ""},
			},
		},
	}

	logger.Info("Prowlarr requesting indexer schemas - returning Newznab and Torznab schemas")

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(schemas); err != nil {
		logger.Error("Failed to encode indexer schemas response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSpoofedIndexerTest handles the /api/v3/indexer/test endpoint that Prowlarr calls during TestConnection
func HandleSpoofedIndexerTest(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleSpoofedIndexerTest: %v", err)
			handleErrorResponse(w, "Indexer test request failed", http.StatusInternalServerError)
		}
	}()

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse the indexer test request
	var indexerTest map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&indexerTest); err != nil {
		logger.Error("Failed to decode indexer test request: %v", err)
		handleErrorResponse(w, "Invalid request format", http.StatusBadRequest)
		return
	}

	logger.Info("Prowlarr testing indexer connection: %v", indexerTest["Name"])

	config := GetConfig()
	appVersion := config.Version

	// Set the required headers that Prowlarr checks
	w.Header().Set("X-Application-Version", appVersion)
	w.Header().Set("Content-Type", "application/json")

	// Return a successful test response
	testResult := map[string]interface{}{
		"isValid": true,
		"errors":  []interface{}{},
	}

	logger.Info("Indexer test successful, returned version: %s", appVersion)

	if err := json.NewEncoder(w).Encode(testResult); err != nil {
		logger.Error("Failed to encode indexer test response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleSpoofedImportList handles the /api/v3/importlist endpoint for Radarr
func HandleSpoofedImportList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{})
}

// HandleSpoofedQueue handles the /api/v3/queue endpoint for both Radarr and Sonarr
func HandleSpoofedQueue(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"page":          1,
		"pageSize":      20,
		"sortKey":       "timeleft",
		"sortDirection": "ascending",
		"totalRecords":  0,
		"records":       []map[string]interface{}{},
	})
}

// getFolderPathFromRequest determines which folder mapping to use based on the request
func getFolderPathFromRequest(r *http.Request, folderMappings []FolderMapping) string {
	apiKey := r.Header.Get("X-Api-Key")
	if apiKey == "" {
		apiKey = r.URL.Query().Get("apikey")
	}

	for _, mapping := range folderMappings {
		if mapping.Enabled && mapping.APIKey == apiKey {
			return mapping.FolderPath
		}
	}

	return ""
}

// getFolderMappingFromRequest determines which folder mapping to use based on the request
func getFolderMappingFromRequest(r *http.Request, folderMappings []FolderMapping) *FolderMapping {
	apiKey := r.Header.Get("X-Api-Key")
	if apiKey == "" {
		apiKey = r.URL.Query().Get("apikey")
	}

	for _, mapping := range folderMappings {
		if mapping.Enabled && mapping.APIKey == apiKey {
			return &mapping
		}
	}

	return nil
}

// HandleAvailableFolders handles requests to get available folders for mapping
func HandleAvailableFolders(w http.ResponseWriter, r *http.Request) {
	folders, err := getAvailableFoldersFromDatabase()
	if err != nil {
		logger.Error("Failed to get available folders: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(folders)
}

// HandleSignalRNegotiate handles SignalR negotiation requests
func HandleSignalRNegotiate(w http.ResponseWriter, r *http.Request) {

	if r.Method == "OPTIONS" {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.WriteHeader(http.StatusOK)
		return
	}

	connectionId := fmt.Sprintf("cinesync-%d", time.Now().UnixNano())

	// ASP.NET Core SignalR negotiation response format
	response := map[string]interface{}{
		"connectionId":        connectionId,
		"connectionToken":     connectionId,
		"negotiateVersion":    1,
		"availableTransports": []map[string]interface{}{
			{
				"transport":       "WebSockets",
				"transferFormats": []string{"Text", "Binary"},
			},
			{
				"transport":       "ServerSentEvents",
				"transferFormats": []string{"Text"},
			},
			{
				"transport":       "LongPolling",
				"transferFormats": []string{"Text", "Binary"},
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	json.NewEncoder(w).Encode(response)
}

// WebSocket upgrader for SignalR connections
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	EnableCompression: true,
	HandshakeTimeout:  10 * time.Second,
}

// Global variables to track SignalR connections
var (
	signalRConnections = make(map[*websocket.Conn]bool)
	signalRMutex       sync.RWMutex
)

// HandleSignalRMessages handles SignalR message requests
func HandleSignalRMessages(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Upgrade") == "websocket" {
		handleSignalRWebSocket(w, r)
		return
	}
	handleSignalRSSE(w, r)
}

func handleSignalRWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Error("WebSocket upgrade failed: %v", err)
		return
	}

	defer func() {
		signalRMutex.Lock()
		delete(signalRConnections, conn)
		signalRMutex.Unlock()
		conn.Close()
	}()

	signalRMutex.Lock()
	signalRConnections[conn] = true
	signalRMutex.Unlock()

	handshakeResponse := `{"error":null}` + "\x1e"
	if err := conn.WriteMessage(websocket.TextMessage, []byte(handshakeResponse)); err != nil {
		logger.Error("Failed to send handshake response: %v", err)
		return
	}

	config := GetConfig()
	versionMessage := fmt.Sprintf(`{"type":1,"target":"receiveMessage","arguments":[{"name":"version","body":{"version":"%s"}}]}`+"\x1e", config.Version)
	if err := conn.WriteMessage(websocket.TextMessage, []byte(versionMessage)); err != nil {
		logger.Error("Failed to send version message: %v", err)
		return
	}

	// Keep connection alive with periodic pings
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			conn.SetReadDeadline(time.Now().Add(60 * time.Second))
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNormalClosure) {
					logger.Warn("WebSocket unexpected close: %v", err)
				}
				return
			}
		}
	}()

	for {
		select {
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":6}`+"\x1e")); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

// handleSignalRSSE handles Server-Sent Events fallback
func handleSignalRSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	handshakeResponse := `{"error":null}` + "\x1e"
	w.Write([]byte(handshakeResponse))
	flusher.Flush()

	config := GetConfig()
	versionMessage := fmt.Sprintf(`{"type":1,"target":"receiveMessage","arguments":[{"name":"version","body":{"version":"%s"}}]}`+"\x1e", config.Version)
	w.Write([]byte(versionMessage))
	flusher.Flush()

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	timeout := time.After(30 * time.Minute)

	for {
		select {
		case <-ticker.C:
			pingMessage := `{"type":6}`+"\x1e"
			if _, err := w.Write([]byte(pingMessage)); err != nil {
				return
			}
			flusher.Flush()
		case <-timeout:
			return
		case <-r.Context().Done():
			return
		}
	}
}

// HandleSystemEvents handles system events requests
func HandleSystemEvents(w http.ResponseWriter, r *http.Request) {
	events := []interface{}{}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// HandleCommand handles command requests
func HandleCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method == "POST" {
		response := map[string]interface{}{
			"id":     1,
			"name":   "Command",
			"status": "completed",
			"queued": time.Now().Format(time.RFC3339),
			"ended":  time.Now().Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	commands := []interface{}{}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commands)
}

// HandleConfigHost handles host configuration requests
func HandleConfigHost(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	response := map[string]interface{}{
		"bindAddress":        "*",
		"port":               8989,
		"sslPort":            443,
		"enableSsl":          true,
		"launchBrowser":      false,
		"authenticationMethod": "none",
		"analyticsEnabled":   false,
		"username":           "",
		"password":           "",
		"logLevel":           "info",
		"consoleLogLevel":    "info",
		"branch":             config.Branch,
		"apiKey":             config.APIKey,
		"sslCertPath":        "",
		"sslCertPassword":    "",
		"urlBase":            "",
		"updateAutomatically": false,
		"updateMechanism":    "docker",
		"updateScriptPath":   "",
		"proxyEnabled":       false,
		"proxyType":          "http",
		"proxyHostname":      "",
		"proxyPort":          8080,
		"proxyUsername":      "",
		"proxyPassword":      "",
		"proxyBypassFilter":  "",
		"proxyBypassLocalAddresses": true,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// HandleSpoofedSeriesByID handles requests for individual series by ID
func HandleSpoofedSeriesByID(w http.ResponseWriter, r *http.Request, seriesID int) {
	config := GetConfig()

	var series *SeriesResource
	var err error

	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "sonarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				series, err = getSeriesByIDFromDatabaseByFolder(seriesID, folderMapping.FolderPath)
			} else {
				http.NotFound(w, r)
				return
			}
		} else {
			http.NotFound(w, r)
			return
		}
	} else {
		series, err = getSeriesByIDFromDatabase(seriesID)
	}

	if err != nil {
		logger.Error("Failed to get series by ID %d: %v", seriesID, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if series == nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(series)
}

// HandleSpoofedMovieByID handles requests for individual movies by ID
func HandleSpoofedMovieByID(w http.ResponseWriter, r *http.Request, movieID int) {
	config := GetConfig()

	var movie *MovieResource
	var err error

	// Check if folder mode is enabled and get folder from request
	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "radarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				movie, err = getMovieByIDFromDatabaseByFolder(movieID, folderMapping.FolderPath)
			} else {
				http.NotFound(w, r)
				return
			}
		} else {
			http.NotFound(w, r)
			return
		}
	} else {
		movie, err = getMovieByIDFromDatabase(movieID)
	}

	if err != nil {
		logger.Error("Failed to get movie by ID %d: %v", movieID, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if movie == nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(movie)
}

// HandleSpoofedMovieFiles handles the /api/v3/moviefile endpoint for Radarr
func HandleSpoofedMovieFiles(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()

	// Check if this is a request for a specific moviefile by ID
	path := strings.TrimPrefix(r.URL.Path, "/api/v3/moviefile")
	if path != "" && path != "/" {
		// Extract moviefile ID from path
		movieFileIDStr := strings.Trim(path, "/")
		if movieFileID, err := strconv.Atoi(movieFileIDStr); err == nil {
			HandleSpoofedMovieFileByID(w, r, movieFileID)
			return
		}
	}

	// Get movieId from query parameters if provided
	movieIDStr := r.URL.Query().Get("movieId")
	var movieFiles []MovieFile
	var err error

	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "radarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				if movieIDStr != "" {
					if movieID, parseErr := strconv.Atoi(movieIDStr); parseErr == nil {
						movieFiles, err = getMovieFilesByMovieIDFromDatabaseByFolder(movieID, folderMapping.FolderPath)
					}
				} else {
					movieFiles, err = getMovieFilesFromDatabaseByFolder(folderMapping.FolderPath)
				}
			} else {
				movieFiles = []MovieFile{}
			}
		} else {
			movieFiles = []MovieFile{}
		}
	} else {
		if movieIDStr != "" {
			if movieID, parseErr := strconv.Atoi(movieIDStr); parseErr == nil {
				movieFiles, err = getMovieFilesByMovieIDFromDatabase(movieID)
			}
		} else {
			movieFiles, err = getMovieFilesFromDatabase()
		}
	}

	if err != nil {
		logger.Error("Failed to get movie files: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(movieFiles)
}

// HandleSpoofedMovieFileByID handles requests for individual movie files by ID
func HandleSpoofedMovieFileByID(w http.ResponseWriter, r *http.Request, movieFileID int) {
	config := GetConfig()

	var movieFile *MovieFile
	var err error

	// Check if folder mode is enabled and get folder from request
	if config.FolderMode {
		folderMapping := getFolderMappingFromRequest(r, config.FolderMappings)
		if folderMapping != nil {
			if folderMapping.ServiceType == "radarr" || folderMapping.ServiceType == "auto" || folderMapping.ServiceType == "" {
				movieFile, err = getMovieFileByIDFromDatabaseByFolder(movieFileID, folderMapping.FolderPath)
			} else {
				http.NotFound(w, r)
				return
			}
		} else {
			http.NotFound(w, r)
			return
		}
	} else {
		movieFile, err = getMovieFileByIDFromDatabase(movieFileID)
	}

	if err != nil {
		logger.Error("Failed to get movie file by ID %d: %v", movieFileID, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	if movieFile == nil {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(movieFile)
}

// SignalR Event Broadcasting Functions

// BroadcastMovieFileUpdated broadcasts a movie file updated event to all connected SignalR clients
func BroadcastMovieFileUpdated(movieFile *MovieFile) {
	if movieFile == nil {
		return
	}

	message := map[string]interface{}{
		"name": "movieFileUpdated",
		"body": map[string]interface{}{
			"movieFile": movieFile,
			"movie": map[string]interface{}{
				"id":    movieFile.MovieId,
				"title": extractTitleFromPath(movieFile.Path),
			},
		},
	}

	broadcastSignalRMessage(message)
}

// BroadcastMovieFileImported broadcasts a movie file imported event
func BroadcastMovieFileImported(movieFile *MovieFile) {
    if movieFile == nil {
        return
    }

    movie := getMovieDetailsForSignalR(movieFile.MovieId)
    movieForAdded := make(map[string]interface{})
    for k, v := range movie {
        movieForAdded[k] = v
    }
    movieForAdded["hasFile"] = false
    movieForAdded["movieFileId"] = 0
    
    movieAddedMessage := map[string]interface{}{
        "name": "movie",
        "body": map[string]interface{}{
            "resource": movieForAdded,
            "action":   "added",
        },
    }
    broadcastSignalRMessage(movieAddedMessage)
    time.Sleep(1000 * time.Millisecond)

    // Then broadcast the movie updated with file
    movieUpdatedMessage := map[string]interface{}{
        "name": "movie",
        "body": map[string]interface{}{
            "resource": movie,
            "action":   "updated",
        },
    }
    broadcastSignalRMessage(movieUpdatedMessage)
}

// BroadcastMovieAdded broadcasts a movie added event to all connected SignalR clients
func BroadcastMovieAdded(movieID int) {
    movie := getMovieDetailsForSignalR(movieID)

    message := map[string]interface{}{
        "name": "movie",
        "body": map[string]interface{}{
            "resource": movie,
            "action":   "added",
        },
    }

    broadcastSignalRMessage(message)
}

// BroadcastMovieFileDeleted broadcasts a movie file deleted event to all connected SignalR clients
func BroadcastMovieFileDeleted(movieFileId int, movieId int, movieTitle string) {
	message := map[string]interface{}{
		"name": "movieFileDeleted",
		"body": map[string]interface{}{
			"movieFile": map[string]interface{}{
				"id":      movieFileId,
				"movieId": movieId,
			},
			"movie": map[string]interface{}{
				"id":    movieId,
				"title": movieTitle,
			},
		},
	}

	broadcastSignalRMessage(message)
}

// BroadcastEpisodeFileUpdated broadcasts an episode file updated event to all connected SignalR clients
func BroadcastEpisodeFileUpdated(episodeFile map[string]interface{}) {
	if episodeFile == nil {
		return
	}

	// Extract series ID and episode ID for proper event structure
	seriesID, _ := episodeFile["seriesId"].(int)
	episodeID, _ := episodeFile["episodeId"].(int)
	
	
	if seriesID == 0 || episodeID == 0 {
		logger.Warn("Missing seriesId or episodeId in episodeFile, skipping broadcast")
		return
	}

	series := getSeriesDetailsForSignalR(seriesID)

	// First broadcast series added with hasFile=false to ensure Bazarr has the series in its database
	seriesForAdded := make(map[string]interface{})
	for k, v := range series {
		seriesForAdded[k] = v
	}
	seriesForAdded["hasFile"] = false
	
	seriesAddedMessage := map[string]interface{}{
		"name": "series",
		"body": map[string]interface{}{
			"resource": seriesForAdded,
			"action":   "added",
		},
	}
	broadcastSignalRMessage(seriesAddedMessage)

	time.Sleep(3000 * time.Millisecond)

	seriesUpdatedMessage := map[string]interface{}{
		"name": "series",
		"body": map[string]interface{}{
			"resource": series,
			"action":   "updated",
		},
	}
	broadcastSignalRMessage(seriesUpdatedMessage)
	time.Sleep(2000 * time.Millisecond)

	// Also broadcast the episodeFile event
	episodeFileMessage := map[string]interface{}{
		"name": "episodeFile",
		"body": map[string]interface{}{
			"resource": episodeFile,
			"action":   "updated",
		},
	}
	broadcastSignalRMessage(episodeFileMessage)
}

// BroadcastEpisodeFileAdded broadcasts an episode file added event
func BroadcastEpisodeFileAdded(episodeFile map[string]interface{}) {
    if episodeFile == nil {
        return
    }

	seriesID, _ := episodeFile["seriesId"].(int)
	episodeID, _ := episodeFile["episodeId"].(int)
	
	
	if seriesID == 0 || episodeID == 0 {
		logger.Warn("Missing seriesId or episodeId in episodeFile, skipping broadcast")
		return
	}

	series := getSeriesDetailsForSignalR(seriesID)

    seriesForAdded := make(map[string]interface{})
    for k, v := range series {
        seriesForAdded[k] = v
    }
    seriesForAdded["hasFile"] = false
    
    seriesAddedMessage := map[string]interface{}{
        "name": "series",
        "body": map[string]interface{}{
            "resource": seriesForAdded,
            "action":   "added",
        },
    }
    broadcastSignalRMessage(seriesAddedMessage)

    time.Sleep(3000 * time.Millisecond)

    // Then broadcast the series updated with file
    seriesUpdatedMessage := map[string]interface{}{
        "name": "series",
        "body": map[string]interface{}{
            "resource": series,
            "action":   "updated",
        },
    }
    broadcastSignalRMessage(seriesUpdatedMessage)

    time.Sleep(2000 * time.Millisecond)

    episodeFileMessage := map[string]interface{}{
        "name": "episodeFile",
        "body": map[string]interface{}{
            "resource": episodeFile,
            "action":   "added",
        },
    }
    broadcastSignalRMessage(episodeFileMessage)
}

// BroadcastEpisodeFileDeleted broadcasts an episode file deleted event to all connected SignalR clients
func BroadcastEpisodeFileDeleted(episodeFileId int, seriesId int, seriesTitle string) {
	episodeFileMessage := map[string]interface{}{
		"name": "episodeFileDeleted",
		"body": map[string]interface{}{
			"episodeFile": map[string]interface{}{
				"id":       episodeFileId,
				"seriesId": seriesId,
			},
		},
	}
	broadcastSignalRMessage(episodeFileMessage)

	time.Sleep(300 * time.Millisecond)
	seriesMessage := map[string]interface{}{
		"name": "seriesUpdated",
		"body": map[string]interface{}{
			"series": map[string]interface{}{
				"id": seriesId,
			},
		},
	}
	broadcastSignalRMessage(seriesMessage)
}

// getSeriesDetailsForSignalR retrieves detailed series information for SignalR events
func getSeriesDetailsForSignalR(seriesID int) map[string]interface{} {

	series, err := getSeriesByIDFromDatabase(seriesID)
	
	if err != nil {
		logger.Error("Database error getting series ID %d: %v", seriesID, err)
	}
	if series == nil {
		logger.Error("Series is nil for ID %d", seriesID)
	}
	
	if err != nil || series == nil {
		return map[string]interface{}{
			"id":    seriesID,
			"title": "Unknown Series",
		}
	}

	// Convert to map for easier manipulation
	seriesMap := map[string]interface{}{
		"id":                   series.ID,
		"title":               series.Title,
		"sortTitle":           series.SortTitle,
		"status":              series.Status,
		"ended":               false,
		"overview":            series.Overview,
		"network":             series.Network,
		"airTime":             series.AirTime,
		"images":              series.Images,
		"seasons":             series.Seasons,
		"year":                series.Year,
		"path":                series.Path,
		"qualityProfileId":    series.QualityProfileId,
		"languageProfileId":   series.LanguageProfileId,
		"seasonFolder":        series.SeasonFolder,
		"monitored":           series.Monitored,
		"useSceneNumbering":   false,
		"runtime":             series.Runtime,
		"tvdbId":              series.TvdbId,
		"tvRageId":            series.TvRageId,
		"tvMazeId":            series.TvMazeId,
		"firstAired":          "2023-01-01",
		"seriesType":          "standard",
		"cleanTitle":          strings.ToLower(strings.ReplaceAll(series.Title, " ", "-")),
		"imdbId":              "",
		"titleSlug":           strings.ToLower(strings.ReplaceAll(series.Title, " ", "-")),
		"certification":       "",
		"genres":              []string{},
		"tags":                []int{},
		"added":               time.Now().Format("2006-01-02T15:04:05Z"),
		"ratings":             map[string]interface{}{},
		"statistics":          map[string]interface{}{},
		"hasFile":             true,
	}

	
	return seriesMap
}

func IsSignalRConnected() bool {
	signalRMutex.RLock()
	defer signalRMutex.RUnlock()
	return len(signalRConnections) > 0
}

func GetSignalRConnectionCount() int {
	signalRMutex.RLock()
	defer signalRMutex.RUnlock()
	return len(signalRConnections)
}

// broadcastSignalRMessage sends a SignalR message to all connected clients
func broadcastSignalRMessage(message map[string]interface{}) {
	signalRMutex.RLock()
	defer signalRMutex.RUnlock()

	if len(signalRConnections) == 0 {
		return
	}

	// Create SignalR message format
	signalRMessage := map[string]interface{}{
		"type":      1,
		"target":    "receiveMessage",
		"arguments": []interface{}{message},
	}

	messageBytes, err := json.Marshal(signalRMessage)
	if err != nil {
		logger.Error("Failed to marshal SignalR message: %v", err)
		return
	}

	// Add SignalR message terminator
	messageData := string(messageBytes) + "\x1e"


	// Send to all connected clients with better error handling
	for conn := range signalRConnections {
		// Set write deadline for each message
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		
		if err := conn.WriteMessage(websocket.TextMessage, []byte(messageData)); err != nil {
			logger.Warn("Failed to send SignalR message to client: %v", err)
			// Remove failed connection
			delete(signalRConnections, conn)
			// Close the connection gracefully
			conn.Close()
		}
	}
}

// extractTitleFromPath extracts movie/series title from file path
func extractTitleFromPath(filePath string) string {
	if filePath == "" {
		return ""
	}

	dir := filepath.Dir(filePath)
	baseName := filepath.Base(dir)

	if idx := strings.LastIndex(baseName, "("); idx > 0 {
		return strings.TrimSpace(baseName[:idx])
	}

	return baseName
}

// getMovieDetailsForSignalR gets movie details for SignalR payloads
func getMovieDetailsForSignalR(movieID int) map[string]interface{} {
	movie, err := getMovieByIDFromDatabase(movieID)
	if err != nil || movie == nil {
		return map[string]interface{}{
			"id":    movieID,
			"title": "Unknown Movie",
		}
	}

	// Return enriched movie object with fields Bazarr expects
	return map[string]interface{}{
		"id":                  movie.ID,
		"title":               movie.Title,
		"originalTitle":       movie.OriginalTitle,
		"sortTitle":           movie.SortTitle,
		"status":              movie.Status,
		"overview":            movie.Overview,
		"year":                movie.Year,
		"hasFile":             movie.HasFile,
		"movieFileId":         movie.MovieFileId,
		"path":                movie.Path,
		"qualityProfileId":    movie.QualityProfileId,
		"monitored":           movie.Monitored,
		"minimumAvailability": movie.MinimumAvailability,
		"isAvailable":         movie.IsAvailable,
		"runtime":             movie.Runtime,
		"cleanTitle":          movie.CleanTitle,
		"imdbId":              movie.ImdbId,
		"tmdbId":              movie.TmdbId,
		"titleSlug":           movie.TitleSlug,
		"rootFolderPath":      movie.RootFolderPath,
		"certification":       movie.Certification,
		"genres":              movie.Genres,
		"tags":                movie.Tags,
		"added":               movie.Added,
		"images":              movie.Images,
		"popularity":          movie.Popularity,
		"sizeOnDisk":          movie.SizeOnDisk,
	}
}

// Prowlarr API Handler Functions

// ProwlarrApplicationTestRequest represents the test request for Prowlarr applications
type ProwlarrApplicationTestRequest struct {
	BaseURL          string                 `json:"baseUrl"`
	APIKey           string                 `json:"apiKey"`
	SyncCategories   []int                  `json:"syncCategories"`
	AnimeSyncCategories []int               `json:"animeSyncCategories"`
	Tags             []int                  `json:"tags"`
	Name             string                 `json:"name"`
	Implementation   string                 `json:"implementation"`
	ConfigContract   string                 `json:"configContract"`
	InfoLink         string                 `json:"infoLink"`
	Fields           []interface{}          `json:"fields"`
}

// ProwlarrApplicationTestResponse represents the response for application tests
type ProwlarrApplicationTestResponse struct {
	IsValid      bool                   `json:"isValid"`
	Errors       []ProwlarrValidationFailure    `json:"errors"`
}

// ProwlarrValidationFailure represents validation errors
type ProwlarrValidationFailure struct {
	PropertyName string `json:"propertyName"`
	ErrorMessage string `json:"errorMessage"`
	Severity     string `json:"severity"`
}

// HandleProwlarrApplicationTest handles POST /api/v1/applications/test
func HandleProwlarrApplicationTest(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleProwlarrApplicationTest: %v", err)
			handleErrorResponse(w, "Application test failed", http.StatusInternalServerError)
		}
	}()

	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var testReq ProwlarrApplicationTestRequest
	if err := json.NewDecoder(r.Body).Decode(&testReq); err != nil {
		logger.Error("Failed to decode application test request: %v", err)
		handleErrorResponse(w, "Invalid request format", http.StatusBadRequest)
		return
	}

	logger.Info("Testing Prowlarr application connection: %s -> %s", testReq.Name, testReq.BaseURL)

	// Validate the application configuration
	response := validateProwlarrApplication(testReq)

	w.Header().Set("Content-Type", "application/json")
	if !response.IsValid {
		w.WriteHeader(http.StatusBadRequest)
	}
	
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode application test response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// validateProwlarrApplication validates an application configuration and tests connection
func validateProwlarrApplication(req ProwlarrApplicationTestRequest) ProwlarrApplicationTestResponse {
	var errors []ProwlarrValidationFailure

	// Validate required fields
	if req.BaseURL == "" {
		errors = append(errors, ProwlarrValidationFailure{
			PropertyName: "BaseUrl",
			ErrorMessage: "Base URL is required",
			Severity:     "error",
		})
	}

	if req.APIKey == "" {
		errors = append(errors, ProwlarrValidationFailure{
			PropertyName: "ApiKey", 
			ErrorMessage: "API Key is required",
			Severity:     "error",
		})
	}

	// If basic validation failed, return early
	if len(errors) > 0 {
		return ProwlarrApplicationTestResponse{
			IsValid: false,
			Errors:  errors,
		}
	}

	// Test connection to the application
	if err := testProwlarrApplicationConnection(req.BaseURL, req.APIKey); err != nil {
		serviceName := "Application"
		if req.Implementation != "" {
			serviceName = req.Implementation
		}
		errors = append(errors, ProwlarrValidationFailure{
			PropertyName: "BaseUrl",
			ErrorMessage: fmt.Sprintf("Unable to complete application test, cannot connect to %s. %s", serviceName, err.Error()),
			Severity:     "error",
		})
	}

	return ProwlarrApplicationTestResponse{
		IsValid: len(errors) == 0,
		Errors:  errors,
	}
}

// testProwlarrApplicationConnection tests the connection to Radarr/Sonarr
func testProwlarrApplicationConnection(baseURL, apiKey string) error {
	// Normalize URL
	baseURL = strings.TrimSuffix(baseURL, "/")
	testURL := baseURL + "/api/v3/system/status"

	// Create request
	req, err := http.NewRequest("GET", testURL, nil)
	if err != nil {
		return err
	}

	// Add API key header
	req.Header.Set("X-Api-Key", apiKey)

	// Make request with timeout
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	// Check response
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("authentication failed - check API key")
	} else if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, resp.Status)
	}

	// Try to decode response to ensure it's valid JSON
	var statusResponse map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&statusResponse); err != nil {
		return fmt.Errorf("invalid response format")
	}

	return nil
}

// HandleProwlarrApplications handles GET/POST /api/v1/applications
func HandleProwlarrApplications(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleProwlarrApplications: %v", err)
			handleErrorResponse(w, "Applications request failed", http.StatusInternalServerError)
		}
	}()

	switch r.Method {
	case http.MethodGet:
		// Return empty list of applications for now
		applications := []interface{}{}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(applications); err != nil {
			logger.Error("Failed to encode applications response: %v", err)
			handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
		}
	case http.MethodPost:
		// Handle application creation - return mock response
		var appReq ProwlarrApplicationTestRequest
		if err := json.NewDecoder(r.Body).Decode(&appReq); err != nil {
			logger.Error("Failed to decode create application request: %v", err)
			handleErrorResponse(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		// Return created application with ID
		response := map[string]interface{}{
			"id":               1,
			"name":            appReq.Name,
			"implementation":  appReq.Implementation,
			"configContract":  appReq.ConfigContract,
			"infoLink":        appReq.InfoLink,
			"baseUrl":         appReq.BaseURL,
			"apiKey":          appReq.APIKey,
			"syncCategories":  appReq.SyncCategories,
			"animeSyncCategories": appReq.AnimeSyncCategories,
			"tags":            appReq.Tags,
			"fields":          appReq.Fields,
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(response); err != nil {
			logger.Error("Failed to encode create application response: %v", err)
			handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
		}
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleProwlarrSystemStatus handles GET /api/v1/system/status
func HandleProwlarrSystemStatus(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleProwlarrSystemStatus: %v", err)
			handleErrorResponse(w, "System status request failed", http.StatusInternalServerError)
		}
	}()

	config := GetConfig()
	if config == nil {
		logger.Error("Failed to get spoofing config in HandleProwlarrSystemStatus")
		handleErrorResponse(w, "Configuration unavailable", http.StatusServiceUnavailable)
		return
	}

	status := map[string]interface{}{
		"appName":          "Prowlarr",
		"instanceName":     config.InstanceName,
		"version":          config.Version,
		"buildTime":        processStartTime.Format("2006-01-02T15:04:05Z"),
		"isDebug":          false,
		"isProduction":     true,
		"isAdmin":          true,
		"isUserInteractive": false,
		"startupPath":      "/app",
		"appData":          "/config",
		"osName":           "linux",
		"osVersion":        "5.4.0",
		"isMonoRuntime":    false,
		"isMono":           false,
		"isLinux":          true,
		"isOsx":            false,
		"isWindows":        false,
		"mode":             "production",
		"branch":           config.Branch,
		"authentication":   "external",
		"startTime":        processStartTime.Format("2006-01-02T15:04:05Z"),
		"packageVersion":   config.Version,
		"packageAuthor":    "linuxserver.io",
		"packageUpdateMechanism": "docker",
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(status); err != nil {
		logger.Error("Failed to encode Prowlarr system status response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleProwlarrIndexers handles GET /api/v1/indexer
func HandleProwlarrIndexers(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleProwlarrIndexers: %v", err)
			handleErrorResponse(w, "Indexers request failed", http.StatusInternalServerError)
		}
	}()

	// Return mock indexer list for Prowlarr compatibility
	indexers := []map[string]interface{}{
		{
			"id":             1,
			"name":           "CineSync Mock Indexer",
			"implementation": "TorrentRssIndexer",
			"configContract": "TorrentRssIndexerSettings",
			"protocol":       "torrent",
			"privacy":        "public",
			"enable":         true,
			"supportsRss":    true,
			"supportsSearch": true,
			"priority":       25,
			"capabilities": map[string]interface{}{
				"categories": []map[string]interface{}{
					{"id": 2000, "name": "Movies"},
					{"id": 2010, "name": "Movies/Foreign"},
					{"id": 2040, "name": "Movies/HD"},
					{"id": 5000, "name": "TV"},
					{"id": 5040, "name": "TV/HD"},
				},
				"supportsRss":    true,
				"supportsSearch": true,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(indexers); err != nil {
		logger.Error("Failed to encode indexers response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleProwlarrSearch handles GET /api/v1/search
func HandleProwlarrSearch(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleProwlarrSearch: %v", err)
			handleErrorResponse(w, "Search request failed", http.StatusInternalServerError)
		}
	}()

	// Extract search parameters
	query := r.URL.Query().Get("query")
	categories := r.URL.Query().Get("categories")
	indexerIds := r.URL.Query().Get("indexerIds")
	limit := r.URL.Query().Get("limit")
	offset := r.URL.Query().Get("offset")

	logger.Info("Prowlarr search request - query: %s, categories: %s, indexers: %s, limit: %s, offset: %s",
		query, categories, indexerIds, limit, offset)

	// Return empty search results for now
	searchResponse := map[string]interface{}{
		"results": []interface{}{},
		"total":   0,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(searchResponse); err != nil {
		logger.Error("Failed to encode search response: %v", err)
		handleErrorResponse(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleTorznabCaps handles GET /torznab/{indexerSlug}/api?t=caps
func HandleTorznabCaps(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleTorznabCaps: %v", err)
			handleErrorResponse(w, "Torznab caps request failed", http.StatusInternalServerError)
		}
	}()

	// Extract indexer slug from path
	pathParts := strings.Split(r.URL.Path, "/")
	indexerSlug := "unknown"
	if len(pathParts) >= 3 {
		indexerSlug = pathParts[2]
	}

	logger.Info("Torznab caps request for indexer: %s", indexerSlug)

	// Return Torznab capabilities XML
	capsXML := `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="CineSync Prowlarr" strapline="A usenet and torrent meta indexer" />
  <limits max="100" default="100"/>
  <registration available="no" open="no"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="yes" supportedParams="q,season,ep"/>
    <movie-search available="yes" supportedParams="q,imdbid,tmdbid"/>
    <music-search available="no" supportedParams=""/>
    <audio-search available="no" supportedParams=""/>
    <book-search available="no" supportedParams=""/>
  </searching>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2010" name="Foreign"/>
      <subcat id="2020" name="Other"/>
      <subcat id="2030" name="SD"/>
      <subcat id="2040" name="HD"/>
      <subcat id="2045" name="UHD"/>
      <subcat id="2050" name="BluRay"/>
      <subcat id="2060" name="3D"/>
    </category>
    <category id="5000" name="TV">
      <subcat id="5010" name="WEB-DL"/>
      <subcat id="5020" name="Foreign"/>
      <subcat id="5030" name="SD"/>
      <subcat id="5040" name="HD"/>
      <subcat id="5045" name="UHD"/>
      <subcat id="5050" name="Other"/>
      <subcat id="5070" name="Anime"/>
      <subcat id="5080" name="Documentary"/>
    </category>
  </categories>
</caps>`

	w.Header().Set("Content-Type", "application/xml")
	w.Write([]byte(capsXML))
}

// HandleTorznabSearch handles GET /torznab/{indexerSlug}/api?t=search
func HandleTorznabSearch(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if err := recover(); err != nil {
			logger.Error("Panic in HandleTorznabSearch: %v", err)
			handleErrorResponse(w, "Torznab search request failed", http.StatusInternalServerError)
		}
	}()

	// Extract parameters
	query := r.URL.Query().Get("q")
	categories := r.URL.Query().Get("cat")
	limit := r.URL.Query().Get("limit")

	// Extract indexer slug from path
	pathParts := strings.Split(r.URL.Path, "/")
	indexerSlug := "unknown"
	if len(pathParts) >= 3 {
		indexerSlug = pathParts[2]
	}

	logger.Info("Torznab search request for indexer: %s, query: %s, categories: %s, limit: %s",
		indexerSlug, query, categories, limit)

	// Return empty RSS feed for now
	rssXML := `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <atom:link href="http://localhost:9696/torznab/` + indexerSlug + `/api" rel="self" type="application/rss+xml"/>
    <title>CineSync Prowlarr</title>
    <description>A usenet and torrent meta indexer</description>
    <language>en-us</language>
    <category>search</category>
  </channel>
</rss>`

	w.Header().Set("Content-Type", "application/xml")
	w.Write([]byte(rssXML))
}
