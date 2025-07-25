package spoofing

import (
	"net/http"
)

// RegisterRoutes registers all spoofing routes with the given mux
func RegisterRoutes(mux *http.ServeMux) {
	config := GetConfig()

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
		"/api/v3/tag":             HandleSpoofedTag,
		"/api/v3/tag/":            HandleSpoofedTag,
		"/api":                    HandleSpoofedAPI,

		// Event and sync endpoints
		"/api/v3/system/events":   HandleSystemEvents,
		"/api/v3/system/events/":  HandleSystemEvents,
		"/api/v3/command":         HandleCommand,
		"/api/v3/command/":        HandleCommand,
		"/api/v3/config/host":     HandleConfigHost,
		"/api/v3/config/host/":    HandleConfigHost,
	}

	// SignalR endpoints (use different auth middleware)
	signalREndpoints := map[string]http.HandlerFunc{
		"/signalr/messages/negotiate": HandleSignalRNegotiate,
		"/signalr/messages":           HandleSignalRMessages,
	}

	// Service-specific endpoints
	serviceEndpoints := make(map[string]http.HandlerFunc)

	if config.FolderMode {
		// In folder mode, register both Radarr and Sonarr endpoints
		// The handlers will determine which data to return based on the folder mapping's service type
		serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
		serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
		serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
		serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
		serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
		serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
		serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
		serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
	} else {
		// In global mode, use the configured service type
		switch config.ServiceType {
		case "radarr":
			// Radarr-specific endpoints
			serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
		case "sonarr":
			// Sonarr-specific endpoints
			serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
			serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
		case "auto":
			// Auto mode - register both sets of endpoints
			serviceEndpoints["/api/v3/movie"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/movie/"] = HandleSpoofedMovies
			serviceEndpoints["/api/v3/series"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/series/"] = HandleSpoofedSeries
			serviceEndpoints["/api/v3/episode"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/episode/"] = HandleSpoofedEpisode
			serviceEndpoints["/api/v3/languageprofile"] = HandleSpoofedLanguageProfile
			serviceEndpoints["/api/v3/languageprofile/"] = HandleSpoofedLanguageProfile
		}
	}

	// Add folder management endpoints (these don't need auth middleware as they're internal)
	mux.HandleFunc("/api/spoofing/folders/available", HandleAvailableFolders)

	// Register common endpoints
	for path, handler := range commonEndpoints {
		mux.HandleFunc(path, AuthMiddleware(handler))
	}

	// Register service-specific endpoints
	for path, handler := range serviceEndpoints {
		mux.HandleFunc(path, AuthMiddleware(handler))
	}

	// Register SignalR endpoints with SignalR-specific auth
	for path, handler := range signalREndpoints {
		mux.HandleFunc(path, SignalRAuthMiddleware(handler))
	}
}