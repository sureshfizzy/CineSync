package db

import (
	"database/sql"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

var (
	sourceDBPool     *sql.DB
	sourceDBPoolOnce sync.Once
	sourceDBPoolMux  sync.RWMutex
	sourceDBSemaphore chan struct{}
)

// GetSourceDatabaseConnection returns a shared source database connection with proper SQLite settings
func GetSourceDatabaseConnection() (*sql.DB, error) {
	sourceDBPoolOnce.Do(func() {
		sourceDBSemaphore = make(chan struct{}, 5)

		dbDir := filepath.Join("../db")

		// Ensure the directory exists
		if err := os.MkdirAll(dbDir, 0755); err != nil {
			logger.Error("Failed to create database directory: %v", err)
			return
		}

		// Open the source database with optimized SQLite settings for concurrent access
		dbPath := filepath.Join(dbDir, "source_files.db")
		db, err := sql.Open("sqlite", dbPath+"?_busy_timeout=60000&_journal_mode=WAL&_synchronous=NORMAL&_cache_size=20000&_foreign_keys=ON&_temp_store=MEMORY")
		if err != nil {
			logger.Error("Failed to open source database pool: %v", err)
			return
		}

		// Configure connection pool for optimal performance with SQLite
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
		db.SetConnMaxLifetime(time.Hour * 24)

		// Test the connection and set additional pragmas
		if err := db.Ping(); err != nil {
			logger.Error("Failed to ping source database: %v", err)
			db.Close()
			return
		}

		// Set additional SQLite pragmas for better concurrency
		pragmas := []string{
			"PRAGMA journal_mode=WAL",
			"PRAGMA synchronous=NORMAL",
			"PRAGMA cache_size=20000",
			"PRAGMA temp_store=MEMORY",
			"PRAGMA mmap_size=268435456",
			"PRAGMA optimize",
		}

		for _, pragma := range pragmas {
			if _, err := db.Exec(pragma); err != nil {
				logger.Warn("Failed to set pragma %s: %v", pragma, err)
			}
		}

		sourceDBPool = db
		logger.Info("Source database connection pool initialized successfully")
	})

	sourceDBPoolMux.RLock()
	defer sourceDBPoolMux.RUnlock()

	if sourceDBPool == nil {
		return nil, sql.ErrConnDone
	}

	return sourceDBPool, nil
}

// executeWithSemaphore executes a database operation with semaphore control
func executeWithSemaphore(operation func(*sql.DB) error) error {
	sourceDBSemaphore <- struct{}{}
	defer func() { <-sourceDBSemaphore }()

	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get source database connection: %w", err)
	}

	return operation(db)
}

// InitSourceDB initializes the source files database
func InitSourceDB() error {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get source database connection: %w", err)
	}

	// Create tables
	if err := createSourceTables(db); err != nil {
		return fmt.Errorf("failed to create source tables: %w", err)
	}

	// Verify tables were created successfully
	if err := verifySourceTables(db); err != nil {
		return fmt.Errorf("failed to verify source tables: %w", err)
	}

	logger.Info("Source files database initialized successfully")
	return nil
}

// createSourceTables creates the necessary tables for source file tracking
func createSourceTables(db *sql.DB) error {
	// Create source_files table for tracking source directory files
	querySourceFiles := `CREATE TABLE IF NOT EXISTS source_files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		file_path TEXT UNIQUE NOT NULL,
		file_name TEXT NOT NULL,
		file_size INTEGER,
		file_size_formatted TEXT,
		modified_time INTEGER,
		is_media_file BOOLEAN DEFAULT FALSE,
		media_type TEXT, -- 'movie', 'tvshow', or NULL
		source_index INTEGER,
		source_directory TEXT,
		relative_path TEXT,
		file_extension TEXT,
		discovered_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		is_active BOOLEAN DEFAULT TRUE,
		processing_status TEXT DEFAULT 'unprocessed', -- 'unprocessed', 'processed', 'failed', 'skipped'
		last_processed_at INTEGER,
		tmdb_id TEXT,
		season_number INTEGER,
		episode_number INTEGER
	);`
	if _, err := db.Exec(querySourceFiles); err != nil {
		return fmt.Errorf("failed to create source_files table: %w", err)
	}

	// Create indexes for source_files table
	sourceFileIndexes := []string{
		`CREATE INDEX IF NOT EXISTS idx_source_files_path ON source_files(file_path);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_media ON source_files(is_media_file);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_status ON source_files(processing_status);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_source_idx ON source_files(source_index);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_active ON source_files(is_active);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_last_seen ON source_files(last_seen_at);`,
		`CREATE INDEX IF NOT EXISTS idx_source_files_discovered ON source_files(discovered_at);`,
	}

	for _, indexQuery := range sourceFileIndexes {
		if _, err := db.Exec(indexQuery); err != nil {
			return fmt.Errorf("failed to create source_files index: %w", err)
		}
	}

	// Create source_scans table for tracking scan jobs
	querySourceScans := `CREATE TABLE IF NOT EXISTS source_scans (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		scan_type TEXT NOT NULL, -- 'scheduled', 'manual', 'startup'
		started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
		completed_at INTEGER,
		status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed'
		files_discovered INTEGER DEFAULT 0,
		files_updated INTEGER DEFAULT 0,
		files_removed INTEGER DEFAULT 0,
		total_files INTEGER DEFAULT 0,
		error_message TEXT,
		scan_duration_ms INTEGER
	);`
	if _, err := db.Exec(querySourceScans); err != nil {
		return fmt.Errorf("failed to create source_scans table: %w", err)
	}

	// Create index for source_scans table
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_source_scans_started ON source_scans(started_at);`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS idx_source_scans_status ON source_scans(status);`)

	logger.Info("Source database tables created successfully")
	return nil
}

// verifySourceTables verifies that the source tables exist and are accessible
func verifySourceTables(db *sql.DB) error {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM source_files").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to verify source_files table: %w", err)
	}

	// Test source_scans table
	err = db.QueryRow("SELECT COUNT(*) FROM source_scans").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to verify source_scans table: %w", err)
	}

	logger.Info("Source database tables verified successfully")
	return nil
}

// GetSourceDB returns the source database connection (deprecated, use GetSourceDatabaseConnection)
func GetSourceDB() *sql.DB {
	db, _ := GetSourceDatabaseConnection()
	return db
}

// CloseSourceDB closes the source database connection pool
func CloseSourceDB() error {
	sourceDBPoolMux.Lock()
	defer sourceDBPoolMux.Unlock()

	if sourceDBPool != nil {
		err := sourceDBPool.Close()
		sourceDBPool = nil
		logger.Info("Source database connection pool closed")
		return err
	}
	return nil
}

// SourceFileExists checks if a source file exists in the database
func SourceFileExists(filePath string) (bool, error) {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return false, fmt.Errorf("failed to get source database connection: %w", err)
	}

	var count int
	query := `SELECT COUNT(*) FROM source_files WHERE file_path = ?`
	err = db.QueryRow(query, filePath).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// InsertSourceFile inserts a new source file into the database with semaphore control
func InsertSourceFile(file SourceFile) error {
	return executeWithSemaphore(func(db *sql.DB) error {
		query := `INSERT INTO source_files
			(file_path, file_name, file_size, file_size_formatted, modified_time,
			 is_media_file, media_type, source_index, source_directory, relative_path,
			 file_extension, discovered_at, last_seen_at, is_active, processing_status)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

		_, err := db.Exec(query,
			file.FilePath, file.FileName, file.FileSize, file.FileSizeFormatted,
			file.ModifiedTime, file.IsMediaFile, file.MediaType, file.SourceIndex,
			file.SourceDirectory, file.RelativePath, file.FileExtension,
			file.DiscoveredAt, file.LastSeenAt, file.IsActive, file.ProcessingStatus)

		return err
	})
}

// UpdateSourceFile updates an existing source file in the database with semaphore control
func UpdateSourceFile(file SourceFile) error {
	return executeWithSemaphore(func(db *sql.DB) error {
		query := `UPDATE source_files SET
			file_size = ?, file_size_formatted = ?, modified_time = ?,
			is_media_file = ?, media_type = ?, last_seen_at = ?, is_active = ?
			WHERE file_path = ?`

		_, err := db.Exec(query,
			file.FileSize, file.FileSizeFormatted, file.ModifiedTime,
			file.IsMediaFile, file.MediaType, file.LastSeenAt, file.IsActive,
			file.FilePath)

		return err
	})
}

// UpdateSourceFileProcessingStatus updates the processing status of a source file with semaphore control
func UpdateSourceFileProcessingStatus(filePath, status, tmdbID string, seasonNumber *int) error {
	return executeWithSemaphore(func(db *sql.DB) error {
		query := `UPDATE source_files SET processing_status = ?, last_processed_at = ?, tmdb_id = ?, season_number = ?
				  WHERE file_path = ?`

		var tmdbIDVal sql.NullString
		var seasonNumberVal sql.NullInt64

		if tmdbID != "" {
			tmdbIDVal.String = tmdbID
			tmdbIDVal.Valid = true
		}

		if seasonNumber != nil {
			seasonNumberVal.Int64 = int64(*seasonNumber)
			seasonNumberVal.Valid = true
		}

		_, err := db.Exec(query, status, getCurrentTimestamp(), tmdbIDVal, seasonNumberVal, filePath)
		if err != nil {
			logger.Debug("Failed to update source file processing status: %v", err)
			return err
		}

		return nil
	})
}

// MarkAllSourceFilesInactive marks all source files as inactive (for scanning)
func MarkAllSourceFilesInactive() error {
	return executeWithSemaphore(func(db *sql.DB) error {
		query := `UPDATE source_files SET is_active = FALSE`
		_, err := db.Exec(query)
		return err
	})
}

// BatchUpdateSourceFiles performs batch operations within a transaction for better performance
func BatchUpdateSourceFiles(operations []func(*sql.Tx) error) error {
	return executeWithSemaphore(func(db *sql.DB) error {
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("failed to begin transaction: %w", err)
		}
		defer tx.Rollback()

		for _, operation := range operations {
			if err := operation(tx); err != nil {
				return fmt.Errorf("batch operation failed: %w", err)
			}
		}

		return tx.Commit()
	})
}

// RemoveInactiveSourceFiles removes source files that are no longer present
func RemoveInactiveSourceFiles() (int, error) {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return 0, fmt.Errorf("failed to get source database connection: %w", err)
	}

	query := `DELETE FROM source_files WHERE is_active = FALSE`
	result, err := db.Exec(query)
	if err != nil {
		return 0, err
	}

	rowsAffected, _ := result.RowsAffected()
	return int(rowsAffected), nil
}

// InsertSourceScan inserts a new source scan record
func InsertSourceScan(scanType string) (int64, error) {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return 0, fmt.Errorf("failed to get source database connection: %w", err)
	}

	query := `INSERT INTO source_scans (scan_type, started_at, status) VALUES (?, ?, 'running')`
	result, err := db.Exec(query, scanType, getCurrentTimestamp())
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

// UpdateSourceScan updates a source scan record with completion details
func UpdateSourceScan(scanID int64, status string, totalFiles, discovered, updated, removed int, durationMs int64, scanError error) error {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get source database connection: %w", err)
	}

	query := `UPDATE source_scans SET completed_at = ?, status = ?, files_discovered = ?,
			  files_updated = ?, files_removed = ?, total_files = ?, scan_duration_ms = ?, error_message = ?
			  WHERE id = ?`

	var errorMsg sql.NullString
	if scanError != nil {
		errorMsg.String = scanError.Error()
		errorMsg.Valid = true
	}

	_, err = db.Exec(query, getCurrentTimestamp(), status, discovered, updated, removed,
		totalFiles, durationMs, errorMsg, scanID)
	if err != nil {
		logger.Error("Failed to update source scan record: %v", err)
	}
	return err
}

// getCurrentTimestamp returns the current Unix timestamp
func getCurrentTimestamp() int64 {
	return time.Now().Unix()
}

// executeWithRetry executes a database operation with retry logic for SQLITE_BUSY errors
func executeWithRetry(operation func() error) error {
	maxRetries := 5
	baseDelay := 100 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		err := operation()
		if err == nil {
			return nil
		}

		// Check if it's a SQLite busy error
		if strings.Contains(err.Error(), "database is locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
			if attempt < maxRetries-1 {
				// Exponential backoff with jitter
				delay := baseDelay * time.Duration(1<<uint(attempt))
				jitter := time.Duration(rand.Int63n(int64(delay / 2)))
				time.Sleep(delay + jitter)
				logger.Debug("Database busy, retrying operation (attempt %d/%d)", attempt+1, maxRetries)
				continue
			}
		}
		return err
	}

	return fmt.Errorf("operation failed after %d retries", maxRetries)
}

// IsNewDatabase checks if this is a new database that needs initial scanning
func IsNewDatabase() bool {
	db, err := GetSourceDatabaseConnection()
	if err != nil {
		return false
	}

	var scanCount int
	err = db.QueryRow("SELECT COUNT(*) FROM source_scans").Scan(&scanCount)
	return err == nil && scanCount == 0
}


