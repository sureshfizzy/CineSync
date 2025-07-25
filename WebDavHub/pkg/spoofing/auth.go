package spoofing

import (
	"encoding/json"
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

		if config.FolderMode {
			// In folder mode, validate that the API key corresponds to an active folder mapping
			if apiKey == "" {
				logger.Warn("Missing API key for spoofed endpoint in folder mode: %s", r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}

			// Check if the API key matches any enabled folder mapping
			validAPIKey := false
			for _, mapping := range config.FolderMappings {
				if mapping.Enabled && strings.EqualFold(mapping.APIKey, apiKey) {
					validAPIKey = true
					break
				}
			}

			if !validAPIKey {
				logger.Warn("Invalid API key for folder mode spoofed endpoint: %s (API key: %s)", r.URL.Path, apiKey)
				logger.Debug("Available folder mappings: %d", len(config.FolderMappings))
				for i, mapping := range config.FolderMappings {
					logger.Debug("Mapping %d: Enabled=%t, APIKey=%s, Folder=%s", i, mapping.Enabled, mapping.APIKey, mapping.FolderPath)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}

		} else {
			// Global mode - validate against the main API key
			if apiKey == "" {
				logger.Warn("Missing API key for spoofed endpoint: %s", r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}

			if !strings.EqualFold(apiKey, config.APIKey) {
				logger.Warn("Invalid API key for spoofed endpoint: %s", r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}
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

// SignalRAuthMiddleware validates access tokens for SignalR endpoints
func SignalRAuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		config := GetConfig()

		if !config.Enabled {
			http.NotFound(w, r)
			return
		}

		// Get access token from query parameter
		accessToken := r.URL.Query().Get("access_token")

		if accessToken == "" {
			logger.Warn("Missing access token for SignalR endpoint: %s", r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
			return
		}

		// In folder mode, check if the access token matches any folder mapping
		if config.FolderMode {
			validToken := false
			for _, mapping := range config.FolderMappings {
				if mapping.Enabled && strings.EqualFold(mapping.APIKey, accessToken) {
					validToken = true
					logger.Debug("SignalR: Found matching access token for folder: %s", mapping.FolderPath)
					break
				}
			}

			if !validToken {
				logger.Warn("Invalid access token for SignalR endpoint: %s (token: %s)", r.URL.Path, accessToken)
				logger.Debug("Available folder mappings: %d", len(config.FolderMappings))
				for i, mapping := range config.FolderMappings {
					logger.Debug("SignalR Mapping %d: Enabled=%t, APIKey=%s, Folder=%s", i, mapping.Enabled, mapping.APIKey, mapping.FolderPath)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}
		} else {
			// Global mode - validate against the main API key
			if !strings.EqualFold(accessToken, config.APIKey) {
				logger.Warn("Invalid access token for SignalR endpoint: %s", r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{"error": "Unauthorized"})
				return
			}
		}

		logger.Debug("SignalR: Valid access token found for endpoint: %s", r.URL.Path)

		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	}
}
