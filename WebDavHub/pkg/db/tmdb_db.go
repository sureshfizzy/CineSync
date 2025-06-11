package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	_ "modernc.org/sqlite"
	"cinesync/pkg/logger"
)

var db *sql.DB
var tmdbCacheWriteQueue chan tmdbCacheWriteReq

const MAX_TMDB_CACHE_ENTRIES = 5000

type tmdbCacheWriteReq struct {
	query  string
	result string
}

func StartTmdbCacheWriter() {
	tmdbCacheWriteQueue = make(chan tmdbCacheWriteReq, 100)
	go func() {
		for req := range tmdbCacheWriteQueue {
			for i := 0; i < 5; i++ { // retry up to 5 times
				err := upsertTmdbCacheDirect(req.query, req.result)
				if err == nil {
					break
				}
				if strings.Contains(err.Error(), "database is locked") {
					time.Sleep(100 * time.Millisecond)
					continue
				}
				fmt.Printf("TMDB cache write error: %v\n", err)
				break
			}
		}
	}()
}

// InitDB initializes the SQLite database under the project directory (data/cinefiles.db)
func InitDB(_ string) error {
	dbDir := filepath.Join("../db")
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create db directory: %w", err)
	}
	dbPath := filepath.Join(dbDir, "cinesync.db")
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open db: %w", err)
	}
	// Set WAL mode and busy timeout
	if _, err := db.Exec("PRAGMA journal_mode=WAL;"); err != nil {
		return fmt.Errorf("failed to set WAL mode: %w", err)
	}
	if _, err := db.Exec("PRAGMA busy_timeout = 5000;"); err != nil {
		return fmt.Errorf("failed to set busy timeout: %w", err)
	}
	if _, err := db.Exec("PRAGMA auto_vacuum = FULL;"); err != nil {
		return fmt.Errorf("failed to set auto_vacuum: %w", err)
	}
	if _, err := db.Exec("PRAGMA page_size = 4096;"); err != nil {
		return fmt.Errorf("failed to set page_size: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	StartTmdbCacheWriter()
	return createTable()
}

func createTable() error {
	query := `CREATE TABLE IF NOT EXISTS file_details (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT UNIQUE,
		name TEXT,
		type TEXT,
		size TEXT,
		modified TEXT,
		icon TEXT,
		extra TEXT
	);`
	if _, err := db.Exec(query); err != nil {
		return err
	}

	// Create recent_media table
	recentMediaQuery := `CREATE TABLE IF NOT EXISTS recent_media (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		folder_name TEXT NOT NULL,
		updated_at INTEGER NOT NULL,
		type TEXT NOT NULL,
		tmdb_id TEXT,
		show_name TEXT,
		season_number INTEGER,
		episode_number INTEGER,
		episode_title TEXT,
		filename TEXT,
		created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
	);`
	if _, err := db.Exec(recentMediaQuery); err != nil {
		return err
	}

	// Create index for faster queries
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_recent_media_created_at ON recent_media(created_at DESC);`)

	return nil
}

// FileDetail represents a row in the file_details table
// (matches FileInfo, with extra for custom metadata)
type FileDetail struct {
	Path     string
	Name     string
	Type     string
	Size     string
	Modified string
	Icon     string
	Extra    string // JSON or plain text for extensibility
}

// Insert or update a file detail
func UpsertFileDetail(fd FileDetail) error {
	query := `INSERT INTO file_details (path, name, type, size, modified, icon, extra)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			name=excluded.name, type=excluded.type, size=excluded.size, modified=excluded.modified, icon=excluded.icon, extra=excluded.extra;`
	_, err := db.Exec(query, fd.Path, fd.Name, fd.Type, fd.Size, fd.Modified, fd.Icon, fd.Extra)
	return err
}

// Get file detail by path
func GetFileDetail(path string) (*FileDetail, error) {
	query := `SELECT path, name, type, size, modified, icon, extra FROM file_details WHERE path = ?;`
	row := db.QueryRow(query, path)
	var fd FileDetail
	err := row.Scan(&fd.Path, &fd.Name, &fd.Type, &fd.Size, &fd.Modified, &fd.Icon, &fd.Extra)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &fd, nil
}

// List all file details (optionally filter by prefix)
func ListFileDetails(prefix string) ([]FileDetail, error) {
	query := `SELECT path, name, type, size, modified, icon, extra FROM file_details WHERE path LIKE ?;`
	rows, err := db.Query(query, prefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var results []FileDetail
	for rows.Next() {
		var fd FileDetail
		if err := rows.Scan(&fd.Path, &fd.Name, &fd.Type, &fd.Size, &fd.Modified, &fd.Icon, &fd.Extra); err != nil {
			return nil, err
		}
		results = append(results, fd)
	}
	return results, nil
}

// Delete file detail by path
func DeleteFileDetail(path string) error {
	query := `DELETE FROM file_details WHERE path = ?;`
	_, err := db.Exec(query, path)
	return err
}

// --- TMDB Cache ---

// InitTmdbCacheTable initializes the new two-table TMDB cache schema.
// It drops the old tmdb_cache table if it exists.
func InitTmdbCacheTable() error {
	// Drop the old single tmdb_cache table if it exists to avoid conflicts and ensure clean schema.
	// Errors during drop are ignored as the table might not exist.
	_, _ = db.Exec(`DROP TABLE IF EXISTS tmdb_cache;`)

	// Create tmdb_entities table to store unique TMDB entity data
	queryEntities := `CREATE TABLE IF NOT EXISTS tmdb_entities (
		tmdb_id INTEGER NOT NULL,
		media_type TEXT NOT NULL,
		title TEXT,
		poster_path TEXT,
		year TEXT, -- Stores release_date string, frontend parses year
		local_poster_path TEXT, -- Path to locally cached poster image
		poster_cached_at INTEGER, -- Unix timestamp when poster was cached
		last_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now')), -- Unix timestamp of last update
		PRIMARY KEY (tmdb_id, media_type)
	);`
	if _, err := db.Exec(queryEntities); err != nil {
		return fmt.Errorf("failed to create tmdb_entities table: %w", err)
	}

	// Add new columns to existing tmdb_entities table if they don't exist (migration)
	_, _ = db.Exec(`ALTER TABLE tmdb_entities ADD COLUMN local_poster_path TEXT;`)
	_, _ = db.Exec(`ALTER TABLE tmdb_entities ADD COLUMN poster_cached_at INTEGER;`)

	// Create tmdb_cache_keys table to map cache_key lookups to entities
	queryCacheKeys := `CREATE TABLE IF NOT EXISTS tmdb_cache_keys (
		cache_key TEXT PRIMARY KEY NOT NULL,
		tmdb_id INTEGER NOT NULL,
		media_type TEXT NOT NULL,
		last_accessed INTEGER NOT NULL DEFAULT (strftime('%s', 'now')), -- Unix timestamp of last access
		FOREIGN KEY (tmdb_id, media_type) REFERENCES tmdb_entities(tmdb_id, media_type) ON DELETE CASCADE ON UPDATE CASCADE
	);`
	if _, err := db.Exec(queryCacheKeys); err != nil {
		return fmt.Errorf("failed to create tmdb_cache_keys table: %w", err)
	}

	// Create index for faster lookups
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_tmdb_cache_keys_tmdb ON tmdb_cache_keys(tmdb_id, media_type);`)

	return nil
}

type TmdbEntity struct {
	TmdbID     int
	MediaType  string
	Title      string
	PosterPath string
	Year       string // Represents release_date
}

func GetTmdbCache(cacheKey string) (string, error) {
	query := `
		SELECT e.tmdb_id, e.media_type, e.title, e.poster_path, e.year
		FROM tmdb_cache_keys k
		JOIN tmdb_entities e ON k.tmdb_id = e.tmdb_id AND k.media_type = e.media_type
		WHERE k.cache_key = ?;
	`
	row := db.QueryRow(query, cacheKey)
	var entity TmdbEntity
	err := row.Scan(&entity.TmdbID, &entity.MediaType, &entity.Title, &entity.PosterPath, &entity.Year)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to scan tmdb cache data: %w", err)
	}

	jsonStr := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
		entity.TmdbID, entity.Title, entity.PosterPath, entity.Year, entity.MediaType)
	return jsonStr, nil
}

func upsertTmdbCacheDirect(cacheKey, result string) error {
	var entryData struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		PosterPath  string `json:"poster_path"`
		ReleaseDate string `json:"release_date"`
		MediaType   string `json:"media_type"`
	}
	err := json.Unmarshal([]byte(result), &entryData)
	if err != nil {
		return fmt.Errorf("failed to parse TMDB cache JSON for upsert: %w", err)
	}

	// Validate MediaType: must be 'movie' or 'tv'
	if entryData.MediaType != "movie" && entryData.MediaType != "tv" {
		return fmt.Errorf("invalid media_type for TMDB cache upsert: '%s'. Must be 'movie' or 'tv'", entryData.MediaType)
	}

	// Check cache size and cleanup if needed before adding new entries
	if err := cleanupTmdbCacheIfNeeded(); err != nil {
		fmt.Printf("Warning: TMDB cache cleanup failed: %v\n", err)
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction for tmdb cache upsert: %w", err)
	}
	defer tx.Rollback()

	// Check if the cache key exists and points to a different TMDB ID
	var existingTmdbID int
	var existingMediaType string
	err = tx.QueryRow(`SELECT tmdb_id, media_type FROM tmdb_cache_keys WHERE cache_key = ?`, cacheKey).Scan(&existingTmdbID, &existingMediaType)
	if err == nil && (existingTmdbID != entryData.ID || existingMediaType != entryData.MediaType) {
		// Cache key exists but points to different TMDB ID - delete old mapping
		_, err = tx.Exec(`DELETE FROM tmdb_cache_keys WHERE cache_key = ?`, cacheKey)
		if err != nil {
			return fmt.Errorf("failed to delete old cache key mapping: %w", err)
		}
	}

	// Upsert into tmdb_entities with timestamp
	_, err = tx.Exec(`
		INSERT INTO tmdb_entities (tmdb_id, media_type, title, poster_path, year, last_updated)
		VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
		ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
			title=excluded.title,
			poster_path=excluded.poster_path,
			year=excluded.year,
			last_updated=excluded.last_updated;
	`, entryData.ID, entryData.MediaType, entryData.Title, entryData.PosterPath, entryData.ReleaseDate)
	if err != nil {
		return fmt.Errorf("failed to upsert into tmdb_entities: %w", err)
	}

	// Upsert into tmdb_cache_keys with timestamp
	_, err = tx.Exec(`
		INSERT INTO tmdb_cache_keys (cache_key, tmdb_id, media_type, last_accessed)
		VALUES (?, ?, ?, strftime('%s', 'now'))
		ON CONFLICT(cache_key) DO UPDATE SET
			tmdb_id=excluded.tmdb_id,
			media_type=excluded.media_type,
			last_accessed=excluded.last_accessed;
	`, cacheKey, entryData.ID, entryData.MediaType)
	if err != nil {
		return fmt.Errorf("failed to upsert into tmdb_cache_keys: %w", err)
	}

	return tx.Commit()
}

// UpsertTmdbCache stores or updates a TMDB cache entry (async, robust)
func UpsertTmdbCache(cacheKey, result string) error {
	tmdbCacheWriteQueue <- tmdbCacheWriteReq{query: cacheKey, result: result}
	return nil // always return nil, as write is async
}

// GetTmdbCacheByTmdbIdAndType returns the first cache entry for a given tmdb_id and media_type
func GetTmdbCacheByTmdbIdAndType(tmdbIDStr, mediaType string) (string, error) {
	tmdbID, err := strconv.Atoi(tmdbIDStr)
	if err != nil {
		return "", fmt.Errorf("invalid tmdbID format: %w", err)
	}

	query := `SELECT tmdb_id, media_type, title, poster_path, year FROM tmdb_entities WHERE tmdb_id = ? AND media_type = ?;`
	row := db.QueryRow(query, tmdbID, mediaType)
	var entity TmdbEntity
	err = row.Scan(&entity.TmdbID, &entity.MediaType, &entity.Title, &entity.PosterPath, &entity.Year)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("failed to scan tmdb entity data: %w", err)
	}

	jsonStr := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
		entity.TmdbID, entity.Title, entity.PosterPath, entity.Year, entity.MediaType)
	return jsonStr, nil
}

// cleanupTmdbCacheIfNeeded removes old cache entries if the cache exceeds the size limit
func cleanupTmdbCacheIfNeeded() error {
	// Count current cache entries
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM tmdb_cache_keys`).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to count cache entries: %w", err)
	}

	// If under limit, no cleanup needed
	if count <= MAX_TMDB_CACHE_ENTRIES {
		return nil
	}

	// Remove oldest 20% of entries to make room for new ones
	entriesToRemove := count / 5
	if entriesToRemove < 100 {
		entriesToRemove = 100 // Remove at least 100 entries
	}

	// Delete oldest entries based on last_accessed timestamp
	_, err = db.Exec(`
		DELETE FROM tmdb_cache_keys
		WHERE cache_key IN (
			SELECT cache_key FROM tmdb_cache_keys
			ORDER BY last_accessed ASC
			LIMIT ?
		)
	`, entriesToRemove)

	if err != nil {
		return fmt.Errorf("failed to cleanup old cache entries: %w", err)
	}

	// Clean up orphaned entities (entities with no cache keys pointing to them)
	_, err = db.Exec(`
		DELETE FROM tmdb_entities
		WHERE NOT EXISTS (
			SELECT 1 FROM tmdb_cache_keys k
			WHERE k.tmdb_id = tmdb_entities.tmdb_id
			AND k.media_type = tmdb_entities.media_type
		)
	`)

	if err != nil {
		return fmt.Errorf("failed to cleanup orphaned entities: %w", err)
	}

	fmt.Printf("TMDB cache cleanup: removed %d old entries\n", entriesToRemove)
	return nil
}

// ClearTmdbCache removes all TMDB cache entries
func ClearTmdbCache() error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction for cache clear: %w", err)
	}
	defer tx.Rollback()

	_, err = tx.Exec(`DELETE FROM tmdb_cache_keys`)
	if err != nil {
		return fmt.Errorf("failed to clear cache keys: %w", err)
	}

	_, err = tx.Exec(`DELETE FROM tmdb_entities`)
	if err != nil {
		return fmt.Errorf("failed to clear entities: %w", err)
	}

	return tx.Commit()
}

// DB returns the global *sql.DB instance
func DB() *sql.DB {
	return db
}

// RecentMedia represents a recent media item
type RecentMedia struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	FolderName    string `json:"folderName"`
	UpdatedAt     int64  `json:"updatedAt"`
	Type          string `json:"type"`
	TmdbId        string `json:"tmdbId,omitempty"`
	ShowName      string `json:"showName,omitempty"`
	SeasonNumber  int    `json:"seasonNumber,omitempty"`
	EpisodeNumber int    `json:"episodeNumber,omitempty"`
	EpisodeTitle  string `json:"episodeTitle,omitempty"`
	Filename      string `json:"filename,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
}

// AddRecentMedia adds a new recent media item to the database, replacing duplicates
func AddRecentMedia(media RecentMedia) error {
	if (media.Type == "tvshow" || media.Type == "tv") && media.TmdbId != "" && media.SeasonNumber > 0 && media.EpisodeNumber > 0 {
		deleteQuery := `DELETE FROM recent_media WHERE tmdb_id = ? AND type IN ('tvshow', 'tv') AND season_number = ? AND episode_number = ?`
		_, err := db.Exec(deleteQuery, media.TmdbId, media.SeasonNumber, media.EpisodeNumber)
		if err != nil {
			return fmt.Errorf("failed to remove duplicate episode: %w", err)
		}
	} else if media.Type == "movie" && media.TmdbId != "" {
		deleteQuery := `DELETE FROM recent_media WHERE tmdb_id = ? AND type = 'movie'`
		_, err := db.Exec(deleteQuery, media.TmdbId)
		if err != nil {
			return fmt.Errorf("failed to remove duplicate movie: %w", err)
		}
	}

	// Insert the new entry
	query := `INSERT INTO recent_media (name, path, folder_name, updated_at, type, tmdb_id, show_name, season_number, episode_number, episode_title, filename)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	_, err := db.Exec(query, media.Name, media.Path, media.FolderName, media.UpdatedAt, media.Type,
		media.TmdbId, media.ShowName, media.SeasonNumber, media.EpisodeNumber, media.EpisodeTitle, media.Filename)

	if err != nil {
		return fmt.Errorf("failed to add recent media: %w", err)
	}

	return cleanupRecentMedia()
}

// Uses efficient database queries on the processed_files table - no file system scanning needed
func GetMediaCounts(rootDir string) (movieCount int, showCount int, err error) {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")
	mediaHubDB, err := sql.Open("sqlite", mediaHubDBPath)
	if err != nil {
		db.QueryRow(`SELECT COUNT(DISTINCT tmdb_id) FROM tmdb_entities WHERE media_type = 'movie'`).Scan(&movieCount)
		db.QueryRow(`SELECT COUNT(DISTINCT tmdb_id) FROM tmdb_entities WHERE media_type = 'tv'`).Scan(&showCount)
		return movieCount, showCount, nil
	}
	defer mediaHubDB.Close()

	// Count unique TV shows (entries with season_number)
	showQuery := `SELECT COUNT(DISTINCT tmdb_id) FROM processed_files WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id != 'NULL' AND season_number IS NOT NULL AND season_number != '' AND season_number != 'NULL'`
	err = mediaHubDB.QueryRow(showQuery).Scan(&showCount)
	if err != nil {
		showCount = 0
	}

	// Count unique movies (entries with tmdb_id but no season_number)
	movieQuery := `SELECT COUNT(DISTINCT tmdb_id) FROM processed_files WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id != 'NULL' AND (season_number IS NULL OR season_number = '' OR season_number = 'NULL')`
	err = mediaHubDB.QueryRow(movieQuery).Scan(&movieCount)
	if err != nil {
		movieCount = 0
	}

	return movieCount, showCount, nil
}

// GetAllStatsFromDB returns all stats from MediaHub database - no file system scanning
func GetAllStatsFromDB() (totalFiles int, totalFolders int, totalSize int64, movieCount int, showCount int, err error) {
	// Use the database connection pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Warn("Failed to get database connection: %v", err)
		return 0, 0, 0, 0, 0, nil
	}

	// Get total file count (count files that have destination paths)
	err = mediaHubDB.QueryRow(`SELECT COUNT(*) FROM processed_files WHERE destination_path IS NOT NULL AND destination_path != ''`).Scan(&totalFiles)
	if err != nil {
		totalFiles = 0
	}

	// Get unique folder count by extracting directories from DESTINATION paths
	rows, err := mediaHubDB.Query(`SELECT DISTINCT destination_path FROM processed_files WHERE destination_path IS NOT NULL AND destination_path != ''`)
	if err != nil {
		totalFolders = 0
	} else {
		defer rows.Close()
		folderSet := make(map[string]bool)

		for rows.Next() {
			var destinationPath string
			if err := rows.Scan(&destinationPath); err != nil {
				continue
			}

			// Extract directory path from destination
			dir := filepath.Dir(destinationPath)
			if dir != "." && dir != "/" && dir != "\\" && dir != "" {
				folderSet[dir] = true
			}
		}
		totalFolders = len(folderSet)
	}

	// Calculate storage size from database - fast and accurate!
	totalSize = 0

	// Get total size from stored file_size column
	err = mediaHubDB.QueryRow(`SELECT COALESCE(SUM(file_size), 0) FROM processed_files WHERE file_size IS NOT NULL`).Scan(&totalSize)
	if err != nil {
		totalSize = 0
	}

	// Get movie and show counts (reuse existing logic)
	movieCount, showCount, err = GetMediaCounts("")
	if err != nil {
		movieCount, showCount = 0, 0
	}

	return totalFiles, totalFolders, totalSize, movieCount, showCount, nil
}

// GetRecentMedia retrieves recent media items with dynamic limit for proper show grouping
func GetRecentMedia(limit int) ([]RecentMedia, error) {
	if limit <= 0 {
		limit = 10
	}

	// Get all recent media items
	query := `SELECT id, name, path, folder_name, updated_at, type, tmdb_id, show_name, season_number, episode_number, episode_title, filename, created_at
		FROM recent_media ORDER BY created_at DESC`

	rows, err := db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query recent media: %w", err)
	}
	defer rows.Close()

	var results []RecentMedia
	for rows.Next() {
		var media RecentMedia
		var tmdbId, showName, episodeTitle, filename sql.NullString
		var seasonNumber, episodeNumber sql.NullInt64

		err := rows.Scan(&media.ID, &media.Name, &media.Path, &media.FolderName, &media.UpdatedAt,
			&media.Type, &tmdbId, &showName, &seasonNumber, &episodeNumber, &episodeTitle, &filename, &media.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to scan recent media: %w", err)
		}

		// Handle nullable fields
		if tmdbId.Valid {
			media.TmdbId = tmdbId.String
		}
		if showName.Valid {
			media.ShowName = showName.String
		}
		if seasonNumber.Valid {
			media.SeasonNumber = int(seasonNumber.Int64)
		}
		if episodeNumber.Valid {
			media.EpisodeNumber = int(episodeNumber.Int64)
		}
		if episodeTitle.Valid {
			media.EpisodeTitle = episodeTitle.String
		}
		if filename.Valid {
			media.Filename = filename.String
		}

		results = append(results, media)
	}

	return results, nil
}

// cleanupRecentMedia dynamically adjusts limit based on show episodes - no artificial caps
func cleanupRecentMedia() error {
	var uniqueShows int
	showCountQuery := `SELECT COUNT(DISTINCT CASE
		WHEN (type = 'tvshow' OR type = 'tv') AND tmdb_id IS NOT NULL AND tmdb_id != ''
		THEN tmdb_id || '-' || type
		ELSE 'movie-' || id
	END) FROM recent_media`

	err := db.QueryRow(showCountQuery).Scan(&uniqueShows)
	if err != nil {
		return fmt.Errorf("failed to count unique shows: %w", err)
	}

	// Get total count
	var totalCount int
	err = db.QueryRow(`SELECT COUNT(*) FROM recent_media`).Scan(&totalCount)
	if err != nil {
		return fmt.Errorf("failed to count total entries: %w", err)
	}

	dynamicLimit := 20 + (totalCount - uniqueShows)

	const MAX_REASONABLE_ENTRIES = 100
	if totalCount <= MAX_REASONABLE_ENTRIES {
		return nil
	}

	entriesToKeep := dynamicLimit
	if entriesToKeep > MAX_REASONABLE_ENTRIES {
		entriesToKeep = MAX_REASONABLE_ENTRIES
	}

	query := `DELETE FROM recent_media WHERE id NOT IN (
		SELECT id FROM recent_media ORDER BY created_at DESC LIMIT ?
	)`

	_, err = db.Exec(query, entriesToKeep)
	if err != nil {
		return fmt.Errorf("failed to cleanup recent media: %w", err)
	}

	return nil
}

// ClearRecentMedia removes all recent media entries
func ClearRecentMedia() error {
	_, err := db.Exec(`DELETE FROM recent_media`)
	if err != nil {
		return fmt.Errorf("failed to clear recent media: %w", err)
	}
	return nil
}
