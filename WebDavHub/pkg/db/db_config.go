package db

import (
	"database/sql"
	"time"

	"cinesync/pkg/env"
)

// DatabaseConfig holds common database configuration
type DatabaseConfig struct {
	MaxOpenConns    int
	MaxIdleConns    int
	ConnMaxLifetime time.Duration
	BusyTimeout     string
	JournalMode     string
	Synchronous     string
	CacheSize       string
	ForeignKeys     string
	TempStore       string
}

func GetDefaultDatabaseConfig() DatabaseConfig {
	// For concurrent access across multiple applications (MediaHub + Spoofing)
	// We need to allow multiple readers but manage write contention carefully
	
	// SQLite in WAL mode supports multiple concurrent readers + 1 writer
	// Keep connections low to reduce contention
	maxConnections := 3
	if maxConnections < 1 {
		maxConnections = 1
	}

	return DatabaseConfig{
		MaxOpenConns:    maxConnections, // Allow multiple readers
		MaxIdleConns:    1, // Keep minimal idle connections
		ConnMaxLifetime: time.Hour * 2, // Shorter lifetime to prevent stale connections
		BusyTimeout:     "60000", // 60 seconds - reasonable for concurrent access
		JournalMode:     "WAL", // WAL mode is essential for concurrent readers
		Synchronous:     "NORMAL", // Balance between safety and performance
		CacheSize:       "-16000", // 16MB cache (negative means KB)
		ForeignKeys:     "ON",
		TempStore:       "MEMORY",
	}
}


func (config DatabaseConfig) BuildConnectionString(dbPath string) string {
	return dbPath + "?" +
		"_busy_timeout=" + config.BusyTimeout +
		"&_journal_mode=" + config.JournalMode +
		"&_synchronous=" + config.Synchronous +
		"&_cache_size=" + config.CacheSize +
		"&_foreign_keys=" + config.ForeignKeys +
		"&_temp_store=" + config.TempStore +
		"&_wal_autocheckpoint=1000" + // Checkpoint every 1000 pages to prevent WAL bloat
		"&_mmap_size=134217728" + // 128MB memory mapping - reasonable size
		"&_locking_mode=NORMAL" + // Normal locking allows concurrent access
		"&_read_uncommitted=false" + // Ensure consistency
		"&_query_only=false" +
		"&_secure_delete=false" + // Improve write performance
		"&_auto_vacuum=INCREMENTAL" + // Prevent database file bloat
		"&_optimize" // Optimize on connection
}


func (config DatabaseConfig) ConfigureDatabase(db *sql.DB) {
	db.SetMaxOpenConns(config.MaxOpenConns)
	db.SetMaxIdleConns(config.MaxIdleConns)
	db.SetConnMaxLifetime(config.ConnMaxLifetime)
}


func OpenAndConfigureDatabase(dbPath string) (*sql.DB, error) {
	config := GetDefaultDatabaseConfig()
	
	db, err := sql.Open("sqlite", config.BuildConnectionString(dbPath))
	if err != nil {
		return nil, err
	}

	config.ConfigureDatabase(db)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func GetMaxProcesses(itemCount int) int {
	maxProcesses := env.GetInt("MAX_PROCESSES", 8)
	if maxProcesses > itemCount {
		maxProcesses = itemCount
	}
	if maxProcesses < 1 {
		maxProcesses = 1
	}
	return maxProcesses
}