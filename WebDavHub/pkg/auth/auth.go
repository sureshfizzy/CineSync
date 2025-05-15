package auth

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

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

// JWTClaims defines the structure for JWT claims
type JWTClaims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

// GenerateJWT generates a JWT for a given username
func GenerateJWT(username string) (string, error) {
	claims := JWTClaims{
		Username: username,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

// JWTMiddleware protects endpoints with JWT auth
func JWTMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow public endpoints
		if isAuthEndpoint(r.URL.Path) || strings.HasPrefix(r.URL.Path, "/static/") {
			next.ServeHTTP(w, r)
			return
		}

		// Check if auth is enabled
		enabled := true
		if v := os.Getenv("WEBDAV_AUTH_ENABLED"); v == "false" || v == "0" {
			enabled = false
		}
		if !enabled {
			next.ServeHTTP(w, r)
			return
		}

		header := r.Header.Get("Authorization")
		tokenStr := ""
		if strings.HasPrefix(header, "Bearer ") {
			tokenStr = strings.TrimPrefix(header, "Bearer ")
			logger.Debug("JWT found in Authorization header")
		} else if token := r.URL.Query().Get("token"); token != "" {
			tokenStr = token
			logger.Debug("JWT found in query parameter")
		}

		if tokenStr == "" {
			logger.Warn("Missing or invalid token for path: %s", r.URL.Path)
			http.Error(w, "Missing or invalid Authorization header or token parameter", http.StatusUnauthorized)
			return
		}

		token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			logger.Warn("Invalid or expired token for path %s: %v", r.URL.Path, err)
			http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// HandleLogin handles the login endpoint (JWT version)
func HandleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var creds Credentials
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		logger.Warn("Invalid request body: %v", err)
		return
	}
	if !validateCredentials(creds.Username, creds.Password) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		logger.Warn("Failed login attempt for user '%s'", creds.Username)
		return
	}
	token, err := GenerateJWT(creds.Username)
	if err != nil {
		http.Error(w, "Failed to generate token", http.StatusInternalServerError)
		logger.Warn("Failed to generate token for user '%s': %v", creds.Username, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
	logger.Info("Successful login for user '%s'", creds.Username)
}

// HandleAuthCheck checks if the JWT is valid
func HandleAuthCheck(w http.ResponseWriter, r *http.Request) {
	header := r.Header.Get("Authorization")
	valid := false
	if strings.HasPrefix(header, "Bearer ") {
		tokenStr := strings.TrimPrefix(header, "Bearer ")
		token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})
		if err == nil && token.Valid {
			valid = true
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"isAuthenticated": valid,
		"authEnabled":     true,
	})
}

// HandleMe returns the current user's info from the JWT
func HandleMe(w http.ResponseWriter, r *http.Request) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		http.Error(w, "Missing or invalid Authorization header", http.StatusUnauthorized)
		return
	}
	tokenStr := strings.TrimPrefix(header, "Bearer ")
	token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
		return
	}
	claims, ok := token.Claims.(*JWTClaims)
	if !ok {
		http.Error(w, "Invalid token claims", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"username": claims.Username,
	})
}
