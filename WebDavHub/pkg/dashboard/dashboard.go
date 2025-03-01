package dashboard

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"cinesync/pkg/logger"
)

// DashboardData holds the data needed for rendering the dashboard template
type DashboardData struct {
	Title        string
	MediaFolders []MediaFolder
	Year         int
	Version      string
}

// MediaFolder represents a media folder displayed on the dashboard
type MediaFolder struct {
	Name        string
	Path        string
	Description string
	Icon        string
	ItemCount   int
	TotalSize   string
	LastUpdated string
}

// GetMediaFolders scans the root directory and returns a list of media folders
func GetMediaFolders(rootDir string) ([]MediaFolder, error) {
	var folders []MediaFolder

	entries, err := os.ReadDir(rootDir)
	if err != nil {
		return nil, err
	}

	for _, entry := range entries {
		if entry.IsDir() {
			path := filepath.Join(rootDir, entry.Name())

			// Get folder stats with recursive calculation
			itemCount, totalSize, lastUpdated, err := GetFolderStats(path)
			if err != nil {
				logger.Warn("Error getting stats for folder %s: %v", path, err)
				continue
			}

			// Default icon and description based on folder name
			icon := "fas fa-folder"
			description := "Media folder"

			// Set specific icons based on folder name for TV and Movies
			lowerName := strings.ToLower(entry.Name())
			if strings.Contains(lowerName, "movie") || strings.Contains(lowerName, "film") {
				icon = "fas fa-film"
				description = "Movie collection"
			} else if strings.Contains(lowerName, "tv") || strings.Contains(lowerName, "show") {
				icon = "fas fa-tv"
				description = "TV shows collection"
			}

			folders = append(folders, MediaFolder{
				Name:        entry.Name(),
				Path:        "/browse/" + entry.Name(),
				Description: description,
				Icon:        icon,
				ItemCount:   itemCount,
				TotalSize:   FormatSize(totalSize),
				LastUpdated: lastUpdated,
			})
		}
	}

	return folders, nil
}

// GetFolderStats returns statistics about a folder with recursive size calculation
func GetFolderStats(path string) (itemCount int, totalSize int64, lastUpdated string, err error) {
	var latestTime time.Time

	err = filepath.Walk(path, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip the root path itself from item count
		if filePath != path {
			if !info.IsDir() {
				itemCount++
				totalSize += info.Size()
			}
		}

		if info.ModTime().After(latestTime) {
			latestTime = info.ModTime()
		}

		return nil
	})

	if err != nil {
		return 0, 0, "", err
	}

	// Format the last updated time
	if !latestTime.IsZero() {
		lastUpdated = latestTime.Format("Jan 02, 2006")
	} else {
		lastUpdated = "N/A"
	}

	return itemCount, totalSize, lastUpdated, nil
}

// FormatSize formats a file size in bytes to a human-readable string
func FormatSize(size int64) string {
	const unit = 1024
	if size < unit {
		return fmt.Sprintf("%d B", size)
	}
	div, exp := int64(unit), 0
	for n := size / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(size)/float64(div), "KMGTPE"[exp])
}
