package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	media "cinesync/pkg/api/Media"
	"cinesync/pkg/db"
	"cinesync/pkg/logger"
)

// LibraryItem represents a movie or series in the user's library
type LibraryItem struct {
	ID             int     `json:"id"`
	TmdbID         int     `json:"tmdb_id"`
	Title          string  `json:"title"`
	Year           *int    `json:"year,omitempty"`
	MediaType      string  `json:"media_type"` // 'movie' or 'tv'
	RootFolder     string  `json:"root_folder"`
	QualityProfile string  `json:"quality_profile"`
	MonitorPolicy  string  `json:"monitor_policy"`
	SeriesType     *string `json:"series_type,omitempty"`
	SeasonFolder   *bool   `json:"season_folder,omitempty"`
	Tags           string  `json:"tags"`
	Status         string  `json:"status"`
	AddedAt        int64   `json:"added_at"`
	UpdatedAt      int64   `json:"updated_at"`
}

// LibraryItemFromDB represents a movie or series
type LibraryItemFromDB struct {
	ID              int    `json:"id"`
	TmdbID          int    `json:"tmdb_id"`
	Title           string `json:"title"`
	Year            *int   `json:"year,omitempty"`
	MediaType       string `json:"media_type"`
	RootFolder      string `json:"root_folder"`
	QualityProfile  string `json:"quality_profile"`
	MonitorPolicy   string `json:"monitor_policy"`
	Tags            string `json:"tags"`
	Status          string `json:"status"`
	AddedAt         int64  `json:"added_at"`
	UpdatedAt       int64  `json:"updated_at"`
	PosterPath      string `json:"poster_path"` // /MediaCover/{tmdb_id}/poster.jpg
	Overview        string `json:"overview"`
	Quality         string `json:"quality"`
	DestinationPath string `json:"destination_path"`
}

// WantedEpisode is a lightweight DTO for missing TV episodes
type WantedEpisode struct {
	ID             string `json:"id"`
	TmdbID         int    `json:"tmdbId"`
	Title          string `json:"title"`
	Year           *int   `json:"year,omitempty"`
	MediaType      string `json:"mediaType"` // always "tv" here
	RootFolder     string `json:"rootFolder"`
	QualityProfile string `json:"qualityProfile"`
	SeasonNumber   int    `json:"seasonNumber"`
	EpisodeNumber  int    `json:"episodeNumber"`
	Episode        string `json:"episode"`
	EpisodeTitle   string `json:"episodeTitle"`
	AirDate        string `json:"airDate,omitempty"`
}

// WantedMovie is a lightweight DTO for movies that are in the library
type WantedMovie struct {
	ID             string   `json:"id"`
	TmdbID         int      `json:"tmdbId"`
	Title          string   `json:"title"`
	Year           *int     `json:"year,omitempty"`
	MediaType      string   `json:"mediaType"`
	RootFolder     string   `json:"rootFolder"`
	QualityProfile string   `json:"qualityProfile"`
	MonitorPolicy  string   `json:"monitorPolicy"`
	Tags           []string `json:"tags,omitempty"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

// writePagedJSON writes a standardized paged JSON response:
func writePagedJSON[T any](w http.ResponseWriter, data []T, totalCount int) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Content-Type", "application/json")

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"data":        data,
		"count":       len(data),
		"total_count": totalCount,
	})
}

// AddMovieRequest represents the request to add a movie to the library
type AddMovieRequest struct {
	TmdbID         int      `json:"tmdbId"`
	Title          string   `json:"title"`
	Year           *int     `json:"year,omitempty"`
	RootFolder     string   `json:"rootFolder"`
	QualityProfile string   `json:"qualityProfile"`
	MonitorPolicy  string   `json:"monitorPolicy"`
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

// InitLibraryTable creates the library table if it doesn't exist
func InitLibraryTable() error {
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

	// Create root_folders table
	createRootFoldersTableSQL := `
	CREATE TABLE IF NOT EXISTS root_folders (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT UNIQUE NOT NULL,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);`

	if _, err := database.Exec(createRootFoldersTableSQL); err != nil {
		return fmt.Errorf("failed to create root_folders table: %w", err)
	}

	// Create indexes for better performance
	indexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_library_items_media_type ON library_items(media_type);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_tmdb_id ON library_items(tmdb_id);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_status ON library_items(status);`,
		`CREATE INDEX IF NOT EXISTS idx_library_items_added_at ON library_items(added_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_root_folders_path ON root_folders(path);`,
	}

	for _, indexSQL := range indexes {
		if _, err := database.Exec(indexSQL); err != nil {
			logger.Warn("Failed to create library index: %v", err)
		}
	}

	return nil
}

// HandleGetLibraryWantedFast exposes missing TV episodes directly from MediaHub DB.
func HandleGetLibraryWantedFast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get MediaHub database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	variant := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("variant")))
	resolution := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("resolution")))

	if variant == "movies" || variant == "movie" {
		if err := InitLibraryTable(); err != nil {
			logger.Error("Failed to initialize library table: %v", err)
			http.Error(w, "Database initialization failed", http.StatusInternalServerError)
			return
		}

		movieFilter := ""
		switch resolution {
		case "2160p":
			movieFilter = `
          AND (LOWER(li.quality_profile) LIKE '%2160%' OR LOWER(li.quality_profile) LIKE '%4k%' OR LOWER(li.quality_profile) LIKE '%uhd%')`
		case "1080p":
			movieFilter = `
          AND LOWER(li.quality_profile) LIKE '%1080%'`
		case "720p":
			movieFilter = `
          AND LOWER(li.quality_profile) LIKE '%720%'`
		case "480p":
			movieFilter = `
          AND LOWER(li.quality_profile) LIKE '%480%'`
		}

		baseQuery := fmt.Sprintf(`
        SELECT
          li.id,
          li.tmdb_id,
          li.title,
          li.year,
          li.root_folder,
          li.quality_profile,
          li.monitor_policy,
          li.tags,
          li.added_at,
          li.updated_at
        FROM library_items li
        LEFT JOIN processed_files p ON CAST(p.tmdb_id AS INTEGER) = li.tmdb_id
          AND p.destination_path IS NOT NULL AND p.destination_path != ''
          AND (p.reason IS NULL OR p.reason = '')
          AND (p.season_number IS NULL OR p.season_number = '' OR p.season_number = 'NULL')
        WHERE li.media_type = 'movie'
          AND p.tmdb_id IS NULL%s
        `, movieFilter)
		orderBy := " ORDER BY li.added_at DESC"

		countQuery := "SELECT COUNT(1) FROM (" + baseQuery + ") AS sub"
		var totalCount int
		if err := mediaHubDB.QueryRow(countQuery).Scan(&totalCount); err != nil {
			logger.Warn("Failed to count wanted movies: %v", err)
			totalCount = 0
		}

		limit, offset := parseLimitOffset(r)

		query := baseQuery + orderBy
		args := []interface{}{}
		if limit > 0 {
			query += " LIMIT ? OFFSET ?"
			args = append(args, limit, offset)
		}

		rows, err := mediaHubDB.Query(query, args...)
		if err != nil {
			logger.Error("Failed to query library movies: %v", err)
			http.Error(w, "Failed to query wanted movies", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		var out []WantedMovie
		for rows.Next() {
			var (
				id             int
				tmdbID         int
				title          string
				year           sql.NullInt64
				rootFolder     string
				qualityProfile string
				monitorPolicy  string
				tagsJSON       string
				addedAt        int64
				updatedAt      int64
			)
			if err := rows.Scan(&id, &tmdbID, &title, &year, &rootFolder, &qualityProfile, &monitorPolicy, &tagsJSON, &addedAt, &updatedAt); err != nil {
				continue
			}
			var tags []string
			if tagsJSON != "" {
				_ = json.Unmarshal([]byte(tagsJSON), &tags)
			}

			var yearPtr *int
			if year.Valid && year.Int64 > 0 {
				y := int(year.Int64)
				yearPtr = &y
			}

			out = append(out, WantedMovie{
				ID:             fmt.Sprintf("movie-%d", id),
				TmdbID:         tmdbID,
				Title:          title,
				Year:           yearPtr,
				MediaType:      "movie",
				RootFolder:     rootFolder,
				QualityProfile: qualityProfile,
				MonitorPolicy:  monitorPolicy,
				Tags:           tags,
				CreatedAt:      time.Unix(addedAt, 0).UTC().Format(time.RFC3339),
				UpdatedAt:      time.Unix(updatedAt, 0).UTC().Format(time.RFC3339),
			})
		}

		if err := rows.Err(); err != nil {
			logger.Error("Error iterating wanted movies: %v", err)
			http.Error(w, "Failed to enumerate wanted movies", http.StatusInternalServerError)
			return
		}

		writePagedJSON(w, out, totalCount)
		return
	}

	// Default: TV episodes
	// If a resolution is provided, return episodes that are missing THAT resolution
	// (even if another quality exists), matching the per-quality stats in logs.
	showHasResolution := ""
	episodeMissingResolution := `
          AND NOT EXISTS (
            SELECT 1
            FROM processed_files p
            WHERE p.episode_id = e.id
              AND p.destination_path IS NOT NULL AND p.destination_path != ''
              AND (p.reason IS NULL OR p.reason = '')
          )`
	qualityProfileExpr := "COALESCE(li.quality_profile, pf.quality, '')"

	switch resolution {
	case "2160p":
		qualityProfileExpr = "'2160p'"
		showHasResolution = `
          AND EXISTS (
            SELECT 1
            FROM processed_files q
            WHERE q.show_id = e.show_id
              AND q.destination_path IS NOT NULL AND q.destination_path != ''
              AND (
                LOWER(COALESCE(q.quality, '')) LIKE '%2160%'
                OR LOWER(COALESCE(q.quality, '')) LIKE '%4k%'
                OR LOWER(COALESCE(q.quality, '')) LIKE '%uhd%'
              )
          )`
		episodeMissingResolution = `
          AND NOT EXISTS (
            SELECT 1
            FROM processed_files p
            WHERE p.episode_id = e.id
              AND p.destination_path IS NOT NULL AND p.destination_path != ''
              AND (p.reason IS NULL OR p.reason = '')
              AND (
                LOWER(COALESCE(p.quality, '')) LIKE '%2160%'
                OR LOWER(COALESCE(p.quality, '')) LIKE '%4k%'
                OR LOWER(COALESCE(p.quality, '')) LIKE '%uhd%'
              )
          )`
	case "1080p":
		qualityProfileExpr = "'1080p'"
		showHasResolution = `
          AND EXISTS (
            SELECT 1
            FROM processed_files q
            WHERE q.show_id = e.show_id
              AND q.destination_path IS NOT NULL AND q.destination_path != ''
              AND LOWER(COALESCE(q.quality, '')) LIKE '%1080%'
          )`
		episodeMissingResolution = `
          AND NOT EXISTS (
            SELECT 1
            FROM processed_files p
            WHERE p.episode_id = e.id
              AND p.destination_path IS NOT NULL AND p.destination_path != ''
              AND (p.reason IS NULL OR p.reason = '')
              AND LOWER(COALESCE(p.quality, '')) LIKE '%1080%'
          )`
	case "720p":
		qualityProfileExpr = "'720p'"
		showHasResolution = `
          AND EXISTS (
            SELECT 1
            FROM processed_files q
            WHERE q.show_id = e.show_id
              AND q.destination_path IS NOT NULL AND q.destination_path != ''
              AND LOWER(COALESCE(q.quality, '')) LIKE '%720%'
          )`
		episodeMissingResolution = `
          AND NOT EXISTS (
            SELECT 1
            FROM processed_files p
            WHERE p.episode_id = e.id
              AND p.destination_path IS NOT NULL AND p.destination_path != ''
              AND (p.reason IS NULL OR p.reason = '')
              AND LOWER(COALESCE(p.quality, '')) LIKE '%720%'
          )`
	case "480p":
		qualityProfileExpr = "'480p'"
		showHasResolution = `
          AND EXISTS (
            SELECT 1
            FROM processed_files q
            WHERE q.show_id = e.show_id
              AND q.destination_path IS NOT NULL AND q.destination_path != ''
              AND LOWER(COALESCE(q.quality, '')) LIKE '%480%'
          )`
		episodeMissingResolution = `
          AND NOT EXISTS (
            SELECT 1
            FROM processed_files p
            WHERE p.episode_id = e.id
              AND p.destination_path IS NOT NULL AND p.destination_path != ''
              AND (p.reason IS NULL OR p.reason = '')
              AND LOWER(COALESCE(p.quality, '')) LIKE '%480%'
          )`
	}

	baseQuery := fmt.Sprintf(`
        SELECT
          sh.tmdb_id,
          COALESCE(sh.proper_name, '') AS title,
          COALESCE(sh.year, '')        AS year_str,
          COALESCE(pf.root_folder, '') AS root_folder,
          %s AS quality_profile,
          e.season_number,
          e.episode_number,
          COALESCE(e.title, '')        AS episode_title,
          COALESCE(e.air_date, '')     AS air_date
        FROM episodes e
        JOIN tv_shows sh ON sh.id = e.show_id
        LEFT JOIN (
          SELECT show_id, MIN(root_folder) AS root_folder, MIN(quality) AS quality
          FROM processed_files
          WHERE destination_path IS NOT NULL AND destination_path != ''
          GROUP BY show_id
        ) pf ON pf.show_id = e.show_id
        LEFT JOIN library_items li
          ON li.tmdb_id = sh.tmdb_id
          AND li.media_type = 'tv'
        WHERE (e.air_date IS NULL OR e.air_date <= date('now'))
          AND sh.tmdb_id IS NOT NULL%s%s
        `, qualityProfileExpr, showHasResolution, episodeMissingResolution)
	orderBy := " ORDER BY e.air_date DESC, sh.proper_name, e.season_number, e.episode_number"
	// Count total wanted episodes
	countQuery := "SELECT COUNT(1) FROM (" + baseQuery + ") AS sub"
	var totalCount int
	if err := mediaHubDB.QueryRow(countQuery).Scan(&totalCount); err != nil {
		logger.Warn("Failed to count wanted episodes: %v", err)
		totalCount = 0
	}

	limit, offset := parseLimitOffset(r)
	query := baseQuery + orderBy
	args := []interface{}{}
	if limit > 0 {
		query += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
	}

	rows, err := mediaHubDB.Query(query, args...)
	if err != nil {
		logger.Error("Failed to query wanted episodes: %v", err)
		http.Error(w, "Failed to query wanted episodes", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var out []WantedEpisode
	for rows.Next() {
		var (
			tmdbID         int
			title          string
			yearStr        string
			rootFolder     string
			qualityProfile string
			seasonNumber   int
			episodeNumber  int
			episodeTitle   string
			airDate        string
		)
		if err := rows.Scan(&tmdbID, &title, &yearStr, &rootFolder, &qualityProfile, &seasonNumber, &episodeNumber, &episodeTitle, &airDate); err != nil {
			continue
		}

		var yearPtr *int
		if yearStr != "" {
			if y, err := strconv.Atoi(yearStr); err == nil && y > 0 {
				yearPtr = &y
			}
		}

		id := fmt.Sprintf("%d-%d-%d", tmdbID, seasonNumber, episodeNumber)
		epCode := fmt.Sprintf("%dx%02d", seasonNumber, episodeNumber)

		out = append(out, WantedEpisode{
			ID:             id,
			TmdbID:         tmdbID,
			Title:          title,
			Year:           yearPtr,
			MediaType:      "tv",
			RootFolder:     rootFolder,
			QualityProfile: qualityProfile,
			SeasonNumber:   seasonNumber,
			EpisodeNumber:  episodeNumber,
			Episode:        epCode,
			EpisodeTitle:   episodeTitle,
			AirDate:        airDate,
		})
	}

	if err := rows.Err(); err != nil {
		logger.Error("Error iterating wanted episodes: %v", err)
		http.Error(w, "Failed to enumerate wanted episodes", http.StatusInternalServerError)
		return
	}

	writePagedJSON(w, out, totalCount)
}

// fetchAndSaveMediaCover fetches TMDB data and saves poster/fanart
func fetchAndSaveMediaCover(tmdbID int, mediaType string) error {
	return media.FetchAndSave(tmdbID, mediaType)
}

// upsertPlaceholderProcessedFile inserts or updates a minimal processed_files row
func upsertPlaceholderProcessedFile(tmdbID int, mediaType, title string, yearPtr *int) error {
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
	// processed_at
	_, _ = mediaHubDB.Exec(`UPDATE processed_files SET processed_at = COALESCE(processed_at, datetime('now')) WHERE tmdb_id = ? AND (processed_at IS NULL OR processed_at = '')`, tmdbStr)

	return nil
}

// fetchTmdbDetails retrieves rich TMDB metadata for writing into processed_files
func fetchTmdbDetails(tmdbID int, mediaType string) map[string]string {
	details := make(map[string]string)
	apiKey := getTmdbApiKey()
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
	if v, ok := data["overview"].(string); ok {
		details["overview"] = v
	}
	if v, ok := data["status"].(string); ok {
		details["status"] = v
	}
	if v, ok := data["original_language"].(string); ok {
		details["original_language"] = v
	}
	// Genres -> comma-separated names
	if arr, ok := data["genres"].([]interface{}); ok {
		names := make([]string, 0)
		for _, g := range arr {
			if m, ok := g.(map[string]interface{}); ok {
				if n, ok := m["name"].(string); ok {
					names = append(names, n)
				}
			}
		}
		if len(names) > 0 {
			details["genres"] = strings.Join(names, ", ")
		}
	}

	if mediaType == "movie" {
		if v, ok := data["title"].(string); ok {
			details["proper_name"] = v
		}
		if v, ok := data["original_title"].(string); ok {
			details["original_title"] = v
		}
		if v, ok := data["release_date"].(string); ok {
			details["release_date"] = v
		}
		if n, ok := data["runtime"].(float64); ok {
			details["runtime"] = fmt.Sprintf("%d", int(n))
		}
		if v, ok := data["imdb_id"].(string); ok {
			details["imdb_id"] = v
		}
		if y, ok := data["release_date"].(string); ok && len(y) >= 4 {
			details["year"] = y[:4]
		}
	} else {
		if v, ok := data["name"].(string); ok {
			details["proper_name"] = v
		}
		if v, ok := data["original_name"].(string); ok {
			details["original_title"] = v
		}
		if v, ok := data["first_air_date"].(string); ok {
			details["first_air_date"] = v
		}
		if v, ok := data["last_air_date"].(string); ok {
			details["last_air_date"] = v
		}
		if arr, ok := data["episode_run_time"].([]interface{}); ok && len(arr) > 0 {
			if n, ok := arr[0].(float64); ok {
				details["runtime"] = fmt.Sprintf("%d", int(n))
			}
		}
		if n, ok := data["number_of_episodes"].(float64); ok {
			details["total_episodes"] = fmt.Sprintf("%d", int(n))
		}
		if y, ok := data["first_air_date"].(string); ok && len(y) >= 4 {
			details["year"] = y[:4]
		}
	}

	return details
}

// upsertProcessedWithDetails writes fields available from TMDB into processed_files.
func upsertProcessedWithDetails(tmdbID int, mediaType string, basicTitle string, yearPtr *int, rootFolder string, preferredLanguage string) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return
	}
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
	if rootFolder != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET root_folder = ? WHERE tmdb_id = ?`, rootFolder, tmdbStr)
	}
	if strings.TrimSpace(preferredLanguage) != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET language = ? WHERE tmdb_id = ?`, strings.TrimSpace(preferredLanguage), tmdbStr)
	}
	_, _ = mediaHubDB.Exec(`UPDATE processed_files SET processed_at = COALESCE(processed_at, datetime('now')) WHERE tmdb_id = ? AND (processed_at IS NULL OR processed_at = '')`, tmdbStr)

	// Rich details
	details := fetchTmdbDetails(tmdbID, mediaType)
	if v := details["proper_name"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET proper_name = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["year"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET year = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["imdb_id"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET imdb_id = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["overview"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET overview = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["runtime"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET runtime = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["original_title"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET original_title = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["status"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET status = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["release_date"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET release_date = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["first_air_date"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET first_air_date = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["last_air_date"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET last_air_date = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["genres"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET genres = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["original_language"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET original_language = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
	if v := details["total_episodes"]; v != "" {
		_, _ = mediaHubDB.Exec(`UPDATE processed_files SET total_episodes = ? WHERE tmdb_id = ?`, v, tmdbStr)
	}
}

func getPreferredLanguageFromQualityProfile(mediaType, profileName string) string {
	if strings.TrimSpace(profileName) == "" {
		return ""
	}
	database, err := db.GetDatabaseConnection()
	if err != nil {
		return ""
	}

	var languageName string
	err = database.QueryRow(
		`SELECT COALESCE(language_name, '') FROM quality_profiles WHERE media_type = ? AND name = ? LIMIT 1`,
		strings.ToLower(strings.TrimSpace(mediaType)),
		strings.TrimSpace(profileName),
	).Scan(&languageName)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(languageName)
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
	if err := InitLibraryTable(); err != nil {
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

	preferredLanguage := getPreferredLanguageFromQualityProfile("movie", req.QualityProfile)
	go func(tmdbID int, title string, yearPtr *int, rootFolder string, preferredLanguage string) {
		upsertProcessedWithDetails(tmdbID, "movie", title, yearPtr, rootFolder, preferredLanguage)
	}(req.TmdbID, req.Title, req.Year, req.RootFolder, preferredLanguage)

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
	if err := InitLibraryTable(); err != nil {
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
	preferredLanguage := getPreferredLanguageFromQualityProfile("tv", req.QualityProfile)
	go func(tmdbID int, title string, yearPtr *int, rootFolder string, preferredLanguage string) {
		upsertProcessedWithDetails(tmdbID, "tv", title, yearPtr, rootFolder, preferredLanguage)
	}(req.TmdbID, req.Title, req.Year, req.RootFolder, preferredLanguage)

	// Populate tv_shows / tv_seasons / episodes from TMDB
	go func(tmdbID int) {
		time.Sleep(2 * time.Second)
		if err := populateTvShowMetadata(tmdbID); err != nil {
			logger.Warn("Failed to populate TV show metadata for TMDB ID %d: %v", tmdbID, err)
		}
	}(req.TmdbID)

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
	if err := InitLibraryTable(); err != nil {
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
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	tmdbIDFilter := r.URL.Query().Get("tmdbId")

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

	if tmdbIDFilter != "" {
		query += " AND tmdb_id = ?"
		args = append(args, tmdbIDFilter)
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

func applyTitleQueryFilter(sql string, columnExpr string, rawQuery string) (string, []any) {
	q := strings.TrimSpace(rawQuery)
	if q == "" {
		return strings.ReplaceAll(sql, "{{QUERY_FILTER}}", ""), nil
	}
	like := "%" + strings.ToLower(q) + "%"
	sql = strings.ReplaceAll(sql, "{{QUERY_FILTER}}", fmt.Sprintf("AND LOWER(%s) LIKE ?", columnExpr))
	return sql, []any{like}
}

// getMoviesFromProcessedFiles returns movies
func getMoviesFromProcessedFiles(limit, offset int, query string, missingOnly bool) ([]LibraryItemFromDB, int, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}

	// Get total count
	var totalCount int
	countQuery := `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM processed_files
			WHERE UPPER(media_type) = 'MOVIE'
			AND proper_name IS NOT NULL AND proper_name != ''
			{{QUERY_FILTER}}
			{{MISSING_FILTER}}
			GROUP BY proper_name, year, tmdb_id
		) AS sub`
	countQuery, countArgs := applyTitleQueryFilter(countQuery, "proper_name", query)
	missingFilter := ""
	if missingOnly {
		missingFilter = "AND (destination_path IS NULL OR destination_path = '')"
	}
	countQuery = strings.ReplaceAll(countQuery, "{{MISSING_FILTER}}", missingFilter)
	if err := mediaHubDB.QueryRow(countQuery, countArgs...).Scan(&totalCount); err != nil {
		return nil, 0, err
	}

	sqlQuery := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, '0') as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(root_folder, '') as root_folder,
			MAX(processed_at) as latest_processed_at,
			COALESCE(quality, '') as quality,
			COALESCE(overview, '') as overview
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND proper_name IS NOT NULL
		AND proper_name != ''
		{{QUERY_FILTER}}
		{{MISSING_FILTER}}
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT ? OFFSET ?`

	sqlQuery, args := applyTitleQueryFilter(sqlQuery, "proper_name", query)
	sqlQuery = strings.ReplaceAll(sqlQuery, "{{MISSING_FILTER}}", missingFilter)
	args = append(args, limit, offset)

	rows, err := mediaHubDB.Query(sqlQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []LibraryItemFromDB
	for rows.Next() {
		var properName, tmdbIDStr, destPath, rootFolder, latestProcessedAt, quality, overview string
		var yearStr string
		if err := rows.Scan(&properName, &yearStr, &tmdbIDStr, &destPath, &rootFolder, &latestProcessedAt, &quality, &overview); err != nil {
			continue
		}
		tmdbID, _ := strconv.Atoi(tmdbIDStr)
		if tmdbID == 0 {
			continue
		}
		yearInt, _ := strconv.Atoi(yearStr)
		var yearPtr *int
		if yearInt > 0 {
			yearPtr = &yearInt
		}
		addedAt := int64(0)
		if t, err := time.Parse(time.RFC3339, latestProcessedAt); err == nil {
			addedAt = t.Unix()
		} else if t, err := time.Parse("2006-01-02 15:04:05", latestProcessedAt); err == nil {
			addedAt = t.Unix()
		}
		movieStatus := "imported"
		if destPath == "" {
			movieStatus = "missing"
		}
		items = append(items, LibraryItemFromDB{
			ID:              tmdbID,
			TmdbID:          tmdbID,
			Title:           properName,
			Year:            yearPtr,
			MediaType:       "movie",
			RootFolder:      rootFolder,
			QualityProfile:  quality,
			MonitorPolicy:   "any",
			Tags:            "[]",
			Status:          movieStatus,
			AddedAt:         addedAt,
			UpdatedAt:       addedAt,
			PosterPath:      fmt.Sprintf("/MediaCover/%d/poster.jpg", tmdbID),
			Overview:        overview,
			Quality:         quality,
			DestinationPath: destPath,
		})
	}
	return items, totalCount, rows.Err()
}

// getSeriesFromProcessedFiles returns TV series
func getSeriesFromProcessedFiles(limit, offset int, query string) ([]LibraryItemFromDB, int, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, 0, err
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}

	var totalCount int
	countQuery := `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM processed_files
			WHERE (UPPER(media_type) = 'TV' OR UPPER(media_type) = 'EPISODE' OR media_type LIKE '%TV%' OR media_type LIKE '%SHOW%')
			AND proper_name IS NOT NULL AND proper_name != ''
			{{QUERY_FILTER}}
			GROUP BY proper_name, year, tmdb_id
		) AS sub`
	countQuery, countArgs := applyTitleQueryFilter(countQuery, "proper_name", query)
	if err := mediaHubDB.QueryRow(countQuery, countArgs...).Scan(&totalCount); err != nil {
		return nil, 0, err
	}

	sqlQuery := `
		SELECT
			COALESCE(pf.proper_name, '') as proper_name,
			COALESCE(pf.year, '0') as year,
			COALESCE(pf.tmdb_id, '') as tmdb_id,
			COALESCE(MIN(pf.destination_path), '') as destination_path,
			COALESCE(MIN(pf.root_folder), '') as root_folder,
			MAX(pf.processed_at) as latest_processed_at,
			COALESCE((
				SELECT GROUP_CONCAT(DISTINCT q.res_bucket)
				FROM (
					SELECT
						CASE
							WHEN LOWER(COALESCE(pq.quality, '')) LIKE '%2160%' OR LOWER(COALESCE(pq.quality, '')) LIKE '%4k%' OR LOWER(COALESCE(pq.quality, '')) LIKE '%uhd%' THEN '2160p'
							WHEN LOWER(COALESCE(pq.quality, '')) LIKE '%1080%' THEN '1080p'
							WHEN LOWER(COALESCE(pq.quality, '')) LIKE '%720%' THEN '720p'
							WHEN LOWER(COALESCE(pq.quality, '')) LIKE '%480%' THEN '480p'
							ELSE NULL
						END AS res_bucket
					FROM processed_files pq
					WHERE pq.show_id = pf.show_id
					  AND pq.destination_path IS NOT NULL AND pq.destination_path != ''
				) q
				WHERE q.res_bucket IS NOT NULL
			), '') AS quality,
			COALESCE(MAX(pf.overview), '') as overview,
			COALESCE((
				SELECT COUNT(1)
				FROM episodes e
				WHERE e.show_id = pf.show_id
				  AND (e.air_date IS NULL OR e.air_date <= date('now'))
			), 0) AS total_aired,
			COALESCE((
				SELECT COUNT(DISTINCT p2.episode_id)
				FROM processed_files p2
				WHERE p2.show_id = pf.show_id
				  AND p2.episode_id IS NOT NULL
				  AND p2.destination_path IS NOT NULL AND p2.destination_path != ''
				  AND (p2.reason IS NULL OR p2.reason = '')
			), 0) AS imported_eps
		FROM processed_files pf
		WHERE (UPPER(pf.media_type) = 'TV' OR UPPER(pf.media_type) = 'EPISODE' OR pf.media_type LIKE '%TV%' OR pf.media_type LIKE '%SHOW%')
		  AND pf.proper_name IS NOT NULL
		  AND pf.proper_name != ''
		  {{QUERY_FILTER}}
		GROUP BY pf.proper_name, pf.year, pf.tmdb_id
		ORDER BY proper_name, year
		LIMIT ? OFFSET ?`

	sqlQuery, args := applyTitleQueryFilter(sqlQuery, "pf.proper_name", query)
	args = append(args, limit, offset)

	rows, err := mediaHubDB.Query(sqlQuery, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var items []LibraryItemFromDB
	for rows.Next() {
		var properName, tmdbIDStr, destPath, rootFolder, latestProcessedAt, quality, overview string
		var yearStr string
		var totalAired, importedEps int
		if err := rows.Scan(&properName, &yearStr, &tmdbIDStr, &destPath, &rootFolder, &latestProcessedAt, &quality, &overview, &totalAired, &importedEps); err != nil {
			continue
		}
		tmdbID, _ := strconv.Atoi(tmdbIDStr)
		if tmdbID == 0 {
			continue
		}
		yearInt, _ := strconv.Atoi(yearStr)
		var yearPtr *int
		if yearInt > 0 {
			yearPtr = &yearInt
		}
		addedAt := int64(0)
		if t, err := time.Parse(time.RFC3339, latestProcessedAt); err == nil {
			addedAt = t.Unix()
		} else if t, err := time.Parse("2006-01-02 15:04:05", latestProcessedAt); err == nil {
			addedAt = t.Unix()
		}
		status := "imported"
		if destPath == "" || (totalAired > 0 && importedEps < totalAired) {
			status = "missing"
		}

		items = append(items, LibraryItemFromDB{
			ID:              tmdbID,
			TmdbID:          tmdbID,
			Title:           properName,
			Year:            yearPtr,
			MediaType:       "tv",
			RootFolder:      rootFolder,
			QualityProfile:  quality,
			MonitorPolicy:   "any",
			Tags:            "[]",
			Status:          status,
			AddedAt:         addedAt,
			UpdatedAt:       addedAt,
			PosterPath:      fmt.Sprintf("/MediaCover/%d/poster.jpg", tmdbID),
			Overview:        overview,
			Quality:         quality,
			DestinationPath: destPath,
		})
	}
	return items, totalCount, rows.Err()
}

// parseLimitOffset parses limit and offset from query params.
func parseLimitOffset(r *http.Request) (limit, offset int) {
	const maxLimit = 1000

	limit = 0
	offset = 0

	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > maxLimit {
				limit = maxLimit
			} else {
				limit = n
			}
		}
	}

	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}

	return limit, offset
}

// HandleGetLibraryMovies handles GET /api/library/movie
func HandleGetLibraryMovies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit, offset := parseLimitOffset(r)
	q := r.URL.Query().Get("query")
	missingOnly := r.URL.Query().Get("status") == "missing"
	items, totalCount, err := getMoviesFromProcessedFiles(limit, offset, q, missingOnly)
	if err != nil {
		logger.Error("Failed to get movies from database: %v", err)
		http.Error(w, "Failed to get movies", http.StatusInternalServerError)
		return
	}

	writePagedJSON(w, items, totalCount)
}

// HandleGetLibraryTv handles GET /api/library/tv
func HandleGetLibraryTv(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit, offset := parseLimitOffset(r)
	q := r.URL.Query().Get("query")
	items, totalCount, err := getSeriesFromProcessedFiles(limit, offset, q)
	if err != nil {
		logger.Error("Failed to get series from database: %v", err)
		http.Error(w, "Failed to get series", http.StatusInternalServerError)
		return
	}

	writePagedJSON(w, items, totalCount)
}

// HandleUpdateLibraryItem handles PUT /api/library/{id}
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
