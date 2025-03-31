package files

import (
	"fmt"
	"path/filepath"
)

// GetMimeType returns the MIME type based on file extension
func GetMimeType(filePath string) string {
	ext := filepath.Ext(filePath)
	switch ext {
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".pdf":
		return "application/pdf"
	case ".txt":
		return "text/plain"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mkv":
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	case ".mov":
		return "video/quicktime"
	case ".wmv":
		return "video/x-ms-wmv"
	case ".flv":
		return "video/x-flv"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	case ".zip":
		return "application/zip"
	case ".tar":
		return "application/x-tar"
	case ".gz", ".gzip":
		return "application/gzip"
	case ".rar":
		return "application/x-rar-compressed"
	}

	// Default to octet-stream for unknown types
	return "application/octet-stream"
}

// IsStreamableMedia checks if the MIME type is a streamable media type
func IsStreamableMedia(mimeType string) bool {
	return mimeType[:5] == "video" || mimeType[:5] == "audio"
}

// GetFileIconAndClass returns the appropriate font awesome icon and CSS class
func GetFileIconAndClass(filename string) (string, string) {
	ext := filepath.Ext(filename)
	switch ext {
	case ".mp4", ".webm", ".mkv", ".avi", ".mov", ".wmv", ".flv":
		return "fas fa-film", "video-icon-container"
	case ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".svg", ".webp":
		return "fas fa-image", "image-icon-container"
	case ".mp3", ".wav", ".ogg", ".flac", ".aac":
		return "fas fa-music", "audio-icon-container"
	case ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx":
		return "fas fa-file-pdf", "document-icon-container"
	case ".zip", ".tar", ".gz", ".rar", ".7z":
		return "fas fa-file-archive", "archive-icon-container"
	case ".html", ".css", ".js", ".php", ".py", ".go", ".java", ".c", ".cpp", ".ts":
		return "fas fa-file-code", "code-icon-container"
	default:
		return "fas fa-file", "file-icon-container"
	}
}

// FormatFileSize formats file size in human-readable format
func FormatFileSize(size int64) string {
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

// SplitPath splits a URL path into its components
func SplitPath(path string) []string {
	if path == "/" {
		return []string{}
	}

	// Remove leading slash
	if path[0] == '/' {
		path = path[1:]
	}

	// Remove trailing slash
	if len(path) > 0 && path[len(path)-1] == '/' {
		path = path[:len(path)-1]
	}

	if path == "" {
		return []string{}
	}

	return filepath.SplitList(filepath.FromSlash(path))
}
