package api

import (
	"cinesync/pkg/logger"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// FileOperation represents a file operation record
type FileOperation struct {
	ID              string `json:"id"`
	FilePath        string `json:"filePath"`
	DestinationPath string `json:"destinationPath,omitempty"`
	FileName        string `json:"fileName"`
	Status          string `json:"status"`
	Timestamp       string `json:"timestamp"`
	Reason          string `json:"reason,omitempty"`
	Error           string `json:"error,omitempty"`
	TmdbID          string `json:"tmdbId,omitempty"`
	SeasonNumber    int    `json:"seasonNumber,omitempty"`
	Type            string `json:"type"`
	Operation       string `json:"operation"`
}

// HandleFileOperations returns file operations data from MediaHub database
func HandleFileOperations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get file operations from MediaHub database
	operations, err := getFileOperationsFromMediaHub()
	if err != nil {
		logger.Warn("Failed to get file operations: %v", err)
		http.Error(w, "Failed to retrieve file operations", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"operations": operations,
		"status":     "success",
	})
}

// HandleTrackDeletion handles POST requests to track file deletions
func HandleTrackDeletion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		SourcePath      string `json:"sourcePath"`
		DestinationPath string `json:"destinationPath"`
		TmdbID          string `json:"tmdbId"`
		SeasonNumber    string `json:"seasonNumber"`
		Reason          string `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.SourcePath == "" {
		http.Error(w, "sourcePath is required", http.StatusBadRequest)
		return
	}

	err := TrackFileDeletion(req.SourcePath, req.DestinationPath, req.TmdbID, req.SeasonNumber, req.Reason)
	if err != nil {
		logger.Warn("Failed to track file deletion: %v", err)
		http.Error(w, "Failed to track deletion", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Deletion tracked successfully",
	})
}

// getFileOperationsFromMediaHub reads file operations from MediaHub database
func getFileOperationsFromMediaHub() ([]FileOperation, error) {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")
	
	// Check if database exists
	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		logger.Warn("MediaHub database not found at %s", mediaHubDBPath)
		return []FileOperation{}, nil
	}

	// Open MediaHub database
	mediaHubDB, err := sql.Open("sqlite", mediaHubDBPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open MediaHub database: %w", err)
	}
	defer mediaHubDB.Close()

	// Ensure deletion tracking table exists
	err = createDeletionTrackingTable(mediaHubDB)
	if err != nil {
		// Table creation failed, but continue silently
	}

	// Query processed files
	query := `
		SELECT 
			file_path,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason
		FROM processed_files 
		ORDER BY rowid DESC 
		LIMIT 1000
	`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query processed files: %w", err)
	}
	defer rows.Close()

	var operations []FileOperation
	for rows.Next() {
		var op FileOperation
		var seasonStr string
		
		err := rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason)
		if err != nil {
			logger.Warn("Failed to scan row: %v", err)
			continue
		}

		// Generate ID from file path hash
		op.ID = fmt.Sprintf("%x", sha256.Sum256([]byte(op.FilePath)))
		
		// Extract filename from path
		op.FileName = filepath.Base(op.FilePath)
		
		// Determine status based on destination path and reason
		if op.DestinationPath != "" && op.DestinationPath != "NULL" {
			if _, err := os.Stat(op.DestinationPath); err == nil {
				op.Status = "created"
			} else {
				op.Status = "failed"
				if op.Reason == "" {
					op.Reason = "Destination file not found"
				}
			}
		} else if op.Reason != "" && op.Reason != "NULL" {
			reasonLower := strings.ToLower(op.Reason)
			if strings.Contains(reasonLower, "error") || strings.Contains(reasonLower, "exception") || strings.Contains(reasonLower, "failed") {
				op.Status = "error"
				op.Error = op.Reason
			} else {
				op.Status = "failed"
			}
		} else {
			op.Status = "failed"
			op.Reason = "No destination path or reason provided"
		}

		// Parse season number
		if seasonStr != "" && seasonStr != "NULL" {
			if seasonNum, err := strconv.Atoi(seasonStr); err == nil {
				op.SeasonNumber = seasonNum
			}
		}

		// Determine media type
		op.Type = "other"
		if op.TmdbID != "" && op.TmdbID != "NULL" {
			if op.SeasonNumber > 0 {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			// Try to determine from file extension and path
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") {
					op.Type = "tvshow"
				} else if strings.Contains(pathLower, "movie") {
					op.Type = "movie"
				}
			}
		}

		// Set operation type
		op.Operation = "process"

		// Try to get timestamp from file modification time, fallback to current time
		if info, err := os.Stat(op.FilePath); err == nil {
			op.Timestamp = info.ModTime().Format(time.RFC3339)
		} else if op.DestinationPath != "" {
			if info, err := os.Stat(op.DestinationPath); err == nil {
				op.Timestamp = info.ModTime().Format(time.RFC3339)
			} else {
				op.Timestamp = time.Now().Format(time.RFC3339)
			}
		} else {
			op.Timestamp = time.Now().Format(time.RFC3339)
		}

		operations = append(operations, op)
	}

	// Also get deletion records
	deletions, err := getDeletionRecords(mediaHubDB)
	if err != nil {
		logger.Warn("Failed to get deletion records: %v", err)
	} else {
		operations = append(operations, deletions...)
	}

	return operations, nil
}

// createDeletionTrackingTable creates the deletion tracking table if it doesn't exist
func createDeletionTrackingTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS file_deletions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_path TEXT NOT NULL,
			destination_path TEXT,
			tmdb_id TEXT,
			season_number TEXT,
			deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			reason TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_file_deletions_source ON file_deletions(source_path);
		CREATE INDEX IF NOT EXISTS idx_file_deletions_deleted_at ON file_deletions(deleted_at);
	`
	_, err := db.Exec(query)
	return err
}

// getDeletionRecords retrieves deletion records from the database
func getDeletionRecords(db *sql.DB) ([]FileOperation, error) {
	query := `
		SELECT 
			source_path,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason,
			deleted_at
		FROM file_deletions 
		ORDER BY deleted_at DESC 
		LIMIT 500
	`

	rows, err := db.Query(query)
	if err != nil {
		logger.Warn("Failed to query file_deletions table: %v", err)
		return []FileOperation{}, nil
	}
	defer rows.Close()
	
	// Check if table has any records
	var count int
	countQuery := "SELECT COUNT(*) FROM file_deletions"
	err = db.QueryRow(countQuery).Scan(&count)
	if err != nil {
		logger.Warn("Failed to count deletion records: %v", err)
	}

	var operations []FileOperation
	for rows.Next() {
		var op FileOperation
		var seasonStr, deletedAt string
		
		err := rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason, &deletedAt)
		if err != nil {
			logger.Warn("Failed to scan deletion row: %v", err)
			continue
		}

		// Generate ID from file path hash with deletion prefix
		op.ID = fmt.Sprintf("del_%x", sha256.Sum256([]byte(op.FilePath+deletedAt)))
		op.FileName = filepath.Base(op.FilePath)
		op.Status = "deleted"
		op.Operation = "delete"
		op.Timestamp = deletedAt

		// Parse season number
		if seasonStr != "" && seasonStr != "NULL" {
			if seasonNum, err := strconv.Atoi(seasonStr); err == nil {
				op.SeasonNumber = seasonNum
			}
		}

		// Determine media type
		op.Type = "other"
		if op.TmdbID != "" && op.TmdbID != "NULL" {
			if op.SeasonNumber > 0 {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			// Try to determine from file extension and path
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") {
					op.Type = "tvshow"
				} else if strings.Contains(pathLower, "movie") {
					op.Type = "movie"
				}
			}
		}

		operations = append(operations, op)
	}

	return operations, nil
}

// TrackFileDeletion records a file deletion event
func TrackFileDeletion(sourcePath, destinationPath, tmdbID, seasonNumber, reason string) error {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")
	
	// Check if database exists
	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		return fmt.Errorf("MediaHub database not found")
	}

	// Open MediaHub database
	mediaHubDB, err := sql.Open("sqlite", mediaHubDBPath)
	if err != nil {
		return fmt.Errorf("failed to open MediaHub database: %w", err)
	}
	defer mediaHubDB.Close()

	// Ensure table exists
	err = createDeletionTrackingTable(mediaHubDB)
	if err != nil {
		return fmt.Errorf("failed to create deletion tracking table: %w", err)
	}

	// Insert deletion record
	query := `
		INSERT INTO file_deletions (source_path, destination_path, tmdb_id, season_number, reason)
		VALUES (?, ?, ?, ?, ?)
	`
	_, err = mediaHubDB.Exec(query, sourcePath, destinationPath, tmdbID, seasonNumber, reason)
	if err != nil {
		return fmt.Errorf("failed to insert deletion record: %w", err)
	}

	logger.Info("Tracked file deletion: %s -> %s", sourcePath, destinationPath)
	return nil
}
