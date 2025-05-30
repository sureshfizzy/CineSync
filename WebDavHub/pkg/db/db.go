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
	_, err := db.Exec(query)
	return err
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
		last_updated INTEGER NOT NULL DEFAULT (strftime('%s', 'now')), -- Unix timestamp of last update
		PRIMARY KEY (tmdb_id, media_type)
	);`
	if _, err := db.Exec(queryEntities); err != nil {
		return fmt.Errorf("failed to create tmdb_entities table: %w", err)
	}

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
