package spoofing

import (
	"database/sql"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/db"
)

// Common utilities for spoofing operations

// executeWithRetry executes a database operation with retry logic for SQLITE_BUSY errors
func executeWithRetry(operation func() error) error {
	maxRetries := 10
	baseDelay := 100 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		err := operation()
		if err == nil {
			return nil
		}

		// Check if it's a SQLite busy error
		if strings.Contains(err.Error(), "database is locked") || strings.Contains(err.Error(), "SQLITE_BUSY") {
			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<uint(attempt))
				if delay > 5*time.Second {
					delay = 5*time.Second
				}
				jitter := time.Duration(rand.Int63n(int64(delay / 2)))
				time.Sleep(delay + jitter)
				continue
			}
		}
		return err
	}

	return fmt.Errorf("operation failed after %d retries", maxRetries)
}

// Quality detection utilities
func detectQualityFromDatabase(dbQuality, filePath string) Quality {
	if dbQuality != "" {
		// Use database quality if available
		quality := strings.ToLower(strings.TrimSpace(dbQuality))

		// Determine source type first
		var source string
		if strings.Contains(quality, "bluray") && (strings.Contains(quality, "remux") || strings.Contains(quality, "bdremux")) {
			source = "bluray-remux"
		} else if strings.Contains(quality, "bluray") || strings.Contains(quality, "bdrip") || strings.Contains(quality, "bd") {
			source = "bluray"
		} else if strings.Contains(quality, "webdl") || strings.Contains(quality, "web-dl") || strings.Contains(quality, "web dl") {
			source = "webdl"
		} else if strings.Contains(quality, "webrip") || strings.Contains(quality, "web-rip") || strings.Contains(quality, "web rip") {
			source = "webrip"
		} else if strings.Contains(quality, "hdrip") || strings.Contains(quality, "hd-rip") || strings.Contains(quality, "hd rip") {
			source = "hdrip"
		} else if strings.Contains(quality, "hdtv") || strings.Contains(quality, "hd-tv") || strings.Contains(quality, "hd tv") {
			source = "hdtv"
		} else if strings.Contains(quality, "sdtv") || strings.Contains(quality, "sd-tv") || strings.Contains(quality, "sd tv") {
			source = "sdtv"
		} else {
			source = "unknown"
		}

		// Determine resolution and return appropriate quality
		if strings.Contains(quality, "2160p") || strings.Contains(quality, "4k") {
			return createQuality(3, "4K-2160p", source, 2160)
		}
		if strings.Contains(quality, "1080p") {
			return createQuality(1, "HD-1080p", source, 1080)
		}
		if strings.Contains(quality, "720p") {
			return createQuality(2, "HD-720p", source, 720)
		}
		if strings.Contains(quality, "480p") || strings.Contains(quality, "sd") {
			return createQuality(4, "SD-480p", source, 480)
		}
	}

	// If no database quality, try to detect from file path as fallback
	if filePath != "" {
		path := strings.ToLower(filePath)

		// Determine source from file path
		var source string
		if strings.Contains(path, "bluray") && strings.Contains(path, "remux") {
			source = "bluray-remux"
		} else if strings.Contains(path, "bluray") || strings.Contains(path, "bdrip") {
			source = "bluray"
		} else if strings.Contains(path, "webdl") || strings.Contains(path, "web-dl") {
			source = "webdl"
		} else if strings.Contains(path, "webrip") {
			source = "webrip"
		} else if strings.Contains(path, "hdrip") {
			source = "hdrip"
		} else if strings.Contains(path, "hdtv") {
			source = "hdtv"
		} else if strings.Contains(path, "sdtv") {
			source = "sdtv"
		} else {
			source = "unknown"
		}

		if strings.Contains(path, "2160p") || strings.Contains(path, "4k") {
			return createQuality(3, "4K-2160p", source, 2160)
		}
		if strings.Contains(path, "1080p") {
			return createQuality(1, "HD-1080p", source, 1080)
		}
		if strings.Contains(path, "720p") {
			return createQuality(2, "HD-720p", source, 720)
		}
		if strings.Contains(path, "480p") {
			return createQuality(4, "SD-480p", source, 480)
		}
	}

	// Fallback to 1080p when quality is empty or unknown
	return createQuality(1, "HD-1080p", "unknown", 1080)
}

func createQuality(id int, name, source string, resolution int) Quality {
	return Quality{
		Quality:  QualityDefinition{ID: id, Name: name, Source: source, Resolution: resolution},
		Revision: QualityRevision{Version: 1, Real: 0, IsRepack: false},
	}
}

// ID generation utilities
func generateUniqueEpisodeID(seriesID, season, episode int) int {
	return seriesID*10000 + season*100 + episode
}

func generateUniqueEpisodeFileID(seriesID, season, episode int) int {
	return generateUniqueEpisodeID(seriesID, season, episode)
}

// generateUniqueSeriesID creates a unique series ID based on TMDB ID, title, and year
// This prevents collisions when the same TMDB ID appears multiple times
func generateUniqueSeriesID(tmdbID int, title string, year int) int {
	if tmdbID <= 0 {
		return generateHashBasedID(title, year)
	}

	titleHash := simpleStringHash(title)
	uniqueID := tmdbID*1000 + (titleHash+year)%1000

	if uniqueID <= 0 {
		uniqueID = tmdbID*1000 + 1
	}

	return uniqueID
}

// generateHashBasedID creates an ID based on title and year when TMDB ID is not available
func generateHashBasedID(title string, year int) int {
	hash := simpleStringHash(title)
	return (hash*10000 + year) % 999999 + 100000
}

// simpleStringHash creates a simple hash from a string
func simpleStringHash(s string) int {
	hash := 0
	for _, char := range s {
		hash = hash*31 + int(char)
	}
	if hash < 0 {
		hash = -hash
	}
	return hash % 10000
}

// extractTMDBIDFromSeriesID extracts the original TMDB ID from a generated unique series ID
func extractTMDBIDFromSeriesID(uniqueSeriesID int) int {
	return uniqueSeriesID / 1000
}

// Image creation utilities
func createMediaImages(tmdbID int, mediaType string) []interface{} {
	if tmdbID <= 0 {
		return []interface{}{}
	}

	// Get poster path from database
	posterPath := getPosterPathFromDatabase(tmdbID, mediaType)
	
	images := []interface{}{}

	if posterPath != "" {
		// Use cached/proxied images
		images = append(images, createImageEntry("poster", 
			fmt.Sprintf("/api/image-cache?poster=%s&size=w500", posterPath),
			fmt.Sprintf("https://image.tmdb.org/t/p/w500%s", posterPath)))
		
		images = append(images, createImageEntry("fanart",
			fmt.Sprintf("/api/image-cache?poster=%s&size=w1280", posterPath),
			fmt.Sprintf("https://image.tmdb.org/t/p/w1280%s", posterPath)))
	} else if checkLocalMediaExists(tmdbID, mediaType) {
		// Use local files - same path for both movies and series
		images = append(images, createImageEntry("poster",
			fmt.Sprintf("/MediaCover/%d/poster.jpg", tmdbID),
			fmt.Sprintf("/MediaCover/%d/poster.jpg", tmdbID)))

		images = append(images, createImageEntry("fanart",
			fmt.Sprintf("/MediaCover/%d/fanart.jpg", tmdbID),
			fmt.Sprintf("/MediaCover/%d/fanart.jpg", tmdbID)))
	}

	return images
}

func createImageEntry(coverType, url, remoteUrl string) map[string]interface{} {
	return map[string]interface{}{
		"coverType": coverType,
		"url":       url,
		"remoteUrl": remoteUrl,
	}
}

func getImageBaseURL(mediaType string) string {
	switch mediaType {
	case "movie":
		return "/images/MediaCover"
	case "tv", "series":
		return "/images/MediaCover"
	default:
		return "/images/MediaCover"
	}
}

func checkLocalMediaExists(tmdbID int, mediaType string) bool {
	// Check for poster in db/MediaCover/{tmdbID}/poster.jpg
	posterPath := filepath.Join("../db", "MediaCover", fmt.Sprintf("%d", tmdbID), "poster.jpg")
	_, err := os.Stat(posterPath)
	return err == nil
}

func getPosterPathFromDatabase(tmdbID int, mediaType string) string {
	var posterPath string
	
	err := executeWithRetry(func() error {
		dbPath := filepath.Join("../db", "cinesync.db")
		cineSyncDB, err := db.OpenAndConfigureDatabase(dbPath)
		if err != nil {
			return err
		}
		defer cineSyncDB.Close()

		query := `SELECT poster_path FROM tmdb_entities WHERE tmdb_id = ? AND media_type = ? LIMIT 1`
		row := cineSyncDB.QueryRow(query, tmdbID, mediaType)
		
		err = row.Scan(&posterPath)
		if err == sql.ErrNoRows {
			posterPath = ""
			return nil
		}
		return err
	})
	
	if err != nil {
		return ""
	}
	return posterPath
}

// Text extraction utilities
func extractEpisodeTitle(filePath string, season, episode int) string {
	filename := filepath.Base(filePath)
	
	// Try to extract episode title from filename
	pattern := fmt.Sprintf(`S%02dE%02d - (.+?)[\[\.]`, season, episode)
	if matches := regexp.MustCompile(pattern).FindStringSubmatch(filename); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	
	return fmt.Sprintf("S%02dE%02d", season, episode)
}

// Database connection utilities
func withDatabaseConnection(operation func(*sql.DB) error) error {
	return executeWithRetry(func() error {
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
			return err
		}
		return operation(mediaHubDB)
	})
}

// Common language utilities
func getDefaultLanguages() []Language {
	return getLanguagesFromDatabase("")
}

func getLanguagesFromDatabase(dbLanguage string) []Language {
	if dbLanguage == "" {
		// Fallback to English when language is empty
		return []Language{{ID: 2, Name: "English"}}
	}

	// Map common language names to IDs
	languageMap := map[string]Language{
		"english": {ID: 2, Name: "English"},
		"hindi":   {ID: 14, Name: "Hindi"},
		"french":  {ID: 3, Name: "French"},
		"spanish": {ID: 4, Name: "Spanish"},
		"german":  {ID: 5, Name: "German"},
		"italian": {ID: 6, Name: "Italian"},
		"dutch":   {ID: 7, Name: "Dutch"},
		"japanese": {ID: 8, Name: "Japanese"},
		"korean":  {ID: 9, Name: "Korean"},
		"chinese": {ID: 10, Name: "Chinese"},
		"portuguese": {ID: 11, Name: "Portuguese"},
		"russian": {ID: 12, Name: "Russian"},
		"arabic":  {ID: 13, Name: "Arabic"},
	}

	// Normalize the language name
	normalizedLang := strings.ToLower(strings.TrimSpace(dbLanguage))

	if lang, exists := languageMap[normalizedLang]; exists {
		return []Language{lang}
	}

	// If language not found in map, fallback to English
	return []Language{{ID: 2, Name: "English"}}
}

// Time parsing utilities
func parseProcessedTime(timeStr string) time.Time {
	processedTime, err := time.Parse("2006-01-02 15:04:05", timeStr)
	if err != nil {
		processedTime, _ = time.Parse(time.RFC3339, timeStr)
	}
	if processedTime.IsZero() {
		processedTime = time.Now().Add(-24 * time.Hour)
	}
	return processedTime
}

// Safe integer conversion
func safeAtoi(s string, defaultValue int) int {
	if val, err := strconv.Atoi(s); err == nil && val > 0 {
		return val
	}
	return defaultValue
}

// constructSeriesPath constructs the series folder path from destination path, title, and year
func constructSeriesPath(destinationPath, title string, year int) string {
	if destinationPath == "" || title == "" {
		return destinationPath
	}

	seriesFolderName := fmt.Sprintf("%s (%d)", title, year)

	if idx := strings.Index(destinationPath, seriesFolderName); idx != -1 {
		endIdx := idx + len(seriesFolderName)
		return destinationPath[:endIdx]
	}

	pathParts := strings.Split(filepath.ToSlash(destinationPath), "/")

	for i, part := range pathParts {
		if strings.Contains(part, title) && strings.Contains(part, fmt.Sprintf("(%d)", year)) {
			return filepath.Join(pathParts[:i+1]...)
		}
	}

	return filepath.Dir(destinationPath)
}

// getSeriesNameByTmdbID retrieves the series name from TMDB ID
func getSeriesNameByTmdbID(db *sql.DB, tmdbID, folderPath string) (string, error) {
	var seriesName string
	var query string
	var args []interface{}

	if folderPath != "" {
		query = `
			SELECT COALESCE(proper_name, '') as proper_name
			FROM processed_files
			WHERE UPPER(media_type) = 'TV'
			AND COALESCE(tmdb_id, '') = ?
			AND base_path = ?
			AND proper_name IS NOT NULL
			AND proper_name != ''
			LIMIT 1`
		args = []interface{}{tmdbID, folderPath}
	} else {
		query = `
			SELECT COALESCE(proper_name, '') as proper_name
			FROM processed_files
			WHERE UPPER(media_type) = 'TV'
			AND COALESCE(tmdb_id, '') = ?
			AND proper_name IS NOT NULL
			AND proper_name != ''
			LIMIT 1`
		args = []interface{}{tmdbID}
	}

	err := db.QueryRow(query, args...).Scan(&seriesName)
	return seriesName, err
}

// buildEpisodesQuery builds the episodes query with optional folder filtering
func buildEpisodesQuery(seriesName, folderPath string, groupBy bool) (string, []interface{}) {
	var args []interface{}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,`

	if groupBy {
		query += `
			MAX(processed_at) as latest_processed_at,
			SUM(COALESCE(file_size, 0)) as total_file_size,`
	} else {
		query += `
			COALESCE(processed_at, '') as processed_at,
			COALESCE(file_size, 0) as file_size,`
	}

	query += `
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name = ?
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL`

	args = append(args, seriesName)

	if folderPath != "" {
		query += ` AND base_path = ?`
		args = append(args, folderPath)
	}

	if groupBy {
		query += ` GROUP BY proper_name, season_number, episode_number`
	}

	query += ` ORDER BY CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)`

	return query, args
}