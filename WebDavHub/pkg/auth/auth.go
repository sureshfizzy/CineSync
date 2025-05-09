package auth

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
)

// Credentials stores the authentication information
type Credentials struct {
	Username string
	Password string
}

// GetCredentials retrieves credentials from environment variables
func GetCredentials() Credentials {
	return Credentials{
		Username: env.GetString("WEBDAV_USERNAME", "admin"),
		Password: env.GetString("WEBDAV_PASSWORD", "password"),
	}
}

// BasicAuth middleware for HTTP Basic Authentication
func BasicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if authentication is enabled
		if !env.IsBool("WEBDAV_AUTH_ENABLED", true) {
			next.ServeHTTP(w, r)
			return
		}

		credentials := GetCredentials()

		// Get username and password from request
		username, password, ok := r.BasicAuth()

		// Check if credentials are provided and match
		if !ok || subtle.ConstantTimeCompare([]byte(username), []byte(credentials.Username)) != 1 ||
			subtle.ConstantTimeCompare([]byte(password), []byte(credentials.Password)) != 1 {

			// For API routes, return JSON response
			if strings.HasPrefix(r.URL.Path, "/api/") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Invalid credentials",
				})
				logger.Warn("Failed API authentication attempt from %s", r.RemoteAddr)
				return
			}

			// For WebDAV routes, use standard basic auth
			w.Header().Set("WWW-Authenticate", `Basic realm="CineSync WebDAV"`)
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("Unauthorized"))
			logger.Warn("Failed WebDAV authentication attempt from %s", r.RemoteAddr)
			return
		}

		logger.Debug("Successful authentication for user: %s", username)
		next.ServeHTTP(w, r)
	})
}
