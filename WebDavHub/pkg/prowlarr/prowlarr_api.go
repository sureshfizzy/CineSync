package prowlarr

import (
	"encoding/json"
	"net/http"

	"cinesync/pkg/logger"
)

// Minimal Prowlarr system status (v1)
func HandleProwlarrSystemStatus(w http.ResponseWriter, r *http.Request) {
    // minimal config replacement to avoid cross-package deps
    config := struct {
        InstanceName string
        Version      string
        Branch       string
    }{
        InstanceName: "CineSync",
        Version:      "1.0.0",
        Branch:       "stable",
    }
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"appName":       "Prowlarr",
		"instanceName":  config.InstanceName,
		"version":       config.Version,
        "buildTime":     "",
		"branch":        config.Branch,
        "startTime":     "",
	})
}

// Minimal Prowlarr applications (v1)
func HandleProwlarrApplications(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]interface{}{})
		return
	}
	if r.Method == http.MethodPost {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		body["id"] = 1
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(body)
		return
	}
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// Minimal Prowlarr application test (v1)
func HandleProwlarrApplicationTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost { http.Error(w, "Method not allowed", http.StatusMethodNotAllowed); return }
	// Accept anything and return valid=true to keep integration flowing
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"isValid": true,
		"errors":  []interface{}{},
	})
}

// Minimal Prowlarr indexers (v1)
func HandleProwlarrIndexers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{
		{
			"id":             1,
			"name":           "CineSync",
			"implementation": "TorrentRssIndexer",
			"protocol":       "torrent",
			"supportsRss":    true,
			"supportsSearch": true,
		},
	})
}

// Minimal Prowlarr search (v1)
func HandleProwlarrSearch(w http.ResponseWriter, r *http.Request) {
	logger.Info("Prowlarr search: q=%s cats=%s ids=%s", r.URL.Query().Get("query"), r.URL.Query().Get("categories"), r.URL.Query().Get("indexerIds"))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"results": []interface{}{},
		"total":   0,
	})
}
