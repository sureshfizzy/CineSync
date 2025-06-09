package db

import (
	"database/sql"
	"path/filepath"
	"sync"
	"time"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

var (
	dbPool     *sql.DB
	dbPoolOnce sync.Once
	dbPoolMux  sync.RWMutex
)

// GetDatabaseConnection returns a shared database connection with proper SQLite settings
func GetDatabaseConnection() (*sql.DB, error) {
	dbPoolOnce.Do(func() {
		mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")
		
		// Open database with optimized SQLite settings for concurrent access
		db, err := sql.Open("sqlite", mediaHubDBPath+"?_busy_timeout=30000&_journal_mode=WAL&_synchronous=NORMAL&_cache_size=1000&_foreign_keys=on")
		if err != nil {
			logger.Error("Failed to open MediaHub database pool: %v", err)
			return
		}

		// Configure connection pool for optimal performance
		db.SetMaxOpenConns(25)
		db.SetMaxIdleConns(10)
		db.SetConnMaxLifetime(time.Hour * 2)

		// Test the connection
		if err := db.Ping(); err != nil {
			logger.Error("Failed to ping MediaHub database: %v", err)
			db.Close()
			return
		}

		dbPool = db
		logger.Info("Database connection pool initialized successfully")
	})

	dbPoolMux.RLock()
	defer dbPoolMux.RUnlock()
	
	if dbPool == nil {
		return nil, sql.ErrConnDone
	}
	
	return dbPool, nil
}

// CloseDatabasePool closes the shared database connection pool
func CloseDatabasePool() {
	dbPoolMux.Lock()
	defer dbPoolMux.Unlock()
	
	if dbPool != nil {
		dbPool.Close()
		dbPool = nil
		logger.Info("Database connection pool closed")
	}
}

// WithDatabaseTransaction executes a function within a database transaction
func WithDatabaseTransaction(fn func(*sql.Tx) error) error {
	db, err := GetDatabaseConnection()
	if err != nil {
		return err
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}

	defer func() {
		if p := recover(); p != nil {
			tx.Rollback()
			panic(p)
		} else if err != nil {
			tx.Rollback()
		} else {
			err = tx.Commit()
		}
	}()

	err = fn(tx)
	return err
}
