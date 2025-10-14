package spoofing

import (
    "net/http"
    prowlarrapi "cinesync/pkg/prowlarr"
)

// RegisterRoutes registers all spoofing routes with the given mux
func RegisterRoutes(mux *http.ServeMux) {
	config := GetConfig()

	// Always register MediaCover routes regardless of spoofing status
	mediaHandler := HandlerWrapper(RetryHandlerWrapper(HandleMediaCover, 3), 30)
	mux.HandleFunc("/api/v3/MediaCover/", PanicRecoveryMiddleware(mediaHandler))

	// Common endpoints for both services
	commonEndpoints := map[string]http.HandlerFunc{
		"/api/v3/system/status":  HandleSystemStatus,
		"/api/v3/system/status/": HandleSystemStatus,
		"/api/system/status":     HandleSystemStatusV1,
		"/api/system/status/":    HandleSystemStatusV1,

		// Core endpoints
		"/api/v3/health":          HandleSpoofedHealth,
		"/api/v3/health/":         HandleSpoofedHealth,
		"/api/v3/rootfolder":      HandleSpoofedRootFolder,
		"/api/v3/rootfolder/":     HandleSpoofedRootFolder,
		"/api/v3/qualityprofile":  HandleSpoofedQualityProfile,
		"/api/v3/qualityprofile/": HandleSpoofedQualityProfile,
		"/api/v3/language":        HandleSpoofedLanguage,
		"/api/v3/language/":       HandleSpoofedLanguage,
		"/api/v3/tag":             HandleSpoofedTag,
		"/api/v3/tag/":            HandleSpoofedTag,
		"/api":                    HandleSpoofedAPI,

		// Filesystem and utils endpoints
		"/api/v3/filesystem":           HandleSpoofedFilesystem,
		"/api/v3/filesystem/":          HandleSpoofedFilesystem,
		"/api/v3/filesystem/type":      HandleSpoofedFilesystem,
		"/api/v3/filesystem/mediafiles": HandleSpoofedFilesystem,
		"/api/v3/utils":                HandleSpoofedUtils,
		"/api/v3/utils/":               HandleSpoofedUtils,

		// Additional common endpoints
		"/api/v3/notification":    HandleSpoofedNotification,
		"/api/v3/notification/":   HandleSpoofedNotification,
		"/api/v3/downloadclient":  HandleSpoofedDownloadClient,
		"/api/v3/downloadclient/": HandleSpoofedDownloadClient,
		"/api/v3/indexer":         HandleSpoofedIndexer,
		"/api/v3/indexer/":        HandleSpoofedIndexer,
		"/api/v3/indexer/schema":  HandleSpoofedIndexerSchema,
		"/api/v3/indexer/schema/": HandleSpoofedIndexerSchema,
		"/api/v3/indexer/test":    HandleSpoofedIndexerTest,
		"/api/v3/indexer/test/":   HandleSpoofedIndexerTest,
		"/api/v3/importlist":      HandleSpoofedImportList,
		"/api/v3/importlist/":     HandleSpoofedImportList,
		"/api/v3/queue":           HandleSpoofedQueue,
		"/api/v3/queue/":          HandleSpoofedQueue,

		// Event and sync endpoints
		"/api/v3/system/events":   HandleSystemEvents,
		"/api/v3/system/events/":  HandleSystemEvents,
		"/api/v3/command":         HandleCommand,
		"/api/v3/command/":        HandleCommand,
		"/api/v3/config/host":     HandleConfigHost,
		"/api/v3/config/host/":    HandleConfigHost,
	}

	// SignalR endpoints (use different auth middleware)
	// Based on Radarr source: x.MapHub<MessageHub>("/signalr/messages").RequireAuthorization("SignalR");
	signalREndpoints := map[string]http.HandlerFunc{
		"/signalr/messages/negotiate": HandleSignalRNegotiate,
		"/signalr/messages":           HandleSignalRMessages,
		"/signalr/negotiate":          HandleSignalRNegotiate,
		"/signalr":                    HandleSignalRMessages,
	}

	// Service-specific endpoints
	serviceEndpoints := make(map[string]http.HandlerFunc)

	if config.FolderMode {
		// In folder mode, register both Radarr and Sonarr endpoints
		// The handlers will determine which data to return based on the folder mapping's service type
		serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
		serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
		serviceEndpoints["/api/v3/moviefile"] = HandleSpoofedMovieFiles
		serviceEndpoints["/api/v3/moviefile/"] = HandleSpoofedMovieFiles
		serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
		serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
		serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
		serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
		serviceEndpoints["/api/v3/episodefile"] = HandleSpoofedEpisodeFiles
		serviceEndpoints["/api/v3/episodefile/"] = HandleSpoofedEpisodeFiles
		serviceEndpoints["/api/v3/episodeFile"] = HandleSpoofedEpisodeFiles
		serviceEndpoints["/api/v3/episodeFile/"] = HandleSpoofedEpisodeFiles
		serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
		serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
	} else {
		// In global mode, use the configured service type
		switch config.ServiceType {
		case "radarr":
			// Radarr-specific endpoints
			serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/moviefile"] = HandleSpoofedMovieFiles
			serviceEndpoints["/api/v3/moviefile/"] = HandleSpoofedMovieFiles
		case "sonarr":
			// Sonarr-specific endpoints
			serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episodefile"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodefile/"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodeFile"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodeFile/"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
			serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
		case "auto":
			// Auto mode - register both sets of endpoints
			serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/moviefile"] = HandleSpoofedMovieFiles
			serviceEndpoints["/api/v3/moviefile/"] = HandleSpoofedMovieFiles
			serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episodefile"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodefile/"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodeFile"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/episodeFile/"] = HandleSpoofedEpisodeFiles
			serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
			serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
		}
	}

	// Add folder management endpoints (these don't need auth middleware as they're internal)
	mux.HandleFunc("/api/spoofing/folders/available", HandleAvailableFolders)

	// Add circuit breaker status endpoint for monitoring
	mux.HandleFunc("/api/spoofing/circuit-breaker/status", HandleCircuitBreakerStatus)

	// Prowlarr v1 API endpoints for Radarr/Sonarr integration
    prowlarrEndpoints := map[string]http.HandlerFunc{
        "/api/v1/applications":         prowlarrapi.HandleProwlarrApplications,
        "/api/v1/applications/":        prowlarrapi.HandleProwlarrApplications,
        "/api/v1/applications/test":    prowlarrapi.HandleProwlarrApplicationTest,
        "/api/v1/system/status":        prowlarrapi.HandleProwlarrSystemStatus,
        "/api/v1/system/status/":       prowlarrapi.HandleProwlarrSystemStatus,
        "/api/v1/indexer":              prowlarrapi.HandleProwlarrIndexers,
        "/api/v1/indexer/":             prowlarrapi.HandleProwlarrIndexers,
        "/api/v1/search":               prowlarrapi.HandleProwlarrSearch,
        "/api/v1/search/":              prowlarrapi.HandleProwlarrSearch,
    }

	// Register Prowlarr endpoints with resilience wrappers
	for path, handler := range prowlarrEndpoints {
		resilientHandler := HandlerWrapper(RetryHandlerWrapper(handler, 3), 30)
		mux.HandleFunc(path, AuthMiddleware(resilientHandler))
	}

	// Torznab endpoints (indexer proxy for Radarr)
    mux.HandleFunc("/torznab/", func(w http.ResponseWriter, r *http.Request) {
        if r.URL.Query().Get("t") == "caps" {
            prowlarrapi.HandleTorznabCaps(w, r)
        } else {
            prowlarrapi.HandleTorznabSearch(w, r)
        }
    })

	// Register common endpoints with resilience wrappers
	for path, handler := range commonEndpoints {
		resilientHandler := HandlerWrapper(RetryHandlerWrapper(handler, 3), 30)
		mux.HandleFunc(path, AuthMiddleware(resilientHandler))
	}

	// Register service-specific endpoints with resilience wrappers
	for path, handler := range serviceEndpoints {
		resilientHandler := HandlerWrapper(RetryHandlerWrapper(handler, 3), 30)
		mux.HandleFunc(path, AuthMiddleware(resilientHandler))
	}

	for path, handler := range signalREndpoints {
		resilientHandler := PanicRecoveryMiddleware(handler)
		mux.HandleFunc(path, SignalRAuthMiddleware(resilientHandler))
	}
}