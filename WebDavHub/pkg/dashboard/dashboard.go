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
	Stats        DashboardStats
	Year         int
	Version      string
}

// DashboardStats holds overall statistics for the dashboard
type DashboardStats struct {
	TotalFolders  int
	TotalItems    int
	TotalSize     string
	RecentUpdates []RecentUpdate
}

// RecentUpdate represents a recently updated item for the dashboard
type RecentUpdate struct {
	Name      string
	Path      string
	FolderName string
	UpdatedAt time.Time
	Type      string
}

// MediaFolder represents a media folder displayed on the dashboard
type MediaFolder struct {
	Name          string
	Path          string
	Description   string
	Icon          string
	IconColor     string
	ItemCount     int
	TotalSize     string
	LastUpdated   string
	LastUpdatedAt time.Time
	MediaType     string
}

// GetDashboardData prepares all data needed for rendering the dashboard
func GetDashboardData(rootDir string, version string) (DashboardData, error) {
	mediaFolders, err := GetMediaFolders(rootDir)
	if err != nil {
		return DashboardData{}, err
	}

	// Calculate overall statistics
	totalItems := 0
	var totalSize int64 = 0
	for _, folder := range mediaFolders {
		totalItems += folder.ItemCount
	}

	// Get recent updates
	recentUpdates, err := GetRecentUpdates(rootDir, 5)
	if err != nil {
		logger.Warn("Error getting recent updates: %v", err)
	}

	stats := DashboardStats{
		TotalFolders:  len(mediaFolders),
		TotalItems:    totalItems,
		TotalSize:     FormatSize(totalSize),
		RecentUpdates: recentUpdates,
	}

	return DashboardData{
		Title:        "Media Dashboard",
		MediaFolders: mediaFolders,
		Stats:        stats,
		Year:         time.Now().Year(),
		Version:      version,
	}, nil
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
			itemCount, totalSize, lastUpdatedTime, err := GetFolderStats(path)
			if err != nil {
				logger.Warn("Error getting stats for folder %s: %v", path, err)
				continue
			}

			lastUpdated := "N/A"
			if !lastUpdatedTime.IsZero() {
				lastUpdated = FormatTimeAgo(lastUpdatedTime)
			}

			// Enhanced media type detection
			mediaType, icon, iconColor, description := DetectMediaType(entry.Name())

			folders = append(folders, MediaFolder{
				Name:          entry.Name(),
				Path:          "/browse/" + entry.Name(),
				Description:   description,
				Icon:          icon,
				IconColor:     iconColor,
				ItemCount:     itemCount,
				TotalSize:     FormatSize(totalSize),
				LastUpdated:   lastUpdated,
				LastUpdatedAt: lastUpdatedTime,
				MediaType:     mediaType,
			})
		}
	}

	return folders, nil
}

// DetectMediaType determines the media type, icon, and description based on folder name
func DetectMediaType(folderName string) (mediaType, icon, iconColor, description string) {
	lowerName := strings.ToLower(folderName)

	// Default values
	mediaType = "other"
	icon = "fas fa-folder"
	iconColor = "#3b82f6" // Default blue
	description = "Media folder"

	// Detect media type based on folder name
	if strings.Contains(lowerName, "movie") || strings.Contains(lowerName, "film") {
		mediaType = "movies"
		icon = "fas fa-film"
		iconColor = "#ef4444" // Red
		description = "Movie collection"
	} else if strings.Contains(lowerName, "tv") || strings.Contains(lowerName, "show") || strings.Contains(lowerName, "series") {
		mediaType = "tvshows"
		icon = "fas fa-tv"
		iconColor = "#10b981" // Green
		description = "TV shows collection"
	} else if strings.Contains(lowerName, "music") || strings.Contains(lowerName, "audio") || strings.Contains(lowerName, "song") {
		mediaType = "music"
		icon = "fas fa-music"
		iconColor = "#8b5cf6" // Purple
		description = "Music collection"
	} else if strings.Contains(lowerName, "photo") || strings.Contains(lowerName, "image") || strings.Contains(lowerName, "picture") {
		mediaType = "photos"
		icon = "fas fa-image"
		iconColor = "#0ea5e9" // Light blue
		description = "Photo collection"
	} else if strings.Contains(lowerName, "document") || strings.Contains(lowerName, "doc") || strings.Contains(lowerName, "book") {
		mediaType = "documents"
		icon = "fas fa-file-alt"
		iconColor = "#f59e0b" // Orange
		description = "Document collection"
	}

	return mediaType, icon, iconColor, description
}

// GetFolderStats returns statistics about a folder with recursive size calculation
func GetFolderStats(path string) (itemCount int, totalSize int64, lastUpdated time.Time, err error) {
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

				// Check if this file is newer than our current latest
				if info.ModTime().After(latestTime) {
					latestTime = info.ModTime()
				}
			}
		}
		return nil
	})

	if err != nil {
		return 0, 0, time.Time{}, err
	}

	return itemCount, totalSize, latestTime, nil
}

// GetRecentUpdates returns the most recently updated files across all folders
func GetRecentUpdates(rootDir string, limit int) ([]RecentUpdate, error) {
	var updates []RecentUpdate

	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		// Skip directories
		if !info.IsDir() {
			// Get the folder this file belongs to
			relPath, err := filepath.Rel(rootDir, path)
			if err != nil {
				return nil
			}

			pathParts := strings.Split(relPath, string(filepath.Separator))
			if len(pathParts) > 0 {
				folderName := pathParts[0]

				// Determine media type
				mediaType := "other"
				lowerName := strings.ToLower(filepath.Base(path))
				if HasVideoExtension(lowerName) {
					if strings.Contains(strings.ToLower(folderName), "movie") {
						mediaType = "movie"
					} else {
						mediaType = "tvshow"
					}
				}

				updates = append(updates, RecentUpdate{
					Name:       filepath.Base(path),
					Path:       "/view/" + relPath,
					FolderName: folderName,
					UpdatedAt:  info.ModTime(),
					Type:       mediaType,
				})
			}
		}
		return nil
	})

	if err != nil {
		return nil, err
	}

	return updates, nil
}

// HasVideoExtension checks if a filename has a video file extension
func HasVideoExtension(filename string) bool {
	videoExtensions := []string{".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm"}
	for _, ext := range videoExtensions {
		if strings.HasSuffix(strings.ToLower(filename), ext) {
			return true
		}
	}
	return false
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

// FormatTimeAgo formats a time.Time as a human-readable "time ago" string
func FormatTimeAgo(t time.Time) string {
	now := time.Now()
	diff := now.Sub(t)

	if diff < time.Minute {
		return "Just now"
	} else if diff < time.Hour {
		minutes := int(diff.Minutes())
		if minutes == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", minutes)
	} else if diff < 24*time.Hour {
		hours := int(diff.Hours())
		if hours == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", hours)
	} else if diff < 48*time.Hour {
		return "Yesterday"
	} else if diff < 7*24*time.Hour {
		days := int(diff.Hours() / 24)
		return fmt.Sprintf("%d days ago", days)
	} else {
		return t.Format("Jan 02, 2006")
	}
}
