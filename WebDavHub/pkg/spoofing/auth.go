package spoofing

import (
	"net/http"
	"strings"

	"cinesync/pkg/logger"
)

// AuthMiddleware validates API key for spoofed endpoints
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := GetConfig()
		
		if !config.Enabled {
			http.NotFound(w, r)
			return
		}

		// Get API key from header or query parameter
		apiKey := r.Header.Get("X-Api-Key")
		if apiKey == "" {
			apiKey = r.URL.Query().Get("apikey")
		}

		// Validate API key
		if apiKey == "" {
			logger.Warn("Missing API key for spoofed endpoint: %s", r.URL.Path)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if !strings.EqualFold(apiKey, config.APIKey) {
			logger.Warn("Invalid API key for spoofed endpoint: %s", r.URL.Path)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Api-Key")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	}
}
