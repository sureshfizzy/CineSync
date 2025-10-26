package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

// DebridDB manages the debrid-specific database
type DebridDB struct {
	db   *sql.DB
	path string
	mu   sync.RWMutex
}

// RemovedFileRecord represents a removed file record in the database
type RemovedFileRecord struct {
	ID             int       `db:"id"`
	TorrentID      string    `db:"torrent_id"`
	TorrentHash    string    `db:"torrent_hash"`
	TorrentName    string    `db:"torrent_name"`
	FilePath       string    `db:"file_path"`
	OriginalSize   int64     `db:"original_size"`
	DetectedAt     time.Time `db:"detected_at"`
	VerifiedViaAPI bool      `db:"verified_via_api"`
	CacheKey       string    `db:"cache_key"`
}

var (
	debridDB     *DebridDB
	debridDBOnce sync.Once
)

// GetDebridDB returns the singleton debrid database instance
func GetDebridDB() *DebridDB {
	debridDBOnce.Do(func() {
		dbDir := filepath.Join("../db")
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			logger.Error("[DebridDB] Failed to create database directory %s: %v", dbDir, err)
			panic(fmt.Sprintf("Failed to create database directory: %v", err))
		}
		
		dbPath := filepath.Join(dbDir, "debrid.db")
		
		db, err := initializeDebridDB(dbPath)
		if err != nil {
			logger.Error("[DebridDB] Failed to initialize debrid database: %v", err)
			panic(fmt.Sprintf("Failed to initialize debrid database: %v", err))
		}
		debridDB = db
	})
	return debridDB
}

// InitDebridDB initializes the debrid database during application startup
func InitDebridDB() error {
	// This will trigger the debridDBOnce.Do initialization if not already done
	db := GetDebridDB()
	if db == nil {
		return fmt.Errorf("failed to initialize debrid database")
	}
	return nil
}

// initializeDebridDB creates and configures the debrid database
func initializeDebridDB(dbPath string) (*DebridDB, error) {
	// Use a more memory-efficient configuration for the debrid database
	config := DatabaseConfig{
		MaxOpenConns:    1,
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Hour,
		BusyTimeout:     "30000",
		JournalMode:     "WAL",
		Synchronous:     "NORMAL",
		CacheSize:       "-2000",
		ForeignKeys:     "ON",
		TempStore:       "MEMORY",
	}
	
	connectionString := config.BuildConnectionString(dbPath)
	logger.Debug("[DebridDB] Opening database with connection string: %s", dbPath)
	
	db, err := sql.Open("sqlite", connectionString)
	if err != nil {
		return nil, fmt.Errorf("failed to open debrid database: %w", err)
	}

	// Configure connection pool
	config.ConfigureDatabase(db)
	
	// Test the connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping debrid database: %w", err)
	}

	debridDB := &DebridDB{
		db:   db,
		path: dbPath,
	}

	if err := debridDB.createTables(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	logger.Info("[DebridDB] Debrid database initialized successfully at: %s", dbPath)
	return debridDB, nil
}

// createTables creates the necessary tables for debrid data
func (ddb *DebridDB) createTables() error {
	createRemovedFilesTable := `
	CREATE TABLE IF NOT EXISTS removed_files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		cache_key TEXT UNIQUE NOT NULL,
		torrent_id TEXT NOT NULL,
		torrent_name TEXT NOT NULL,
		file_path TEXT NOT NULL,
		original_size INTEGER NOT NULL DEFAULT 0,
		detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		verified_via_api BOOLEAN NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`

	if _, err := ddb.db.Exec(createRemovedFilesTable); err != nil {
		return fmt.Errorf("failed to create removed_files table: %w", err)
	}

	// Check if torrent_hash column exists, if not add it
	var columnExists bool
	checkColumn := `SELECT COUNT(*) FROM pragma_table_info('removed_files') WHERE name='torrent_hash';`
	err := ddb.db.QueryRow(checkColumn).Scan(&columnExists)
	if err != nil {
		return fmt.Errorf("failed to check for torrent_hash column: %w", err)
	}

	// Add torrent_hash column if it doesn't exist
	if !columnExists {
		logger.Info("[DebridDB] Adding torrent_hash column to existing removed_files table")
		addColumn := `ALTER TABLE removed_files ADD COLUMN torrent_hash TEXT NOT NULL DEFAULT '';`
		if _, err := ddb.db.Exec(addColumn); err != nil {
			return fmt.Errorf("failed to add torrent_hash column: %w", err)
		}
	}

	// Create indexes (including the new torrent_hash index)
	createIndexes := `
	CREATE INDEX IF NOT EXISTS idx_removed_files_cache_key ON removed_files(cache_key);
	CREATE INDEX IF NOT EXISTS idx_removed_files_torrent_id ON removed_files(torrent_id);
	CREATE INDEX IF NOT EXISTS idx_removed_files_torrent_hash ON removed_files(torrent_hash);
	CREATE INDEX IF NOT EXISTS idx_removed_files_detected_at ON removed_files(detected_at);
	`

	if _, err := ddb.db.Exec(createIndexes); err != nil {
		return fmt.Errorf("failed to create indexes: %w", err)
	}

	return nil
}

// AddRemovedFile adds a file to the removed files database
func (ddb *DebridDB) AddRemovedFile(torrentID, torrentHash, torrentName, filePath string, originalSize int64, verifiedViaAPI bool) error {
	if ddb == nil || ddb.db == nil {
		return fmt.Errorf("debrid database not initialized")
	}

	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)

	ddb.mu.Lock()
	defer ddb.mu.Unlock()

	query := `
	INSERT OR REPLACE INTO removed_files 
	(cache_key, torrent_id, torrent_hash, torrent_name, file_path, original_size, detected_at, verified_via_api, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`

	_, err := ddb.db.Exec(query, cacheKey, torrentID, torrentHash, torrentName, filePath, originalSize, time.Now(), verifiedViaAPI)
	if err != nil {
		return fmt.Errorf("failed to insert removed file: %w", err)
	}

	logger.Info("[DebridDB] Added removed file to database: %s", cacheKey)
	return nil
}

// IsFileRemoved checks if a file is marked as removed in the database
func (ddb *DebridDB) IsFileRemoved(torrentID, filePath string) (bool, *RemovedFileRecord, error) {
	if ddb == nil || ddb.db == nil {
		return false, nil, fmt.Errorf("debrid database not initialized")
	}

	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)

	ddb.mu.RLock()
	defer ddb.mu.RUnlock()

	query := `
	SELECT id, torrent_id, torrent_hash, torrent_name, file_path, original_size, detected_at, verified_via_api, cache_key
	FROM removed_files 
	WHERE cache_key = ?`

	var record RemovedFileRecord
	err := ddb.db.QueryRow(query, cacheKey).Scan(
		&record.ID,
		&record.TorrentID,
		&record.TorrentHash,
		&record.TorrentName,
		&record.FilePath,
		&record.OriginalSize,
		&record.DetectedAt,
		&record.VerifiedViaAPI,
		&record.CacheKey,
	)

	if err == sql.ErrNoRows {
		return false, nil, nil
	}

	if err != nil {
		return false, nil, fmt.Errorf("failed to query removed file: %w", err)
	}

	return true, &record, nil
}

// IsFileRemovedByHash checks if any file from a torrent hash is marked as removed
func (ddb *DebridDB) IsFileRemovedByHash(torrentHash, filePath string) (bool, *RemovedFileRecord, error) {
	if ddb == nil || ddb.db == nil {
		return false, nil, fmt.Errorf("debrid database not initialized")
	}

	if torrentHash == "" {
		return false, nil, nil
	}

	ddb.mu.RLock()
	defer ddb.mu.RUnlock()

	query := `
	SELECT id, torrent_id, torrent_hash, torrent_name, file_path, original_size, detected_at, verified_via_api, cache_key
	FROM removed_files 
	WHERE torrent_hash = ? AND file_path = ?`

	var record RemovedFileRecord
	err := ddb.db.QueryRow(query, torrentHash, filePath).Scan(
		&record.ID,
		&record.TorrentID,
		&record.TorrentHash,
		&record.TorrentName,
		&record.FilePath,
		&record.OriginalSize,
		&record.DetectedAt,
		&record.VerifiedViaAPI,
		&record.CacheKey,
	)

	if err == sql.ErrNoRows {
		return false, nil, nil
	}

	if err != nil {
		return false, nil, fmt.Errorf("failed to query removed file by hash: %w", err)
	}

	return true, &record, nil
}

// GetAllRemovedFiles returns all removed files from the database
func (ddb *DebridDB) GetAllRemovedFiles() ([]RemovedFileRecord, error) {
	if ddb == nil || ddb.db == nil {
		return nil, fmt.Errorf("debrid database not initialized")
	}

	ddb.mu.RLock()
	defer ddb.mu.RUnlock()

	query := `
	SELECT id, torrent_id, torrent_hash, torrent_name, file_path, original_size, detected_at, verified_via_api, cache_key
	FROM removed_files 
	ORDER BY detected_at DESC`

	rows, err := ddb.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query removed files: %w", err)
	}
	defer rows.Close()

	var records []RemovedFileRecord
	for rows.Next() {
		var record RemovedFileRecord
		err := rows.Scan(
			&record.ID,
			&record.TorrentID,
			&record.TorrentHash,
			&record.TorrentName,
			&record.FilePath,
			&record.OriginalSize,
			&record.DetectedAt,
			&record.VerifiedViaAPI,
			&record.CacheKey,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan removed file record: %w", err)
		}
		records = append(records, record)
	}

	if err = rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iteration error: %w", err)
	}

	return records, nil
}

// RemoveFileRecord removes a specific file record from the database
func (ddb *DebridDB) RemoveFileRecord(torrentID, filePath string) error {
	if ddb == nil || ddb.db == nil {
		return fmt.Errorf("debrid database not initialized")
	}

	cacheKey := fmt.Sprintf("%s:%s", torrentID, filePath)

	ddb.mu.Lock()
	defer ddb.mu.Unlock()

	query := `DELETE FROM removed_files WHERE cache_key = ?`

	result, err := ddb.db.Exec(query, cacheKey)
	if err != nil {
		return fmt.Errorf("failed to delete removed file record: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected > 0 {
		logger.Info("[DebridDB] Removed file record from database: %s", cacheKey)
	}

	return nil
}

// GetRemovedFilesCount returns the count of removed files
func (ddb *DebridDB) GetRemovedFilesCount() (int, error) {
	if ddb == nil || ddb.db == nil {
		return 0, fmt.Errorf("debrid database not initialized")
	}

	ddb.mu.RLock()
	defer ddb.mu.RUnlock()

	var count int
	query := `SELECT COUNT(*) FROM removed_files`

	err := ddb.db.QueryRow(query).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count removed files: %w", err)
	}

	return count, nil
}

// CleanupOldRecords removes records older than the specified duration
func (ddb *DebridDB) CleanupOldRecords(olderThan time.Duration) (int, error) {
	if ddb == nil || ddb.db == nil {
		return 0, fmt.Errorf("debrid database not initialized")
	}

	ddb.mu.Lock()
	defer ddb.mu.Unlock()

	cutoffTime := time.Now().Add(-olderThan)
	query := `DELETE FROM removed_files WHERE detected_at < ?`

	result, err := ddb.db.Exec(query, cutoffTime)
	if err != nil {
		return 0, fmt.Errorf("failed to cleanup old records: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	if rowsAffected > 0 {
		logger.Info("[DebridDB] Cleaned up %d old removed file records", rowsAffected)
	}

	return int(rowsAffected), nil
}

// Close closes the database connection
func (ddb *DebridDB) Close() error {
	if ddb == nil || ddb.db == nil {
		return nil
	}

	ddb.mu.Lock()
	defer ddb.mu.Unlock()

	err := ddb.db.Close()
	if err != nil {
		return fmt.Errorf("failed to close debrid database: %w", err)
	}

	logger.Info("[DebridDB] Debrid database connection closed")
	return nil
}

// GetDatabaseStats returns database statistics
func (ddb *DebridDB) GetDatabaseStats() (map[string]interface{}, error) {
	if ddb == nil || ddb.db == nil {
		return nil, fmt.Errorf("debrid database not initialized")
	}

	ddb.mu.RLock()
	defer ddb.mu.RUnlock()

	stats := make(map[string]interface{})

	// Get removed files count
	var removedCount int
	err := ddb.db.QueryRow("SELECT COUNT(*) FROM removed_files").Scan(&removedCount)
	if err != nil {
		return nil, fmt.Errorf("failed to get removed files count: %w", err)
	}
	stats["removed_files_count"] = removedCount

	// Get oldest and newest records
	var oldestDate, newestDate sql.NullTime
	err = ddb.db.QueryRow("SELECT MIN(detected_at), MAX(detected_at) FROM removed_files").Scan(&oldestDate, &newestDate)
	if err != nil {
		return nil, fmt.Errorf("failed to get date range: %w", err)
	}

	if oldestDate.Valid {
		stats["oldest_record"] = oldestDate.Time
	}
	if newestDate.Valid {
		stats["newest_record"] = newestDate.Time
	}

	stats["database_path"] = ddb.path

	return stats, nil
}