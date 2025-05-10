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

// isAuthEndpoint checks if the request is for an authentication-related endpoint
func isAuthEndpoint(path string) bool {
	authEndpoints := []string{
		"/api/auth/enabled",
		"/api/auth/test",
		"/api/auth/login",
		"/api/auth/check",
	}
	for _, endpoint := range authEndpoints {
		if path == endpoint {
			return true
		}
	}
	return false
}

// validateCredentials checks if the provided credentials match the stored ones
func validateCredentials(username, password string) bool {
	credentials := GetCredentials()
	return subtle.ConstantTimeCompare([]byte(username), []byte(credentials.Username)) == 1 &&
		subtle.ConstantTimeCompare([]byte(password), []byte(credentials.Password)) == 1
}

// BasicAuth middleware for HTTP Basic Authentication
func BasicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if authentication is enabled
		if !env.IsBool("WEBDAV_AUTH_ENABLED", true) {
			next.ServeHTTP(w, r)
			return
		}

		// Skip authentication for auth-related endpoints
		if isAuthEndpoint(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		// Get username and password from request
		username, password, ok := r.BasicAuth()

		// Log authentication attempt
		logger.Debug("Authentication attempt from %s for path %s", r.RemoteAddr, r.URL.Path)

		// Check if credentials are provided and match
		if !ok {
			logger.Warn("Authentication failed: No credentials provided from %s", r.RemoteAddr)
			sendUnauthorizedResponse(w, r)
			return
		}

		if !validateCredentials(username, password) {
			logger.Warn("Authentication failed: Invalid credentials for user '%s' from %s", username, r.RemoteAddr)
			sendUnauthorizedResponse(w, r)
			return
		}

		// Add authentication headers to response
		w.Header().Set("X-Authenticated-User", username)

		logger.Debug("Successful authentication for user: %s on path %s", username, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

// sendUnauthorizedResponse sends an appropriate unauthorized response based on the request type
func sendUnauthorizedResponse(w http.ResponseWriter, r *http.Request) {
	// For API routes, return JSON response
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "Invalid credentials",
		})
		return
	}

	// For WebDAV routes, use standard basic auth
	w.Header().Set("WWW-Authenticate", `Basic realm="CineSync WebDAV"`)
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte("Unauthorized"))
}

// HandleLogin handles the login endpoint
func HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		logger.Warn("Invalid method %s for login endpoint from %s", r.Method, r.RemoteAddr)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username, password, ok := r.BasicAuth()
	if !ok {
		logger.Warn("Login failed: No credentials provided from %s", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "Missing credentials",
		})
		return
	}

	if !validateCredentials(username, password) {
		logger.Warn("Login failed: Invalid credentials for user '%s' from %s", username, r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "Invalid credentials",
		})
		return
	}

	logger.Info("Successful login for user '%s' from %s", username, r.RemoteAddr)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Login successful",
	})
}

// HandleAuthCheck handles the consolidated auth check endpoint
func HandleAuthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		logger.Warn("Invalid method %s for auth check endpoint from %s", r.Method, r.RemoteAddr)
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Check if auth is enabled
	authEnabled := env.IsBool("WEBDAV_AUTH_ENABLED", true)
	if !authEnabled {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"isAuthenticated": true,
			"authEnabled":     false,
		})
		return
	}

	// Check credentials if provided
	username, password, ok := r.BasicAuth()
	isAuthenticated := false

	if ok && validateCredentials(username, password) {
		isAuthenticated = true
		logger.Debug("Auth check successful for user '%s' from %s", username, r.RemoteAddr)
	} else if ok {
		logger.Warn("Auth check failed: Invalid credentials for user '%s' from %s", username, r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"isAuthenticated": isAuthenticated,
		"authEnabled":     true,
	})
}
