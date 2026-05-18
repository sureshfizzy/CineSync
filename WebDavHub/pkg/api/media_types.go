package api

import (
	"path/filepath"
	"strings"
)

var videoFileExtensions = map[string]struct{}{
	".mp4":  {},
	".mkv":  {},
	".avi":  {},
	".mov":  {},
	".wmv":  {},
	".flv":  {},
	".webm": {},
	".m4v":  {},
	".mpg":  {},
	".mpeg": {},
	".3gp":  {},
	".ogv":  {},
	".ts":   {},
	".m2ts": {},
	".mts":  {},
	".strm": {},
}

var subtitleFileExtensions = map[string]struct{}{
	".srt": {},
	".ass": {},
	".ssa": {},
	".vtt": {},
	".sub": {},
	".idx": {},
}

func hasFileExtension(filename string, extensions map[string]struct{}) bool {
	_, ok := extensions[strings.ToLower(filepath.Ext(filename))]
	return ok
}

func mediaFileType(filename, requestedType string) (string, bool) {
	fileType := ""
	switch {
	case hasFileExtension(filename, videoFileExtensions):
		fileType = "video"
	case hasFileExtension(filename, subtitleFileExtensions):
		fileType = "subtitle"
	}

	switch requestedType {
	case "subtitle", "subtitles":
		return fileType, fileType == "subtitle"
	case "all":
		return fileType, fileType != ""
	default:
		return fileType, fileType == "video"
	}
}

func isMediaFile(filename string) bool {
	_, ok := mediaFileType(filename, "video")
	return ok
}
