package db

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

// HandleFileOperations handles both GET (retrieve operations) and POST (track operations)
func HandleFileOperations(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGetFileOperations(w, r)
	case http.MethodPost:
		handleTrackFileOperation(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetFileOperations returns file operations data from MediaHub database
func handleGetFileOperations(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	statusFilter := r.URL.Query().Get("status")

	limit := 50
	if limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	offset := 0
	if offsetStr != "" {
		if parsedOffset, err := strconv.Atoi(offsetStr); err == nil && parsedOffset >= 0 {
			offset = parsedOffset
		}
	}

	// Get file operations from MediaHub database
	operations, total, err := getFileOperationsFromMediaHub(limit, offset, statusFilter)
	if err != nil {
		logger.Warn("Failed to get file operations: %v", err)
		http.Error(w, "Failed to retrieve file operations", http.StatusInternalServerError)
		return
	}

	// Get status counts
	statusCounts, err := getStatusCounts(operations, total)
	if err != nil {
		logger.Warn("Failed to get status counts: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"operations":   operations,
		"total":        total,
		"statusCounts": statusCounts,
		"status":       "success",
	})
}

// handleTrackFileOperation tracks file additions and deletions
func handleTrackFileOperation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Operation       string `json:"operation"`       // "add", "delete", or "failed"
		SourcePath      string `json:"sourcePath"`
		DestinationPath string `json:"destinationPath"`
		TmdbID          string `json:"tmdbId"`
		SeasonNumber    string `json:"seasonNumber"`
		Reason          string `json:"reason"`
		Error           string `json:"error"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.SourcePath == "" {
		http.Error(w, "sourcePath is required", http.StatusBadRequest)
		return
	}

	if req.Operation == "" {
		http.Error(w, "operation is required (add or delete)", http.StatusBadRequest)
		return
	}

	var message string
	var err error

	switch req.Operation {
	case "add":
		message = "Addition tracked successfully"

	case "delete":
		err = TrackFileDeletion(req.SourcePath, req.DestinationPath, req.TmdbID, req.SeasonNumber, req.Reason)
		if err != nil {
			logger.Warn("Failed to track file deletion: %v", err)
			http.Error(w, "Failed to track deletion", http.StatusInternalServerError)
			return
		}
		message = "Deletion tracked successfully"

	case "failed":
		err = TrackFileFailure(req.SourcePath, req.TmdbID, req.SeasonNumber, req.Reason, req.Error)
		if err != nil {
			logger.Warn("Failed to track file failure: %v", err)
			http.Error(w, "Failed to track failure", http.StatusInternalServerError)
			return
		}
		message = "Failure tracked successfully"

	default:
		http.Error(w, "Invalid operation. Must be 'add', 'delete', or 'failed'", http.StatusBadRequest)
		return
	}

	// Notify dashboard about stats change
	NotifyDashboardStatsChanged()

	// Notify file operations subscribers about the change
	NotifyFileOperationChanged()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": message,
	})
}



// getFileOperationsFromMediaHub reads file operations from MediaHub database
func getFileOperationsFromMediaHub(limit, offset int, statusFilter string) ([]FileOperation, int, error) {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

	// Check if database exists
	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		logger.Warn("MediaHub database not found at %s", mediaHubDBPath)
		return []FileOperation{}, 0, nil
	}

	// Get database connection from pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get database connection: %w", err)
	}

	// Ensure deletion tracking table exists
	err = createDeletionTrackingTable(mediaHubDB)
	if err != nil {
		// Table creation failed, but continue silently
	}

	// Build WHERE clause for status filtering
	var whereClause string
	var args []interface{}

	if statusFilter == "deleted" {
		// Handle deletions separately
		var totalDeletions int
		err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM file_deletions").Scan(&totalDeletions)
		if err != nil {
			logger.Warn("Failed to get total deletions count: %v", err)
			totalDeletions = 0
		}

		deletions, err := getDeletionRecordsWithPagination(mediaHubDB, limit, offset)
		if err != nil {
			logger.Warn("Failed to get deletion records: %v", err)
			return []FileOperation{}, 0, nil
		}

		return deletions, totalDeletions, nil
	}

	if statusFilter == "failed" {
		// Handle failures separately - combine processed files failures and file_failures table
		var totalFailures int

		// Count from processed_files table
		processedFailuresQuery := "SELECT COUNT(*) FROM processed_files WHERE (destination_path IS NULL OR destination_path = '') AND (reason IS NULL OR reason = '' OR (LOWER(reason) NOT LIKE '%skipped%' AND LOWER(reason) NOT LIKE '%extra%' AND LOWER(reason) NOT LIKE '%special content%' AND LOWER(reason) NOT LIKE '%unsupported%' AND LOWER(reason) NOT LIKE '%adult content%' AND LOWER(reason) NOT LIKE '%error%' AND LOWER(reason) NOT LIKE '%exception%' AND LOWER(reason) NOT LIKE '%failed%'))"
		var processedFailures int
		err = mediaHubDB.QueryRow(processedFailuresQuery).Scan(&processedFailures)
		if err != nil {
			logger.Warn("Failed to get processed failures count: %v", err)
			processedFailures = 0
		}

		// Count from file_failures table
		var fileFailures int
		err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM file_failures").Scan(&fileFailures)
		if err != nil {
			logger.Warn("Failed to get file failures count: %v", err)
			fileFailures = 0
		}

		totalFailures = processedFailures + fileFailures

		failures, err := getFailureRecordsWithPagination(mediaHubDB, limit, offset)
		if err != nil {
			logger.Warn("Failed to get failure records: %v", err)
			return []FileOperation{}, 0, nil
		}

		return failures, totalFailures, nil
	}

	// Build status filter for processed files
	if statusFilter != "" {
		switch statusFilter {
		case "created":
			whereClause = "WHERE destination_path IS NOT NULL AND destination_path != ''"
		case "failed":
			// Combine both failed and error cases - any operation that didn't succeed
			whereClause = "WHERE (destination_path IS NULL OR destination_path = '') AND (reason IS NULL OR reason = '' OR (LOWER(reason) NOT LIKE '%skipped%' AND LOWER(reason) NOT LIKE '%extra%' AND LOWER(reason) NOT LIKE '%special content%' AND LOWER(reason) NOT LIKE '%unsupported%' AND LOWER(reason) NOT LIKE '%adult content%'))"
		case "skipped":
			whereClause = "WHERE reason IS NOT NULL AND reason != '' AND (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR LOWER(reason) LIKE '%adult content%')"
		}
	}

	// Get total count for filtered results
	countQuery := "SELECT COUNT(*) FROM processed_files " + whereClause
	var totalCount int
	err = mediaHubDB.QueryRow(countQuery, args...).Scan(&totalCount)
	if err != nil {
		logger.Warn("Failed to get total count: %v", err)
		totalCount = 0
	}

	// Query processed files with pagination and filtering
	query := `
		SELECT
			file_path,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason
		FROM processed_files ` + whereClause + `
		ORDER BY rowid DESC
		LIMIT ? OFFSET ?
	`
	args = append(args, limit, offset)

	rows, err := mediaHubDB.Query(query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query processed files: %w", err)
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
			if strings.Contains(reasonLower, "skipped") ||
			   strings.Contains(reasonLower, "extra") ||
			   strings.Contains(reasonLower, "special content") ||
			   strings.Contains(reasonLower, "unsupported file type") ||
			   strings.Contains(reasonLower, "adult content") {
				op.Status = "skipped"
			} else {
				op.Status = "failed"
				if strings.Contains(reasonLower, "error") || strings.Contains(reasonLower, "exception") || strings.Contains(reasonLower, "failed") {
					op.Error = op.Reason
				}
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

	return operations, totalCount, nil
}

// getStatusCounts gets the count of operations by status from the database
func getStatusCounts(operations []FileOperation, total int) (map[string]int, error) {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

	// Check if database exists
	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		return map[string]int{}, nil
	}

	// Get database connection from pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return nil, fmt.Errorf("failed to get database connection: %w", err)
	}

	counts := map[string]int{
		"created":  0,
		"failed":   0,
		"skipped":  0,
		"deleted":  0,
	}

	// Count processed files by status
	query := `
		SELECT
			CASE
				WHEN destination_path IS NOT NULL AND destination_path != '' THEN 'created'
				WHEN reason IS NOT NULL AND reason != '' THEN
					CASE
						WHEN LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
							 LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
							 LOWER(reason) LIKE '%adult content%' THEN 'skipped'
						ELSE 'failed'
					END
				ELSE 'failed'
			END as status,
			COUNT(*) as count
		FROM processed_files
		GROUP BY status
	`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		logger.Warn("Failed to query status counts: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var status string
			var count int
			if err := rows.Scan(&status, &count); err == nil {
				counts[status] = count
			}
		}
	}

	// Count deletions
	var deletionCount int
	err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM file_deletions").Scan(&deletionCount)
	if err != nil {
		logger.Warn("Failed to get deletion count: %v", err)
	} else {
		counts["deleted"] = deletionCount
	}

	// Count failures from file_failures table and add to existing failed count
	var fileFailureCount int
	err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM file_failures").Scan(&fileFailureCount)
	if err != nil {
		logger.Warn("Failed to get file failure count: %v", err)
	} else {
		counts["failed"] += fileFailureCount
	}

	return counts, nil
}

// Global variables to track file operation notification subscribers
var fileOperationNotificationChannels = make(map[chan bool]bool)
var fileOperationChannelMutex = make(chan bool, 1)

// NotifyFileOperationChanged sends a notification to all file operation subscribers
func NotifyFileOperationChanged() {
	fileOperationChannelMutex <- true
	defer func() { <-fileOperationChannelMutex }()

	for ch := range fileOperationNotificationChannels {
		select {
		case ch <- true:
		default:
			delete(fileOperationNotificationChannels, ch)
		}
	}
}

// subscribeToFileOperationNotifications adds a channel to receive file operation notifications
func subscribeToFileOperationNotifications() chan bool {
	fileOperationChannelMutex <- true
	defer func() { <-fileOperationChannelMutex }()

	ch := make(chan bool, 1)
	fileOperationNotificationChannels[ch] = true
	return ch
}

// unsubscribeFromFileOperationNotifications removes a channel from file operation notifications
func unsubscribeFromFileOperationNotifications(ch chan bool) {
	fileOperationChannelMutex <- true
	defer func() { <-fileOperationChannelMutex }()

	delete(fileOperationNotificationChannels, ch)
	close(ch)
}

// HandleFileOperationEvents provides Server-Sent Events for file operation updates
func HandleFileOperationEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Subscribe to file operation notifications
	notificationCh := subscribeToFileOperationNotifications()
	defer unsubscribeFromFileOperationNotifications(notificationCh)

	// Send initial connection message
	fmt.Fprintf(w, "data: {\"type\":\"connected\"}\n\n")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Listen for notifications or client disconnect
	for {
		select {
		case <-notificationCh:
			fmt.Fprintf(w, "data: {\"type\":\"file_operation_update\"}\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
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

// getDeletionRecordsWithPagination retrieves deletion records with pagination
func getDeletionRecordsWithPagination(db *sql.DB, limit, offset int) ([]FileOperation, error) {
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
		LIMIT ? OFFSET ?
	`

	rows, err := db.Query(query, limit, offset)
	if err != nil {
		logger.Warn("Failed to query file_deletions table: %v", err)
		return []FileOperation{}, nil
	}
	defer rows.Close()

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

// getFailureRecordsWithPagination retrieves failure records with pagination from both tables
func getFailureRecordsWithPagination(db *sql.DB, limit, offset int) ([]FileOperation, error) {
	var operations []FileOperation

	// First get failures from file_failures table
	failuresQuery := `
		SELECT
			source_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason,
			COALESCE(error_message, '') as error_message,
			failed_at
		FROM file_failures
		ORDER BY failed_at DESC
		LIMIT ? OFFSET ?
	`

	rows, err := db.Query(failuresQuery, limit, offset)
	if err != nil {
		logger.Warn("Failed to query file_failures table: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var op FileOperation
			var seasonStr, failedAt string

			err := rows.Scan(&op.FilePath, &op.TmdbID, &seasonStr, &op.Reason, &op.Error, &failedAt)
			if err != nil {
				logger.Warn("Failed to scan failure row: %v", err)
				continue
			}

			// Generate ID from file path hash with failure prefix
			op.ID = fmt.Sprintf("fail_%x", sha256.Sum256([]byte(op.FilePath+failedAt)))
			op.FileName = filepath.Base(op.FilePath)
			op.Status = "failed"
			op.Operation = "process"
			op.Timestamp = failedAt

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
	}

	// If we still have room in the limit, get failures from processed_files table
	remainingLimit := limit - len(operations)
	if remainingLimit > 0 {
		processedFailuresQuery := `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(reason, '') as reason
			FROM processed_files
			WHERE (destination_path IS NULL OR destination_path = '') AND
				  (reason IS NULL OR reason = '' OR
				   (LOWER(reason) NOT LIKE '%skipped%' AND LOWER(reason) NOT LIKE '%extra%' AND
				    LOWER(reason) NOT LIKE '%special content%' AND LOWER(reason) NOT LIKE '%unsupported%' AND
				    LOWER(reason) NOT LIKE '%adult content%' AND LOWER(reason) NOT LIKE '%error%' AND
				    LOWER(reason) NOT LIKE '%exception%' AND LOWER(reason) NOT LIKE '%failed%'))
			ORDER BY rowid DESC
			LIMIT ? OFFSET ?
		`

		adjustedOffset := offset - len(operations)
		if adjustedOffset < 0 {
			adjustedOffset = 0
		}

		rows, err := db.Query(processedFailuresQuery, remainingLimit, adjustedOffset)
		if err != nil {
			logger.Warn("Failed to query processed_files for failures: %v", err)
		} else {
			defer rows.Close()
			for rows.Next() {
				var op FileOperation
				var seasonStr string

				err := rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason)
				if err != nil {
					logger.Warn("Failed to scan processed failure row: %v", err)
					continue
				}

				// Generate ID from file path hash
				op.ID = fmt.Sprintf("%x", sha256.Sum256([]byte(op.FilePath)))
				op.FileName = filepath.Base(op.FilePath)
				op.Status = "failed"
				op.Operation = "process"

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

				// Try to get timestamp from file modification time
				if info, err := os.Stat(op.FilePath); err == nil {
					op.Timestamp = info.ModTime().Format(time.RFC3339)
				} else {
					op.Timestamp = time.Now().Format(time.RFC3339)
				}

				operations = append(operations, op)
			}
		}
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

	// Get database connection from pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %w", err)
	}

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

	return nil
}

// TrackFileFailure records a file processing failure event
func TrackFileFailure(sourcePath, tmdbID, seasonNumber, reason, errorMessage string) error {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

	// Check if database exists
	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		return fmt.Errorf("MediaHub database not found")
	}

	// Get database connection from pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return fmt.Errorf("failed to get database connection: %w", err)
	}

	// Ensure table exists
	err = createFailureTrackingTable(mediaHubDB)
	if err != nil {
		return fmt.Errorf("failed to create failure tracking table: %w", err)
	}

	// Insert failure record
	query := `
		INSERT INTO file_failures (source_path, tmdb_id, season_number, reason, error_message)
		VALUES (?, ?, ?, ?, ?)
	`
	_, err = mediaHubDB.Exec(query, sourcePath, tmdbID, seasonNumber, reason, errorMessage)
	if err != nil {
		return fmt.Errorf("failed to insert failure record: %w", err)
	}

	return nil
}

// createFailureTrackingTable creates the failure tracking table if it doesn't exist
func createFailureTrackingTable(db *sql.DB) error {
	query := `
		CREATE TABLE IF NOT EXISTS file_failures (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			source_path TEXT NOT NULL,
			tmdb_id TEXT,
			season_number TEXT,
			failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			reason TEXT,
			error_message TEXT
		);
		CREATE INDEX IF NOT EXISTS idx_file_failures_source ON file_failures(source_path);
		CREATE INDEX IF NOT EXISTS idx_file_failures_failed_at ON file_failures(failed_at);
	`
	_, err := db.Exec(query)
	return err
}

// Global variables to track dashboard notification subscribers
var dashboardNotificationChannels = make(map[chan bool]bool)
var dashboardChannelMutex = make(chan bool, 1)

// NotifyDashboardStatsChanged sends a notification to all dashboard subscribers
func NotifyDashboardStatsChanged() {
	dashboardChannelMutex <- true
	defer func() { <-dashboardChannelMutex }()

	for ch := range dashboardNotificationChannels {
		select {
		case ch <- true:
		default:
			delete(dashboardNotificationChannels, ch)
		}
	}
}

// subscribeToDashboardNotifications adds a channel to receive dashboard notifications
func subscribeToDashboardNotifications() chan bool {
	dashboardChannelMutex <- true
	defer func() { <-dashboardChannelMutex }()

	ch := make(chan bool, 1)
	dashboardNotificationChannels[ch] = true
	return ch
}

// unsubscribeFromDashboardNotifications removes a channel from dashboard notifications
func unsubscribeFromDashboardNotifications(ch chan bool) {
	dashboardChannelMutex <- true
	defer func() { <-dashboardChannelMutex }()

	delete(dashboardNotificationChannels, ch)
	close(ch)
}

// HandleDashboardEvents provides Server-Sent Events for dashboard updates
func HandleDashboardEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Subscribe to dashboard notifications
	notificationCh := subscribeToDashboardNotifications()
	defer unsubscribeFromDashboardNotifications(notificationCh)

	// Send initial connection message
	fmt.Fprintf(w, "data: {\"type\":\"connected\"}\n\n")
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Listen for notifications or client disconnect
	for {
		select {
		case <-notificationCh:
			fmt.Fprintf(w, "data: {\"type\":\"stats_changed\"}\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		case <-r.Context().Done():
			// Client disconnected
			return
		}
	}
}
