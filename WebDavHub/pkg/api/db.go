package api

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
	dbDir := filepath.Join("data")
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

// Only store the fields actually used in the frontend
func InitTmdbCacheTable() error {
	query := `CREATE TABLE IF NOT EXISTS tmdb_cache (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		cache_key TEXT UNIQUE,
		tmdb_id INTEGER,
		title TEXT,
		poster_path TEXT,
		year TEXT,
		media_type TEXT
	);`
	_, err := db.Exec(query)
	return err
}

type TmdbCacheEntry struct {
	TmdbID     int
	Title      string
	PosterPath string
	Year       string
	MediaType  string
}

func GetTmdbCache(cacheKey string) (string, error) {
	query := `SELECT tmdb_id, title, poster_path, year, media_type FROM tmdb_cache WHERE cache_key = ?;`
	row := db.QueryRow(query, cacheKey)
	var entry TmdbCacheEntry
	err := row.Scan(&entry.TmdbID, &entry.Title, &entry.PosterPath, &entry.Year, &entry.MediaType)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	jsonStr := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
		entry.TmdbID, entry.Title, entry.PosterPath, entry.Year, entry.MediaType)
	return jsonStr, nil
}

func upsertTmdbCacheDirect(cacheKey, result string) error {
	var entry struct {
		ID         int    `json:"id"`
		Title      string `json:"title"`
		PosterPath string `json:"poster_path"`
		ReleaseDate string `json:"release_date"`
		MediaType  string `json:"media_type"`
	}
	err := json.Unmarshal([]byte(result), &entry)
	if err != nil {
		return fmt.Errorf("failed to parse TMDB cache JSON: %w", err)
	}
	// Check for existing tmdb_id + media_type
	var existingID int
	err = db.QueryRow(`SELECT id FROM tmdb_cache WHERE tmdb_id = ? AND media_type = ?`, entry.ID, entry.MediaType).Scan(&existingID)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = db.Exec(`INSERT INTO tmdb_cache (cache_key, tmdb_id, title, poster_path, year, media_type) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET tmdb_id=excluded.tmdb_id, title=excluded.title, poster_path=excluded.poster_path, year=excluded.year, media_type=excluded.media_type`,
		cacheKey, entry.ID, entry.Title, entry.PosterPath, entry.ReleaseDate, entry.MediaType)
	return err
}

// UpsertTmdbCache stores or updates a TMDB cache entry (async, robust)
func UpsertTmdbCache(cacheKey, result string) error {
	tmdbCacheWriteQueue <- tmdbCacheWriteReq{query: cacheKey, result: result}
	return nil // always return nil, as write is async
}

// GetTmdbCacheByTmdbIdAndType returns the first cache entry for a given tmdb_id and media_type
func GetTmdbCacheByTmdbIdAndType(tmdbID, mediaType string) (string, error) {
	query := `SELECT tmdb_id, title, poster_path, year, media_type FROM tmdb_cache WHERE tmdb_id = ? AND media_type = ? LIMIT 1;`
	var entry TmdbCacheEntry
	var idInt int
	idInt, err := strconv.Atoi(tmdbID)
	if err != nil {
		return "", err
	}
	err = db.QueryRow(query, idInt, mediaType).Scan(&entry.TmdbID, &entry.Title, &entry.PosterPath, &entry.Year, &entry.MediaType)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	jsonStr := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
		entry.TmdbID, entry.Title, entry.PosterPath, entry.Year, entry.MediaType)
	return jsonStr, nil
}

// DB returns the global *sql.DB instance
func DB() *sql.DB {
	return db
} 