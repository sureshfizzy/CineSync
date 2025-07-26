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
func detectQualityFromPath(filePath string) Quality {
	path := strings.ToLower(filePath)
	
	if strings.Contains(path, "2160p") || strings.Contains(path, "4k") {
		return createQuality(3, "4K-2160p", "bluray", 2160)
	}
	if strings.Contains(path, "1080p") {
		return createQuality(1, "HD-1080p", "bluray", 1080)
	}
	if strings.Contains(path, "720p") {
		return createQuality(2, "HD-720p", "bluray", 720)
	}
	
	return createQuality(1, "Unknown", "unknown", 0)
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

// Image creation utilities
func createMediaImages(tmdbID int, mediaType string) []interface{} {
	if tmdbID <= 0 {
		return []interface{}{}
	}

	// Get poster path from database
	posterPath := getPosterPathFromDatabase(tmdbID, mediaType)
	
	images := []interface{}{}
	baseURL := getImageBaseURL(mediaType)

	if posterPath != "" {
		// Use cached/proxied images
		images = append(images, createImageEntry("poster", 
			fmt.Sprintf("/api/image-cache?poster=%s&size=w500", posterPath),
			fmt.Sprintf("https://image.tmdb.org/t/p/w500%s", posterPath)))
		
		images = append(images, createImageEntry("fanart",
			fmt.Sprintf("/api/image-cache?poster=%s&size=w1280", posterPath),
			fmt.Sprintf("https://image.tmdb.org/t/p/w1280%s", posterPath)))
	} else if checkLocalMediaExists(tmdbID, mediaType) {
		// Use local files
		images = append(images, createImageEntry("poster",
			fmt.Sprintf("%s/%d/poster-500.jpg", baseURL, tmdbID),
			fmt.Sprintf("%s/%d/poster-500.jpg", baseURL, tmdbID)))
		
		images = append(images, createImageEntry("fanart",
			fmt.Sprintf("%s/%d/fanart-1280.jpg", baseURL, tmdbID),
			fmt.Sprintf("%s/%d/fanart-1280.jpg", baseURL, tmdbID)))
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
		return "/images/movies/MediaCover"
	case "tv", "series":
		return "/images/series/MediaCover"
	default:
		return "/images/movies/MediaCover"
	}
}

func checkLocalMediaExists(tmdbID int, mediaType string) bool {
	baseURL := getImageBaseURL(mediaType)
	// Remove the leading slash and convert to file path
	dirPath := strings.TrimPrefix(baseURL, "/images/")
	posterPath := filepath.Join("../db", dirPath, fmt.Sprintf("%d", tmdbID), "poster.jpg")
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
