package prowlarr

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/db"
	"cinesync/pkg/logger"
)

// HandleSpoofedIndexerCRUD provides minimal DB-backed CRUD for /api/v3/indexer
func HandleSpoofedIndexerCRUD(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		// List or single by id
		path := strings.TrimPrefix(r.URL.Path, "/api/v3/indexer")
		path = strings.TrimPrefix(path, "/")
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
            logger.Error("Failed to get database connection: %v", err)
            handleErrorResponse(w, "Database connection failed", http.StatusInternalServerError)
			return
		}
		if path == "" {
			rows, err := mediaHubDB.Query(`SELECT id, name, protocol, url, api_key, enabled, update_interval, categories, timeout, test_status, created_at, updated_at FROM indexers`)
			if err != nil {
                logger.Error("Failed to query indexers: %v", err)
                handleErrorResponse(w, "Failed to query indexers", http.StatusInternalServerError)
				return
			}
			defer rows.Close()
			list := make([]map[string]interface{}, 0)
			for rows.Next() {
				var (
					id int64
					name, protocol, urlStr, apiKey, testStatus, categories string
					enabled bool
					updateInterval, timeout int
					createdAt, updatedAt int64
				)
				if err := rows.Scan(&id, &name, &protocol, &urlStr, &apiKey, &enabled, &updateInterval, &categories, &timeout, &testStatus, &createdAt, &updatedAt); err != nil {
					logger.Error("Failed to scan indexer row: %v", err)
					continue
				}
				list = append(list, map[string]interface{}{
					"id": id,
					"name": name,
					"protocol": protocol,
					"url": urlStr,
					"apiKey": apiKey,
					"enabled": enabled,
					"updateInterval": updateInterval,
					"categories": categories,
					"timeout": timeout,
					"testStatus": testStatus,
					"createdAt": createdAt,
					"updatedAt": updatedAt,
					// Minimal Radarr fields to avoid null lists in equality checks
					"implementation":  "Torznab",
					"configContract":  "TorznabSettings",
					"tags":            []int{},
                    "fields": []map[string]interface{}{
                        {"name": "baseUrl", "value": urlStr},
                        {"name": "apiPath", "value": "/api"},
                        {"name": "apiKey", "value": apiKey},
                        {"name": "categories", "value": csvToIntSlice(categories)},
                    },
				})
			}
			json.NewEncoder(w).Encode(list)
			return
		}
		// Single by id
		idStr := path
		if i := strings.Index(path, "/"); i >= 0 {
			idStr = path[:i]
		}
		id, err := strconv.ParseInt(idStr, 10, 64)
		if err != nil {
			http.Error(w, "Invalid indexer id", http.StatusBadRequest)
			return
		}
		row := mediaHubDB.QueryRow(`SELECT id, name, protocol, url, api_key, enabled, update_interval, categories, timeout, test_status, created_at, updated_at FROM indexers WHERE id = ?`, id)
		var (
			rid int64
			name, protocol, urlStr, apiKey, testStatus, categories string
			enabled bool
			updateInterval, timeout int
			createdAt, updatedAt int64
		)
		if err := row.Scan(&rid, &name, &protocol, &urlStr, &apiKey, &enabled, &updateInterval, &categories, &timeout, &testStatus, &createdAt, &updatedAt); err != nil {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id": rid,
			"name": name,
			"protocol": protocol,
			"url": urlStr,
			"apiKey": apiKey,
			"enabled": enabled,
			"updateInterval": updateInterval,
			"categories": categories,
			"timeout": timeout,
			"testStatus": testStatus,
			"createdAt": createdAt,
			"updatedAt": updatedAt,
			"implementation":  "Torznab",
			"configContract":  "TorznabSettings",
			"tags":            []int{},
            "fields": []map[string]interface{}{
                {"name": "baseUrl", "value": urlStr},
                {"name": "apiPath", "value": "/api"},
                {"name": "apiKey", "value": apiKey},
                {"name": "categories", "value": csvToIntSlice(categories)},
            },
		})
		return

	case http.MethodPost:
		var idx map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&idx); err != nil {
            logger.Error("Failed to decode indexer create request: %v", err)
            handleErrorResponse(w, "Invalid request format", http.StatusBadRequest)
			return
		}

		name := firstString(idx["name"])
		implementation := firstString(idx["implementation"])
		protocol := firstString(idx["protocol"])
		if protocol == "" || strings.EqualFold(implementation, "Torznab") || strings.EqualFold(implementation, "Newznab") {
			protocol = "torznab"
		}
		baseURL := firstString(idx["baseUrl"], idx["url"]) 
		apiKey := firstString(idx["apiKey"]) 
		if baseURL == "" || apiKey == "" {
			if f := extractFieldsMap(idx); f != nil {
				if baseURL == "" { baseURL = firstString(f["baseUrl"]) }
				if apiKey == "" { apiKey = firstString(f["apiKey"]) }
				if protocol == "" {
					if p := firstString(f["protocol"]); p != "" { protocol = p }
				}
			}
		}
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
            logger.Error("Failed to get database connection: %v", err)
            handleErrorResponse(w, "Database connection failed", http.StatusInternalServerError)
			return
		}
		if protocol == "jackett" || protocol == "prowlarr" {
			protocol = "torznab"
		}
		if name == "" || protocol == "" || baseURL == "" {
            handleErrorResponse(w, "Missing required fields: name, protocol, baseUrl", http.StatusBadRequest)
			return
		}
		now := time.Now().Unix()
		res, err := mediaHubDB.Exec(`INSERT INTO indexers (name, protocol, url, api_key, enabled, update_interval, categories, timeout, test_status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			name, protocol, baseURL, apiKey, true, 15, "", 30, "unknown", now, now,
		)
		if err != nil {
            logger.Error("Failed to insert indexer: %v", err)
            handleErrorResponse(w, "Failed to create indexer", http.StatusInternalServerError)
			return
		}
		insertID, _ := res.LastInsertId()
		idx["id"] = insertID
		idx["url"] = baseURL
		idx["enabled"] = true
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(idx)
		return

	case http.MethodPut:
		var idx map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&idx); err != nil {
            logger.Error("Failed to decode indexer update request: %v", err)
            handleErrorResponse(w, "Invalid request format", http.StatusBadRequest)
			return
		}
		var targetID int64
		if v, ok := idx["id"]; ok {
			switch vv := v.(type) {
			case int64:
				targetID = vv
			case int:
				targetID = int64(vv)
			case float64:
				targetID = int64(vv)
			case string:
				if parsed, err := strconv.ParseInt(vv, 10, 64); err == nil {
					targetID = parsed
				}
			}
		}
		if targetID == 0 {
			path := strings.TrimPrefix(r.URL.Path, "/api/v3/indexer/")
			if i := strings.Index(path, "/"); i >= 0 {
				path = path[:i]
			}
			if parsed, err := strconv.ParseInt(path, 10, 64); err == nil {
				targetID = parsed
				idx["id"] = targetID
			}
		}
		if targetID == 0 {
            handleErrorResponse(w, "Indexer id is required for update", http.StatusBadRequest)
			return
		}
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
            logger.Error("Failed to get database connection: %v", err)
            handleErrorResponse(w, "Database connection failed", http.StatusInternalServerError)
			return
		}
		name := firstString(idx["name"]) 
		implementation := firstString(idx["implementation"]) 
		protocol := firstString(idx["protocol"]) 
		if protocol == "" || strings.EqualFold(implementation, "Torznab") || strings.EqualFold(implementation, "Newznab") {
			protocol = "torznab"
		}
		baseURL := firstString(idx["baseUrl"], idx["url"]) 
		apiKey := firstString(idx["apiKey"]) 
		if baseURL == "" || apiKey == "" {
			if f := extractFieldsMap(idx); f != nil {
				if baseURL == "" { baseURL = firstString(f["baseUrl"]) }
				if apiKey == "" { apiKey = firstString(f["apiKey"]) }
				if protocol == "" {
					if p := firstString(f["protocol"]); p != "" { protocol = p }
				}
			}
		}
		if name == "" || protocol == "" || baseURL == "" {
            handleErrorResponse(w, "Missing required fields: name, protocol, baseUrl", http.StatusBadRequest)
			return
		}
		_, err = mediaHubDB.Exec(`UPDATE indexers SET name = ?, protocol = ?, url = ?, api_key = ?, updated_at = ? WHERE id = ?`,
			name, protocol, baseURL, apiKey, time.Now().Unix(), targetID,
		)
		if err != nil {
            logger.Error("Failed to update indexer %d: %v", targetID, err)
            handleErrorResponse(w, "Failed to update indexer", http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(idx)
		return

	case http.MethodDelete:
		path := strings.TrimPrefix(r.URL.Path, "/api/v3/indexer/")
		if i := strings.Index(path, "/"); i >= 0 {
			path = path[:i]
		}
		id, err := strconv.ParseInt(path, 10, 64)
		if err != nil || id == 0 {
            http.Error(w, "Invalid indexer id", http.StatusBadRequest)
			return
		}
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
			logger.Error("Failed to get database connection: %v", err)
            handleErrorResponse(w, "Database connection failed", http.StatusInternalServerError)
			return
		}
		if _, err := mediaHubDB.Exec(`DELETE FROM indexers WHERE id = ?`, id); err != nil {
			logger.Error("Failed to delete indexer %d: %v", id, err)
            handleErrorResponse(w, "Failed to delete indexer", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

// local error response for this subpackage to avoid import cycles
func handleErrorResponse(w http.ResponseWriter, message string, statusCode int) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(statusCode)
    _ = json.NewEncoder(w).Encode(map[string]interface{}{
        "error":   http.StatusText(statusCode),
        "message": message,
        "status":  statusCode,
    })
}

// firstString returns the first non-empty string from provided interface values.
func firstString(values ...interface{}) string {
	for _, v := range values {
		if v == nil { continue }
		switch t := v.(type) {
		case string:
			if strings.TrimSpace(t) != "" { return t }
		case fmt.Stringer:
			s := t.String(); if strings.TrimSpace(s) != "" { return s }
		case float64:
			if t != 0 { return strconv.FormatFloat(t, 'f', -1, 64) }
		case int:
			if t != 0 { return strconv.Itoa(t) }
		case int64:
			if t != 0 { return strconv.FormatInt(t, 10) }
		}
	}
	return ""
}

// extractFieldsMap converts a Prowlarr/Radarr fields array into a map[name]value.
func extractFieldsMap(idx map[string]interface{}) map[string]interface{} {
	raw, ok := idx["fields"]
	if !ok || raw == nil { return nil }
	switch arr := raw.(type) {
	case []interface{}:
		out := make(map[string]interface{})
		for _, it := range arr {
			m, _ := it.(map[string]interface{})
			if m == nil { continue }
			name := firstString(m["name"]) 
			if name == "" { continue }
			val, ok := m["value"]
			if !ok { val = m["defaultValue"] }
			out[name] = val
		}
		return out
	}
	return nil
}

// csvToIntSlice converts a CSV string like "2000,2040" to []int{2000,2040}
func csvToIntSlice(csv string) []int {
    csv = strings.TrimSpace(csv)
    if csv == "" { return []int{} }
    parts := strings.Split(csv, ",")
    out := make([]int, 0, len(parts))
    for _, p := range parts {
        p = strings.TrimSpace(p)
        if p == "" { continue }
        if n, err := strconv.Atoi(p); err == nil { out = append(out, n) }
    }
    return out
}