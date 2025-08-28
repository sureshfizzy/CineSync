package db

import (
	"database/sql"
	"fmt"
	"math/rand"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

var (
	dbPool     *sql.DB
	dbPoolOnce sync.Once
	dbPoolMux  sync.RWMutex
	
	// Write operation queue for serializing write operations
	dbWriteQueue chan func()
	dbWriteQueueOnce sync.Once
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

		// Additional pragmas for concurrent access optimization
		additionalPragmas := []string{
			"PRAGMA auto_vacuum=INCREMENTAL",
			"PRAGMA incremental_vacuum(100)", // Clean up immediately
			"PRAGMA wal_checkpoint(RESTART)", // Force WAL checkpoint on startup
			"PRAGMA optimize", // Optimize query planner
		}

		for _, pragma := range additionalPragmas {
			if _, err := db.Exec(pragma); err != nil {
				logger.Warn("Failed to set additional pragma %s: %v", pragma, err)
			} else {
				logger.Debug("Successfully executed pragma: %s", pragma)
			}
		}

		dbPool = db
		logger.Info("MediaHub database connection pool initialized successfully")

		// Initialize write operation queue for serializing writes
		initWriteQueue()
		
		startWALCheckpointManager(db)
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

// WithDatabaseTransaction executes a function within a database transaction with write queue serialization
func WithDatabaseTransaction(fn func(*sql.Tx) error) error {
	return executeMainDBWriteOperationSync(func() error {
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
	})
}

// startWALCheckpointManager starts a background routine to manage WAL checkpoints
// This prevents WAL file from growing too large and reduces lock contention
func startWALCheckpointManager(db *sql.DB) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				performWALCheckpoint(db)
			}
		}
	}()
}

// performWALCheckpoint checks WAL file size and performs checkpoint if needed
func performWALCheckpoint(db *sql.DB) {
	var busy, walFrames, checkpointedFrames int
	err := db.QueryRow("PRAGMA wal_checkpoint").Scan(&busy, &walFrames, &checkpointedFrames)
	if err != nil {
		logger.Debug("Failed to check WAL status: %v", err)
		return
	}

	// Reduced threshold for more frequent checkpoints during heavy operations
	if walFrames > 500 {
		logger.Debug("WAL file has %d frames, performing checkpoint", walFrames)
		_, err = db.Exec("PRAGMA wal_checkpoint(PASSIVE)")
		if err != nil {
			logger.Warn("Failed to perform WAL checkpoint: %v", err)
		} else {
			logger.Debug("Successfully performed WAL checkpoint")
		}
	}
}

// initWriteQueue initializes the write queue for serializing write operations
func initWriteQueue() {
	dbWriteQueueOnce.Do(func() {
		// Increased buffer size for better handling of deletion bursts
		dbWriteQueue = make(chan func(), 2000)

		go func() {
			logger.Info("Database write queue processor started")
			for writeOp := range dbWriteQueue {
				writeOp()
			}
		}()
	})
}

// executeMainDBWriteOperation queues a write operation for serial execution
func executeMainDBWriteOperation(operation func()) {
	if dbWriteQueue != nil {
		select {
		case dbWriteQueue <- operation:
		default:
			// Add small delay before direct execution to reduce lock contention
			logger.Warn("Database write queue is full, executing operation directly with delay")
			time.Sleep(50 * time.Millisecond)
			operation()
		}
	} else {
		operation()
	}
}

// executeMainDBWriteOperationSync executes a write operation through the write queue (serialized) and waits for completion
func executeMainDBWriteOperationSync(operation func() error) error {
	resultChan := make(chan error, 1)

	executeMainDBWriteOperation(func() {
		resultChan <- operation()
	})

	return <-resultChan
}

// executeMainDBDeletionOperation executes deletion operations with optimized retry logic
func executeMainDBDeletionOperation(operation func() error) error {
	return executeMainDBWriteOperationSync(func() error {
		return executeWithRetryOptimized(operation, 15, 25*time.Millisecond)
	})
}

// executeWithRetryOptimized provides retry logic for specific operation types
func executeWithRetryOptimized(operation func() error, maxRetries int, baseDelay time.Duration) error {
	for attempt := 0; attempt < maxRetries; attempt++ {
		err := operation()
		if err == nil {
			return nil
		}

		// Check if it's a SQLite busy error
		if strings.Contains(err.Error(), "database is locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<uint(attempt/3))
				if delay > 1*time.Second {
					delay = 1*time.Second
				}
				jitter := time.Duration(rand.Int63n(int64(delay / 4)))
				time.Sleep(delay + jitter)
				logger.Debug("Database busy, retrying deletion operation (attempt %d/%d)", attempt+1, maxRetries)
				continue
			}
		}
		return err
	}

	return fmt.Errorf("deletion operation failed after %d retries", maxRetries)
}
