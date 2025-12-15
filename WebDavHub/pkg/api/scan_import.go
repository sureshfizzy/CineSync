package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
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
	Files []ScanImportFile `json:"files,omitempty"`
	File  *ScanImportFile  `json:"file,omitempty"`
	Progress *ScanProgress `json:"progress,omitempty"`
	Error string           `json:"error,omitempty"`
	Done  bool             `json:"done,omitempty"`
}

// ScanProgress represents the current scanning progress
type ScanProgress struct {
	Current int `json:"current"`
	Total   int `json:"total"`
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

	skipStr := r.URL.Query().Get("skip")
	skip := 0
	if skipStr != "" {
		if parsedSkip, err := strconv.Atoi(skipStr); err == nil && parsedSkip > 0 {
			skip = parsedSkip
		}
	}

	logger.Info("Scanning directory for import: %s", path)
	ctx := r.Context()

	// Check if directory exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		logger.Warn("Directory does not exist: %s", path)
		response := ScanImportResponse{
			Error: "Directory does not exist",
			Done:  true,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}


	initialProgress := ScanImportResponse{
		Progress: &ScanProgress{
			Current: skip,
			Total:   0,
		},
	}
	if data, err := json.Marshal(initialProgress); err == nil {
		w.Write(data)
		w.Write([]byte("\n"))
		flusher.Flush()
	}

	maxWorkers := env.GetInt("MAX_PROCESSES", runtime.NumCPU())
	if maxWorkers > 20 {
		maxWorkers = 20
	}
	if maxWorkers < 1 {
		maxWorkers = 1
	}

	jobs := make(chan IndexedJob, maxWorkers*2)
	results := make(chan IndexedResult, maxWorkers*2)
	totalCh := make(chan int, 1)
	scanErrCh := make(chan error, 1)

	go streamVideoFilesFromDirectory(ctx, path, skip, jobs, totalCh, scanErrCh)

	var workerWG sync.WaitGroup
	for i := 0; i < maxWorkers; i++ {
		workerWG.Add(1)
		go func() {
			defer workerWG.Done()
			for job := range jobs {
				select {
				case <-ctx.Done():
					return
				default:
				}

				fallbackEpisode := job.Index + skip + 1
				parsedFile := parseVideoFileForImport(job.File, fallbackEpisode)

				select {
				case <-ctx.Done():
					return
				case results <- IndexedResult{File: parsedFile, Index: job.Index}:
				}
			}
		}()
	}

	go func() {
		workerWG.Wait()
		close(results)
	}()

	totalFiles := 0
	totalAfterSkip := 0
	scanComplete := false
	nextToStream := 0
	buffer := make(map[int]ScanImportFile)

	for {
		select {
		case err := <-scanErrCh:
			if err != nil && !errors.Is(err, context.Canceled) {
				logger.Error("Failed to scan directory %s: %v", path, err)
				response := ScanImportResponse{
					Error: fmt.Sprintf("Failed to scan directory: %v", err),
					Done:  true,
				}
				data, _ := json.Marshal(response)
				w.Write(data)
				w.Write([]byte("\n"))
				flusher.Flush()
				return
			}
		case total := <-totalCh:
			totalFiles = total
			if total > skip {
				totalAfterSkip = total - skip
			} else {
				totalAfterSkip = 0
			}
			scanComplete = true
			progressResponse := ScanImportResponse{
				Progress: &ScanProgress{
					Current: skip + nextToStream,
					Total:   totalFiles,
				},
			}
			if data, err := json.Marshal(progressResponse); err == nil {
				w.Write(data)
				w.Write([]byte("\n"))
				flusher.Flush()
			}
			if totalAfterSkip == 0 {
				completionResponse := ScanImportResponse{
					Done: true,
					Progress: &ScanProgress{
						Current: totalFiles,
						Total:   totalFiles,
					},
				}
				if data, err := json.Marshal(completionResponse); err == nil {
					w.Write(data)
					w.Write([]byte("\n"))
					flusher.Flush()
				}
				logger.Info("Completed streaming scan for %d files", totalFiles)
				return
			}

		case result, ok := <-results:
			if !ok {
				completionResponse := ScanImportResponse{
					Done: true,
					Progress: &ScanProgress{
						Current: totalFiles,
						Total:   totalFiles,
					},
				}
				if data, err := json.Marshal(completionResponse); err == nil {
					w.Write(data)
					w.Write([]byte("\n"))
					flusher.Flush()
				}
				logger.Info("Completed streaming scan for %d files", totalFiles)
				return
			}

			buffer[result.Index] = result.File
			for {
				file, exists := buffer[nextToStream]
				if !exists {
					break
				}

				currentTotal := totalFiles
				if currentTotal == 0 {
					// Total not known yet; show progress based on streamed count
					currentTotal = skip + nextToStream + 1
				}

				fileResponse := ScanImportResponse{
					File: &file,
					Progress: &ScanProgress{
						Current: skip + nextToStream + 1,
						Total:   currentTotal,
					},
				}

				data, err := json.Marshal(fileResponse)
				if err != nil {
					logger.Error("Failed to marshal file response: %v", err)
					delete(buffer, nextToStream)
					nextToStream++
					continue
				}

				if _, err := w.Write(data); err != nil {
					logger.Error("Failed to write streaming response: %v", err)
					return
				}
				if _, err := w.Write([]byte("\n")); err != nil {
					logger.Error("Failed to write newline: %v", err)
					return
				}

				flusher.Flush()
				delete(buffer, nextToStream)
				nextToStream++

				if scanComplete && totalAfterSkip > 0 && nextToStream >= totalAfterSkip {
					completionResponse := ScanImportResponse{
						Done: true,
						Progress: &ScanProgress{
							Current: totalFiles,
							Total:   totalFiles,
						},
					}
					if data, err := json.Marshal(completionResponse); err == nil {
						w.Write(data)
						w.Write([]byte("\n"))
						flusher.Flush()
					}
					logger.Info("Completed streaming scan for %d files", totalFiles)
					return
				}
			}

		case <-ctx.Done():
			logger.Info("Client disconnected during streaming scan")
			return
		}
	}
}

// VideoFileInfo represents basic info about a video file
type VideoFileInfo struct {
	Name string
	Path string
	Size int64
}

// IndexedJob represents a file processing job with its index
type IndexedJob struct {
	File  VideoFileInfo
	Index int
}

// IndexedResult represents a processed file result with its original index
type IndexedResult struct {
	File  ScanImportFile
	Index int
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

// streamVideoFilesFromDirectory walks a directory tree, sending video files as they are found.
func streamVideoFilesFromDirectory(ctx context.Context, dirPath string, skip int, jobs chan<- IndexedJob, totalCh chan<- int, errCh chan<- error) {
	defer close(jobs)

	videoExtensions := map[string]struct{}{
		".mkv":  {}, ".mp4": {}, ".avi": {}, ".mov": {}, ".wmv": {}, ".flv": {},
		".webm": {}, ".m4v": {}, ".mpg": {}, ".mpeg": {}, ".3gp": {}, ".ogv": {},
		".ts": {}, ".m2ts": {}, ".mts": {}, ".strm": {},
	}

	total := 0

	walkErr := filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		if ctx != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
		}

		if d.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if _, ok := videoExtensions[ext]; !ok {
			return nil
		}

		total++

		if total <= skip {
			return nil
		}

		var size int64
		if info, infoErr := d.Info(); infoErr == nil {
			size = info.Size()
		}

		job := IndexedJob{
			File: VideoFileInfo{
				Name: d.Name(),
				Path: path,
				Size: size,
			},
			Index: total - skip - 1,
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case jobs <- job:
		}

		return nil
	})

	if walkErr != nil && !errors.Is(walkErr, context.Canceled) {
		errCh <- walkErr
	} else {
		errCh <- nil
	}

	totalCh <- total
}

// processFilesInParallel processes files using parallel workers and returns results in order
func processFilesInParallel(files []VideoFileInfo, skip int, ctx context.Context) []ScanImportFile {
	maxWorkers := env.GetInt("MAX_PROCESSES", runtime.NumCPU())
	if maxWorkers > 20 {
		maxWorkers = 20
	}
	if maxWorkers < 1 {
		maxWorkers = 1
	}

	jobs := make(chan IndexedJob, len(files))
	results := make(chan IndexedResult, len(files))

	// Start worker goroutines
	for w := 0; w < maxWorkers; w++ {
		go func() {
			for job := range jobs {
				// Check for cancellation
				if ctx != nil {
					select {
					case <-ctx.Done():
						return
					default:
					}
				}

				fallbackEpisode := job.Index + skip + 1
				parsedFile := parseVideoFileForImport(job.File, fallbackEpisode)
				results <- IndexedResult{File: parsedFile, Index: job.Index}
			}
		}()
	}

	// Send jobs to workers
	go func() {
		defer close(jobs)
		for i, file := range files {
			if ctx != nil {
				select {
				case <-ctx.Done():
					return
				case jobs <- IndexedJob{File: file, Index: i}:
				}
			} else {
				jobs <- IndexedJob{File: file, Index: i}
			}
		}
	}()

	// Collect results in order
	resultBuffer := make([]ScanImportFile, len(files))
	for i := 0; i < len(files); i++ {
		result := <-results
		resultBuffer[result.Index] = result.File
	}

	return resultBuffer
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

	// Extract all data directly from the single result
	mediaType := getStringValue(result, "media_type")
	if mediaType == "" {
		mediaType = "tv"
	}

	title := getStringValue(result, "title")
	episodeTitle := getStringValue(result, "episode_title")
	year := getIntValue(result, "year")
	season := getIntValue(result, "season")
	episode := getIntValue(result, "episode")

	quality := getStringValue(result, "resolution")
	if quality == "" {
		quality = getStringValue(result, "quality_source")
	}
	if quality == "" {
		quality = "Unknown"
	}

	releaseGroup := getStringValue(result, "release_group")
	if releaseGroup == "" {
		releaseGroup = "Unknown"
	}

	languages := getStringArrayValue(result, "languages")
	language := "English"
	if len(languages) > 0 {
		language = languages[0]
	}

	// Determine release type based on parsed data and media type
	releaseType := "Single Episode"
	if mediaType == "movie" {
		releaseType = "Movie"
	} else if season == 0 {
		releaseType = "Special"
	} else if episode == 0 {
		releaseType = "Season Pack"
	}

	// Use parsed episode number or fallback (only for TV shows)
	if mediaType == "tv" && episode == 0 {
		episode = fallbackEpisode
	}

	// Use parsed season number or default (only for TV shows)
	if mediaType == "tv" && season == 0 {
		season = 1
	}

	// Extract ID fields from the result map
	tmdbID := getIntValue(result, "tmdb_id")
	imdbID := getStringValue(result, "imdb_id")
	tvdbID := getIntValue(result, "tvdb_id")

	// Create final parsed file structure
	parsedFile := ScanImportFile{
		Name:         file.Name,
		Path:         file.Path,
		Size:         sizeStr,
		ReleaseGroup: releaseGroup,
		Quality:      quality,
		Language:     language,
		ReleaseType:  releaseType,
		MediaType:    mediaType,
		Year:         year,
		TMDBID:       tmdbID,
		IMDBID:       imdbID,
		TVDBID:       tvdbID,
	}

	// Set fields based on media type
	if mediaType == "movie" {
		parsedFile.Title = title
		parsedFile.MovieTitle = title
		parsedFile.Series = ""
		parsedFile.Season = 0
		parsedFile.Episode = 0
		parsedFile.EpisodeTitle = ""
		parsedFile.MovieID = tmdbID
		parsedFile.SeriesID = 0
	} else {
		parsedFile.Series = title
		parsedFile.Season = season
		parsedFile.Episode = episode
		parsedFile.EpisodeTitle = episodeTitle
		parsedFile.Title = episodeTitle
		parsedFile.MovieTitle = ""
		parsedFile.SeriesID = tmdbID
		parsedFile.MovieID = 0
	}
	return parsedFile
}

// convertParsedResultToScanImportFile converts a parsed result map to ScanImportFile
func convertParsedResultToScanImportFile(result map[string]interface{}, file VideoFileInfo, sizeStr string, fallbackEpisode int) ScanImportFile {
	if errorMsg, hasError := result["error"]; hasError {
		logger.Error("MediaHub parser error for %s: %v", file.Name, errorMsg)
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

	title := getStringValue(result, "title")
	episodeTitle := getStringValue(result, "episode_title")
	year := getIntValue(result, "year")
	season := getIntValue(result, "season")
	episode := getIntValue(result, "episode")
	quality := getStringValue(result, "resolution")
	if quality == "" {
		quality = getStringValue(result, "quality_source")
	}
	if quality == "" {
		quality = "Unknown"
	}

	releaseGroup := getStringValue(result, "release_group")
	if releaseGroup == "" {
		releaseGroup = "Unknown"
	}

	languages := getStringArrayValue(result, "languages")
	language := "English"
	if len(languages) > 0 {
		language = languages[0]
	}

	// Determine release type based on parsed data and media type
	releaseType := "Single Episode"
	if mediaType == "movie" {
		releaseType = "Movie"
	} else if season == 0 {
		releaseType = "Special"
	} else if episode == 0 {
		releaseType = "Season Pack"
	}

	// Use parsed episode number or fallback (only for TV shows)
	if mediaType == "tv" && episode == 0 {
		episode = fallbackEpisode
	}

	// Use parsed season number or default (only for TV shows)
	if mediaType == "tv" && season == 0 {
		season = 1
	}

	// Extract ID fields from the result map
	tmdbID := getIntValue(result, "tmdb_id")
	imdbID := getStringValue(result, "imdb_id")
	tvdbID := getIntValue(result, "tvdb_id")

	// Create final parsed file structure
	parsedFile := ScanImportFile{
		Name:         file.Name,
		Path:         file.Path,
		Size:         sizeStr,
		ReleaseGroup: releaseGroup,
		Quality:      quality,
		Language:     language,
		ReleaseType:  releaseType,
		MediaType:    mediaType,
		Year:         year,
		TMDBID:       tmdbID,
		IMDBID:       imdbID,
		TVDBID:       tvdbID,
	}

	// Set fields based on media type
	if mediaType == "movie" {
		parsedFile.Title = title
		parsedFile.MovieTitle = title
		parsedFile.Series = ""
		parsedFile.Season = 0
		parsedFile.Episode = 0
		parsedFile.EpisodeTitle = ""
		parsedFile.MovieID = tmdbID
		parsedFile.SeriesID = 0
	} else {
		parsedFile.Series = title
		parsedFile.Season = season
		parsedFile.Episode = episode
		parsedFile.EpisodeTitle = episodeTitle
		parsedFile.Title = episodeTitle
		parsedFile.MovieTitle = ""
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