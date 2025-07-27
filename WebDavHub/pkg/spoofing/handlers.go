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
	"time"

	"cinesync/pkg/logger"
	"github.com/gorilla/websocket"
)

// HandleSystemStatus handles the /api/v3/system/status endpoint for both Radarr and Sonarr
func HandleSystemStatus(w http.ResponseWriter, r *http.Request) {
	config := GetConfig()
	
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
	json.NewEncoder(w).Encode(status)
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
	health, err := getHealthStatusFromDatabase()
	if err != nil {
		logger.Error("Failed to get health status: %v", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(health)
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
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	json.NewEncoder(w).Encode(response)
}

// WebSocket upgrader for SignalR connections
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

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
	defer conn.Close()

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
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
					logger.Error("WebSocket unexpected close: %v", err)
				}
				return
			}
		}
	}()

	// Main loop for sending periodic pings
	for {
		select {
		case <-ticker.C:
			pingMessage := `{"type":6}` + "\x1e"
			if err := conn.WriteMessage(websocket.TextMessage, []byte(pingMessage)); err != nil {
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

	ticker := time.NewTicker(30 * time.Second)
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
