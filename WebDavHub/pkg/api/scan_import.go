package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/logger"
)

// ScanImportFile represents a parsed video file with TMDB data
type ScanImportFile struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	Size         string `json:"size"`
	Series       string `json:"series"`
	Season       int    `json:"season"`
	Episode      int    `json:"episode"`
	EpisodeTitle string `json:"episodeTitle"`
	ReleaseGroup string `json:"releaseGroup"`
	Quality      string `json:"quality"`
	Language     string `json:"language"`
	ReleaseType  string `json:"releaseType"`
	Title        string `json:"title"`
	MovieTitle   string `json:"movieTitle"`
	Year         int    `json:"year"`
	MediaType    string `json:"mediaType"`
	TMDBID       int    `json:"tmdbId,omitempty"`
	IMDBID       string `json:"imdbId,omitempty"`
	TVDBID       int    `json:"tvdbId,omitempty"`
	SeriesID     int    `json:"seriesId,omitempty"`
	MovieID      int    `json:"movieId,omitempty"`
}

// ScanImportResponse represents the response from scanning a directory for import
type ScanImportResponse struct {
	Files []ScanImportFile `json:"files"`
	Error string           `json:"error,omitempty"`
}

// HandleScanForImport scans a directory for video files and parses them with TMDB data
func HandleScanForImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "Path parameter is required", http.StatusBadRequest)
		return
	}

	logger.Info("Scanning directory for import: %s", path)

	// Check if directory exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		logger.Warn("Directory does not exist: %s", path)
		response := ScanImportResponse{
			Files: []ScanImportFile{},
			Error: "Directory does not exist",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Get video files from directory
	videoFiles, err := getVideoFilesFromDirectory(path)
	if err != nil {
		logger.Error("Failed to scan directory %s: %v", path, err)
		response := ScanImportResponse{
			Files: []ScanImportFile{},
			Error: fmt.Sprintf("Failed to scan directory: %v", err),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	// Parse each video file and get TMDB data
	var parsedFiles []ScanImportFile
	for i, file := range videoFiles {		
		parsedFile := parseVideoFileForImport(file, i+1)
		parsedFiles = append(parsedFiles, parsedFile)
	}

	response := ScanImportResponse{
		Files: parsedFiles,
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode scan import response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// VideoFileInfo represents basic info about a video file
type VideoFileInfo struct {
	Name string
	Path string
	Size int64
}

// MediaHubParsedData represents the result from MediaHub's parse_media_file()
type MediaHubParsedData struct {
	Title        string   `json:"title"`
	Year         int      `json:"year"`
	Season       int      `json:"season"`
	Episode      int      `json:"episode"`
	EpisodeTitle string   `json:"episode_title"`
	Quality      string   `json:"resolution"`
	QualitySource string  `json:"quality_source"`
	ReleaseGroup string   `json:"release_group"`
	Language     string   `json:"language"`
	Languages    []string `json:"languages"`
	IsAnime      bool     `json:"is_anime"`
	Container    string   `json:"container"`
}

// MediaHubTMDBData represents enhanced data from TMDB API
type MediaHubTMDBData struct {
	SeriesName   string `json:"series_name"`
	EpisodeTitle string `json:"episode_title"`
	Year         int    `json:"year"`
	TMDBID       int    `json:"tmdb_id"`
}

// getVideoFilesFromDirectory scans a directory and returns video files
func getVideoFilesFromDirectory(dirPath string) ([]VideoFileInfo, error) {
	var videoFiles []VideoFileInfo
	videoExtensions := []string{".mkv", ".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv", ".ts", ".m2ts", ".mts", ".strm"}
	
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		logger.Error("Failed to read directory %s: %v", dirPath, err)
		return nil, err
	}

	var totalFiles, videoFileCount, skippedDirs int
	
	for _, entry := range entries {
		if entry.IsDir() {
			skippedDirs++
			continue
		}

		totalFiles++
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		
		// Check if it's a video file
		isVideo := false
		for _, videoExt := range videoExtensions {
			if ext == videoExt {
				isVideo = true
				break
			}
		}

		if !isVideo {
			continue
		}

		fullPath := filepath.Join(dirPath, name)
		
		// Get file size
		var size int64
		if info, err := os.Stat(fullPath); err == nil {
			size = info.Size()
		} else {
			logger.Warn("Could not get file size for %s: %v", fullPath, err)
		}

		videoFiles = append(videoFiles, VideoFileInfo{
			Name: name,
			Path: fullPath,
			Size: size,
		})
		
		videoFileCount++
	}

	return videoFiles, nil
}

// parseVideoFileForImport parses a video file using MediaHub's parser and gets TMDB data
func parseVideoFileForImport(file VideoFileInfo, fallbackEpisode int) ScanImportFile {

	// Format file size
	sizeStr := formatFileSizeForImport(file.Size)
	result, err := callMediaHubCleanQuery(file.Name)
	if err != nil {
		logger.Error("MediaHub parser failed for %s: %v", file.Name, err)
		return ScanImportFile{
			Name:         file.Name,
			Path:         file.Path,
			Size:         sizeStr,
			Series:       "Unknown Series",
			Season:       1,
			Episode:      fallbackEpisode,
			EpisodeTitle: fmt.Sprintf("Episode %d", fallbackEpisode),
			ReleaseGroup: "Unknown",
			Quality:      "Unknown",
			Language:     "English",
			ReleaseType:  "Single Episode",
		}
	}

	parsedData, err := callMediaHubParser(file.Name)
	if err != nil {
		logger.Error("MediaHub parser conversion failed for %s: %v", file.Name, err)
		return ScanImportFile{
			Name:         file.Name,
			Path:         file.Path,
			Size:         sizeStr,
			Series:       "Unknown Series",
			Season:       1,
			Episode:      fallbackEpisode,
			EpisodeTitle: fmt.Sprintf("Episode %d", fallbackEpisode),
			ReleaseGroup: "Unknown",
			Quality:      "Unknown",
			Language:     "English",
			ReleaseType:  "Single Episode",
		}
	}

	// Get media type from parsed data
	mediaType := getStringValue(result, "media_type")
	if mediaType == "" {
		mediaType = "tv"
	}

	seriesName := parsedData.Title
	episodeTitle := parsedData.EpisodeTitle

	// Determine release type based on parsed data and media type
	releaseType := "Single Episode"
	if mediaType == "movie" {
		releaseType = "Movie"
	} else if parsedData.Season == 0 {
		releaseType = "Special"
	} else if parsedData.Episode == 0 {
		releaseType = "Season Pack"
	}

	// Use parsed episode number or fallback (only for TV shows)
	episodeNum := parsedData.Episode
	if mediaType == "tv" && episodeNum == 0 {
		episodeNum = fallbackEpisode
	}

	// Use parsed season number or default (only for TV shows)
	seasonNum := parsedData.Season
	if mediaType == "tv" && seasonNum == 0 {
		seasonNum = 1
	}

	// Create final parsed file structure
	parsedFile := ScanImportFile{
		Name:         file.Name,
		Path:         file.Path,
		Size:         sizeStr,
		ReleaseGroup: parsedData.ReleaseGroup,
		Quality:      parsedData.Quality,
		Language:     parsedData.Language,
		ReleaseType:  releaseType,
		MediaType:    mediaType,
		Year:         parsedData.Year,
	}

	// Extract ID fields from the result map
	tmdbID := getIntValue(result, "tmdb_id")
	imdbID := getStringValue(result, "imdb_id")
	tvdbID := getIntValue(result, "tvdb_id")

	// Set fields based on media type
	if mediaType == "movie" {
		parsedFile.Title = seriesName
		parsedFile.MovieTitle = seriesName
		parsedFile.Series = ""
		parsedFile.Season = 0
		parsedFile.Episode = 0
		parsedFile.EpisodeTitle = ""
		parsedFile.TMDBID = tmdbID
		parsedFile.IMDBID = imdbID
		parsedFile.TVDBID = tvdbID
		parsedFile.MovieID = tmdbID
		parsedFile.SeriesID = 0
	} else {
		parsedFile.Series = seriesName
		parsedFile.Season = seasonNum
		parsedFile.Episode = episodeNum
		parsedFile.EpisodeTitle = episodeTitle
		parsedFile.Title = episodeTitle
		parsedFile.MovieTitle = ""
		parsedFile.TMDBID = tmdbID
		parsedFile.IMDBID = imdbID
		parsedFile.TVDBID = tvdbID
		parsedFile.SeriesID = tmdbID
		parsedFile.MovieID = 0
	}
	return parsedFile
}

func callMediaHubCleanQuery(filename string) (map[string]interface{}, error) {
	// Get the current working directory and navigate to project root
	currentDir, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("failed to get current directory: %v", err)
	}

	scriptPath := filepath.Join(currentDir, "..", "MediaHub", "utils", "parse_filename.py")

	pythonCmd := "python"
	if runtime.GOOS != "windows" {
		pythonCmd = "python3"
	}
	if customPython := os.Getenv("PYTHON_COMMAND"); customPython != "" {
		pythonCmd = customPython
	}

	cmd := exec.Command(pythonCmd, scriptPath, filename)
	cmd.Dir = filepath.Join(currentDir, "..")
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	
	err = cmd.Run()
	if err != nil {
		return nil, fmt.Errorf("MediaHub execution failed: %v, stderr: %s", err, stderr.String())
	}

	output := stdout.String()

	jsonStart := strings.Index(output, "{")
	if jsonStart == -1 {
		return nil, fmt.Errorf("no JSON found in MediaHub output: %s", output)
	}
	
	jsonOutput := output[jsonStart:]

	var result map[string]interface{}
	if err := json.Unmarshal([]byte(jsonOutput), &result); err != nil {
		return nil, fmt.Errorf("failed to parse MediaHub output: %v", err)
	}

	if errorMsg, hasError := result["error"]; hasError {
		return nil, fmt.Errorf("MediaHub parser error: %v", errorMsg)
	}

	return result, nil
}

func callMediaHubParser(filename string) (*MediaHubParsedData, error) {
	result, err := callMediaHubCleanQuery(filename)
	if err != nil {
		return nil, err
	}

	if errorMsg, hasError := result["error"]; hasError {
		logger.Error("MediaHub parser error: %v", errorMsg)
		return nil, fmt.Errorf("MediaHub parser error: %v", errorMsg)
	}

	// Convert to MediaHubParsedData with proper type handling
	parsedData := &MediaHubParsedData{
		Title:         getStringValue(result, "title"),
		Year:          getIntValue(result, "year"),
		Season:        getIntValue(result, "season"),
		Episode:       getIntValue(result, "episode"),
		EpisodeTitle:  getStringValue(result, "episode_title"),
		Quality:       getStringValue(result, "resolution"),
		QualitySource: getStringValue(result, "quality_source"),
		ReleaseGroup:  getStringValue(result, "release_group"),
		Language:      "",
		Languages:     getStringArrayValue(result, "languages"),
		IsAnime:       getBoolValue(result, "is_anime"),
		Container:     getStringValue(result, "container"),
	}

	// Handle season/episode from clean_query response format
	if parsedData.Season == 0 {
		if seasonStr := getStringValue(result, "season_number"); seasonStr != "" {
			if season, err := strconv.Atoi(seasonStr); err == nil {
				parsedData.Season = season
			}
		}
	}
	
	if parsedData.Episode == 0 {
		if episodeStr := getStringValue(result, "episode_number"); episodeStr != "" {
			if episode, err := strconv.Atoi(episodeStr); err == nil {
				parsedData.Episode = episode
			}
		}
	}

	// Handle language field
	if len(parsedData.Languages) > 0 {
		parsedData.Language = parsedData.Languages[0]
	}
	if parsedData.Language == "" {
		parsedData.Language = "English"
	}

	// Use quality_source if resolution is empty
	if parsedData.Quality == "" && parsedData.QualitySource != "" {
		parsedData.Quality = parsedData.QualitySource
	}
	if parsedData.Quality == "" {
		parsedData.Quality = "Unknown"
	}

	// Set default values for empty fields
	if parsedData.ReleaseGroup == "" {
		parsedData.ReleaseGroup = "Unknown"
	}
	if parsedData.Title == "" {
		parsedData.Title = "Unknown Series"
	}
	return parsedData, nil
}

// callMediaHubTMDB calls TMDB API for series and episode information
func callMediaHubTMDB(seriesTitle string, year, season, episode int) (*MediaHubTMDBData, error) {
	
	client := &http.Client{Timeout: 15 * time.Second}
	searchURL := fmt.Sprintf("http://localhost:8082/api/tmdb/search?type=tv&query=%s", url.QueryEscape(seriesTitle))
	if year > 0 {
		searchURL += fmt.Sprintf("&year=%d", year)
	}

	resp, err := client.Get(searchURL)
	if err != nil {
		logger.Error("Failed to call TMDB search API: %v", err)
		return nil, fmt.Errorf("TMDB search API call failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Error("TMDB search API returned status %d", resp.StatusCode)
		return nil, fmt.Errorf("TMDB search API returned status %d", resp.StatusCode)
	}

	var searchResult struct {
		Results []struct {
			ID           int    `json:"id"`
			Name         string `json:"name"`
			FirstAirDate string `json:"first_air_date"`
		} `json:"results"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&searchResult); err != nil {
		logger.Error("Failed to decode TMDB search response: %v", err)
		return nil, fmt.Errorf("failed to decode search response: %v", err)
	}

	if len(searchResult.Results) == 0 {
		logger.Warn("No TMDB results found for series: %s", seriesTitle)
		return &MediaHubTMDBData{
			SeriesName:   seriesTitle,
			EpisodeTitle: "",
			Year:         year,
			TMDBID:       0,
		}, nil
	}

	bestMatch := searchResult.Results[0]

	if bestMatch.Name == "" {
		bestMatch.Name = seriesTitle
	}
	
	result := &MediaHubTMDBData{
		SeriesName:   bestMatch.Name,
		EpisodeTitle: "",
		Year:         year,
		TMDBID:       bestMatch.ID,
	}

	if season > 0 && episode > 0 && bestMatch.ID > 0 {
		
		episodeURL := fmt.Sprintf("http://localhost:8082/api/tmdb/details?type=tv&id=%d&season=%d&episode=%d", 
			bestMatch.ID, season, episode)
		
		episodeResp, err := client.Get(episodeURL)
		if err != nil {
			logger.Warn("Failed to get episode details: %v", err)
		} else {
			defer episodeResp.Body.Close()
			if episodeResp.StatusCode == http.StatusOK {
				var episodeResult struct {
					Name string `json:"name"`
				}
				if err := json.NewDecoder(episodeResp.Body).Decode(&episodeResult); err == nil {
					result.EpisodeTitle = episodeResult.Name
				}
			}
		}
	}
	return result, nil
}

// formatFileSizeForImport formats a file size in bytes to a human-readable string
func formatFileSizeForImport(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// HandleScan handles requests to parse a filename using MediaHub's clean_query function
func HandleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	filename := r.URL.Query().Get("filename")
	if filename == "" {
		http.Error(w, "filename parameter is required", http.StatusBadRequest)
		return
	}

	logger.Info("Parsing filename with MediaHub: %s", filename)

	// Call MediaHub's clean_query function directly
	result, err := callMediaHubCleanQuery(filename)
	if err != nil {
		logger.Error("MediaHub parsing failed: %v", err)
		response := map[string]interface{}{
			"title": filename,
			"error": err.Error(),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(result); err != nil {
		logger.Error("Failed to encode scan response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
		return
	}
}

// Helper functions to safely extract values from JSON map
func getStringValue(data map[string]interface{}, key string) string {
	if val, ok := data[key]; ok {
		if str, ok := val.(string); ok {
			return str
		}
	}
	return ""
}

func getIntValue(data map[string]interface{}, key string) int {
	if val, ok := data[key]; ok {
		switch v := val.(type) {
		case int:
			return v
		case float64:
			return int(v)
		case string:
			if v == "" || v == "None" {
				return 0
			}
		}
	}
	return 0
}

func getBoolValue(data map[string]interface{}, key string) bool {
	if val, ok := data[key]; ok {
		if b, ok := val.(bool); ok {
			return b
		}
	}
	return false
}

func getStringArrayValue(data map[string]interface{}, key string) []string {
	if val, ok := data[key]; ok {
		if arr, ok := val.([]interface{}); ok {
			result := make([]string, len(arr))
			for i, v := range arr {
				if str, ok := v.(string); ok {
					result[i] = str
				}
			}
			return result
		}
	}
	return []string{}
}