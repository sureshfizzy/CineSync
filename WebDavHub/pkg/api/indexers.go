package api

import (
	"cinesync/pkg/db"
	"cinesync/pkg/logger"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Indexer represents an indexer configuration
type Indexer struct {
	ID             int    `json:"id"`
	Name           string `json:"name"`
	Protocol       string `json:"protocol"`
	URL            string `json:"url"`
	APIKey         string `json:"apiKey,omitempty"`
	Enabled        bool   `json:"enabled"`
	UpdateInterval int    `json:"updateInterval"`
	Categories     string `json:"categories,omitempty"`
	Timeout        int    `json:"timeout"`
	LastUpdated    *int64 `json:"lastUpdated,omitempty"`
	LastTested     *int64 `json:"lastTested,omitempty"`
	TestStatus     string `json:"testStatus"`
	TestMessage    string `json:"testMessage,omitempty"`
	CreatedAt      int64  `json:"createdAt"`
	UpdatedAt      int64  `json:"updatedAt"`
}

// IndexerTest represents a test result for an indexer
type IndexerTest struct {
	ID           int    `json:"id"`
	IndexerID    int    `json:"indexerId"`
	TestType     string `json:"testType"`
	Status       string `json:"status"`
	Message      string `json:"message,omitempty"`
	ResponseTime int    `json:"responseTimeMs,omitempty"`
	TestedAt     int64  `json:"testedAt"`
}

// IndexerSearchRequest represents a search request
type IndexerSearchRequest struct {
	Query      string `json:"query"`
	Categories []int  `json:"categories,omitempty"`
	Limit      int    `json:"limit,omitempty"`
}

// IndexerSearchResult represents a search result
type IndexerSearchResult struct {
	Title       string  `json:"title"`
	Size        int64   `json:"size"`
	Category    string  `json:"category"`
	PublishDate string  `json:"publishDate"`
	Link        string  `json:"link"`
	Magnet      string  `json:"magnet,omitempty"`
	Seeders     int     `json:"seeders,omitempty"`
	Leechers    int     `json:"leechers,omitempty"`
	Indexer     string  `json:"indexer"`
	IndexerID   int     `json:"indexerId"`
}

// HandleIndexers handles indexer management requests
func HandleIndexers(w http.ResponseWriter, r *http.Request) {
	logger.Info("Indexer request: %s %s", r.Method, r.URL.Path)

	switch r.Method {
	case http.MethodGet:
		handleGetIndexers(w, r)
	case http.MethodPost:
		handleCreateIndexer(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleIndexerByID handles individual indexer operations
func HandleIndexerByID(w http.ResponseWriter, r *http.Request) {
	logger.Info("Indexer ID request: %s %s", r.Method, r.URL.Path)

	parts := getPathSegments(r, "/api/indexers")
		if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Indexer ID is required", http.StatusBadRequest)
		return
	}

	indexerID, err := strconv.Atoi(parts[0])
	if err != nil {
		http.Error(w, "Invalid indexer ID", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleGetIndexer(w, r, indexerID)
	case http.MethodPut:
		handleUpdateIndexer(w, r, indexerID)
	case http.MethodDelete:
		handleDeleteIndexer(w, r, indexerID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleIndexerTest handles indexer testing
func HandleIndexerTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := getPathSegments(r, "/api/indexers")
		if len(parts) < 2 || parts[0] == "" || parts[1] != "test" {
		http.Error(w, "Invalid test endpoint", http.StatusBadRequest)
		return
	}

	indexerID, err := strconv.Atoi(parts[0])
	if err != nil {
		http.Error(w, "Invalid indexer ID", http.StatusBadRequest)
		return
	}

	handleTestIndexer(w, r, indexerID)
}

// HandleIndexerSearch handles indexer search
func HandleIndexerSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	parts := getPathSegments(r, "/api/indexers")
		if len(parts) < 2 || parts[0] == "" || parts[1] != "search" {
		http.Error(w, "Invalid search endpoint", http.StatusBadRequest)
		return
	}

	indexerID, err := strconv.Atoi(parts[0])
	if err != nil {
		http.Error(w, "Invalid indexer ID", http.StatusBadRequest)
		return
	}

	handleSearchIndexer(w, r, indexerID)
}

// HandleIndexerTestConfig handles testing an indexer configuration without saving
func HandleIndexerTestConfig(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }

    var cfg Indexer
    if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }

    // Minimal validation
    if strings.TrimSpace(cfg.Protocol) == "" || strings.TrimSpace(cfg.URL) == "" {
        http.Error(w, "Protocol and URL are required", http.StatusBadRequest)
        return
    }

    result := testIndexerConnection(cfg)

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(result)
}

// HandleIndexerCaps returns Torznab caps (categories) for an indexer or provided config
func HandleIndexerCaps(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet && r.Method != http.MethodPost {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }

    // Allow POST with config, or GET /api/indexers/{id}/caps
    var idx Indexer
    if r.Method == http.MethodPost {
        if err := json.NewDecoder(r.Body).Decode(&idx); err != nil {
            http.Error(w, "Invalid JSON", http.StatusBadRequest)
            return
        }
    } else {
		parts := getPathSegments(r, "/api/indexers")
		if len(parts) < 2 || parts[0] == "" || parts[1] != "caps" {
            http.Error(w, "Invalid caps endpoint", http.StatusBadRequest)
            return
        }
        id, err := strconv.Atoi(parts[0])
        if err != nil { http.Error(w, "Invalid indexer ID", http.StatusBadRequest); return }

        mediaHubDB, dberr := db.GetDatabaseConnection()
        if dberr != nil { http.Error(w, "Database connection failed", http.StatusInternalServerError); return }
        var apiKey sql.NullString
        q := `SELECT id, name, protocol, url, api_key, timeout FROM indexers WHERE id = ?`
        if err := mediaHubDB.QueryRow(q, id).Scan(&idx.ID, &idx.Name, &idx.Protocol, &idx.URL, &apiKey, &idx.Timeout); err != nil {
            http.Error(w, "Indexer not found", http.StatusNotFound)
            return
        }
        if apiKey.Valid { idx.APIKey = apiKey.String }
    }

    caps, err := indexerService.GetIndexerCaps(idx)
    if err != nil { http.Error(w, err.Error(), http.StatusBadRequest); return }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]interface{}{"categories": caps})
}

// handleGetIndexers retrieves all indexers
func handleGetIndexers(w http.ResponseWriter, r *http.Request) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

    query := `SELECT id, name, protocol, url, api_key, enabled, 
        update_interval, categories, timeout, last_updated, last_tested, 
        test_status, test_message, created_at, updated_at 
        FROM indexers ORDER BY name`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		logger.Error("Failed to query indexers: %v", err)
		http.Error(w, "Failed to retrieve indexers", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var indexers []Indexer
	for rows.Next() {
    var indexer Indexer
    var apiKey, categories, testMessage sql.NullString
		var lastUpdated, lastTested sql.NullInt64

		err := rows.Scan(
			&indexer.ID, &indexer.Name, &indexer.Protocol, &indexer.URL,
        &apiKey, &indexer.Enabled,
			&indexer.UpdateInterval, &categories, &indexer.Timeout,
			&lastUpdated, &lastTested, &indexer.TestStatus,
			&testMessage, &indexer.CreatedAt, &indexer.UpdatedAt,
		)
		if err != nil {
			logger.Warn("Failed to scan indexer row: %v", err)
			continue
		}

		if apiKey.Valid {
			indexer.APIKey = apiKey.String
		}
		if categories.Valid {
			indexer.Categories = categories.String
		}
		if testMessage.Valid {
			indexer.TestMessage = testMessage.String
		}
		if lastUpdated.Valid {
			indexer.LastUpdated = &lastUpdated.Int64
		}
		if lastTested.Valid {
			indexer.LastTested = &lastTested.Int64
		}

		indexers = append(indexers, indexer)
	}

	if err := rows.Err(); err != nil {
		logger.Error("Error iterating indexers: %v", err)
		http.Error(w, "Failed to retrieve indexers", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(indexers)
}

// handleGetIndexer retrieves a specific indexer
func handleGetIndexer(w http.ResponseWriter, r *http.Request, indexerID int) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

    query := `SELECT id, name, protocol, url, api_key, enabled, 
        update_interval, categories, timeout, last_updated, last_tested, 
        test_status, test_message, created_at, updated_at 
        FROM indexers WHERE id = ?`

    var indexer Indexer
    var apiKey, categories, testMessage sql.NullString
	var lastUpdated, lastTested sql.NullInt64

    err = mediaHubDB.QueryRow(query, indexerID).Scan(
        &indexer.ID, &indexer.Name, &indexer.Protocol, &indexer.URL,
        &apiKey, &indexer.Enabled,
        &indexer.UpdateInterval, &categories, &indexer.Timeout,
        &lastUpdated, &lastTested, &indexer.TestStatus,
        &testMessage, &indexer.CreatedAt, &indexer.UpdatedAt,
    )

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Indexer not found", http.StatusNotFound)
		} else {
			logger.Error("Failed to query indexer: %v", err)
			http.Error(w, "Failed to retrieve indexer", http.StatusInternalServerError)
		}
		return
	}

	if apiKey.Valid {
		indexer.APIKey = apiKey.String
	}
	if categories.Valid {
		indexer.Categories = categories.String
	}
	if testMessage.Valid {
		indexer.TestMessage = testMessage.String
	}
	if lastUpdated.Valid {
		indexer.LastUpdated = &lastUpdated.Int64
	}
	if lastTested.Valid {
		indexer.LastTested = &lastTested.Int64
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(indexer)
}

// handleCreateIndexer creates a new indexer
func handleCreateIndexer(w http.ResponseWriter, r *http.Request) {
	var req Indexer
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Name == "" || req.Protocol == "" || req.URL == "" {
		http.Error(w, "Name, protocol, and URL are required", http.StatusBadRequest)
		return
	}

    // Validate protocol
    if req.Protocol == "jackett" || req.Protocol == "prowlarr" {
        req.Protocol = "torznab"
    }
    validProtocols := []string{"torznab"}
	validProtocol := false
	for _, protocol := range validProtocols {
		if req.Protocol == protocol {
			validProtocol = true
			break
		}
	}
    if !validProtocol {
        http.Error(w, "Invalid protocol. Must be one of: torznab, jackett, prowlarr", http.StatusBadRequest)
		return
	}

	// Validate URL
	if _, err := url.Parse(req.URL); err != nil {
		http.Error(w, "Invalid URL format", http.StatusBadRequest)
		return
	}

	// Set defaults
	if req.UpdateInterval <= 0 {
		req.UpdateInterval = 15
	}
	if req.Timeout <= 0 {
		req.Timeout = 30
	}

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	now := time.Now().Unix()
    query := `INSERT INTO indexers (name, protocol, url, api_key, enabled, 
        update_interval, categories, timeout, test_status, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

    result, err := mediaHubDB.Exec(query,
        req.Name, req.Protocol, req.URL, req.APIKey,
        req.Enabled, req.UpdateInterval, req.Categories, req.Timeout,
        "unknown", now, now,
    )

	if err != nil {
		logger.Error("Failed to insert indexer: %v", err)
		http.Error(w, "Failed to create indexer", http.StatusInternalServerError)
		return
	}

	id, err := result.LastInsertId()
	if err != nil {
		logger.Error("Failed to get last insert ID: %v", err)
		http.Error(w, "Failed to create indexer", http.StatusInternalServerError)
		return
	}

	req.ID = int(id)
	req.CreatedAt = now
	req.UpdatedAt = now
	req.TestStatus = "unknown"

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req)
}

// handleUpdateIndexer updates an existing indexer
func handleUpdateIndexer(w http.ResponseWriter, r *http.Request, indexerID int) {
	var req Indexer
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.Name == "" || req.Protocol == "" || req.URL == "" {
		http.Error(w, "Name, protocol, and URL are required", http.StatusBadRequest)
		return
	}

    // Validate protocol (normalize jackett/prowlarr under torznab umbrella)
    if req.Protocol == "jackett" || req.Protocol == "prowlarr" {
        req.Protocol = "torznab"
    }
    validProtocols := []string{"torznab"}
	validProtocol := false
	for _, protocol := range validProtocols {
		if req.Protocol == protocol {
			validProtocol = true
			break
		}
	}
    if !validProtocol {
        http.Error(w, "Invalid protocol. Must be one of: torznab, jackett, prowlarr", http.StatusBadRequest)
		return
	}

	// Validate URL
	if _, err := url.Parse(req.URL); err != nil {
		http.Error(w, "Invalid URL format", http.StatusBadRequest)
		return
	}

	// Set defaults
	if req.UpdateInterval <= 0 {
		req.UpdateInterval = 15
	}
	if req.Timeout <= 0 {
		req.Timeout = 30
	}

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	now := time.Now().Unix()
    query := `UPDATE indexers SET name=?, protocol=?, url=?, api_key=?, 
        enabled=?, update_interval=?, categories=?, timeout=?, updated_at=? WHERE id=?`

    result, err := mediaHubDB.Exec(query,
        req.Name, req.Protocol, req.URL, req.APIKey,
        req.Enabled, req.UpdateInterval, req.Categories, req.Timeout, now, indexerID,
    )

	if err != nil {
		logger.Error("Failed to update indexer: %v", err)
		http.Error(w, "Failed to update indexer", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Error("Failed to get rows affected: %v", err)
		http.Error(w, "Failed to update indexer", http.StatusInternalServerError)
		return
	}

	if rowsAffected == 0 {
		http.Error(w, "Indexer not found", http.StatusNotFound)
		return
	}

	req.ID = indexerID
	req.UpdatedAt = now

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(req)
}

// handleDeleteIndexer deletes an indexer
func handleDeleteIndexer(w http.ResponseWriter, r *http.Request, indexerID int) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	query := `DELETE FROM indexers WHERE id = ?`
	result, err := mediaHubDB.Exec(query, indexerID)
	if err != nil {
		logger.Error("Failed to delete indexer: %v", err)
		http.Error(w, "Failed to delete indexer", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Error("Failed to get rows affected: %v", err)
		http.Error(w, "Failed to delete indexer", http.StatusInternalServerError)
		return
	}

	if rowsAffected == 0 {
		http.Error(w, "Indexer not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleTestIndexer tests an indexer connection
func handleTestIndexer(w http.ResponseWriter, r *http.Request, indexerID int) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

    var indexer Indexer
    var apiKey sql.NullString

    query := `SELECT id, name, protocol, url, api_key, timeout FROM indexers WHERE id = ?`
    err = mediaHubDB.QueryRow(query, indexerID).Scan(
        &indexer.ID, &indexer.Name, &indexer.Protocol, &indexer.URL,
        &apiKey, &indexer.Timeout,
    )

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Indexer not found", http.StatusNotFound)
		} else {
			logger.Error("Failed to query indexer: %v", err)
			http.Error(w, "Failed to retrieve indexer", http.StatusInternalServerError)
		}
		return
	}

	if apiKey.Valid {
		indexer.APIKey = apiKey.String
	}

	// Perform test
	testResult := testIndexerConnection(indexer)

	// Save test result
	now := time.Now().Unix()
	testQuery := `INSERT INTO indexer_tests (indexer_id, test_type, status, message, response_time_ms, tested_at) 
		VALUES (?, 'connection', ?, ?, ?, ?)`
	_, err = mediaHubDB.Exec(testQuery, indexerID, testResult.Status, testResult.Message, testResult.ResponseTime, now)

	if err != nil {
		logger.Warn("Failed to save test result: %v", err)
	}

	// Update indexer test status
	updateQuery := `UPDATE indexers SET last_tested=?, test_status=?, test_message=? WHERE id=?`
	_, err = mediaHubDB.Exec(updateQuery, now, testResult.Status, testResult.Message, indexerID)

	if err != nil {
		logger.Warn("Failed to update indexer test status: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(testResult)
}

// handleSearchIndexer performs a search on an indexer
func handleSearchIndexer(w http.ResponseWriter, r *http.Request, indexerID int) {
	var req IndexerSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Query == "" {
		http.Error(w, "Query is required", http.StatusBadRequest)
		return
	}

	if req.Limit <= 0 {
		req.Limit = 100
	}

	// Get indexer details
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

    var indexer Indexer
    var apiKey sql.NullString

    query := `SELECT id, name, protocol, url, api_key, timeout FROM indexers WHERE id = ? AND enabled = 1`
    err = mediaHubDB.QueryRow(query, indexerID).Scan(
        &indexer.ID, &indexer.Name, &indexer.Protocol, &indexer.URL,
        &apiKey, &indexer.Timeout,
    )

	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Indexer not found or disabled", http.StatusNotFound)
		} else {
			logger.Error("Failed to query indexer: %v", err)
			http.Error(w, "Failed to retrieve indexer", http.StatusInternalServerError)
		}
		return
	}

	if apiKey.Valid {
		indexer.APIKey = apiKey.String
	}

	// Perform search
	results, err := searchIndexer(indexer, req)
	if err != nil {
		logger.Error("Failed to search indexer: %v", err)
		http.Error(w, "Search failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(results)
}


// testIndexerConnection tests the connection to an indexer
func testIndexerConnection(indexer Indexer) TestResult {
	return TestIndexerConnection(indexer)
}

// searchIndexer performs a search on the indexer
func searchIndexer(indexer Indexer, req IndexerSearchRequest) ([]IndexerSearchResult, error) {
	results, err := SearchIndexer(indexer, req.Query, req.Categories, req.Limit)
	if err != nil {
		return nil, err
	}

	// Convert SearchResult to IndexerSearchResult
	searchResults := make([]IndexerSearchResult, len(results))
	for i, result := range results {
		searchResults[i] = IndexerSearchResult{
			Title:       result.Title,
			Size:        result.Size,
			Category:    result.Category,
			PublishDate: result.PublishDate,
			Link:        result.Link,
			Magnet:      result.Magnet,
			Seeders:     result.Seeders,
			Leechers:    result.Leechers,
			Indexer:     result.Indexer,
			IndexerID:   result.IndexerID,
		}
	}

	return searchResults, nil
}




