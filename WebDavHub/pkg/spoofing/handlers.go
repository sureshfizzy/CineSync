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

// handleErrorResponse sends a standardized error response
func handleErrorResponse(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	errorResponse := map[string]interface{}{
		"error":   http.StatusText(statusCode),
		"message": message,
		"status":  statusCode,
	}

	if err := json.NewEncoder(w).Encode(errorResponse); err != nil {
		logger.Error("Failed to encode error response: %v", err)
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "Error: %s", message)
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

	status := SystemStatusResponse{
		Version:                config.Version,
		BuildTime:              time.Now().Add(-24 * time.Hour).Format(time.RFC3339),
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
		StartTime:              time.Now().Add(-24 * time.Hour).Format(time.RFC3339),
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
	json.NewEncoder(w).Encode(episodeFiles)
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
	rootFolders, err := getRootFoldersFromDatabase()
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

// HandleMediaCover serves poster and fanart images for Bazarr
func HandleMediaCover(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v3/MediaCover/")
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
		rootFolders, err := getRootFoldersFromDatabase()
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

	rootFolders, err := getRootFoldersFromDatabase()
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{})
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	json.NewEncoder(w).Encode(response)
}

// WebSocket upgrader for SignalR connections
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
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

// handleSignalRWebSocket handles WebSocket connections for SignalR
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

	// Add connection to tracking
	signalRMutex.Lock()
	signalRConnections[conn] = true
	signalRMutex.Unlock()

	// Send handshake response immediately
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
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))
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
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
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

	timeout := time.After(5 * time.Minute)

	for {
		select {
		case <-ticker.C:
			pingMessage := `{"type":6}`+"\x1e"
			w.Write([]byte(pingMessage))
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
		"sslPort":            9898,
		"enableSsl":          false,
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

	message := map[string]interface{}{
		"name": "episodeFileUpdated",
		"body": map[string]interface{}{
			"episodeFile": episodeFile,
		},
	}

	broadcastSignalRMessage(message)
}

// BroadcastEpisodeFileDeleted broadcasts an episode file deleted event to all connected SignalR clients
func BroadcastEpisodeFileDeleted(episodeFileId int, seriesId int, seriesTitle string) {
	message := map[string]interface{}{
		"name": "episodeFileDeleted",
		"body": map[string]interface{}{
			"episodeFile": map[string]interface{}{
				"id":       episodeFileId,
				"seriesId": seriesId,
			},
			"series": map[string]interface{}{
				"id":    seriesId,
				"title": seriesTitle,
			},
		},
	}

	broadcastSignalRMessage(message)
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

	// Send to all connected clients
	for conn := range signalRConnections {
		if err := conn.WriteMessage(websocket.TextMessage, []byte(messageData)); err != nil {
			logger.Warn("Failed to send SignalR message to client: %v", err)
			// Remove failed connection
			delete(signalRConnections, conn)
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
