package ui

import (
	"fmt"
	"html/template"
	"path/filepath"
	"strings"
)

// GetTemplateFuncs returns template functions for use in HTML templates
func GetTemplateFuncs() template.FuncMap {
	return template.FuncMap{
		"split": func(s, sep string) []string {
			return strings.Split(s, sep)
		},
		"joinPath": func(base, path string) string {
			result := filepath.Join(base, path)
			// Convert backslashes to forward slashes for URLs
			return strings.ReplaceAll(result, "\\", "/")
		},
		"formatSize": formatFileSize,
	}
}

// formatFileSize formats a file size in bytes to a human-readable string
func formatFileSize(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}

	if size < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}

	if size < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
	}

	return fmt.Sprintf("%.1f GB", float64(size)/(1024*1024*1024))
}
