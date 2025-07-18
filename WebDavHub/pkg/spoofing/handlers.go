package spoofing

import (
	"encoding/json"
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
	movies, err := getMoviesFromDatabase()
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
	series, err := getSeriesFromDatabase()
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
	// Return empty array for now
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte("[]"))
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
