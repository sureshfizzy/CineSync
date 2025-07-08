package db

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

// DatabaseRecord represents a record from the processed_files table
type DatabaseRecord struct {
	FilePath        string `json:"file_path"`
	DestinationPath string `json:"destination_path,omitempty"`
	TmdbID          string `json:"tmdb_id,omitempty"`
	SeasonNumber    string `json:"season_number,omitempty"`
	Reason          string `json:"reason,omitempty"`
	FileSize        *int64 `json:"file_size,omitempty"`
}

// Cache for column existence to avoid repeated PRAGMA queries
var (
	fileSizeColumnExists sync.Once
	hasFileSizeColumn    bool
)

// checkFileSizeColumnExists checks if the file_size column exists in processed_files table
func checkFileSizeColumnExists() bool {
	fileSizeColumnExists.Do(func() {
		mediaHubDB, err := GetDatabaseConnection()
		if err != nil {
			hasFileSizeColumn = false
			return
		}

		// Simple query to check if column exists - if it fails, column doesn't exist
		var dummy sql.NullInt64
		err = mediaHubDB.QueryRow("SELECT file_size FROM processed_files LIMIT 1").Scan(&dummy)
		hasFileSizeColumn = err == nil || !strings.Contains(err.Error(), "no such column")
	})
	return hasFileSizeColumn
}

// DatabaseStats represents statistics about the database
type DatabaseStats struct {
	TotalRecords   int   `json:"totalRecords"`
	ProcessedFiles int   `json:"processedFiles"`
	SkippedFiles   int   `json:"skippedFiles"`
	Movies         int   `json:"movies"`
	TvShows        int   `json:"tvShows"`
	TotalSize      int64 `json:"totalSize"`
}

// DatabaseSearchResponse represents the response for database search
type DatabaseSearchResponse struct {
	Records []DatabaseRecord `json:"records"`
	Stats   DatabaseStats    `json:"stats"`
	Total   int              `json:"total"`
}

// HandleDatabaseSearch handles database search requests
func HandleDatabaseSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get query parameters
	query := r.URL.Query().Get("query")
	filterType := r.URL.Query().Get("type")
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

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

	// Use the database connection pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Failed to connect to database", http.StatusInternalServerError)
		return
	}

	// Build WHERE clause for both count and data queries
	var whereClause strings.Builder
	var whereArgs []interface{}

	whereClause.WriteString(`WHERE 1=1`)

	// Add search filter
	if query != "" {
		whereClause.WriteString(` AND (
			file_path LIKE ? OR
			destination_path LIKE ? OR
			tmdb_id LIKE ? OR
			reason LIKE ?
		)`)
		searchPattern := "%" + query + "%"
		whereArgs = append(whereArgs, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	// Add type filter
	switch filterType {
	case "movies":
		whereClause.WriteString(` AND tmdb_id IS NOT NULL AND tmdb_id != '' AND (season_number IS NULL OR season_number = '')`)
	case "tvshows":
		whereClause.WriteString(` AND tmdb_id IS NOT NULL AND tmdb_id != '' AND season_number IS NOT NULL AND season_number != ''`)
	case "processed":
		whereClause.WriteString(` AND destination_path IS NOT NULL AND destination_path != '' AND (reason IS NULL OR reason = '')`)
	case "skipped":
		whereClause.WriteString(` AND reason IS NOT NULL AND reason != ''`)
	}

	// First, get the total count
	countQuery := "SELECT COUNT(*) FROM processed_files " + whereClause.String()
	var totalCount int
	err = mediaHubDB.QueryRow(countQuery, whereArgs...).Scan(&totalCount)
	if err != nil {
		logger.Error("Failed to get total count: %v", err)
		http.Error(w, "Failed to get total count", http.StatusInternalServerError)
		return
	}

	// Build data query with pagination
	hasFileSizeColumn := checkFileSizeColumnExists()
	fileSizeSelect := "NULL as file_size"
	if hasFileSizeColumn {
		fileSizeSelect = "file_size"
	}

	dataQuery := `
		SELECT
			file_path,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason,
			` + fileSizeSelect + `
		FROM processed_files ` + whereClause.String() + `
		ORDER BY rowid DESC LIMIT ? OFFSET ?`

	dataArgs := append(whereArgs, limit, offset)

	// Execute data query
	rows, err := mediaHubDB.Query(dataQuery, dataArgs...)
	if err != nil {
		logger.Error("Failed to execute search query: %v", err)
		http.Error(w, "Failed to search database", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var records []DatabaseRecord
	for rows.Next() {
		var record DatabaseRecord
		var fileSize sql.NullInt64

		err := rows.Scan(
			&record.FilePath,
			&record.DestinationPath,
			&record.TmdbID,
			&record.SeasonNumber,
			&record.Reason,
			&fileSize,
		)
		if err != nil {
			logger.Warn("Failed to scan database record: %v", err)
			continue
		}

		if fileSize.Valid {
			record.FileSize = &fileSize.Int64
		}

		records = append(records, record)
	}

	// Get database statistics
	stats, err := getDatabaseStats(mediaHubDB)
	if err != nil {
		logger.Warn("Failed to get database stats: %v", err)
		stats = DatabaseStats{}
	}

	response := DatabaseSearchResponse{
		Records: records,
		Stats:   stats,
		Total:   totalCount,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// FileInfo represents file information from the database
type FileInfo struct {
	FileSize        int64
	TmdbID          string
	SeasonNumber    int
	SourcePath      string
	DestinationPath string
}

// GetFileSizeFromDatabase retrieves file size from the processed_files table by file path
func GetFileSizeFromDatabase(filePath string) (int64, bool) {
	if !checkFileSizeColumnExists() {
		return 0, false
	}

	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Debug("Failed to get database connection for file size lookup: %v", err)
		return 0, false
	}

	var fileSize sql.NullInt64
	query := `SELECT file_size FROM processed_files WHERE file_path = ? OR destination_path = ? LIMIT 1`
	err = mediaHubDB.QueryRow(query, filePath, filePath).Scan(&fileSize)
	if err != nil {
		if err != sql.ErrNoRows {
			logger.Debug("Failed to query file size for %s: %v", filePath, err)
		}
		return 0, false
	}

	if fileSize.Valid {
		return fileSize.Int64, true
	}
	return 0, false
}

// GetFileInfoFromDatabase retrieves comprehensive file information from the processed_files table
func GetFileInfoFromDatabase(filePath string) (FileInfo, bool) {
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Debug("Failed to get database connection for file info lookup: %v", err)
		return FileInfo{}, false
	}

	var fileSize sql.NullInt64
	var tmdbID sql.NullString
	var seasonNumber sql.NullInt64
	var sourcePath sql.NullString
	var destinationPath sql.NullString

	hasFileSizeColumn := checkFileSizeColumnExists()
	fileSizeSelect := "NULL as file_size"
	if hasFileSizeColumn {
		fileSizeSelect = "COALESCE(file_size, 0) as file_size"
	}

	query := `SELECT
		` + fileSizeSelect + `,
		COALESCE(tmdb_id, '') as tmdb_id,
		COALESCE(season_number, 0) as season_number,
		COALESCE(file_path, '') as source_path,
		COALESCE(destination_path, '') as destination_path
	FROM processed_files
	WHERE file_path = ? OR destination_path = ?
	LIMIT 1`

	err = mediaHubDB.QueryRow(query, filePath, filePath).Scan(&fileSize, &tmdbID, &seasonNumber, &sourcePath, &destinationPath)
	if err != nil {
		if err != sql.ErrNoRows {
			logger.Debug("Failed to query file info for %s: %v", filePath, err)
		}
		return FileInfo{}, false
	}

	info := FileInfo{}
	if hasFileSizeColumn && fileSize.Valid {
		info.FileSize = fileSize.Int64
	}
	if tmdbID.Valid {
		info.TmdbID = tmdbID.String
	}
	if seasonNumber.Valid {
		info.SeasonNumber = int(seasonNumber.Int64)
	}
	if sourcePath.Valid {
		info.SourcePath = sourcePath.String
	}
	if destinationPath.Valid {
		info.DestinationPath = destinationPath.String
	}

	return info, true
}

// HandleDatabaseStats handles database statistics requests
func HandleDatabaseStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Use the database connection pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Failed to connect to database", http.StatusInternalServerError)
		return
	}

	stats, err := getDatabaseStats(mediaHubDB)
	if err != nil {
		logger.Error("Failed to get database stats: %v", err)
		http.Error(w, "Failed to get database statistics", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// HandleDatabaseExport handles database export requests
func HandleDatabaseExport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Get query parameters
	query := r.URL.Query().Get("query")
	filterType := r.URL.Query().Get("type")

	// Use the database connection pool
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Failed to connect to database", http.StatusInternalServerError)
		return
	}

	// Build export query (similar to search but without limit)
	var sqlQuery strings.Builder
	var args []interface{}
	hasFileSizeColumn := checkFileSizeColumnExists()

	fileSizeSelect := "0 as file_size"
	if hasFileSizeColumn {
		fileSizeSelect = "COALESCE(file_size, 0) as file_size"
	}

	sqlQuery.WriteString(`
		SELECT
			file_path,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			COALESCE(reason, '') as reason,
			` + fileSizeSelect + `
		FROM processed_files
		WHERE 1=1
	`)

	// Add search filter
	if query != "" {
		sqlQuery.WriteString(` AND (
			file_path LIKE ? OR
			destination_path LIKE ? OR
			tmdb_id LIKE ? OR
			reason LIKE ?
		)`)
		searchPattern := "%" + query + "%"
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	// Add type filter
	switch filterType {
	case "movies":
		sqlQuery.WriteString(` AND tmdb_id IS NOT NULL AND tmdb_id != '' AND (season_number IS NULL OR season_number = '')`)
	case "tvshows":
		sqlQuery.WriteString(` AND tmdb_id IS NOT NULL AND tmdb_id != '' AND season_number IS NOT NULL AND season_number != ''`)
	case "processed":
		sqlQuery.WriteString(` AND destination_path IS NOT NULL AND destination_path != '' AND (reason IS NULL OR reason = '')`)
	case "skipped":
		sqlQuery.WriteString(` AND reason IS NOT NULL AND reason != ''`)
	}

	sqlQuery.WriteString(` ORDER BY rowid DESC`)

	// Execute export query
	rows, err := mediaHubDB.Query(sqlQuery.String(), args...)
	if err != nil {
		logger.Error("Failed to execute export query: %v", err)
		http.Error(w, "Failed to export database", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// Set CSV headers
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=database_export.csv")

	// Create CSV writer
	csvWriter := csv.NewWriter(w)
	defer csvWriter.Flush()

	// Write CSV header
	csvWriter.Write([]string{
		"File Path",
		"Destination Path",
		"TMDB ID",
		"Season Number",
		"Reason",
		"File Size",
	})

	// Write CSV data
	for rows.Next() {
		var filePath, destPath, tmdbID, seasonNumber, reason string
		var fileSize int64

		err := rows.Scan(&filePath, &destPath, &tmdbID, &seasonNumber, &reason, &fileSize)
		if err != nil {
			logger.Warn("Failed to scan export record: %v", err)
			continue
		}

		fileSizeStr := strconv.FormatInt(fileSize, 10)
		if !hasFileSizeColumn || fileSize == 0 {
			fileSizeStr = "N/A"
		}

		csvWriter.Write([]string{
			filePath,
			destPath,
			tmdbID,
			seasonNumber,
			reason,
			fileSizeStr,
		})
	}
}

// getDatabaseStats calculates database statistics
func getDatabaseStats(db *sql.DB) (DatabaseStats, error) {
	var stats DatabaseStats

	// Total records
	err := db.QueryRow("SELECT COUNT(*) FROM processed_files").Scan(&stats.TotalRecords)
	if err != nil {
		return stats, err
	}

	// Processed files (have destination_path and no reason)
	err = db.QueryRow(`
		SELECT COUNT(*) FROM processed_files
		WHERE destination_path IS NOT NULL AND destination_path != ''
		AND (reason IS NULL OR reason = '')
	`).Scan(&stats.ProcessedFiles)
	if err != nil {
		return stats, err
	}

	// Skipped files (have reason)
	err = db.QueryRow(`
		SELECT COUNT(*) FROM processed_files
		WHERE reason IS NOT NULL AND reason != ''
	`).Scan(&stats.SkippedFiles)
	if err != nil {
		return stats, err
	}

	// Movies (have tmdb_id but no season_number)
	err = db.QueryRow(`
		SELECT COUNT(DISTINCT tmdb_id) FROM processed_files
		WHERE tmdb_id IS NOT NULL AND tmdb_id != ''
		AND (season_number IS NULL OR season_number = '')
	`).Scan(&stats.Movies)
	if err != nil {
		return stats, err
	}

	// TV Shows (have tmdb_id and season_number)
	err = db.QueryRow(`
		SELECT COUNT(DISTINCT tmdb_id) FROM processed_files
		WHERE tmdb_id IS NOT NULL AND tmdb_id != ''
		AND season_number IS NOT NULL AND season_number != ''
	`).Scan(&stats.TvShows)
	if err != nil {
		return stats, err
	}

	// Get database file size
	mediaHubDBPath := filepath.Join("..", "db", "processed_files.db")
	if fileInfo, err := os.Stat(mediaHubDBPath); err == nil {
		stats.TotalSize = fileInfo.Size()
	} else {
		logger.Warn("Failed to get database file size: %v", err)
		stats.TotalSize = 0
	}

	return stats, nil
}

// HandleDatabaseUpdate handles database update/migration requests
func HandleDatabaseUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Start database update in background
	go func() {
		if err := runDatabaseUpdate(); err != nil {
			logger.Error("Database update failed: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Database update started",
		"status":  "running",
	})
}

// runDatabaseUpdate executes the MediaHub database update command
func runDatabaseUpdate() error {
	logger.Info("Starting database update to new format...")

	// Execute the MediaHub update database command
	cmd := exec.Command("python", "main.py", "--update-database")
	cmd.Dir = "../MediaHub"

	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.Error("Database update failed: %v, output: %s", err, string(output))
		return fmt.Errorf("database update failed: %v", err)
	}

	logger.Info("Database update completed successfully")
	logger.Info("Update output: %s", string(output))

	// Parse output for success/failure counts
	outputStr := string(output)
	if strings.Contains(outputStr, "Successfully migrated") {
		logger.Info("Database migration completed with results logged above")
	}

	return nil
}


