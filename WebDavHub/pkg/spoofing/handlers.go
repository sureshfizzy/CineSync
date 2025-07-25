package spoofing

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"time"

	"cinesync/pkg/logger"
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

	// SignalR negotiation response
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
	json.NewEncoder(w).Encode(response)
}

// HandleSignalRMessages handles SignalR message requests
func HandleSignalRMessages(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{})
}

// HandleSystemEvents handles system events requests
func HandleSystemEvents(w http.ResponseWriter, r *http.Request) {
	events := []interface{}{}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// HandleCommand handles command requests (like triggering syncs)
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

	// GET request - return empty commands array
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
