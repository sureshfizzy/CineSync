package api

import (
	"encoding/json"
	"net/http"

	"cinesync/pkg/logger"
	"cinesync/pkg/spoofing"
)

// SpoofingConfigRequest represents a request to update the spoofing configuration
type SpoofingConfigRequest struct {
	Enabled        bool                      `json:"enabled"`
	Version        string                    `json:"version"`
	Branch         string                    `json:"branch"`
	APIKey         string                    `json:"apiKey"`
	ServiceType    string                    `json:"serviceType"`
	FolderMode     bool                      `json:"folderMode"`
	FolderMappings []spoofing.FolderMapping  `json:"folderMappings"`
}

// HandleSpoofingConfig handles GET and POST requests for the spoofing configuration
func HandleSpoofingConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle preflight requests
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Get current configuration
	config := spoofing.GetConfig()

	// Handle GET request
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
		return
	}

	// Handle POST and PUT requests to update configuration
	if r.Method == "POST" || r.Method == "PUT" {
		var req SpoofingConfigRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			logger.Warn("Failed to decode spoofing config request: %v", err)
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		config.Enabled = req.Enabled
		config.Version = req.Version
		config.Branch = req.Branch
		config.APIKey = req.APIKey
		config.ServiceType = req.ServiceType
		config.FolderMode = req.FolderMode
		config.FolderMappings = req.FolderMappings

		if err := spoofing.SetConfig(config); err != nil {
			logger.Warn("Failed to update spoofing config: %v", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Return updated configuration
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(config)
		return
	}

	// Handle unsupported methods
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// HandleSpoofingSwitch handles requests to toggle spoofing on/off
func HandleSpoofingSwitch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	// Handle preflight requests
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Only allow POST requests
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get current configuration and toggle enabled state
	config := spoofing.GetConfig()
	config.Enabled = !config.Enabled

	// Validate and save configuration
	if err := spoofing.SetConfig(config); err != nil {
		logger.Warn("Failed to toggle spoofing: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Return updated configuration
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// HandleRegenerateAPIKey handles requests to regenerate the spoofing API key
func HandleRegenerateAPIKey(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get current configuration and regenerate API key
	config := spoofing.GetConfig()
	config.APIKey = spoofing.RegenerateAPIKey()

	// Save configuration
	if err := spoofing.SetConfig(config); err != nil {
		logger.Warn("Failed to regenerate API key: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Return updated configuration
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}