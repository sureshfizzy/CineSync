package db

import (
	"database/sql"
	"path/filepath"
	"sync"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

var (
	dbPool     *sql.DB
	dbPoolOnce sync.Once
	dbPoolMux  sync.RWMutex
)

func GetDatabaseConnection() (*sql.DB, error) {
	dbPoolOnce.Do(func() {
		mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

		absPath, _ := filepath.Abs(mediaHubDBPath)
		logger.Info("Connecting to MediaHub database at: %s", absPath)

		db, err := OpenAndConfigureDatabase(mediaHubDBPath)
		if err != nil {
			logger.Error("Failed to open MediaHub database pool: %v", err)
			return
		}


		pragmas := []string{
			"PRAGMA mmap_size=268435456",
			"PRAGMA optimize",
		}

		for _, pragma := range pragmas {
			if _, err := db.Exec(pragma); err != nil {
				logger.Warn("Failed to set pragma %s: %v", pragma, err)
			}
		}

		dbPool = db
		logger.Info("MediaHub database connection pool initialized successfully")
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

func WithDatabaseTransaction(fn func(*sql.Tx) error) error {
	return executeWithRetry(func() error {
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
	})
}


