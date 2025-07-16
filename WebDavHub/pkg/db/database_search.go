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
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/env"
	"cinesync/pkg/logger"
	_ "modernc.org/sqlite"
)

// DatabaseRecord represents a record from the processed_files table
type DatabaseRecord struct {
	FilePath        string `json:"file_path"`
	DestinationPath string `json:"destination_path,omitempty"`
	BasePath        string `json:"base_path,omitempty"`
	TmdbID          string `json:"tmdb_id,omitempty"`
	SeasonNumber    string `json:"season_number,omitempty"`
	Reason          string `json:"reason,omitempty"`
	FileSize        *int64 `json:"file_size,omitempty"`
	ProcessedAt     string `json:"processed_at,omitempty"`
}

// Cache for column existence to avoid repeated PRAGMA queries
var (
	fileSizeColumnExists sync.Once
	hasFileSizeColumn    bool

	reasonColumnExists sync.Once
	hasReasonColumn    bool

	basePathColumnExists sync.Once
	hasBasePathColumn    bool
)

// checkFileSizeColumnExists checks if the file_size column exists in processed_files table
func checkFileSizeColumnExists() bool {
	fileSizeColumnExists.Do(func() {
		mediaHubDB, err := GetDatabaseConnection()
		if err != nil {
			hasFileSizeColumn = false
			return
		}

		var dummy sql.NullInt64
		err = mediaHubDB.QueryRow("SELECT file_size FROM processed_files LIMIT 1").Scan(&dummy)
		hasFileSizeColumn = err == nil || !strings.Contains(err.Error(), "no such column")
	})
	return hasFileSizeColumn
}

// checkReasonColumnExists checks if the reason column exists in processed_files table
func checkReasonColumnExists() bool {
	reasonColumnExists.Do(func() {
		mediaHubDB, err := GetDatabaseConnection()
		if err != nil {
			hasReasonColumn = false
			return
		}

		// Simple query to check if column exists - if it fails, column doesn't exist
		var dummy sql.NullString
		err = mediaHubDB.QueryRow("SELECT reason FROM processed_files LIMIT 1").Scan(&dummy)
		hasReasonColumn = err == nil || !strings.Contains(err.Error(), "no such column")
	})
	return hasReasonColumn
}

// checkBasePathColumnExists checks if the base_path column exists in processed_files table
func checkBasePathColumnExists() bool {
	basePathColumnExists.Do(func() {
		mediaHubDB, err := GetDatabaseConnection()
		if err != nil {
			hasBasePathColumn = false
			return
		}

		// Simple query to check if column exists - if it fails, column doesn't exist
		var dummy sql.NullString
		err = mediaHubDB.QueryRow("SELECT base_path FROM processed_files LIMIT 1").Scan(&dummy)
		hasBasePathColumn = err == nil || !strings.Contains(err.Error(), "no such column")
	})
	return hasBasePathColumn
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

// FolderCache represents a cache for folder structure similar to Jellyfin's approach
type FolderCache struct {
	mu           sync.RWMutex
	rootFolders  map[string][]FolderInfo
	pathFolders  map[string][]FolderInfo
	totalCounts  map[string]int
	lastUpdated  time.Time
	initialized  bool
}

var (
	globalFolderCache *FolderCache
	cacheOnce         sync.Once
)

// GetFolderCache returns the global folder cache instance
func GetFolderCache() *FolderCache {
	cacheOnce.Do(func() {
		globalFolderCache = &FolderCache{
			rootFolders: make(map[string][]FolderInfo),
			pathFolders: make(map[string][]FolderInfo),
			totalCounts: make(map[string]int),
		}
	})
	return globalFolderCache
}

// getCategoriesFromBasePath gets actual categories from database base_path field
func getCategoriesFromBasePath() []string {
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return nil
	}

	// Check if base_path column exists
	if !checkBasePathColumnExists() {
		logger.Debug("base_path column does not exist yet")
		return nil
	}

	// Get all unique base_path values
	query := `SELECT DISTINCT base_path FROM processed_files WHERE base_path IS NOT NULL AND base_path != '' ORDER BY base_path`
	rows, err := mediaHubDB.Query(query)
	if err != nil {
		logger.Debug("Failed to query base_path for category discovery: %v", err)
		return nil
	}
	defer rows.Close()

	categorySet := make(map[string]bool)

	for rows.Next() {
		var basePath string
		if err := rows.Scan(&basePath); err != nil {
			continue
		}

		apiPath := strings.ReplaceAll(basePath, string(filepath.Separator), "/")

		categorySet[apiPath] = true

		parts := strings.Split(apiPath, "/")
		currentPath := ""
		for i, part := range parts {
			if i == 0 {
				currentPath = part
			} else {
				currentPath = currentPath + "/" + part
			}
			if currentPath != "" {
				categorySet[currentPath] = true
			}
		}
	}

	// Convert set to slice
	var categories []string
	for category := range categorySet {
		categories = append(categories, category)
	}

	return categories
}

func InitializeFolderCache() error {
	cache := GetFolderCache()
	cache.mu.Lock()
	defer cache.mu.Unlock()

	// Get actual categories from database base_path field
	commonCategories := getCategoriesFromBasePath()
	if len(commonCategories) == 0 {
		cache.initialized = true
		return nil
	}

	maxProcesses := GetMaxProcesses(len(commonCategories))

	// Channel to control concurrency
	semaphore := make(chan struct{}, maxProcesses)
	var wg sync.WaitGroup

	// Results channel to collect category data
	type categoryResult struct {
		category string
		folders  []FolderInfo
		total    int
		err      error
	}
	results := make(chan categoryResult, len(commonCategories))

	// Pre-load first 2000 items for each category in parallel (better cache coverage)
	for _, category := range commonCategories {
		wg.Add(1)
		go func(cat string) {
			defer wg.Done()

			// Acquire semaphore
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Smart caching: Load first 2000 folders (covers most navigation patterns)
			// This balances memory usage vs performance for large libraries
			categoryFolders, totalCategory, err := GetFoldersFromDatabasePaginated(cat, 1, 2000)

			results <- categoryResult{
				category: cat,
				folders:  categoryFolders,
				total:    totalCategory,
				err:      err,
			}
		}(category)
	}

	// Wait for all goroutines to complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	successCount := 0
	for result := range results {
		if result.err != nil {
			logger.Debug("Failed to load cache for category %s: %v", result.category, result.err)
			continue
		}

		if len(result.folders) > 0 {
			cache.pathFolders[result.category] = result.folders
			cache.totalCounts[result.category] = result.total
			successCount++
		}
	}

	cache.lastUpdated = time.Now()
	cache.initialized = true
	return nil
}

// InvalidateFolderCache clears the cache when database is updated (legacy function)
func InvalidateFolderCache() {
	cache := GetFolderCache()
	cache.mu.Lock()
	defer cache.mu.Unlock()

	cache.rootFolders = make(map[string][]FolderInfo)
	cache.pathFolders = make(map[string][]FolderInfo)
	cache.totalCounts = make(map[string]int)
	cache.initialized = false

	logger.Info("Folder cache invalidated")
}

// InvalidateFolderCacheForCategory clears the cache for a specific category
func InvalidateFolderCacheForCategory(category string) {
	cache := GetFolderCache()
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if !cache.initialized {
		return
	}

	delete(cache.pathFolders, category)
	delete(cache.totalCounts, category)

	if rootFolders, exists := cache.rootFolders[""]; exists {
		for i, folder := range rootFolders {
			if folder.FolderName == category {
				cache.rootFolders[""] = append(rootFolders[:i], rootFolders[i+1:]...)
				break
			}
		}
	}
}

// UpdateFolderCacheForNewFile adds a new file to the cache instead of invalidating everything
func UpdateFolderCacheForNewFile(destinationPath, properName, year, tmdbID, mediaType string, seasonNumber int) {
	if destinationPath == "" || properName == "" {
		return
	}

	cache := GetFolderCache()
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if !cache.initialized {
		return
	}

	// Extract the category from destination path
	destDir := env.GetString("DESTINATION_DIR", "")
	if destDir == "" {
		return
	}

	// Remove destination directory prefix to get relative path
	relativePath := strings.TrimPrefix(destinationPath, destDir)
	relativePath = strings.Trim(relativePath, "/\\")

	// Split path to get category (Movies, TV Shows, etc.)
	pathParts := strings.Split(relativePath, string(filepath.Separator))
	if len(pathParts) == 0 {
		return
	}

	// Determine the correct category based on source structure
	var category string
	if env.GetString("USE_SOURCE_STRUCTURE", "false") == "true" && len(pathParts) >= 2 {
		category = pathParts[1]
	} else {
		category = pathParts[0]
	}

	// Build folder name from proper_name and year
	var folderName string
	if year != "" {
		folderName = properName + " (" + year + ")"
	} else {
		folderName = properName
	}

	// Check if this folder already exists in cache
	if cachedFolders, exists := cache.pathFolders[category]; exists {
		// Check if folder already exists
		folderExists := false
		for i, folder := range cachedFolders {
			if folder.FolderName == folderName {
				cache.pathFolders[category][i].FileCount++
				folderExists = true
				break
			}
		}

		// If folder doesn't exist, add it
		if !folderExists {
			newFolder := FolderInfo{
				FolderName:   folderName,
				FolderPath:   "/" + category + "/" + folderName,
				ProperName:   properName,
				Year:         year,
				TmdbID:       tmdbID,
				MediaType:    mediaType,
				SeasonNumber: seasonNumber,
				FileCount:    1,
			}

			// Insert in alphabetical order
			inserted := false
			for i, folder := range cachedFolders {
				if strings.ToLower(folderName) < strings.ToLower(folder.FolderName) {
					cache.pathFolders[category] = append(cachedFolders[:i], append([]FolderInfo{newFolder}, cachedFolders[i:]...)...)
					inserted = true
					break
				}
			}
			if !inserted {
				cache.pathFolders[category] = append(cachedFolders, newFolder)
			}
			cache.totalCounts[category]++
		}
	}

	// Update root folder counts
	if rootFolders, exists := cache.rootFolders[""]; exists {
		for i, folder := range rootFolders {
			if folder.FolderName == category {
				cache.rootFolders[""][i].FileCount++
				break
			}
		}
	}
}

// RemoveFolderFromCache removes a folder from cache when files are deleted
func RemoveFolderFromCache(destinationPath, properName, year string) {
	if destinationPath == "" || properName == "" {
		return
	}

	cache := GetFolderCache()
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if !cache.initialized {
		return
	}

	destDir := env.GetString("DESTINATION_DIR", "")
	if destDir == "" {
		return
	}

	relativePath := strings.TrimPrefix(destinationPath, destDir)
	relativePath = strings.Trim(relativePath, "/\\")

	pathParts := strings.Split(relativePath, string(filepath.Separator))
	if len(pathParts) == 0 {
		return
	}

	category := pathParts[0]

	var folderName string
	if year != "" {
		folderName = properName + " (" + year + ")"
	} else {
		folderName = properName
	}

	// Update cache
	if cachedFolders, exists := cache.pathFolders[category]; exists {
		for i, folder := range cachedFolders {
			if folder.FolderName == folderName {
				cache.pathFolders[category][i].FileCount--

				if cache.pathFolders[category][i].FileCount <= 0 {
					cache.pathFolders[category] = append(cachedFolders[:i], cachedFolders[i+1:]...)
					cache.totalCounts[category]--

				}
				break
			}
		}
	}

	// Update root folder counts
	if rootFolders, exists := cache.rootFolders[""]; exists {
		for i, folder := range rootFolders {
			if folder.FolderName == category {
				if cache.rootFolders[""][i].FileCount > 0 {
					cache.rootFolders[""][i].FileCount--
				}
				break
			}
		}
	}
}

// UpdateFolderCacheForNewFileFromDB adds a new file to cache by looking up metadata from database
func UpdateFolderCacheForNewFileFromDB(destinationPath, tmdbID, seasonNumberStr string) {
	if destinationPath == "" {
		return
	}

	// Get database connection
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Debug("Failed to get database connection for cache update: %v", err)
		return
	}

	// Query database for file metadata
	var properName, year, mediaType string
	var seasonNumber int

	query := `
		SELECT COALESCE(proper_name, ''), COALESCE(year, ''), COALESCE(media_type, ''), COALESCE(season_number, 0)
		FROM processed_files
		WHERE destination_path = ?
		LIMIT 1`

	err = mediaHubDB.QueryRow(query, destinationPath).Scan(&properName, &year, &mediaType, &seasonNumber)
	if err != nil {
		if tmdbID != "" {
			query = `
				SELECT COALESCE(proper_name, ''), COALESCE(year, ''), COALESCE(media_type, ''), COALESCE(season_number, 0)
				FROM processed_files
				WHERE tmdb_id = ?
				LIMIT 1`

			err = mediaHubDB.QueryRow(query, tmdbID).Scan(&properName, &year, &mediaType, &seasonNumber)
			if err != nil {
				logger.Debug("Failed to find file metadata for cache update: %v", err)
				return
			}
		} else {
			logger.Debug("Failed to find file metadata for cache update: %v", err)
			return
		}
	}

	if seasonNumberStr != "" {
		if sn, err := strconv.Atoi(seasonNumberStr); err == nil {
			seasonNumber = sn
		}
	}

	UpdateFolderCacheForNewFile(destinationPath, properName, year, tmdbID, mediaType, seasonNumber)
}

// RemoveFolderFromCacheFromDB removes a file from cache by looking up metadata from database
func RemoveFolderFromCacheFromDB(destinationPath, tmdbID string) {
	if destinationPath == "" {
		return
	}

	// Get database connection
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Debug("Failed to get database connection for cache removal: %v", err)
		return
	}

	// Query database for file metadata
	var properName, year string

	query := `
		SELECT COALESCE(proper_name, ''), COALESCE(year, '')
		FROM processed_files
		WHERE destination_path = ?
		LIMIT 1`

	err = mediaHubDB.QueryRow(query, destinationPath).Scan(&properName, &year)
	if err != nil {
		if tmdbID != "" {
			query = `
				SELECT COALESCE(proper_name, ''), COALESCE(year, '')
				FROM processed_files
				WHERE tmdb_id = ?
				LIMIT 1`

			err = mediaHubDB.QueryRow(query, tmdbID).Scan(&properName, &year)
			if err != nil {
				logger.Debug("Failed to find file metadata for cache removal: %v", err)
				return
			}
		} else {
			logger.Debug("Failed to find file metadata for cache removal: %v", err)
			return
		}
	}
	RemoveFolderFromCache(destinationPath, properName, year)
}

// buildSearchWhereClause builds optimized WHERE clause for database searches
func buildSearchWhereClause(query, filterType string) (string, []interface{}) {
	var whereClause strings.Builder
	var whereArgs []interface{}

	whereClause.WriteString(`WHERE 1=1`)

	// Add search filter with optimized LIKE patterns
	if query != "" {
		whereClause.WriteString(` AND (
			file_path LIKE ? OR
			destination_path LIKE ? OR
			base_path LIKE ? OR
			tmdb_id LIKE ? OR
			reason LIKE ?
		)`)
		searchPattern := "%" + query + "%"
		whereArgs = append(whereArgs, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	// Add type filter with optimized conditions
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
	return whereClause.String(), whereArgs
}

// HandleDatabaseSearch handles database search requests
func HandleDatabaseSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := r.URL.Query().Get("query")
	filterType := r.URL.Query().Get("type")

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsedLimit, err := strconv.Atoi(limitStr); err == nil && parsedLimit > 0 && parsedLimit <= 1000 {
			limit = parsedLimit
		}
	}

	// Parse offset with bounds checking
	offset := 0
	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if parsedOffset, err := strconv.Atoi(offsetStr); err == nil && parsedOffset >= 0 {
			offset = parsedOffset
		}
	}

	// Get database connection once
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Failed to connect to database", http.StatusInternalServerError)
		return
	}

	// Build optimized WHERE clause
	whereClause, whereArgs := buildSearchWhereClause(query, filterType)

	// Use optimized single query with window function for count
	hasFileSizeColumn := checkFileSizeColumnExists()
	fileSizeSelect := "NULL as file_size"
	if hasFileSizeColumn {
		fileSizeSelect = "file_size"
	}

	hasReason := checkReasonColumnExists()
	hasBasePath := checkBasePathColumnExists()

	var reasonSelect, basePathSelect string
	if hasReason {
		reasonSelect = "COALESCE(reason, '') as reason"
	} else {
		reasonSelect = "'' as reason"
	}

	if hasBasePath {
		basePathSelect = "COALESCE(base_path, '') as base_path"
	} else {
		basePathSelect = "'' as base_path"
	}

	// Single query that gets both data and total count
	dataQuery := `
		SELECT
			file_path,
			COALESCE(destination_path, '') as destination_path,
			` + basePathSelect + `,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(season_number, '') as season_number,
			` + reasonSelect + `,
			` + fileSizeSelect + `,
			COALESCE(processed_at, '') as processed_at,
			COUNT(*) OVER() as total_count
		FROM processed_files ` + whereClause + `
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
	var totalCount int

	for rows.Next() {
		var record DatabaseRecord
		var fileSize sql.NullInt64

		err := rows.Scan(
			&record.FilePath,
			&record.DestinationPath,
			&record.BasePath,
			&record.TmdbID,
			&record.SeasonNumber,
			&record.Reason,
			&fileSize,
			&record.ProcessedAt,
			&totalCount,
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
	EpisodeNumber   int
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

// FolderInfo represents folder information from database
type FolderInfo struct {
	FolderName   string `json:"folder_name"`
	FolderPath   string `json:"folder_path"`
	TmdbID       string `json:"tmdb_id,omitempty"`
	MediaType    string `json:"media_type,omitempty"`
	Year         string `json:"year,omitempty"`
	ProperName   string `json:"proper_name,omitempty"`
	SeasonNumber int    `json:"season_number,omitempty"`
	FileCount    int    `json:"file_count"`
	Modified     string `json:"modified,omitempty"`
}

func GetFoldersFromDatabasePaginated(basePath string, page, limit int) ([]FolderInfo, int, error) {
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return nil, 0, err
	}

	// Clean the base path
	cleanBasePath := strings.Trim(basePath, "/\\")

	if cleanBasePath == "" {
		// Root level - don't query database, let filesystem handle it
		// This is much simpler and works perfectly as shown in your logs
		return nil, 0, fmt.Errorf("root level should use filesystem")
	}

	// Category level - get movies/shows using optimized database query
	offset := (page - 1) * limit
	result, total, err := getCategoryFoldersPaginated(mediaHubDB, cleanBasePath, page, limit, offset)
	return result, total, err
}



// getCategoryFoldersPaginated gets folders within a category using base_path field
func getCategoryFoldersPaginated(db *sql.DB, category string, page, limit, offset int) ([]FolderInfo, int, error) {
	destDir := env.GetString("DESTINATION_DIR", "")
	if destDir == "" {
		return nil, 0, fmt.Errorf("DESTINATION_DIR not set")
	}
	destDir = filepath.Clean(destDir)

	// Check if base_path column exists
	if !checkBasePathColumnExists() {
		logger.Debug("base_path column does not exist yet")
		return nil, 0, fmt.Errorf("base_path column not available")
	}

	// Normalize path separators - database stores with backslashes, API uses forward slashes
	normalizedCategory := strings.ReplaceAll(category, "/", string(filepath.Separator))

	// First check for exact match (leaf category with content)
	exactMatchQuery := `SELECT COUNT(*) FROM processed_files WHERE base_path = ?`
	var exactCount int
	err := db.QueryRow(exactMatchQuery, normalizedCategory).Scan(&exactCount)
	if err != nil {
		logger.Debug("Failed to check exact match: %v", err)
		return nil, 0, err
	}

	if exactCount > 0 {
		// This is a leaf category, return content folders
		return getCategoryContentFolders(db, normalizedCategory, page, limit, offset)
	}

	// No exact match, look for subcategories
	subcategoryQuery := `
		SELECT DISTINCT base_path
		FROM processed_files
		WHERE base_path IS NOT NULL
		AND base_path != ''
		AND base_path LIKE ?
		ORDER BY base_path`

	likePattern := normalizedCategory + string(filepath.Separator) + "%"

	rows, err := db.Query(subcategoryQuery, likePattern)
	if err != nil {
		logger.Debug("Failed to query subcategories: %v", err)
		return nil, 0, err
	}
	defer rows.Close()

	var subcategoryBasePaths []string
	for rows.Next() {
		var basePath string
		if err := rows.Scan(&basePath); err != nil {
			continue
		}
		subcategoryBasePaths = append(subcategoryBasePaths, basePath)
	}



	// Extract the next level folder names from subcategory base_paths
	subfolderMap := make(map[string]bool)
	for _, basePath := range subcategoryBasePaths {
		// For base_path "Hunch\1080p" and category "Hunch", extract "1080p"
		if strings.HasPrefix(basePath, normalizedCategory+string(filepath.Separator)) {
			remainder := basePath[len(normalizedCategory)+1:] // Remove "Hunch\"
			parts := strings.Split(remainder, string(filepath.Separator))
			if len(parts) > 0 && parts[0] != "" {
				subfolderMap[parts[0]] = true
			}
		}
	}

	var folders []FolderInfo

	// If we have subfolders, return them as folders
	if len(subfolderMap) > 0 {
		for subfolder := range subfolderMap {
			folders = append(folders, FolderInfo{
				FolderName: subfolder,
				FolderPath: "/" + category + "/" + subfolder,
				TmdbID:     "",
				MediaType:  "",
			})
		}
		return folders, len(folders), nil
	}

	// No subcategories found, return empty result
	return []FolderInfo{}, 0, nil
}

// getCategoryContentFolders gets content folders for a leaf category
func getCategoryContentFolders(db *sql.DB, basePath string, page, limit, offset int) ([]FolderInfo, int, error) {
	if strings.Contains(basePath, "(") && strings.Contains(basePath, ")") {
		return []FolderInfo{}, 0, nil
	}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, '') as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(media_type, '') as media_type,
			COALESCE(season_number, 0) as season_number,
			COUNT(*) as file_count,
			MAX(processed_at) as latest_processed_at,
			COUNT(*) OVER() as total_count
		FROM processed_files
		WHERE base_path = ?
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT ? OFFSET ?`

	rows, err := db.Query(query, basePath, limit, offset)
	if err != nil {
		logger.Debug("Failed to query content folders: %v", err)
		return nil, 0, err
	}
	defer rows.Close()

	var folders []FolderInfo
	var totalCount int

	for rows.Next() {
		var folder FolderInfo
		var latestProcessedAt string

		err := rows.Scan(&folder.ProperName, &folder.Year, &folder.TmdbID, &folder.MediaType, &folder.SeasonNumber, &folder.FileCount, &latestProcessedAt, &totalCount)
		if err != nil {
			continue
		}

		// Build folder name from proper_name and year
		if folder.ProperName != "" && folder.Year != "" {
			folder.FolderName = folder.ProperName + " (" + folder.Year + ")"
		} else if folder.ProperName != "" {
			folder.FolderName = folder.ProperName
		} else {
			continue
		}

		apiPath := "/" + strings.ReplaceAll(basePath, string(filepath.Separator), "/") + "/" + folder.FolderName
		folder.FolderPath = apiPath
		folder.Modified = latestProcessedAt

		folders = append(folders, folder)
	}

	return folders, totalCount, nil
}

func GetFoldersFromDatabaseCached(basePath string, page, limit int) ([]FolderInfo, int, error) {
	if basePath == "" {
		return GetFoldersFromDatabasePaginated(basePath, page, limit)
	}

	cleanBasePath := strings.TrimPrefix(basePath, "/")

	cache := GetFolderCache()

	cache.mu.RLock()

	if cache.initialized {
		// Check category folders
		if cachedFolders, exists := cache.pathFolders[cleanBasePath]; exists {
			totalCount := cache.totalCounts[cleanBasePath]
			startIdx := (page - 1) * limit

			// If request is within cached range, serve from cache
			if startIdx < len(cachedFolders) {
				cache.mu.RUnlock()

				endIdx := startIdx + limit
				if endIdx > len(cachedFolders) {
					endIdx = len(cachedFolders)
				}

				result := cachedFolders[startIdx:endIdx]
				return result, totalCount, nil
			} else {
				// Expand cache by loading more data
				cache.mu.RUnlock()
				expandedLimit := startIdx + limit + 500 // Add 500 item buffer
				expandedFolders, expandedTotal, err := GetFoldersFromDatabasePaginated(cleanBasePath, 1, expandedLimit)
				if err == nil && len(expandedFolders) > len(cachedFolders) {
					cache.mu.Lock()
					cache.pathFolders[cleanBasePath] = expandedFolders
					cache.totalCounts[cleanBasePath] = expandedTotal
					cache.mu.Unlock()

					// Serve the requested page from expanded cache
					if startIdx < len(expandedFolders) {
						endIdx := startIdx + limit
						if endIdx > len(expandedFolders) {
							endIdx = len(expandedFolders)
						}
						result := expandedFolders[startIdx:endIdx]

						return result, expandedTotal, nil
					}
				}
				cache.mu.RLock()
			}
		} else {

		}
	}
	cache.mu.RUnlock()

	// Load more data than requested to populate cache for future requests
	cacheLimit := limit
	if limit < 500 {
		cacheLimit = 500
	}

	result, total, err := GetFoldersFromDatabasePaginated(basePath, 1, cacheLimit)

	if err == nil {

		// Populate cache with the results
		cache.mu.Lock()
		cache.pathFolders[cleanBasePath] = result
		cache.totalCounts[cleanBasePath] = total
		cache.mu.Unlock()

		// Return the requested page from the cached results
		startIdx := (page - 1) * limit
		if startIdx < len(result) {
			endIdx := startIdx + limit
			if endIdx > len(result) {
				endIdx = len(result)
			}
			return result[startIdx:endIdx], total, nil
		}

		return result, total, nil
	}

	return result, total, err
}

// SearchFoldersFromDatabase searches folders in the database using proper_name and folder_name
func SearchFoldersFromDatabase(basePath string, searchQuery string, page, limit int) ([]FolderInfo, int, error) {
	mediaHubDB, err := GetDatabaseConnection()
	if err != nil {
		return nil, 0, err
	}

	// Clean the base path
	cleanBasePath := strings.Trim(basePath, "/\\")

	if cleanBasePath == "" {
		return searchRootFolders(mediaHubDB, searchQuery, page, limit)
	}

	return searchCategoryFolders(mediaHubDB, cleanBasePath, searchQuery, page, limit)
}

// searchRootFolders searches across all categories
func searchRootFolders(db *sql.DB, searchQuery string, page, limit int) ([]FolderInfo, int, error) {
	destDir := env.GetString("DESTINATION_DIR", "")
	if destDir == "" {
		return nil, 0, fmt.Errorf("DESTINATION_DIR not set")
	}
	destDir = filepath.Clean(destDir)

	searchPattern := "%" + searchQuery + "%"
	searchPathPattern := destDir + string(filepath.Separator) + "%"
	offset := (page - 1) * limit

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, '') as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(media_type, '') as media_type,
			COALESCE(season_number, 0) as season_number,
			COUNT(*) as file_count,
			COALESCE(base_path, '') as base_path,
			MAX(processed_at) as latest_processed_at,
			COUNT(*) OVER() as total_count
		FROM processed_files
		WHERE destination_path IS NOT NULL
		AND destination_path != ''
		AND destination_path LIKE ?
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND (proper_name LIKE ? OR year LIKE ?)
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT ? OFFSET ?`

	rows, err := db.Query(query, searchPathPattern, searchPattern, searchPattern, limit, offset)
	if err != nil {
		logger.Debug("Failed to search root folders: %v", err)
		return nil, 0, err
	}
	defer rows.Close()

	var folders []FolderInfo
	var totalCount int

	for rows.Next() {
		var folder FolderInfo
		var basePath string
		var latestProcessedAt string

		err := rows.Scan(&folder.ProperName, &folder.Year, &folder.TmdbID, &folder.MediaType,
			&folder.SeasonNumber, &folder.FileCount, &basePath, &latestProcessedAt, &totalCount)
		if err != nil {
			logger.Debug("Failed to scan search result: %v", err)
			continue
		}

		// Build folder name and path
		if folder.ProperName != "" && folder.Year != "" {
			folder.FolderName = folder.ProperName + " (" + folder.Year + ")"
		} else if folder.ProperName != "" {
			folder.FolderName = folder.ProperName
		} else {
			continue
		}

		if basePath != "" {
			apiBasePath := strings.ReplaceAll(basePath, "\\", "/")
			folder.FolderPath = "/" + apiBasePath + "/" + folder.FolderName
		} else {
			folder.FolderPath = "/" + folder.FolderName
		}

		folder.Modified = latestProcessedAt

		folders = append(folders, folder)
	}

	return folders, totalCount, nil
}

// searchCategoryFolders searches within a specific category
func searchCategoryFolders(db *sql.DB, category string, searchQuery string, page, limit int) ([]FolderInfo, int, error) {
	if !checkBasePathColumnExists() {
		return nil, 0, fmt.Errorf("base_path column not available")
	}

	normalizedCategory := strings.ReplaceAll(category, "/", string(filepath.Separator))

	searchPattern := "%" + searchQuery + "%"
	offset := (page - 1) * limit
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, '') as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(media_type, '') as media_type,
			COALESCE(season_number, 0) as season_number,
			COUNT(*) as file_count,
			MAX(processed_at) as latest_processed_at,
			COUNT(*) OVER() as total_count
		FROM processed_files
		WHERE base_path = ?
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND (proper_name LIKE ? OR year LIKE ?)
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT ? OFFSET ?`

	rows, err := db.Query(query, normalizedCategory, searchPattern, searchPattern, limit, offset)
	if err != nil {
		logger.Debug("Failed to search category folders: %v", err)
		return nil, 0, err
	}
	defer rows.Close()

	var folders []FolderInfo
	var totalCount int

	for rows.Next() {
		var folder FolderInfo
		var latestProcessedAt string

		err := rows.Scan(&folder.ProperName, &folder.Year, &folder.TmdbID, &folder.MediaType,
			&folder.SeasonNumber, &folder.FileCount, &latestProcessedAt, &totalCount)
		if err != nil {
			logger.Debug("Failed to scan category search result: %v", err)
			continue
		}

		// Build folder name and path
		if folder.ProperName != "" && folder.Year != "" {
			folder.FolderName = folder.ProperName + " (" + folder.Year + ")"
		} else if folder.ProperName != "" {
			folder.FolderName = folder.ProperName
		} else {
			continue
		}

		folder.FolderPath = "/" + category + "/" + folder.FolderName
		folder.Modified = latestProcessedAt

		folders = append(folders, folder)
	}

	return folders, totalCount, nil
}

// extractCategoryFromPath extracts the category name from a destination path
func extractCategoryFromPath(destPath, destDir string) string {
	relativePath := strings.TrimPrefix(destPath, destDir)
	relativePath = strings.TrimPrefix(relativePath, string(filepath.Separator))

	// Get the first directory component
	parts := strings.Split(relativePath, string(filepath.Separator))
	if len(parts) > 0 && parts[0] != "" {
		return parts[0]
	}

	return "Unknown"
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
	var episodeNumber sql.NullInt64
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
		COALESCE(episode_number, 0) as episode_number,
		COALESCE(file_path, '') as source_path,
		COALESCE(destination_path, '') as destination_path
	FROM processed_files
	WHERE file_path = ? OR destination_path = ?
	LIMIT 1`

	err = mediaHubDB.QueryRow(query, filePath, filePath).Scan(&fileSize, &tmdbID, &seasonNumber, &episodeNumber, &sourcePath, &destinationPath)
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
	if episodeNumber.Valid {
		info.EpisodeNumber = int(episodeNumber.Int64)
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

	// Check if reason column exists before using it
	hasReason := checkReasonColumnExists()

	if hasReason {
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
	} else {
		// Fallback when reason column doesn't exist
		err = db.QueryRow(`
			SELECT COUNT(*) FROM processed_files
			WHERE destination_path IS NOT NULL AND destination_path != ''
		`).Scan(&stats.ProcessedFiles)
		if err != nil {
			return stats, err
		}

		stats.SkippedFiles = 0
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

// getPythonCommand determines the correct Python executable based on the OS and environment
func getPythonCommand() string {
	if customPython := env.GetString("PYTHON_COMMAND", ""); customPython != "" {
		return customPython
	}

	// Default platform-specific behavior
	if runtime.GOOS == "windows" {
		return "python"
	}
	return "python3"
}

// runDatabaseUpdate executes the MediaHub database update command
func runDatabaseUpdate() error {
	logger.Info("Starting database update to new format...")

	// Get the appropriate Python command for this platform
	pythonCmd := getPythonCommand()

	// Execute the MediaHub update database command
	cmd := exec.Command(pythonCmd, "main.py", "--update-database")
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