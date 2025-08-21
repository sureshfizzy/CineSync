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

type FileOperationNotifier func(operation, filePath string)

var fileOperationNotifier FileOperationNotifier

func SetFileOperationNotifier(notifier FileOperationNotifier) {
	fileOperationNotifier = notifier
}

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
	case http.MethodDelete:
		if strings.HasSuffix(r.URL.Path, "/bulk") {
			handleBulkDeleteSelectedFiles(w, r)
		} else {
			handleBulkDeleteSkippedFiles(w, r)
		}
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetFileOperations returns file operations data from MediaHub database
func handleGetFileOperations(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	statusFilter := r.URL.Query().Get("status")
	searchQuery := strings.TrimSpace(r.URL.Query().Get("search"))

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
	operations, total, err := getFileOperationsFromMediaHub(limit, offset, statusFilter, searchQuery)
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
		Operation       string `json:"operation"`       // "add", "delete", "failed", or "force_recreate"
		SourcePath      string `json:"sourcePath"`
		DestinationPath string `json:"destinationPath"`
		TmdbID          string `json:"tmdbId"`
		SeasonNumber    string `json:"seasonNumber"`
		Reason          string `json:"reason"`
		Error           string `json:"error"`
		ProperName      string `json:"properName"`
		Year            string `json:"year"`
		MediaType       string `json:"mediaType"`
		OldDestinationPath string `json:"oldDestinationPath"`
		OldProperName      string `json:"oldProperName"`
		OldYear            string `json:"oldYear"`
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
		if req.DestinationPath != "" {
			trashDir := filepath.Join("..", "db", "trash")
			baseName := filepath.Base(req.DestinationPath)
			
			if entries, err := os.ReadDir(trashDir); err == nil {
				name, ext, _ := strings.Cut(baseName, ".")
				if ext != "" {
					ext = "." + ext
				}
				
				for _, entry := range entries {
					entryName := entry.Name()
					// Check for exact match or numbered variations or random suffix variations
					if entryName == baseName || 
					   strings.HasPrefix(entryName, name+" (") && strings.HasSuffix(entryName, ")"+ext) ||
					   strings.HasPrefix(entryName, baseName+".") {
						trashFilePath := filepath.Join(trashDir, entryName)
						if err := os.Remove(trashFilePath); err != nil {
							logger.Warn("Failed to remove trash file %s: %v", trashFilePath, err)
						} else {
							logger.Info("Removed trash file: %s", trashFilePath)
						}
					}
				}
			}
			
			// Remove from MediaHub's deleted_files table
			if mediaHubDB, err := GetDatabaseConnection(); err == nil {
				mediaHubDB.Exec(`DELETE FROM deleted_files WHERE destination_path = ? OR file_path = ?`, req.DestinationPath, req.SourcePath)
			}
			// Remove from file_deletions table
			if mediaHubDB, err := GetDatabaseConnection(); err == nil {
				mediaHubDB.Exec(`DELETE FROM file_deletions WHERE destination_path = ? OR source_path = ?`, req.DestinationPath, req.SourcePath)
			}
		}

		message = "Addition tracked successfully"
		if req.ProperName != "" && req.MediaType != "" {
			seasonNumber := 0
			if req.SeasonNumber != "" {
				if sn, err := strconv.Atoi(req.SeasonNumber); err == nil {
					seasonNumber = sn
				}
			}
			UpdateFolderCacheForNewFile(req.DestinationPath, req.ProperName, req.Year, req.TmdbID, req.MediaType, seasonNumber)
		} else {
			UpdateFolderCacheForNewFileFromDB(req.DestinationPath, req.TmdbID, req.SeasonNumber)
		}

		if fileOperationNotifier != nil && req.DestinationPath != "" {
			fileOperationNotifier("add", req.DestinationPath)
		}

	case "delete":
		err = TrackFileDeletion(req.SourcePath, req.DestinationPath, req.TmdbID, req.SeasonNumber, req.Reason)
		if err != nil {
			logger.Warn("Failed to track file deletion: %v", err)
			http.Error(w, "Failed to track deletion", http.StatusInternalServerError)
			return
		}
		message = "Deletion tracked successfully"
		if req.ProperName != "" {
			RemoveFolderFromCache(req.DestinationPath, req.ProperName, req.Year)
		} else {
			RemoveFolderFromCacheFromDB(req.DestinationPath, req.TmdbID)
		}

	case "failed":
		err = TrackFileFailure(req.SourcePath, req.TmdbID, req.SeasonNumber, req.Reason, req.Error)
		if err != nil {
			logger.Warn("Failed to track file failure: %v", err)
			http.Error(w, "Failed to track failure", http.StatusInternalServerError)
			return
		}
		message = "Failure tracked successfully"

	case "force_recreate":
		message = "Force recreation tracked successfully"
		if req.OldDestinationPath != "" && req.OldProperName != "" {
			RemoveFolderFromCache(req.OldDestinationPath, req.OldProperName, req.OldYear)
		}

		if req.ProperName != "" && req.MediaType != "" {
			seasonNumber := 0
			if req.SeasonNumber != "" {
				if sn, err := strconv.Atoi(req.SeasonNumber); err == nil {
					seasonNumber = sn
				}
			}
			UpdateFolderCacheForNewFile(req.DestinationPath, req.ProperName, req.Year, req.TmdbID, req.MediaType, seasonNumber)
		} else {
			UpdateFolderCacheForNewFileFromDB(req.DestinationPath, req.TmdbID, req.SeasonNumber)
		}

	default:
		http.Error(w, "Invalid operation. Must be 'add', 'delete', 'failed', or 'force_recreate'", http.StatusBadRequest)
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

// handleBulkDeleteSkippedFiles handles bulk deletion of all skipped files from the database
func handleBulkDeleteSkippedFiles(w http.ResponseWriter, r *http.Request) {
	// Get database connection
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Warn("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Count skipped files before deletion
	countQuery := `
		SELECT COUNT(*) FROM processed_files
		WHERE reason IS NOT NULL AND reason != '' AND
		(LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
		 LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
		 LOWER(reason) LIKE '%adult content%')
	`
	var skippedCount int
	err = mediaHubDB.QueryRow(countQuery).Scan(&skippedCount)
	if err != nil {
		logger.Warn("Failed to count skipped files: %v", err)
		http.Error(w, "Failed to count skipped files", http.StatusInternalServerError)
		return
	}

	if skippedCount == 0 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "No skipped files found to delete",
			"deletedCount": 0,
		})
		return
	}

	// Get the file paths that will be deleted for recent media cleanup
	selectQuery := `
		SELECT COALESCE(file_path, ''), COALESCE(destination_path, '')
		FROM processed_files
		WHERE reason IS NOT NULL AND reason != '' AND
		(LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
		 LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
		 LOWER(reason) LIKE '%adult content%')
	`
	rows, err := mediaHubDB.Query(selectQuery)
	if err != nil {
		logger.Warn("Failed to query skipped files for cleanup: %v", err)
		http.Error(w, "Failed to query skipped files", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var pathsToCleanup []string
	for rows.Next() {
		var filePath, destPath string
		if err := rows.Scan(&filePath, &destPath); err != nil {
			logger.Warn("Failed to scan file paths: %v", err)
			continue
		}
		if filePath != "" {
			pathsToCleanup = append(pathsToCleanup, filePath)
		}
		if destPath != "" && destPath != filePath {
			pathsToCleanup = append(pathsToCleanup, destPath)
		}
	}

	// Delete all skipped files
	deleteQuery := `
		DELETE FROM processed_files
		WHERE reason IS NOT NULL AND reason != '' AND
		(LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
		 LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
		 LOWER(reason) LIKE '%adult content%')
	`
	result, err := mediaHubDB.Exec(deleteQuery)
	if err != nil {
		logger.Warn("Failed to delete skipped files: %v", err)
		http.Error(w, "Failed to delete skipped files", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Warn("Failed to get rows affected: %v", err)
		rowsAffected = int64(skippedCount) // fallback to counted value
	}

	logger.Info("Bulk deleted %d skipped files from database", rowsAffected)

	// Clean up recent media entries for deleted paths
	for _, path := range pathsToCleanup {
		if removeErr := RemoveRecentMediaByPath(path); removeErr != nil {
			logger.Warn("Failed to remove recent media for path %s: %v", path, removeErr)
		}
	}

	// Notify dashboard about stats change
	NotifyDashboardStatsChanged()

	// Notify file operations subscribers about the change
	NotifyFileOperationChanged()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Successfully deleted %d skipped files from database", rowsAffected),
		"deletedCount": rowsAffected,
	})
}

// BulkActionRequest represents a bulk action request
type BulkActionRequest struct {
	FilePaths []string `json:"filePaths"`
}

// handleBulkDeleteSelectedFiles handles permanent deletion of selected files from the deleted tab
func handleBulkDeleteSelectedFiles(w http.ResponseWriter, r *http.Request) {
	var req BulkActionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.FilePaths) == 0 {
		http.Error(w, "No file paths provided", http.StatusBadRequest)
		return
	}

	// Get database connection
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Warn("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	logger.Info("Database connection successful for permanent deletion")

	deletedFromTrash := 0
	var errors []string

	logger.Info("Processing permanent deletion request for IDs: %v", req.FilePaths)
	for _, fileIDStr := range req.FilePaths {
		fileID, err := strconv.Atoi(fileIDStr)
		if err != nil {
			logger.Warn("Invalid file ID: %s", fileIDStr)
			errors = append(errors, fmt.Sprintf("Invalid file ID: %s", fileIDStr))
			continue
		}
		logger.Info("Processing permanent deletion for ID: %d", fileID)

		// Get file info from MediaHub's deleted_files table
		var destinationPath, trashFileName string
		err = mediaHubDB.QueryRow(`
			SELECT COALESCE(destination_path, ''), COALESCE(trash_file_name, '') 
			FROM deleted_files WHERE id = ?
		`, fileID).Scan(&destinationPath, &trashFileName)
		
		if err != nil {
			logger.Warn("File ID %d not found in deleted files: %v", fileID, err)
			errors = append(errors, fmt.Sprintf("File ID %d not found in deleted files", fileID))
			continue
		}
		logger.Info("Found deleted file record: ID=%d, destination=%s, trash_file=%s", fileID, destinationPath, trashFileName)

		// Permanently delete the trash file
		if trashFileName != "" {
			trashFilePath := filepath.Join("..", "db", "trash", trashFileName)
			absTrashPath, _ := filepath.Abs(trashFilePath)
			if _, err := os.Stat(absTrashPath); err == nil {
				if err := os.Remove(absTrashPath); err != nil {
					logger.Warn("Failed to remove trash file %s: %v", trashFileName, err)
					errors = append(errors, fmt.Sprintf("Failed to remove trash file %s: %v", trashFileName, err))
				} else {
					logger.Info("Successfully deleted trash file: %s", absTrashPath)
					deletedFromTrash++
				}
			} else {
				logger.Warn("Trash file not found at %s: %v", absTrashPath, err)
			}
		} else {
			logger.Warn("No trash file name provided for ID %d", fileID)
		}

		// Remove from MediaHub's deleted_files table
		logger.Info("Removing database record for ID: %d", fileID)
		result, err := mediaHubDB.Exec("DELETE FROM deleted_files WHERE id = ?", fileID)
		if err != nil {
			logger.Warn("Failed to remove file ID %d from deleted_files: %v", fileID, err)
			errors = append(errors, fmt.Sprintf("Failed to remove file ID %d from deleted_files: %v", fileID, err))
		} else {
			rowsAffected, _ := result.RowsAffected()
			logger.Info("Successfully removed database record for ID %d, rows affected: %d", fileID, rowsAffected)
		}
	}

	logger.Info("Permanently deleted %d file(s) from trash", deletedFromTrash)

	if len(req.FilePaths) > 0 {
		go func() {
			for _, filePath := range req.FilePaths {
				if removeErr := RemoveRecentMediaByPath(filePath); removeErr != nil {
					logger.Warn("Failed to remove recent media for path %s: %v", filePath, removeErr)
				}
			}
		}()
	}

	// Notify dashboard about stats change
	NotifyDashboardStatsChanged()

	// Notify file operations subscribers about the change
	NotifyFileOperationChanged()

	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Permanently deleted %d file(s) from trash", deletedFromTrash),
		"deletedCount": deletedFromTrash,
	}
	
	if len(errors) > 0 {
		response["errors"] = errors
	}
	
	json.NewEncoder(w).Encode(response)
}

// getFileOperationsFromMediaHub reads file operations from MediaHub database
func getFileOperationsFromMediaHub(limit, offset int, statusFilter, searchQuery string) ([]FileOperation, int, error) {
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

	var testCount int
	err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM processed_files LIMIT 1").Scan(&testCount)
	if err != nil {
		if strings.Contains(err.Error(), "no such table: processed_files") {
			logger.Debug("processed_files table does not exist yet - MediaHub service needs to be started first")
			return []FileOperation{}, 0, nil
		}
		logger.Debug("Error checking processed_files table: %v", err)
		return []FileOperation{}, 0, nil
	}

	// Ensure deletion tracking table exists
	err = createDeletionTrackingTable(mediaHubDB)
	if err != nil {
	}

	// Build WHERE clause for status filtering
	var whereClause string
	var args []interface{}

	if statusFilter == "deleted" {
		// Read directly from MediaHub's deleted_files table
		deletions, err := getDeletedFilesFromMediaHub(mediaHubDB, limit, offset, searchQuery)
		if err != nil {
			logger.Warn("Failed to get deleted files from MediaHub: %v", err)
			return []FileOperation{}, 0, nil
		}

		// Get total count
		totalDeleted, err := getDeletedFilesCountFromMediaHub(mediaHubDB, searchQuery)
		if err != nil {
			logger.Warn("Failed to get deleted files count: %v", err)
			totalDeleted = len(deletions)
		}

		return deletions, totalDeleted, nil
	}

	if statusFilter == "failed" {
		// Check if reason column exists
		var hasReasonColumn bool
		var dummy sql.NullString
		err = mediaHubDB.QueryRow("SELECT reason FROM processed_files LIMIT 1").Scan(&dummy)
		hasReasonColumn = err == nil || !strings.Contains(err.Error(), "no such column")

		var totalFailures int
		if !hasReasonColumn {
			totalFailures = 0
		} else {
			var failuresQuery string
			var countArgs []interface{}

			if searchQuery != "" {
				searchPattern := "%" + searchQuery + "%"
				failuresQuery = `
					SELECT COUNT(*) FROM processed_files
					WHERE reason IS NOT NULL AND reason != '' AND
						  NOT (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
							   LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
							   LOWER(reason) LIKE '%adult content%') AND
						  (file_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR reason LIKE ?)
				`
				countArgs = []interface{}{searchPattern, searchPattern, searchPattern, searchPattern}
			} else {
				failuresQuery = `
					SELECT COUNT(*) FROM processed_files
					WHERE reason IS NOT NULL AND reason != '' AND
						  NOT (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
							   LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
							   LOWER(reason) LIKE '%adult content%')
				`
			}

			err = mediaHubDB.QueryRow(failuresQuery, countArgs...).Scan(&totalFailures)
			if err != nil {
				logger.Warn("Failed to get failures count: %v", err)
				totalFailures = 0
			}
		}

		failures, err := getFailureRecordsWithPagination(mediaHubDB, limit, offset, searchQuery)
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
			whereClause = "WHERE destination_path IS NOT NULL AND destination_path != '' AND (reason IS NULL OR reason = '')"
		case "failed":
			whereClause = "WHERE reason IS NOT NULL AND reason != '' AND NOT (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR LOWER(reason) LIKE '%adult content%')"
		case "skipped":
			whereClause = "WHERE reason IS NOT NULL AND reason != '' AND (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR LOWER(reason) LIKE '%adult content%')"
		}
	}

	// Add search filtering if search query is provided
	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		if whereClause == "" {
			whereClause = "WHERE (file_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR reason LIKE ?)"
		} else {
			whereClause += " AND (file_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR reason LIKE ?)"
		}
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	// Get total count for filtered results
	countQuery := "SELECT COUNT(*) FROM processed_files " + whereClause
	var totalCount int
	err = mediaHubDB.QueryRow(countQuery, args...).Scan(&totalCount)
	if err != nil {
		logger.Warn("Failed to get total count: %v", err)
		totalCount = 0
	}

	// Check if reason column exists
	var hasReasonColumn bool
	var dummy sql.NullString
	err = mediaHubDB.QueryRow("SELECT reason FROM processed_files LIMIT 1").Scan(&dummy)
	hasReasonColumn = err == nil || !strings.Contains(err.Error(), "no such column")

	// Build query based on column availability
	var query string
	if hasReasonColumn {
		query = `
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
	} else {
		query = `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number
			FROM processed_files ` + whereClause + `
			ORDER BY rowid DESC
			LIMIT ? OFFSET ?
		`
	}
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

		if hasReasonColumn {
			err = rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason)
		} else {
			err = rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr)
			op.Reason = ""
		}

		if err != nil {
			logger.Warn("Failed to scan row: %v", err)
			continue
		}

		// Generate ID from file path hash
		op.ID = fmt.Sprintf("%x", sha256.Sum256([]byte(op.FilePath)))

		// Extract filename from path
		op.FileName = filepath.Base(op.FilePath)

		// Determine status based on reason first, then file existence
		if op.Reason != "" && op.Reason != "NULL" {
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
		} else if op.DestinationPath != "" && op.DestinationPath != "NULL" {
			// Check both source and destination file existence
			sourceExists := false
			destExists := false

			if _, err := os.Stat(op.FilePath); err == nil {
				sourceExists = true
			}

			if _, err := os.Stat(op.DestinationPath); err == nil {
				destExists = true
			}

			if destExists {
				op.Status = "created"
			} else if sourceExists {
				op.Status = "failed"
				if op.Reason == "" {
					op.Reason = "Destination file not found"
				}
			} else {
				op.Status = "failed"
				if op.Reason == "" {
					op.Reason = "Source file not found"
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
			// Check if this is a TV show by season number OR by path structure (for extras)
			pathLower := strings.ToLower(op.FilePath)
			isShowByPath := strings.Contains(pathLower, "season") || strings.Contains(pathLower, "extras") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode")

			if op.SeasonNumber > 0 || isShowByPath {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			// Try to determine from file extension and path
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") || strings.Contains(pathLower, "extras") {
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

	var testCount int
	err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM processed_files LIMIT 1").Scan(&testCount)
	if err != nil {
		if strings.Contains(err.Error(), "no such table: processed_files") {
			logger.Debug("processed_files table does not exist yet - MediaHub service needs to be started first")
			return map[string]int{"created": 0, "failed": 0, "skipped": 0, "deleted": 0}, nil
		}
		logger.Debug("Error checking processed_files table: %v", err)
		return map[string]int{"created": 0, "failed": 0, "skipped": 0, "deleted": 0}, nil
	}

	// Ensure deletion tracking table exists
	err = createDeletionTrackingTable(mediaHubDB)
	if err != nil {
	}

	counts := map[string]int{
		"created":  0,
		"failed":   0,
		"skipped":  0,
		"deleted":  0,
	}

	// Check if reason column exists
	var hasReasonColumn bool
	var dummy sql.NullString
	err = mediaHubDB.QueryRow("SELECT reason FROM processed_files LIMIT 1").Scan(&dummy)
	hasReasonColumn = err == nil || !strings.Contains(err.Error(), "no such column")

	// Count processed files by status
	var query string
	if hasReasonColumn {
		query = `
			SELECT
				CASE
					WHEN reason IS NOT NULL AND reason != '' THEN
						CASE
							WHEN LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
								 LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
								 LOWER(reason) LIKE '%adult content%' THEN 'skipped'
							ELSE 'failed'
						END
					WHEN destination_path IS NOT NULL AND destination_path != '' THEN 'created'
					ELSE 'failed'
				END as status,
				COUNT(*) as count
			FROM processed_files
			GROUP BY status
		`
	} else {
		query = `
			SELECT
				CASE
					WHEN destination_path IS NOT NULL AND destination_path != '' THEN 'created'
					ELSE 'failed'
				END as status,
				COUNT(*) as count
			FROM processed_files
			GROUP BY status
		`
	}

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

	// Count deletions using the same filtered logic as display
	var deletionCount int
	deletedDB, err := GetDatabaseConnection()
	if err == nil {
		deletionCount, _ = getDeletedFilesCountFromMediaHub(deletedDB, "")
	} else {
		err = mediaHubDB.QueryRow("SELECT COUNT(*) FROM file_deletions").Scan(&deletionCount)
		if err != nil {
			logger.Warn("Failed to get deletion count: %v", err)
			deletionCount = 0
		}
	}
	counts["deleted"] = deletionCount

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

func createDeletionTrackingTableTx(tx *sql.Tx) error {
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
	_, err := tx.Exec(query)
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
			// Check if this is a TV show by season number OR by path structure (for extras)
			pathLower := strings.ToLower(op.FilePath)
			isShowByPath := strings.Contains(pathLower, "season") || strings.Contains(pathLower, "extras") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode")

			if op.SeasonNumber > 0 || isShowByPath {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			// Try to determine from file extension and path
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") || strings.Contains(pathLower, "extras") {
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
func getDeletionRecordsWithPagination(db *sql.DB, limit, offset int, searchQuery string) ([]FileOperation, error) {
	var query string
	var queryArgs []interface{}

	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		query = `
			SELECT
				source_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(reason, '') as reason,
				deleted_at
			FROM file_deletions
			WHERE (source_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR reason LIKE ?)
			ORDER BY deleted_at DESC
			LIMIT ? OFFSET ?
		`
		queryArgs = []interface{}{searchPattern, searchPattern, searchPattern, searchPattern, limit, offset}
	} else {
		query = `
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
		queryArgs = []interface{}{limit, offset}
	}

	rows, err := db.Query(query, queryArgs...)
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
			// Check if this is a TV show by season number OR by path structure (for extras)
			pathLower := strings.ToLower(op.FilePath)
			isShowByPath := strings.Contains(pathLower, "season") || strings.Contains(pathLower, "extras") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode")

			if op.SeasonNumber > 0 || isShowByPath {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			// Try to determine from file extension and path
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") || strings.Contains(pathLower, "extras") {
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

// getDeletedEntriesWithPagination retrieves deleted entries from deleted_entries database
func getDeletedEntriesWithPagination(db *sql.DB, limit, offset int, searchQuery string) ([]FileOperation, error) {
	var query string
	var queryArgs []interface{}

	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		query = `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(deletion_reason, '') as deletion_reason,
				deleted_at,
				COALESCE(trash_file_name, '') as trash_file_name
			FROM deleted_entries
			WHERE (file_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR deletion_reason LIKE ?)
			ORDER BY deleted_at DESC
			LIMIT ? OFFSET ?
		`
		queryArgs = []interface{}{searchPattern, searchPattern, searchPattern, searchPattern, limit, offset}
	} else {
		query = `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(deletion_reason, '') as deletion_reason,
				deleted_at,
				COALESCE(trash_file_name, '') as trash_file_name
			FROM deleted_entries
			ORDER BY deleted_at DESC
			LIMIT ? OFFSET ?
		`
		queryArgs = []interface{}{limit, offset}
	}

	rows, err := db.Query(query, queryArgs...)
	if err != nil {
		logger.Warn("Failed to query deleted_entries table: %v", err)
		return []FileOperation{}, nil
	}
	defer rows.Close()

	var operations []FileOperation
	for rows.Next() {
		var op FileOperation
		var seasonStr, deletedAt, trashFileName string

		err := rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason, &deletedAt, &trashFileName)
		if err != nil {
			logger.Warn("Failed to scan deleted entry row: %v", err)
			continue
		}

		// Check if the file exists in trash using the trash_file_name field
		if trashFileName != "" {
			trashPath := filepath.Join("..", "db", "trash", trashFileName)
			if _, err := os.Stat(trashPath); os.IsNotExist(err) {
				continue
			}
		} else {
			trashPath := filepath.Join("..", "db", "trash", filepath.Base(op.DestinationPath))
			if _, err := os.Stat(trashPath); os.IsNotExist(err) {
				trashDir := filepath.Join("..", "db", "trash")
				baseName := filepath.Base(op.DestinationPath)
				name, ext, _ := strings.Cut(baseName, ".")
				if ext != "" {
					ext = "." + ext
				}
				
				found := false
				if entries, err := os.ReadDir(trashDir); err == nil {
					for _, entry := range entries {
						entryName := entry.Name()
						if entryName == baseName || 
						   (strings.HasPrefix(entryName, name+" (") && strings.HasSuffix(entryName, ")"+ext)) ||
						   strings.HasPrefix(entryName, baseName+".") {
							found = true
							break
						}
					}
				}
				
				if !found {
					continue
				}
			}
		}

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
			pathLower := strings.ToLower(op.FilePath)
			isShowByPath := strings.Contains(pathLower, "season") || strings.Contains(pathLower, "extras") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode")

			if op.SeasonNumber > 0 || isShowByPath {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
			ext := strings.ToLower(filepath.Ext(op.FileName))
			if ext == ".mkv" || ext == ".mp4" || ext == ".avi" || ext == ".mov" {
				pathLower := strings.ToLower(op.FilePath)
				if strings.Contains(pathLower, "season") || strings.Contains(pathLower, "s0") || strings.Contains(pathLower, "episode") || strings.Contains(pathLower, "extras") {
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

func getFailureRecordsWithPagination(db *sql.DB, limit, offset int, searchQuery string) ([]FileOperation, error) {
	var operations []FileOperation

	// Check if reason column exists
	var hasReasonColumn bool
	var dummy sql.NullString
	err := db.QueryRow("SELECT reason FROM processed_files LIMIT 1").Scan(&dummy)
	hasReasonColumn = err == nil || !strings.Contains(err.Error(), "no such column")

	if !hasReasonColumn {
		return operations, nil
	}

	var failuresQuery string
	var queryArgs []interface{}

	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		failuresQuery = `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(reason, '') as reason,
				COALESCE(error_message, '') as error_message,
				COALESCE(processed_at, '') as processed_at
			FROM processed_files
			WHERE reason IS NOT NULL AND reason != '' AND
				  NOT (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
					   LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
					   LOWER(reason) LIKE '%adult content%') AND
				  (file_path LIKE ? OR destination_path LIKE ? OR tmdb_id LIKE ? OR reason LIKE ?)
			ORDER BY processed_at DESC
			LIMIT ? OFFSET ?
		`
		queryArgs = []interface{}{searchPattern, searchPattern, searchPattern, searchPattern, limit, offset}
	} else {
		failuresQuery = `
			SELECT
				file_path,
				COALESCE(destination_path, '') as destination_path,
				COALESCE(tmdb_id, '') as tmdb_id,
				COALESCE(season_number, '') as season_number,
				COALESCE(reason, '') as reason,
				COALESCE(error_message, '') as error_message,
				COALESCE(processed_at, '') as processed_at
			FROM processed_files
			WHERE reason IS NOT NULL AND reason != '' AND
				  NOT (LOWER(reason) LIKE '%skipped%' OR LOWER(reason) LIKE '%extra%' OR
					   LOWER(reason) LIKE '%special content%' OR LOWER(reason) LIKE '%unsupported%' OR
					   LOWER(reason) LIKE '%adult content%')
			ORDER BY processed_at DESC
			LIMIT ? OFFSET ?
		`
		queryArgs = []interface{}{limit, offset}
	}

	rows, err := db.Query(failuresQuery, queryArgs...)
	if err != nil {
		logger.Warn("Failed to query processed_files for failures: %v", err)
		return operations, err
	}
	defer rows.Close()

	for rows.Next() {
		var op FileOperation
		var seasonStr, processedAt string
		var errorMessage sql.NullString

		err := rows.Scan(&op.FilePath, &op.DestinationPath, &op.TmdbID, &seasonStr, &op.Reason, &errorMessage, &processedAt)
		if err != nil {
			logger.Warn("Failed to scan failure row: %v", err)
			continue
		}

		op.ID = fmt.Sprintf("fail_%x", sha256.Sum256([]byte(op.FilePath+processedAt)))
		op.FileName = filepath.Base(op.FilePath)
		op.Status = "failed"
		op.Operation = "process"
		op.Timestamp = processedAt

		if errorMessage.Valid {
			op.Error = errorMessage.String
		}

		if seasonStr != "" && seasonStr != "NULL" {
			if seasonNum, err := strconv.Atoi(seasonStr); err == nil {
				op.SeasonNumber = seasonNum
			}
		}

		op.Type = "other"
		if op.TmdbID != "" && op.TmdbID != "NULL" {
			if op.SeasonNumber > 0 {
				op.Type = "tvshow"
			} else {
				op.Type = "movie"
			}
		} else {
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

func TrackFileDeletion(sourcePath, destinationPath, tmdbID, seasonNumber, reason string) error {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		return fmt.Errorf("MediaHub database not found")
	}

	err := WithDatabaseTransaction(func(tx *sql.Tx) error {
		err := createDeletionTrackingTableTx(tx)
		if err != nil {
			return fmt.Errorf("failed to create deletion tracking table: %w", err)
		}

		query := `
			INSERT INTO file_deletions (source_path, destination_path, tmdb_id, season_number, reason)
			VALUES (?, ?, ?, ?, ?)
		`
		_, err = tx.Exec(query, sourcePath, destinationPath, tmdbID, seasonNumber, reason)
		if err != nil {
			return fmt.Errorf("failed to insert deletion record: %w", err)
		}

		return nil
	})

	if err != nil {
		return err
	}

	pathsToClean := make([]string, 0, 2)

	if destinationPath != "" {
		pathsToClean = append(pathsToClean, destinationPath)
	}

	if sourcePath != "" && sourcePath != destinationPath {
		pathsToClean = append(pathsToClean, sourcePath)
	}

	for _, path := range pathsToClean {
		if removeErr := RemoveRecentMediaByPath(path); removeErr != nil {
			logger.Warn("Failed to remove recent media for path %s: %v", path, removeErr)
		}
	}

	return nil
}

func TrackFileFailure(sourcePath, tmdbID, seasonNumber, reason, errorMessage string) error {
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")

	if _, err := os.Stat(mediaHubDBPath); os.IsNotExist(err) {
		return fmt.Errorf("MediaHub database not found")
	}

	return WithDatabaseTransaction(func(tx *sql.Tx) error {
		query := `
			INSERT OR REPLACE INTO processed_files (file_path, tmdb_id, season_number, reason, error_message, processed_at)
			VALUES (?, ?, ?, ?, ?, datetime('now'))
		`
		_, err := tx.Exec(query, sourcePath, tmdbID, seasonNumber, reason, errorMessage)
		if err != nil {
			return fmt.Errorf("failed to track failure record: %w", err)
		}

		return nil
	})
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

// getDeletedFilesFromMediaHub reads deleted files from MediaHub's deleted_files table
func getDeletedFilesFromMediaHub(db *sql.DB, limit, offset int, searchQuery string) ([]FileOperation, error) {
	// Build query with search filtering
	query := `
		SELECT id, file_path, destination_path, proper_name, year, media_type, tmdb_id, 
		       season_number, episode_number, quality, deleted_at, deletion_reason, trash_file_name
		FROM deleted_files
	`
	var args []interface{}
	
	// Add search filter if provided
	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		query += " WHERE (proper_name LIKE ? OR file_path LIKE ? OR destination_path LIKE ?)"
		args = append(args, searchPattern, searchPattern, searchPattern)
	}
	
	// Add ordering and pagination
	query += " ORDER BY deleted_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)
	
	rows, err := db.Query(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "no such table: deleted_files") {
			logger.Debug("deleted_files table does not exist yet")
			return []FileOperation{}, nil
		}
		return nil, fmt.Errorf("failed to query deleted_files: %w", err)
	}
	defer rows.Close()
	
	var operations []FileOperation
	
	for rows.Next() {
		var op FileOperation
		var id int
		var seasonNumber sql.NullInt64
		var filePath, destinationPath, timestamp, reason sql.NullString
		var properName, year, mediaType, tmdbID, episodeNumber, quality, trashFileName sql.NullString

		err := rows.Scan(
			&id, &filePath, &destinationPath, &properName, &year, &mediaType, 
			&tmdbID, &seasonNumber, &episodeNumber, &quality, &timestamp, &reason, &trashFileName,
		)
		if err != nil {
			logger.Warn("Failed to scan deleted file row: %v", err)
			continue
		}

		// Build operation object
		op.ID = fmt.Sprintf("%d", id)
		op.Status = "deleted"
		op.Type = "file"
		op.Operation = "delete"

		// Set string fields from NULL-safe variables
		if filePath.Valid {
			op.FilePath = filePath.String
		}
		if destinationPath.Valid {
			op.DestinationPath = destinationPath.String
		}
		if timestamp.Valid {
			op.Timestamp = timestamp.String
		}
		if reason.Valid {
			op.Reason = reason.String
		}

		// Extract filename
		if op.DestinationPath != "" {
			op.FileName = filepath.Base(op.DestinationPath)
		} else {
			op.FileName = filepath.Base(op.FilePath)
		}

		// Set metadata if available
		if tmdbID.Valid {
			op.TmdbID = tmdbID.String
		}
		if seasonNumber.Valid && seasonNumber.Int64 > 0 {
			op.SeasonNumber = int(seasonNumber.Int64)
		}
		
		operations = append(operations, op)
	}
	
	return operations, nil
}

// getDeletedFilesCountFromMediaHub gets the count of deleted files from MediaHub's deleted_files table
func getDeletedFilesCountFromMediaHub(db *sql.DB, searchQuery string) (int, error) {
	query := "SELECT COUNT(*) FROM deleted_files"
	var args []interface{}
	
	// Add search filter if provided
	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		query += " WHERE (proper_name LIKE ? OR file_path LIKE ? OR destination_path LIKE ?)"
		args = append(args, searchPattern, searchPattern, searchPattern)
	}
	
	var count int
	err := db.QueryRow(query, args...).Scan(&count)
	if err != nil {
		if strings.Contains(err.Error(), "no such table: deleted_files") {
			logger.Debug("deleted_files table does not exist yet")
			return 0, nil
		}
		return 0, fmt.Errorf("failed to count deleted files: %w", err)
	}

	return count, nil
}


