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
	maxWorkers := env.GetInt("DB_MAX_WORKERS", 8)
	maxConnections := maxWorkers

	if maxConnections > 10 {
		maxConnections = 10
	}
	if maxConnections < 1 {
		maxConnections = 1
	}

	return DatabaseConfig{
		MaxOpenConns:    1, // Use single connection to avoid locking issues
		MaxIdleConns:    1,
		ConnMaxLifetime: time.Hour * 24,
		BusyTimeout:     "300000", // Increase timeout to 5 minutes
		JournalMode:     "WAL",
		Synchronous:     "NORMAL",
		CacheSize:       "500000", // Increase cache size
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
		"&_wal_autocheckpoint=100" + // More frequent checkpoints
		"&_mmap_size=268435456" +
		"&_locking_mode=NORMAL" +
		"&_read_uncommitted=false" + // Better consistency
		"&_query_only=false" +
		"&_txlock=immediate" // Use immediate transactions
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