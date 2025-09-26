package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/db"
	"cinesync/pkg/logger"
)

// LibraryItem represents a movie or series in the user's library
type LibraryItem struct {
	ID            int     `json:"id"`
	TmdbID        int     `json:"tmdb_id"`
	Title         string  `json:"title"`
	Year          *int    `json:"year,omitempty"`
	MediaType     string  `json:"media_type"` // 'movie' or 'tv'
	RootFolder    string  `json:"root_folder"`
	QualityProfile string `json:"quality_profile"`
	MonitorPolicy string  `json:"monitor_policy"`
	SeriesType    *string `json:"series_type,omitempty"` // Only for TV shows
	SeasonFolder  *bool   `json:"season_folder,omitempty"` // Only for TV shows
	Tags          string  `json:"tags"` // JSON array as string
	Status        string  `json:"status"` // 'wanted', 'downloading', 'completed', 'unavailable'
	AddedAt       int64   `json:"added_at"`
	UpdatedAt     int64   `json:"updated_at"`
}

// AddMovieRequest represents the request to add a movie to the library
type AddMovieRequest struct {
	TmdbID         int    `json:"tmdbId"`
	Title          string `json:"title"`
	Year           *int   `json:"year,omitempty"`
	RootFolder     string `json:"rootFolder"`
	QualityProfile string `json:"qualityProfile"`
	MonitorPolicy  string `json:"monitorPolicy"`
	Tags           []string `json:"tags"`
}

// AddSeriesRequest represents the request to add a series to the library
type AddSeriesRequest struct {
	TmdbID         int      `json:"tmdbId"`
	Title          string   `json:"title"`
	Year           *int     `json:"year,omitempty"`
	RootFolder     string   `json:"rootFolder"`
	QualityProfile string   `json:"qualityProfile"`
	MonitorPolicy  string   `json:"monitorPolicy"`
	SeriesType     string   `json:"seriesType"`
	SeasonFolder   bool     `json:"seasonFolder"`
	Tags           []string `json:"tags"`
}

// initLibraryTable creates the library table if it doesn't exist
func initLibraryTable() error {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %v", err)
	}

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS library_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tmdb_id INTEGER NOT NULL,
		title TEXT NOT NULL,
		year INTEGER,
		media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
		root_folder TEXT NOT NULL,
		quality_profile TEXT NOT NULL,
		monitor_policy TEXT NOT NULL,
		series_type TEXT, -- Only for TV shows
		season_folder BOOLEAN, -- Only for TV shows
		tags TEXT, -- JSON array as string
		status TEXT NOT NULL DEFAULT 'wanted' CHECK (status IN ('wanted', 'downloading', 'completed', 'unavailable')),
		added_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		UNIQUE(tmdb_id, media_type)
	);`

	if _, err := database.Exec(createTableSQL); err != nil {
		return fmt.Errorf("failed to create library_items table: %w", err)
	}

	// Create indexes for better performance
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_library_items_media_type ON library_items(media_type);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_tmdb_id ON library_items(tmdb_id);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_status ON library_items(status);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_added_at ON library_items(added_at DESC);`,
	}

	for _, indexSQL := range indexes {
		if _, err := database.Exec(indexSQL); err != nil {
			logger.Warn("Failed to create library index: %v", err)
		}
	}

	logger.Info("Library table initialized successfully")
	return nil
}

// MediaCover functionality
const (
	TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/"
	POSTER_SIZE         = "w500"
	FANART_SIZE         = "w1280"
)

// getMediaCoverPath returns the local path for a media cover
func getMediaCoverPath(tmdbID int, coverType string) string {
	mediaCoverDir := filepath.Join("..", "db", "MediaCover", fmt.Sprintf("%d", tmdbID))
	os.MkdirAll(mediaCoverDir, 0755)
	return filepath.Join(mediaCoverDir, fmt.Sprintf("%s.jpg", coverType))
}

// downloadImage downloads an image from URL to local path
func downloadImage(imageURL, localPath string) error {
	resp, err := http.Get(imageURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	file, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer file.Close()

	_, err = io.Copy(file, resp.Body)
	return err
}

// saveMediaCover saves poster and fanart for a TMDB item
func saveMediaCover(tmdbID int, posterPath, backdropPath string) error {
	// Save poster
	if posterPath != "" {
		posterURL := fmt.Sprintf("%s%s%s", TMDB_IMAGE_BASE_URL, POSTER_SIZE, posterPath)
		localPosterPath := getMediaCoverPath(tmdbID, "poster")
		
		if err := downloadImage(posterURL, localPosterPath); err != nil {
			logger.Warn("Failed to download poster for TMDB ID %d: %v", tmdbID, err)
		} else {
			logger.Info("Downloaded poster for TMDB ID %d", tmdbID)
		}
	}

	// Save fanart (backdrop)
	if backdropPath != "" {
		fanartURL := fmt.Sprintf("%s%s%s", TMDB_IMAGE_BASE_URL, FANART_SIZE, backdropPath)
		localFanartPath := getMediaCoverPath(tmdbID, "fanart")
		
		if err := downloadImage(fanartURL, localFanartPath); err != nil {
			logger.Warn("Failed to download fanart for TMDB ID %d: %v", tmdbID, err)
		} else {
			logger.Info("Downloaded fanart for TMDB ID %d", tmdbID)
		}
	}

	return nil
}

// fetchAndSaveMediaCover fetches TMDB data and saves poster/fanart
func fetchAndSaveMediaCover(tmdbID int, mediaType string) error {
	// Fetch TMDB data
	tmdbURL := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d?api_key=%s", mediaType, tmdbID, getTMDBAPIKey())
	
	resp, err := http.Get(tmdbURL)
	if err != nil {
		return fmt.Errorf("failed to fetch TMDB data: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("TMDB API returned status %d", resp.StatusCode)
	}

    var tmdbData map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&tmdbData); err != nil {
		return fmt.Errorf("failed to decode TMDB response: %v", err)
	}

	// Extract poster and backdrop paths
	posterPath, _ := tmdbData["poster_path"].(string)
	backdropPath, _ := tmdbData["backdrop_path"].(string)

    // Save media covers
    return saveMediaCover(tmdbID, posterPath, backdropPath)
}

// getTMDBAPIKey returns the TMDB API key using the existing function
func getTMDBAPIKey() string {
	// Use the existing getTmdbApiKey function from tmdb.go
	return getTmdbApiKey()
}

// upsertPlaceholderProcessedFile inserts or updates a minimal processed_files row
func upsertPlaceholderProcessedFile(tmdbID int, mediaType, title string, yearPtr *int, quality string) error {
    mediaHubDB, err := db.GetDatabaseConnection()
    if err != nil {
        return err
    }

    tmdbStr := strconv.Itoa(tmdbID)

    // Ensure a row exists (with tmdb_id only) if none present.
    _, _ = mediaHubDB.Exec(`
        INSERT INTO processed_files (tmdb_id)
        SELECT ?
        WHERE NOT EXISTS (SELECT 1 FROM processed_files WHERE tmdb_id = ?)
    `, tmdbStr, tmdbStr)

    // Update optional fields when columns exist
    // media_type
    _, _ = mediaHubDB.Exec(`UPDATE processed_files SET media_type = COALESCE(media_type, ?) WHERE tmdb_id = ? AND (media_type IS NULL OR media_type = '')`, mediaType, tmdbStr)
    // proper_name
    _, _ = mediaHubDB.Exec(`UPDATE processed_files SET proper_name = COALESCE(proper_name, ?) WHERE tmdb_id = ? AND (proper_name IS NULL OR proper_name = '')`, title, tmdbStr)
    // year
    if yearPtr != nil {
        _, _ = mediaHubDB.Exec(`UPDATE processed_files SET year = COALESCE(year, ?) WHERE tmdb_id = ? AND (year IS NULL OR year = '')`, strconv.Itoa(*yearPtr), tmdbStr)
    }
    // quality
    if quality != "" {
        _, _ = mediaHubDB.Exec(`UPDATE processed_files SET quality = COALESCE(quality, ?) WHERE tmdb_id = ? AND (quality IS NULL OR quality = '')`, quality, tmdbStr)
    }
    // processed_at
    _, _ = mediaHubDB.Exec(`UPDATE processed_files SET processed_at = COALESCE(processed_at, datetime('now')) WHERE tmdb_id = ? AND (processed_at IS NULL OR processed_at = '')`, tmdbStr)

    return nil
}

// fetchTmdbDetails retrieves rich TMDB metadata for writing into processed_files
func fetchTmdbDetails(tmdbID int, mediaType string) map[string]string {
    details := make(map[string]string)
    apiKey := getTMDBAPIKey()
    if apiKey == "" {
        return details
    }

    url := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d?api_key=%s&language=en-US", mediaType, tmdbID, apiKey)
    resp, err := http.Get(url)
    if err != nil {
        return details
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        return details
    }
    var data map[string]interface{}
    if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
        return details
    }

    // Common fields
    if v, ok := data["overview"].(string); ok { details["overview"] = v }
    if v, ok := data["status"].(string); ok { details["status"] = v }
    if v, ok := data["original_language"].(string); ok { details["original_language"] = v }
    // Genres -> comma-separated names
    if arr, ok := data["genres"].([]interface{}); ok {
        names := make([]string, 0)
        for _, g := range arr {
            if m, ok := g.(map[string]interface{}); ok {
                if n, ok := m["name"].(string); ok { names = append(names, n) }
            }
        }
        if len(names) > 0 { details["genres"] = strings.Join(names, ", ") }
    }

    if mediaType == "movie" {
        if v, ok := data["title"].(string); ok { details["proper_name"] = v }
        if v, ok := data["original_title"].(string); ok { details["original_title"] = v }
        if v, ok := data["release_date"].(string); ok { details["release_date"] = v }
        if n, ok := data["runtime"].(float64); ok { details["runtime"] = fmt.Sprintf("%d", int(n)) }
        if v, ok := data["imdb_id"].(string); ok { details["imdb_id"] = v }
        if y, ok := data["release_date"].(string); ok && len(y) >= 4 { details["year"] = y[:4] }
    } else {
        if v, ok := data["name"].(string); ok { details["proper_name"] = v }
        if v, ok := data["original_name"].(string); ok { details["original_title"] = v }
        if v, ok := data["first_air_date"].(string); ok { details["first_air_date"] = v }
        if v, ok := data["last_air_date"].(string); ok { details["last_air_date"] = v }
        if arr, ok := data["episode_run_time"].([]interface{}); ok && len(arr) > 0 {
            if n, ok := arr[0].(float64); ok { details["runtime"] = fmt.Sprintf("%d", int(n)) }
        }
        if n, ok := data["number_of_episodes"].(float64); ok { details["total_episodes"] = fmt.Sprintf("%d", int(n)) }
        if y, ok := data["first_air_date"].(string); ok && len(y) >= 4 { details["year"] = y[:4] }
    }

    return details
}

// upsertProcessedWithDetails writes fields available from TMDB into processed_files
func upsertProcessedWithDetails(tmdbID int, mediaType string, basicTitle string, quality string, yearPtr *int) {
    mediaHubDB, err := db.GetDatabaseConnection()
    if err != nil { return }
    tmdbStr := strconv.Itoa(tmdbID)

    // Ensure row exists
    _, _ = mediaHubDB.Exec(`
        INSERT INTO processed_files (tmdb_id)
        SELECT ?
        WHERE NOT EXISTS (SELECT 1 FROM processed_files WHERE tmdb_id = ?)
    `, tmdbStr, tmdbStr)

    // Basic fields
    _, _ = mediaHubDB.Exec(`UPDATE processed_files SET media_type = COALESCE(media_type, ?) WHERE tmdb_id = ? AND (media_type IS NULL OR media_type = '')`, mediaType, tmdbStr)
    if basicTitle != "" {
        _, _ = mediaHubDB.Exec(`UPDATE processed_files SET proper_name = COALESCE(proper_name, ?) WHERE tmdb_id = ? AND (proper_name IS NULL OR proper_name = '')`, basicTitle, tmdbStr)
    }
    if yearPtr != nil {
        _, _ = mediaHubDB.Exec(`UPDATE processed_files SET year = COALESCE(year, ?) WHERE tmdb_id = ? AND (year IS NULL OR year = '')`, strconv.Itoa(*yearPtr), tmdbStr)
    }
    if quality != "" {
        _, _ = mediaHubDB.Exec(`UPDATE processed_files SET quality = COALESCE(quality, ?) WHERE tmdb_id = ? AND (quality IS NULL OR quality = '')`, quality, tmdbStr)
    }
    _, _ = mediaHubDB.Exec(`UPDATE processed_files SET processed_at = COALESCE(processed_at, datetime('now')) WHERE tmdb_id = ? AND (processed_at IS NULL OR processed_at = '')`, tmdbStr)

    // Rich details
    details := fetchTmdbDetails(tmdbID, mediaType)
    if v := details["proper_name"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET proper_name = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["year"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET year = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["imdb_id"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET imdb_id = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["overview"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET overview = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["runtime"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET runtime = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["original_title"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET original_title = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["status"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET status = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["release_date"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET release_date = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["first_air_date"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET first_air_date = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["last_air_date"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET last_air_date = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["genres"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET genres = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["original_language"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET original_language = ? WHERE tmdb_id = ?`, v, tmdbStr) }
    if v := details["total_episodes"]; v != "" { _, _ = mediaHubDB.Exec(`UPDATE processed_files SET total_episodes = ? WHERE tmdb_id = ?`, v, tmdbStr) }
}

// isAvailableInDestinationDB returns true if the processed_files database has a row
func isAvailableInDestinationDB(tmdbID int, mediaType string) bool {
    mediaHubDB, err := db.GetDatabaseConnection()
    if err != nil {
        return false
    }

    var count int
    q := `SELECT COUNT(1) FROM processed_files WHERE tmdb_id = ? AND destination_path IS NOT NULL AND destination_path != ''`
    if err := mediaHubDB.QueryRow(q, strconv.Itoa(tmdbID)).Scan(&count); err != nil {
        return false
    }
    return count > 0
}

// HandleAddMovie handles POST /api/library/movie - add a movie to the library
func HandleAddMovie(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Initialize library table if it doesn't exist
	if err := initLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	var req AddMovieRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.TmdbID == 0 || req.Title == "" || req.RootFolder == "" {
		http.Error(w, "Missing required fields: tmdbId, title, rootFolder", http.StatusBadRequest)
		return
	}

	// Convert tags to JSON string
	tagsJSON, err := json.Marshal(req.Tags)
	if err != nil {
		http.Error(w, "Invalid tags format", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Insert or update the movie in the library
	query := `
		INSERT INTO library_items (tmdb_id, title, year, media_type, root_folder, quality_profile, monitor_policy, tags, status, added_at, updated_at)
		VALUES (?, ?, ?, 'movie', ?, ?, ?, ?, 'wanted', ?, ?)
		ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
			title = excluded.title,
			year = excluded.year,
			root_folder = excluded.root_folder,
			quality_profile = excluded.quality_profile,
			monitor_policy = excluded.monitor_policy,
			tags = excluded.tags,
			updated_at = excluded.updated_at`

	now := time.Now().Unix()
	_, err = database.Exec(query, req.TmdbID, req.Title, req.Year, req.RootFolder, req.QualityProfile, req.MonitorPolicy, string(tagsJSON), now, now)
	if err != nil {
		logger.Error("Failed to add movie to library: %v", err)
		http.Error(w, "Failed to add movie to library", http.StatusInternalServerError)
		return
	}

	logger.Info("Movie added to library: %s (TMDB ID: %d)", req.Title, req.TmdbID)

	go func(tmdbID int, title string, yearPtr *int) {
		upsertProcessedWithDetails(tmdbID, "movie", title, req.QualityProfile, yearPtr)
	}(req.TmdbID, req.Title, req.Year)

	// Fetch TMDB data and save poster/fanart
	go func() {
		if err := fetchAndSaveMediaCover(req.TmdbID, "movie"); err != nil {
			logger.Warn("Failed to fetch and save media cover for movie %s (TMDB ID: %d): %v", req.Title, req.TmdbID, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Movie '%s' added to library successfully", req.Title),
	})
}

// HandleAddSeries handles POST /api/library/series - add a series to the library
func HandleAddSeries(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Initialize library table if it doesn't exist
	if err := initLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	var req AddSeriesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.TmdbID == 0 || req.Title == "" || req.RootFolder == "" {
		http.Error(w, "Missing required fields: tmdbId, title, rootFolder", http.StatusBadRequest)
		return
	}

	// Convert tags to JSON string
	tagsJSON, err := json.Marshal(req.Tags)
	if err != nil {
		http.Error(w, "Invalid tags format", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Insert or update the series in the library
	query := `
		INSERT INTO library_items (tmdb_id, title, year, media_type, root_folder, quality_profile, monitor_policy, series_type, season_folder, tags, status, added_at, updated_at)
		VALUES (?, ?, ?, 'tv', ?, ?, ?, ?, ?, ?, 'wanted', ?, ?)
		ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
			title = excluded.title,
			year = excluded.year,
			root_folder = excluded.root_folder,
			quality_profile = excluded.quality_profile,
			monitor_policy = excluded.monitor_policy,
			series_type = excluded.series_type,
			season_folder = excluded.season_folder,
			tags = excluded.tags,
			updated_at = excluded.updated_at`

	now := time.Now().Unix()
	_, err = database.Exec(query, req.TmdbID, req.Title, req.Year, req.RootFolder, req.QualityProfile, req.MonitorPolicy, req.SeriesType, req.SeasonFolder, string(tagsJSON), now, now)
	if err != nil {
		logger.Error("Failed to add series to library: %v", err)
		http.Error(w, "Failed to add series to library", http.StatusInternalServerError)
		return
	}

	logger.Info("Series added to library: %s (TMDB ID: %d)", req.Title, req.TmdbID)

	// Placeholder processed_files entry (no source/destination yet)
	go func(tmdbID int, title string, yearPtr *int) {
		upsertProcessedWithDetails(tmdbID, "tv", title, req.QualityProfile, yearPtr)
	}(req.TmdbID, req.Title, req.Year)

	// Fetch TMDB data and save poster/fanart
	go func() {
		if err := fetchAndSaveMediaCover(req.TmdbID, "tv"); err != nil {
			logger.Warn("Failed to fetch and save media cover for series %s (TMDB ID: %d): %v", req.Title, req.TmdbID, err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Series '%s' added to library successfully", req.Title),
	})
}

// HandleGetLibrary handles GET /api/library - get all library items
func HandleGetLibrary(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Initialize library table if it doesn't exist
	if err := initLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

    // Parse query parameters
    mt := r.URL.Query().Get("type")
    if mt == "" {
        mt = r.URL.Query().Get("mediaType")
    }
    mediaType := mt
    status := r.URL.Query().Get("status")

	// Build query
	query := "SELECT id, tmdb_id, title, year, media_type, root_folder, quality_profile, monitor_policy, series_type, season_folder, tags, status, added_at, updated_at FROM library_items WHERE 1=1"
	args := []interface{}{}

	if mediaType != "" {
		query += " AND media_type = ?"
		args = append(args, mediaType)
	}

	if status != "" {
		query += " AND status = ?"
		args = append(args, status)
	}

	query += " ORDER BY added_at DESC"

	rows, err := database.Query(query, args...)
	if err != nil {
		logger.Error("Failed to query library items: %v", err)
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var items []LibraryItem
	for rows.Next() {
		var item LibraryItem
		var tagsJSON string
		var year sql.NullInt64
		var seriesType sql.NullString
		var seasonFolder sql.NullBool

		err := rows.Scan(
			&item.ID, &item.TmdbID, &item.Title, &year, &item.MediaType,
			&item.RootFolder, &item.QualityProfile, &item.MonitorPolicy,
			&seriesType, &seasonFolder, &tagsJSON, &item.Status,
			&item.AddedAt, &item.UpdatedAt,
		)
		if err != nil {
			logger.Warn("Failed to scan library item: %v", err)
			continue
		}

		// Handle nullable fields
		if year.Valid {
			yearInt := int(year.Int64)
			item.Year = &yearInt
		}

		if seriesType.Valid {
			item.SeriesType = &seriesType.String
		}

		if seasonFolder.Valid {
			item.SeasonFolder = &seasonFolder.Bool
		}

		// Parse tags JSON
		var tags []string
		if err := json.Unmarshal([]byte(tagsJSON), &tags); err != nil {
			logger.Warn("Failed to parse tags for item %d: %v", item.ID, err)
			tags = []string{}
		}
		item.Tags = tagsJSON

        if isAvailableInDestinationDB(item.TmdbID, item.MediaType) {
            item.Status = "imported"
        } else {
            item.Status = "missing"
        }

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		logger.Error("Error iterating library items: %v", err)
		http.Error(w, "Database iteration error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    items,
		"count":   len(items),
	})
}

// HandleUpdateLibraryItem handles PUT /api/library/{id} - update a library item
func HandleUpdateLibraryItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from URL path
	path := r.URL.Path
	idStr := path[strings.LastIndex(path, "/")+1:]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Status string `json:"status,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Update the item
	query := "UPDATE library_items SET status = ?, updated_at = ? WHERE id = ?"
	now := time.Now().Unix()
	result, err := database.Exec(query, req.Status, now, id)
	if err != nil {
		logger.Error("Failed to update library item: %v", err)
		http.Error(w, "Failed to update library item", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Error("Failed to get rows affected: %v", err)
		http.Error(w, "Failed to update library item", http.StatusInternalServerError)
		return
	}

	if rowsAffected == 0 {
		http.Error(w, "Library item not found", http.StatusNotFound)
		return
	}

	logger.Info("Library item %d updated successfully", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Library item updated successfully",
	})
}

// HandleDeleteLibraryItem handles DELETE /api/library/{id} - delete a library item
func HandleDeleteLibraryItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract ID from URL path
	path := r.URL.Path
	idStr := path[strings.LastIndex(path, "/")+1:]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Delete the item
	query := "DELETE FROM library_items WHERE id = ?"
	result, err := database.Exec(query, id)
	if err != nil {
		logger.Error("Failed to delete library item: %v", err)
		http.Error(w, "Failed to delete library item", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Error("Failed to get rows affected: %v", err)
		http.Error(w, "Failed to delete library item", http.StatusInternalServerError)
		return
	}

	if rowsAffected == 0 {
		http.Error(w, "Library item not found", http.StatusNotFound)
		return
	}

	logger.Info("Library item %d deleted successfully", id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Library item deleted successfully",
	})
}