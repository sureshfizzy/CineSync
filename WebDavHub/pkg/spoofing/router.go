package spoofing

import (
	"net/http"
)

// RegisterRoutes registers all spoofing routes with the given mux
func RegisterRoutes(mux *http.ServeMux) {
	endpoints := map[string]http.HandlerFunc{
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
		"/api/v3/languageprofile": HandleSpoofedLanguageProfile,
		"/api/v3/languageprofile/": HandleSpoofedLanguageProfile,
		"/api/v3/tag":             HandleSpoofedTag,
		"/api/v3/tag/":            HandleSpoofedTag,
		"/api":                    HandleSpoofedAPI,

		// Media endpoints
		"/api/v3/movie":    HandleSpoofedMovies,
		"/api/v3/movie/":   HandleSpoofedMovies,
		"/api/v3/series":   HandleSpoofedSeries,
		"/api/v3/series/":  HandleSpoofedSeries,
		"/api/v3/episode":  HandleSpoofedEpisode,
		"/api/v3/episode/": HandleSpoofedEpisode,
	}

	for path, handler := range endpoints {
		mux.HandleFunc(path, AuthMiddleware(handler))
	}
}