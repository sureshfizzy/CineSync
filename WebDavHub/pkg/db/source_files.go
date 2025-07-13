package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
)

// Callback function for broadcasting events - set by api package to avoid circular dependency
var BroadcastEventCallback func(eventType string, data map[string]interface{})

// SourceFile represents a file in the source directories
type SourceFile struct {
	ID                  int    `json:"id"`
	FilePath            string `json:"filePath"`
	FileName            string `json:"fileName"`
	FileSize            int64  `json:"fileSize"`
	FileSizeFormatted   string `json:"fileSizeFormatted"`
	ModifiedTime        int64  `json:"modifiedTime"`
	IsMediaFile         bool   `json:"isMediaFile"`
	MediaType           string `json:"mediaType,omitempty"`
	SourceIndex         int    `json:"sourceIndex"`
	SourceDirectory     string `json:"sourceDirectory"`
	RelativePath        string `json:"relativePath"`
	FileExtension       string `json:"fileExtension"`
	DiscoveredAt        int64  `json:"discoveredAt"`
	LastSeenAt          int64  `json:"lastSeenAt"`
	IsActive            bool   `json:"isActive"`
	ProcessingStatus    string `json:"processingStatus"`
	LastProcessedAt     *int64 `json:"lastProcessedAt,omitempty"`
	TmdbID              string `json:"tmdbId,omitempty"`
	SeasonNumber        *int   `json:"seasonNumber,omitempty"`
	EpisodeNumber       *int   `json:"episodeNumber,omitempty"`
}

// SourceScan represents a source directory scan operation
type SourceScan struct {
	ID              int    `json:"id"`
	ScanType        string `json:"scanType"`
	StartedAt       int64  `json:"startedAt"`
	CompletedAt     *int64 `json:"completedAt,omitempty"`
	Status          string `json:"status"`
	FilesDiscovered int    `json:"filesDiscovered"`
	FilesUpdated    int    `json:"filesUpdated"`
	FilesRemoved    int    `json:"filesRemoved"`
	TotalFiles      int    `json:"totalFiles"`
	ErrorMessage    string `json:"errorMessage,omitempty"`
	ScanDurationMs  *int64 `json:"scanDurationMs,omitempty"`
}

// HandleSourceFiles handles source file API requests
func HandleSourceFiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		handleGetSourceFiles(w, r)
	case http.MethodPost:
		handleUpdateSourceFiles(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetSourceFiles retrieves source files with pagination and filtering
func handleGetSourceFiles(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")
	sourceIndexStr := r.URL.Query().Get("sourceIndex")
	statusFilter := r.URL.Query().Get("status")
	mediaOnly := r.URL.Query().Get("mediaOnly") == "true"
	activeOnly := r.URL.Query().Get("activeOnly") != "false" // Default to true
	searchQuery := strings.TrimSpace(r.URL.Query().Get("search"))

	// Default to showing only unprocessed files unless status is explicitly specified
	if statusFilter == "" {
		statusFilter = "unprocessed"
	} else if statusFilter == "all" {
		statusFilter = ""
	}

	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	// Build WHERE clause
	whereClause := "WHERE 1=1"
	var args []interface{}

	if activeOnly {
		whereClause += " AND is_active = ?"
		args = append(args, true)
	}

	if sourceIndexStr != "" {
		if sourceIndex, err := strconv.Atoi(sourceIndexStr); err == nil {
			whereClause += " AND source_index = ?"
			args = append(args, sourceIndex)
		}
	}

	if statusFilter != "" {
		whereClause += " AND processing_status = ?"
		args = append(args, statusFilter)
	}

	if mediaOnly {
		whereClause += " AND is_media_file = ?"
		args = append(args, true)
	}

	// Add search filtering if search query is provided
	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		whereClause += " AND (file_name LIKE ? OR file_path LIKE ? OR relative_path LIKE ? OR media_type LIKE ?)"
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	var total int
	var files []SourceFile

	err := executeReadOperation(func(sourceDB *sql.DB) error {
		// Count total records
		countQuery := "SELECT COUNT(*) FROM source_files " + whereClause

		err := sourceDB.QueryRow(countQuery, args...).Scan(&total)
		if err != nil {
			if err == sql.ErrNoRows {
				total = 0
			} else {
				return fmt.Errorf("failed to count source files: %w", err)
			}
		}

		// Build main query
		query := `SELECT id, file_path, file_name, file_size, file_size_formatted,
				  modified_time, is_media_file, media_type, source_index, source_directory,
				  relative_path, file_extension, discovered_at, last_seen_at, is_active,
				  processing_status, last_processed_at, tmdb_id, season_number, episode_number
				  FROM source_files ` + whereClause + " ORDER BY last_seen_at DESC, file_name ASC LIMIT ? OFFSET ?"
		queryArgs := append(args, limit, offset)

		rows, err := sourceDB.Query(query, queryArgs...)
		if err != nil {
			return fmt.Errorf("failed to query source files: %w", err)
		}
		defer rows.Close()

		// Initialize as empty slice instead of nil to ensure JSON encoding returns [] not null
		files = make([]SourceFile, 0)
		for rows.Next() {
			var file SourceFile
			var mediaType sql.NullString
			var lastProcessedAt sql.NullInt64
			var tmdbID sql.NullString
			var seasonNumber sql.NullInt64
			var episodeNumber sql.NullInt64

			err := rows.Scan(
				&file.ID, &file.FilePath, &file.FileName, &file.FileSize, &file.FileSizeFormatted,
				&file.ModifiedTime, &file.IsMediaFile, &mediaType, &file.SourceIndex, &file.SourceDirectory,
				&file.RelativePath, &file.FileExtension, &file.DiscoveredAt, &file.LastSeenAt, &file.IsActive,
				&file.ProcessingStatus, &lastProcessedAt, &tmdbID, &seasonNumber, &episodeNumber,
			)
			if err != nil {
				logger.Error("Failed to scan source file row: %v", err)
				continue
			}

			if mediaType.Valid {
				file.MediaType = mediaType.String
			}
			if lastProcessedAt.Valid {
				file.LastProcessedAt = &lastProcessedAt.Int64
			}
			if tmdbID.Valid {
				file.TmdbID = tmdbID.String
			}
			if seasonNumber.Valid {
				seasonNum := int(seasonNumber.Int64)
				file.SeasonNumber = &seasonNum
			}
			if episodeNumber.Valid {
				episodeNum := int(episodeNumber.Int64)
				file.EpisodeNumber = &episodeNum
			}

			files = append(files, file)
		}

		return nil
	})

	if err != nil {
		logger.Error("Failed to query source files: %v", err)
		http.Error(w, "Failed to query source files", http.StatusInternalServerError)
		return
	}

	// Calculate pagination info
	totalPages := (total + limit - 1) / limit
	currentPage := (offset / limit) + 1

	response := map[string]interface{}{
		"files":       files,
		"total":       total,
		"page":        currentPage,
		"limit":       limit,
		"totalPages":  totalPages,
		"hasNext":     currentPage < totalPages,
		"hasPrev":     currentPage > 1,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleUpdateSourceFiles handles bulk updates to source files
func handleUpdateSourceFiles(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"`
		Files  []struct {
			FilePath         string `json:"filePath"`
			ProcessingStatus string `json:"processingStatus,omitempty"`
			TmdbID           string `json:"tmdbId,omitempty"`
			SeasonNumber     *int   `json:"seasonNumber,omitempty"`
		} `json:"files,omitempty"`
		ScanType string `json:"scanType,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	switch req.Action {
	case "scan":
		handleSourceScan(w, req.ScanType)
	case "update_status":
		handleUpdateFileStatuses(w, req.Files)
	default:
		http.Error(w, "Invalid action", http.StatusBadRequest)
	}
}

// handleSourceScan triggers a source directory scan
func handleSourceScan(w http.ResponseWriter, scanType string) {
	if scanType == "" {
		scanType = "manual"
	}

	// Start scan in background
	go func() {
		if err := ScanSourceDirectories(scanType); err != nil {
			logger.Error("Source scan failed: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Source scan started",
		"type":    scanType,
	})
}

// handleUpdateFileStatuses updates processing status for multiple files
func handleUpdateFileStatuses(w http.ResponseWriter, files []struct {
	FilePath         string `json:"filePath"`
	ProcessingStatus string `json:"processingStatus,omitempty"`
	TmdbID           string `json:"tmdbId,omitempty"`
	SeasonNumber     *int   `json:"seasonNumber,omitempty"`
}) {
	var updated int
	var err error

	// Use batch update with retry logic
	operations := make([]func(*sql.Tx) error, 0, len(files))

	for _, file := range files {
		f := file
		operations = append(operations, func(tx *sql.Tx) error {
			query := `UPDATE source_files SET processing_status = ?, last_processed_at = ?, tmdb_id = ?, season_number = ?
					  WHERE file_path = ?`

			var tmdbID sql.NullString
			var seasonNumber sql.NullInt64

			if f.TmdbID != "" {
				tmdbID.String = f.TmdbID
				tmdbID.Valid = true
			}

			if f.SeasonNumber != nil {
				seasonNumber.Int64 = int64(*f.SeasonNumber)
				seasonNumber.Valid = true
			}

			result, err := tx.Exec(query, f.ProcessingStatus, time.Now().Unix(), tmdbID, seasonNumber, f.FilePath)
			if err != nil {
				return err
			}

			if rowsAffected, _ := result.RowsAffected(); rowsAffected > 0 {
				updated++
			}
			return nil
		})
	}

	// Execute batch update with retry logic
	err = BatchUpdateSourceFiles(operations)
	if err != nil {
		logger.Error("Failed to batch update file statuses: %v", err)
		http.Error(w, "Failed to update file statuses", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "File statuses updated",
		"updated": updated,
	})
}

// ScanSourceDirectories scans all configured source directories and updates the database
func ScanSourceDirectories(scanType string) error {
	logger.Info("Starting source directory scan (type: %s)", scanType)

	// Broadcast scan started event
	broadcastScanEvent("scan_started", map[string]interface{}{
		"scanType": scanType,
	})

	// Create scan record
	scanID, err := createScanRecord(scanType)
	if err != nil {
		return fmt.Errorf("failed to create scan record: %w", err)
	}

	startTime := time.Now()
	var totalFiles, discovered, updated, removed int
	var scanError error

	defer func() {
		duration := time.Since(startTime).Milliseconds()
		status := "completed"
		if scanError != nil {
			status = "failed"
		}

		updateScanRecord(scanID, status, totalFiles, discovered, updated, removed, duration, scanError)

		if scanError != nil {
			logger.Error("Source scan failed: %v", scanError)
			// Broadcast scan failed event
			broadcastScanEvent("scan_failed", map[string]interface{}{
				"scanType": scanType,
				"error":    scanError.Error(),
			})
		} else {
			logger.Info("Source scan completed: %d total, %d discovered, %d updated, %d removed",
				totalFiles, discovered, updated, removed)
			// Broadcast scan completed event
			broadcastScanEvent("scan_completed", map[string]interface{}{
				"scanType":        scanType,
				"totalFiles":      totalFiles,
				"filesDiscovered": discovered,
				"filesUpdated":    updated,
				"filesRemoved":    removed,
				"duration":        duration,
			})
		}
	}()

	// Get source directories from config
	sourceDirectories, err := getSourceDirectories()
	if err != nil {
		scanError = fmt.Errorf("failed to get source directories: %w", err)
		return scanError
	}

	if len(sourceDirectories) == 0 {
		scanError = fmt.Errorf("no source directories configured")
		return scanError
	}

	// Mark all files as potentially inactive
	if err := MarkAllSourceFilesInactive(); err != nil {
		scanError = fmt.Errorf("failed to mark files inactive: %w", err)
		return scanError
	}

	// Scan each source directory
	for sourceIndex, sourceDir := range sourceDirectories {
		dirFiles, dirDiscovered, dirUpdated, err := scanSourceDirectory(sourceDir, sourceIndex)
		if err != nil {
			logger.Error("Failed to scan source directory %s: %v", sourceDir, err)
			continue
		}

		totalFiles += dirFiles
		discovered += dirDiscovered
		updated += dirUpdated
	}

	// Remove files that are no longer present
	maxRetries := 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		removed, err = RemoveInactiveSourceFiles()
		if err == nil {
			break
		}

		if strings.Contains(err.Error(), "database is locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
			if attempt < maxRetries-1 {
				delay := time.Duration(100*(1<<uint(attempt))) * time.Millisecond
				time.Sleep(delay)
				continue
			}
		}
		logger.Error("Failed to remove inactive files (attempt %d/%d): %v", attempt+1, maxRetries, err)
		if attempt == maxRetries-1 {
			logger.Error("Failed to remove inactive files after %d attempts", maxRetries)
		}
	}

	// Update processing status based on MediaHub database
	if err := updateProcessingStatusFromMediaHub(); err != nil {
		logger.Error("Failed to update processing status from MediaHub: %v", err)
	}

	return nil
}

// createScanRecord creates a new scan record in the database
func createScanRecord(scanType string) (int64, error) {
	return InsertSourceScan(scanType)
}

// updateScanRecord updates a scan record with completion details
func updateScanRecord(scanID int64, status string, totalFiles, discovered, updated, removed int, durationMs int64, scanError error) {
	UpdateSourceScan(scanID, status, totalFiles, discovered, updated, removed, durationMs, scanError)
}

// getSourceDirectories retrieves source directories from config
func getSourceDirectories() ([]string, error) {
	sourceDir := env.GetString("SOURCE_DIR", "")
	if sourceDir == "" {
		return []string{}, nil
	}

	// Split multiple directories if separated by semicolon or comma
	dirs := strings.FieldsFunc(sourceDir, func(c rune) bool {
		return c == ';' || c == ','
	})

	var validDirs []string
	for _, dir := range dirs {
		dir = strings.TrimSpace(dir)
		if dir != "" {
			validDirs = append(validDirs, dir)
		}
	}

	return validDirs, nil
}

// scanSourceDirectory scans a single source directory
func scanSourceDirectory(sourceDir string, sourceIndex int) (totalFiles, discovered, updated int, err error) {
	var insertOperations []func(*sql.Tx) error
	var updateOperations []func(*sql.Tx) error
	var existingFiles []string
	err = executeReadOperation(func(sourceDB *sql.DB) error {
		query := `SELECT file_path FROM source_files WHERE source_index = ?`
		rows, err := sourceDB.Query(query, sourceIndex)
		if err != nil {
			return fmt.Errorf("failed to query existing files: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var filePath string
			if err := rows.Scan(&filePath); err != nil {
				continue
			}
			existingFiles = append(existingFiles, filePath)
		}
		return nil
	})

	if err != nil {
		return 0, 0, 0, fmt.Errorf("failed to get existing files: %w", err)
	}

	existingFileMap := make(map[string]bool)
	for _, filePath := range existingFiles {
		existingFileMap[filePath] = true
	}

	err = filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			logger.Warn("Error accessing path %s: %v", path, err)
			return nil
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		totalFiles++

		// Get relative path
		relPath, err := filepath.Rel(sourceDir, path)
		if err != nil {
			relPath = path
		}

		// Check if file is a media file
		isMedia := isMediaFile(path)
		mediaType := ""
		if isMedia {
			mediaType = detectMediaType(info.Name())
		}

		// Format file size
		sizeFormatted := formatFileSize(info.Size())

		exists := existingFileMap[path]
		processingStatus := "unprocessed"
		var tmdbID string
		var seasonNum *int

		if mediaHubDB, err := GetDatabaseConnection(); err == nil {
			status, tmdbIDVal, seasonNumber := checkFileInMediaHub(mediaHubDB, path)
			processingStatus = status
			tmdbID = tmdbIDVal
			seasonNum = seasonNumber
		}

		if !exists {
			discovered++
			filePath, fileName, fileSize, fileSizeFormatted := path, info.Name(), info.Size(), sizeFormatted
			modTime, relativePathCopy, fileExt := info.ModTime().Unix(), relPath, filepath.Ext(path)
			currentTime := time.Now().Unix()

			insertOperations = append(insertOperations, func(tx *sql.Tx) error {
				query := `INSERT INTO source_files
					(file_path, file_name, file_size, file_size_formatted, modified_time,
					 is_media_file, media_type, source_index, source_directory, relative_path,
					 file_extension, discovered_at, last_seen_at, is_active, processing_status)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

				_, err := tx.Exec(query,
					filePath, fileName, fileSize, fileSizeFormatted, modTime,
					isMedia, mediaType, sourceIndex, sourceDir, relativePathCopy,
					fileExt, currentTime, currentTime, true, processingStatus)
				return err
			})

			if tmdbID != "" {
				tmdbIDCopy, seasonNumCopy := tmdbID, seasonNum
				insertOperations = append(insertOperations, func(tx *sql.Tx) error {
					query := `UPDATE source_files SET tmdb_id = ?, season_number = ? WHERE file_path = ?`
					var seasonNumberVal sql.NullInt64
					if seasonNumCopy != nil {
						seasonNumberVal.Int64 = int64(*seasonNumCopy)
						seasonNumberVal.Valid = true
					}
					_, err := tx.Exec(query, tmdbIDCopy, seasonNumberVal, filePath)
					return err
				})
			}
		} else {
			updated++
			filePath, fileSize, fileSizeFormatted := path, info.Size(), sizeFormatted
			modTime, currentTime := info.ModTime().Unix(), time.Now().Unix()

			updateOperations = append(updateOperations, func(tx *sql.Tx) error {
				query := `UPDATE source_files SET
					file_size = ?, file_size_formatted = ?, modified_time = ?,
					is_media_file = ?, media_type = ?, last_seen_at = ?, is_active = ?
					WHERE file_path = ?`

				_, err := tx.Exec(query,
					fileSize, fileSizeFormatted, modTime,
					isMedia, mediaType, currentTime, true,
					filePath)
				return err
			})

			if tmdbID != "" && processingStatus != "unprocessed" {
				tmdbIDCopy, seasonNumCopy := tmdbID, seasonNum
				updateOperations = append(updateOperations, func(tx *sql.Tx) error {
					query := `UPDATE source_files SET processing_status = ?, last_processed_at = ?, tmdb_id = ?, season_number = ?
							  WHERE file_path = ?`
					var seasonNumberVal sql.NullInt64
					if seasonNumCopy != nil {
						seasonNumberVal.Int64 = int64(*seasonNumCopy)
						seasonNumberVal.Valid = true
					}
					_, err := tx.Exec(query, processingStatus, currentTime, tmdbIDCopy, seasonNumberVal, filePath)
					return err
				})
			}
		}

		return nil
	})

	if err != nil {
		return totalFiles, discovered, updated, err
	}

	if len(insertOperations) > 0 {
		if err := BatchUpdateSourceFiles(insertOperations); err != nil {
			logger.Error("Failed to execute batch insert operations: %v", err)
		}
	}

	if len(updateOperations) > 0 {
		if err := BatchUpdateSourceFiles(updateOperations); err != nil {
			logger.Error("Failed to execute batch update operations: %v", err)
		}
	}

	return totalFiles, discovered, updated, nil
}

// isMediaFile checks if a file is a media file based on extension
func isMediaFile(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	mediaExtensions := []string{
		".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
		".mpg", ".mpeg", ".3gp", ".asf", ".rm", ".rmvb", ".ts", ".m2ts",
	}

	for _, mediaExt := range mediaExtensions {
		if ext == mediaExt {
			return true
		}
	}
	return false
}

// detectMediaType detects if a file is likely a movie or TV show
func detectMediaType(fileName string) string {
	lowerName := strings.ToLower(fileName)

	// TV show patterns
	tvPatterns := []string{"s0", "season", "episode", "e0", "ep0"}
	for _, pattern := range tvPatterns {
		if strings.Contains(lowerName, pattern) {
			return "tvshow"
		}
	}

	return "movie"
}

// formatFileSize formats file size in human readable format
func formatFileSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}

	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}

	units := []string{"KB", "MB", "GB", "TB"}
	return fmt.Sprintf("%.1f %s", float64(size)/float64(div), units[exp])
}

// updateProcessingStatusFromMediaHub updates processing status based on MediaHub database
func updateProcessingStatusFromMediaHub() error {
	// Get MediaHub database connection
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Warn("Failed to get MediaHub database connection: %v", err)
		return nil // Don't fail the scan if MediaHub DB is not available
	}

	var filePaths []string

	err = executeReadOperation(func(sourceDB *sql.DB) error {
		// Get all unprocessed files from source database
		query := `SELECT file_path FROM source_files WHERE processing_status = 'unprocessed' AND is_active = TRUE`
		rows, err := sourceDB.Query(query)
		if err != nil {
			return fmt.Errorf("failed to query unprocessed files: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var filePath string
			if err := rows.Scan(&filePath); err != nil {
				continue
			}
			filePaths = append(filePaths, filePath)
		}
		return nil
	})

	if err != nil {
		return err
	}

	// Check each file against MediaHub database and batch updates
	var batchOperations []func(*sql.Tx) error
	updated := 0

	for _, filePath := range filePaths {
		status, tmdbID, seasonNumber := checkFileInMediaHub(mediaHubDB, filePath)
		if status != "unprocessed" {
			// Capture variables in closure
			fp, st, tid, sn := filePath, status, tmdbID, seasonNumber
			batchOperations = append(batchOperations, func(tx *sql.Tx) error {
				query := `UPDATE source_files SET processing_status = ?, last_processed_at = ?, tmdb_id = ?, season_number = ?
						  WHERE file_path = ?`

				var tmdbIDVal sql.NullString
				var seasonNumberVal sql.NullInt64

				if tid != "" {
					tmdbIDVal.String = tid
					tmdbIDVal.Valid = true
				}

				if sn != nil {
					seasonNumberVal.Int64 = int64(*sn)
					seasonNumberVal.Valid = true
				}

				result, err := tx.Exec(query, st, time.Now().Unix(), tmdbIDVal, seasonNumberVal, fp)
				if err != nil {
					return err
				}

				if rowsAffected, _ := result.RowsAffected(); rowsAffected > 0 {
					updated++
				}
				return nil
			})
		}
	}

	// Execute batch updates if any
	if len(batchOperations) > 0 {
		err := BatchUpdateSourceFiles(batchOperations)
		if err != nil {
			logger.Error("Failed to batch update processing status: %v", err)
		}
	}

	if updated > 0 {
		logger.Info("Updated processing status for %d files from MediaHub database", updated)
	}

	return nil
}

// checkFileInMediaHub checks if a file exists in MediaHub database and returns its status
func checkFileInMediaHub(mediaHubDB *sql.DB, filePath string) (status string, tmdbID string, seasonNumber *int) {
	// Try to query the processed_files table directly
	query := `SELECT destination_path, tmdb_id, season_number, reason FROM processed_files WHERE file_path = ?`
	row := mediaHubDB.QueryRow(query, filePath)

	var destPath sql.NullString
	var tmdbIDVal sql.NullString
	var seasonNumberVal sql.NullString
	var reason sql.NullString

	err := row.Scan(&destPath, &tmdbIDVal, &seasonNumberVal, &reason)
	if err == sql.ErrNoRows {
		return "unprocessed", "", nil
	}
	if err != nil {
		if strings.Contains(err.Error(), "no such table: processed_files") {
			return "unprocessed", "", nil
		}
		logger.Error("Error checking file in MediaHub database: %v", err)
		return "unprocessed", "", nil
	}

	// If reason is set, file was skipped
	if reason.Valid && reason.String != "" {
		return "skipped", "", nil
	}

	// If destination path is set, file was processed
	if destPath.Valid && destPath.String != "" {
		status = "processed"
		if tmdbIDVal.Valid {
			tmdbID = tmdbIDVal.String
		}
		if seasonNumberVal.Valid {
			seasonNum, err := strconv.Atoi(seasonNumberVal.String)
			if err == nil {
				seasonNumber = &seasonNum
			}
		}
		return status, tmdbID, seasonNumber
	}

	return "unprocessed", "", nil
}

// HandleSourceScans handles source scan API requests
func HandleSourceScans(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		// Check if requesting latest scan via query parameter
		if r.URL.Query().Get("latest") == "true" {
			logger.Debug("HandleSourceScans: Routing to handleGetLatestScan via query parameter")
			handleGetLatestScan(w, r)
			return
		}

		// Handle base path (list scans)
		logger.Debug("HandleSourceScans: Routing to handleGetSourceScans")
		handleGetSourceScans(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetSourceScans retrieves source scan history
func handleGetSourceScans(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}
	}

	offset := 0
	if offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	var scans []SourceScan
	var total int

	err := executeReadOperation(func(sourceDB *sql.DB) error {
		// Query scans
		query := `SELECT id, scan_type, started_at, completed_at, status, files_discovered,
				  files_updated, files_removed, total_files, error_message, scan_duration_ms
				  FROM source_scans ORDER BY started_at DESC LIMIT ? OFFSET ?`

		rows, err := sourceDB.Query(query, limit, offset)
		if err != nil {
			return fmt.Errorf("failed to query source scans: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var scan SourceScan
			var completedAt sql.NullInt64
			var errorMessage sql.NullString
			var scanDurationMs sql.NullInt64

			err := rows.Scan(
				&scan.ID, &scan.ScanType, &scan.StartedAt, &completedAt, &scan.Status,
				&scan.FilesDiscovered, &scan.FilesUpdated, &scan.FilesRemoved, &scan.TotalFiles,
				&errorMessage, &scanDurationMs,
			)
			if err != nil {
				logger.Error("Failed to scan source scan row: %v", err)
				continue
			}

			if completedAt.Valid {
				scan.CompletedAt = &completedAt.Int64
			}
			if errorMessage.Valid {
				scan.ErrorMessage = errorMessage.String
			}
			if scanDurationMs.Valid {
				scan.ScanDurationMs = &scanDurationMs.Int64
			}

			scans = append(scans, scan)
		}

		// Count total records
		err = sourceDB.QueryRow("SELECT COUNT(*) FROM source_scans").Scan(&total)
		if err != nil {
			if err == sql.ErrNoRows {
				total = 0
			} else {
				return fmt.Errorf("failed to count source scans: %w", err)
			}
		}

		return nil
	})

	if err != nil {
		logger.Error("Failed to query source scans: %v", err)
		http.Error(w, "Failed to query source scans", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"scans":      scans,
		"total":      total,
		"page":       (offset / limit) + 1,
		"limit":      limit,
		"totalPages": (total + limit - 1) / limit,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleGetLatestScan retrieves the most recent scan
func handleGetLatestScan(w http.ResponseWriter, r *http.Request) {
	logger.Debug("handleGetLatestScan: Called for URL: %s", r.URL.Path)

	var scan SourceScan
	var completedAt sql.NullInt64
	var errorMessage sql.NullString
	var scanDurationMs sql.NullInt64

	err := executeReadOperation(func(sourceDB *sql.DB) error {
		query := `SELECT id, scan_type, started_at, completed_at, status, files_discovered,
				  files_updated, files_removed, total_files, error_message, scan_duration_ms
				  FROM source_scans ORDER BY started_at DESC LIMIT 1`

		return sourceDB.QueryRow(query).Scan(
			&scan.ID, &scan.ScanType, &scan.StartedAt, &completedAt, &scan.Status,
			&scan.FilesDiscovered, &scan.FilesUpdated, &scan.FilesRemoved, &scan.TotalFiles,
			&errorMessage, &scanDurationMs,
		)
	})

	if err == sql.ErrNoRows {
		http.Error(w, "No scans found", http.StatusNotFound)
		return
	} else if err != nil {
		logger.Error("Failed to query latest scan: %v", err)
		http.Error(w, "Failed to query latest scan", http.StatusInternalServerError)
		return
	}

	if completedAt.Valid {
		scan.CompletedAt = &completedAt.Int64
	}
	if errorMessage.Valid {
		scan.ErrorMessage = errorMessage.String
	}
	if scanDurationMs.Valid {
		scan.ScanDurationMs = &scanDurationMs.Int64
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scan)
}

// broadcastScanEvent sends scan-related events to MediaHub SSE clients
func broadcastScanEvent(eventType string, data map[string]interface{}) {
	if BroadcastEventCallback != nil {
		BroadcastEventCallback(eventType, data)
	} else {
		logger.Debug("BroadcastEventCallback not set, scan event not broadcasted: %s", eventType)
	}
}
