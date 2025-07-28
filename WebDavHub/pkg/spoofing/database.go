package spoofing

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/db"
)

var (
	tmdbCache   = make(map[int]*TMDBMovieDetails)
	tmdbTVCache = make(map[int]*TMDBTVDetails)
	tmdbMutex   sync.RWMutex
	tmdbClient  = &http.Client{Timeout: 10 * time.Second}
)

// getMoviesFromDatabase retrieves movies from the CineSync database and formats them for Radarr
func getMoviesFromDatabase() ([]MovieResource, error) {
	var movies []MovieResource

	err := executeWithRetry(func() error {
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
			return err
		}

		movies, err = getMoviesFromDatabaseInternal(mediaHubDB)
		return err
	})

	return movies, err
}

func getMoviesFromDatabaseInternal(mediaHubDB *sql.DB) ([]MovieResource, error) {

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, 0) as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			COALESCE(file_size, 0) as file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movies []MovieResource

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt, language, quality string
		var year int
		var fileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		tmdbID, _ := strconv.Atoi(tmdbIDStr)
		if tmdbID == 0 {
			continue
		}

		addedTime, _ := time.Parse(time.RFC3339, latestProcessedAt)
		if addedTime.IsZero() {
			addedTime = time.Now().Add(-24 * time.Hour)
		}

		movie := createMovieResourceInternal(tmdbID, properName, year, tmdbID, destinationPath, addedTime, fileSize, language, quality)
		movies = append(movies, movie)
	}

	return movies, rows.Err()
}

// createMovieResource creates a properly formatted MovieResource with actual file size
func createMovieResource(id int, title string, year, tmdbID int, filePath string, added time.Time, fileSize int64, language, quality string) MovieResource {
	return createMovieResourceInternal(id, title, year, tmdbID, filePath, added, fileSize, language, quality)
}

type TMDBMovieDetails struct {
	Overview string `json:"overview"`
	Runtime  int    `json:"runtime"`
	Genres   []struct {
		Name string `json:"name"`
	} `json:"genres"`
	Releases struct {
		Countries []struct {
			Certification string `json:"certification"`
			ISO31661      string `json:"iso_3166_1"`
		} `json:"countries"`
	} `json:"releases"`
}

func fetchMovieMetadata(tmdbID int) (string, int, []string, string) {
	if tmdbID <= 0 {
		return "", 0, []string{}, ""
	}

	// Check cache
	tmdbMutex.RLock()
	if cached, exists := tmdbCache[tmdbID]; exists {
		tmdbMutex.RUnlock()
		return extractMetadata(cached)
	}
	tmdbMutex.RUnlock()

	// Fetch from API
	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "" {
		return "", 0, []string{}, ""
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/movie/%d?api_key=%s&append_to_response=releases", tmdbID, apiKey)
	resp, err := tmdbClient.Get(url)
	if err != nil || resp.StatusCode != 200 {
		return "", 0, []string{}, ""
	}
	defer resp.Body.Close()

	var details TMDBMovieDetails
	if json.NewDecoder(resp.Body).Decode(&details) != nil {
		return "", 0, []string{}, ""
	}

	// Cache result
	tmdbMutex.Lock()
	tmdbCache[tmdbID] = &details
	tmdbMutex.Unlock()

	return extractMetadata(&details)
}

func extractMetadata(details *TMDBMovieDetails) (string, int, []string, string) {
	var genres []string
	for _, g := range details.Genres {
		if g.Name != "" {
			genres = append(genres, g.Name)
		}
	}

	var cert string
	for _, c := range details.Releases.Countries {
		if c.ISO31661 == "US" && c.Certification != "" {
			cert = c.Certification
			break
		}
	}

	return details.Overview, details.Runtime, genres, cert
}

// TMDBTVDetails represents the structure of TMDB TV show API response
type TMDBTVDetails struct {
	Overview string `json:"overview"`
	Genres   []struct {
		Name string `json:"name"`
	} `json:"genres"`
	EpisodeRunTime []int    `json:"episode_run_time"`
	Status         string   `json:"status"`
	FirstAirDate   string   `json:"first_air_date"`
	Networks       []struct {
		Name string `json:"name"`
	} `json:"networks"`
}

// TV metadata functions - enhanced to return more fields
func fetchTVMetadata(tmdbID int) (string, int, []string, string, string, string) {
	if tmdbID <= 0 {
		return "", 0, []string{}, "", "", ""
	}

	// Check cache first
	tmdbMutex.RLock()
	if cached, exists := tmdbTVCache[tmdbID]; exists {
		tmdbMutex.RUnlock()
		return extractTVMetadata(cached)
	}
	tmdbMutex.RUnlock()

	apiKey := os.Getenv("TMDB_API_KEY")
	if apiKey == "" {
		return "", 0, []string{}, "", "", ""
	}

	url := fmt.Sprintf("https://api.themoviedb.org/3/tv/%d?api_key=%s", tmdbID, apiKey)
	resp, err := tmdbClient.Get(url)
	if err != nil || resp.StatusCode != 200 {
		return "", 0, []string{}, "", "", ""
	}
	defer resp.Body.Close()

	var details TMDBTVDetails
	if json.NewDecoder(resp.Body).Decode(&details) != nil {
		return "", 0, []string{}, "", "", ""
	}

	// Cache the result
	tmdbMutex.Lock()
	tmdbTVCache[tmdbID] = &details
	tmdbMutex.Unlock()

	return extractTVMetadata(&details)
}

func extractTVMetadata(details *TMDBTVDetails) (string, int, []string, string, string, string) {
	var genres []string
	for _, g := range details.Genres {
		if g.Name != "" {
			genres = append(genres, g.Name)
		}
	}

	runtime := 0
	if len(details.EpisodeRunTime) > 0 {
		runtime = details.EpisodeRunTime[0]
	}

	// Extract network name (use first network if multiple)
	network := ""
	if len(details.Networks) > 0 {
		network = details.Networks[0].Name
	}

	// Map TMDB status to appropriate values
	status := "continuing"
	switch strings.ToLower(details.Status) {
	case "ended":
		status = "ended"
	case "canceled", "cancelled":
		status = "ended"
	case "returning series":
		status = "continuing"
	case "in production":
		status = "continuing"
	default:
		status = "continuing"
	}

	return details.Overview, runtime, genres, status, network, details.FirstAirDate
}

// createMovieResourceInternal
func createMovieResourceInternal(id int, title string, year, tmdbID int, filePath string, added time.Time, fileSize int64, dbLanguage, dbQuality string) MovieResource {

	relativePath := filepath.Base(filePath)
	if strings.Contains(filePath, title) {
		if parts := strings.Split(filePath, title); len(parts) > 1 {
			relativePath = title + parts[1]
		}
	}

	overview, runtime, genres, certification := fetchMovieMetadata(tmdbID)
	quality := detectQualityFromDatabase(dbQuality, filePath)
	languages := getLanguagesFromDatabase(dbLanguage)

	movieFile := &MovieFile{
		ID:           id,
		MovieId:      id,
		RelativePath: relativePath,
		Path:         filePath,
		Size:         fileSize,
		DateAdded:    added,
		Quality:      quality,
		Languages:    languages,
		SceneName:    "",
		ReleaseGroup: "",
	}

	return MovieResource{
		ID:                  id,
		Title:               title,
		AlternateTitles:     []interface{}{},
		OriginalTitle:       title,
		SortTitle:           title,
		Status:              "released",
		Overview:            overview,
		Year:                year,
		HasFile:             true,
		MovieFileId:         id,
		Path:                filepath.Dir(filePath),
		QualityProfileId:    1,
		Monitored:           true,
		MinimumAvailability: "released",
		IsAvailable:         true,
		Runtime:             runtime,
		CleanTitle:          strings.ToLower(strings.ReplaceAll(title, " ", "")),
		ImdbId:              "",
		TmdbId:              tmdbID,
		TitleSlug:           strings.ToLower(strings.ReplaceAll(title, " ", "-")),
		RootFolderPath:      "/movies",
		Certification:       certification,
		Genres:              genres,
		Tags:                []int{},
		Added:               added,
		Images:              createMediaImages(tmdbID, "movie"),
		Popularity:          0,
		MovieFile:           movieFile,
		SizeOnDisk:          fileSize,
	}
}

func createSeriesResource(id int, title string, year, tmdbID int, filePath string, added time.Time, language, quality string) SeriesResource {
	overview, runtime, genres, status, network, firstAirDate := fetchTVMetadata(tmdbID)

	firstAired := added.Format("2006-01-02T15:04:05Z")
	if firstAirDate != "" {
		if parsedDate, err := time.Parse("2006-01-02", firstAirDate); err == nil {
			firstAired = parsedDate.Format("2006-01-02T15:04:05Z")
		}
	}

	var lastAired *string
	if firstAirDate != "" {
		lastAired = &firstAired
	}

	return SeriesResource{
		ID:                id,
		Title:             title,
		AlternateTitles:   []interface{}{},
		SortTitle:         title,
		Status:            status,
		Overview:          overview,
		Network:           network,
		AirTime:           "",
		Year:              year,
		Path:              filePath,
		QualityProfileId:  1,
		LanguageProfileId: 1,
		SeasonFolder:      true,
		Monitored:         true,
		Runtime:           runtime,
		TvdbId:            tmdbID,
		TvRageId:          0,
		TvMazeId:          0,
		FirstAired:        firstAired,
		LastAired:         lastAired,
		NextAiring:        nil,
		PreviousAiring:    nil,
		LastInfoSync:      added,
		SeriesType:        "standard",
		CleanTitle:        strings.ToLower(strings.ReplaceAll(title, " ", "")),
		TitleSlug:         strings.ToLower(strings.ReplaceAll(title, " ", "-")),
		RootFolderPath:    "/tv",
		Genres:            genres,
		Tags:              []int{},
		Added:             added,
		Images:            createMediaImages(tmdbID, "tv"),
		Seasons:           []interface{}{},
	}
}

func getSeriesFromDatabase() ([]SeriesResource, error) {
	var series []SeriesResource

	err := executeWithRetry(func() error {
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
			return err
		}

		series, err = getSeriesFromDatabaseInternal(mediaHubDB)
		return err
	})

	return series, err
}

func getSeriesFromDatabaseInternal(mediaHubDB *sql.DB) ([]SeriesResource, error) {



	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, 0) as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			SUM(COALESCE(file_size, 0)) as total_file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE (UPPER(media_type) = 'TV' OR UPPER(media_type) = 'EPISODE' OR media_type LIKE '%TV%' OR media_type LIKE '%SHOW%')
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var series []SeriesResource

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt, language, quality string
		var year int
		var totalFileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &totalFileSize, &language, &quality); err != nil {
			continue
		}

		tmdbID, _ := strconv.Atoi(tmdbIDStr)
		if tmdbID == 0 {
			continue
		}

		addedTime, _ := time.Parse(time.RFC3339, latestProcessedAt)
		if addedTime.IsZero() {
			addedTime = time.Now().Add(-24 * time.Hour)
		}

		// Construct series folder path from destination path, title, and year
		seriesPath := constructSeriesPath(destinationPath, properName, year)

		// Generate unique series ID to prevent BAZARR constraint violations
		uniqueSeriesID := generateUniqueSeriesID(tmdbID, properName, year)
		show := createSeriesResource(uniqueSeriesID, properName, year, tmdbID, seriesPath, addedTime, language, quality)
		series = append(series, show)
	}

	return series, rows.Err()
}

// getRootFoldersFromDatabase retrieves unique root folders from the database
func getRootFoldersFromDatabase() ([]RootFolder, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT DISTINCT
			CASE
				WHEN UPPER(media_type) = 'MOVIE' THEN 'Movies'
				WHEN UPPER(media_type) = 'TV' THEN 'TV Shows'
				ELSE 'Media'
			END as folder_name,
			CASE
				WHEN UPPER(media_type) = 'MOVIE' THEN '/movies'
				WHEN UPPER(media_type) = 'TV' THEN '/tv'
				ELSE '/media'
			END as folder_path
		FROM processed_files
		WHERE destination_path IS NOT NULL
		AND destination_path != ''
		AND media_type IS NOT NULL
		ORDER BY folder_name`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rootFolders []RootFolder
	id := 1

	for rows.Next() {
		var folderName, folderPath string
		if err := rows.Scan(&folderName, &folderPath); err != nil {
			continue
		}

		rootFolders = append(rootFolders, RootFolder{
			ID:   id,
			Path: folderPath,
		})
		id++
	}

	return rootFolders, rows.Err()
}

// MockData for spoof
// getQualityProfilesFromDatabase retrieves quality profiles based on actual file qualities
func getQualityProfilesFromDatabase() ([]QualityProfile, error) {
	return []QualityProfile{
		{ID: 1, Name: "HD-1080p"},
		{ID: 2, Name: "HD-720p"},
		{ID: 3, Name: "4K-2160p"},
		{ID: 4, Name: "Any"},
	}, nil
}



// getLanguageProfilesFromDatabase retrieves language profiles
func getLanguageProfilesFromDatabase() ([]LanguageProfile, error) {
	return []LanguageProfile{
		{ID: 1, Name: "English"},
		{ID: 2, Name: "Any"},
	}, nil
}

// getTagsFromDatabase retrieves tags from the database
func getTagsFromDatabase() ([]Tag, error) {
	return []Tag{}, nil
}

// getHealthStatusFromDatabase retrieves health status
func getHealthStatusFromDatabase() ([]interface{}, error) {
	return []interface{}{}, nil
}

// getAvailableFoldersFromDatabase retrieves unique base directories from base_path field
func getAvailableFoldersFromDatabase() ([]AvailableFolder, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			base_path,
			COUNT(*) as file_count
		FROM processed_files
		WHERE base_path IS NOT NULL
		AND base_path != ''
		GROUP BY base_path
		ORDER BY base_path`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var folders []AvailableFolder
	for rows.Next() {
		var basePath string
		var fileCount int

		if err := rows.Scan(&basePath, &fileCount); err != nil {
			continue
		}

		// Skip empty or invalid paths
		if basePath == "" || basePath == "." || basePath == ".." {
			continue
		}

		folders = append(folders, AvailableFolder{
			Path:        basePath,
			DisplayName: basePath,
			FileCount:   fileCount,
		})
	}

	return folders, nil
}

// getMoviesFromDatabaseByFolder retrieves movies filtered by base folder path
func getMoviesFromDatabaseByFolder(folderPath string) ([]MovieResource, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, 0) as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			COALESCE(file_size, 0) as file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND base_path = ?
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year`

	rows, err := mediaHubDB.Query(query, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movies []MovieResource

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt, language, quality string
		var year int
		var fileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		// Convert TMDB ID to integer
		tmdbID := 0
		if tmdbIDStr != "" {
			if id, err := strconv.Atoi(tmdbIDStr); err == nil {
				tmdbID = id
			}
		}

		// Skip movies without valid TMDB ID
		if tmdbID == 0 {
			continue
		}

		// Parse processed time
		processedTime, _ := time.Parse("2006-01-02 15:04:05", latestProcessedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		movie := createMovieResourceInternal(tmdbID, properName, year, tmdbID, destinationPath, processedTime, fileSize, language, quality)
		movies = append(movies, movie)
	}

	return movies, nil
}

// getSeriesFromDatabaseByFolder retrieves TV series filtered by base folder path
func getSeriesFromDatabaseByFolder(folderPath string) ([]SeriesResource, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, 0) as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(base_path, '') as base_path,
			MAX(processed_at) as latest_processed_at,
			SUM(COALESCE(file_size, 0)) as total_file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND base_path = ?
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year`

	rows, err := mediaHubDB.Query(query, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var series []SeriesResource

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, basePath, latestProcessedAt string
		var year int
		var totalFileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &basePath, &latestProcessedAt, &totalFileSize); err != nil {
			continue
		}

		// Convert TMDB ID to integer
		tmdbID := 0
		if tmdbIDStr != "" {
			if id, err := strconv.Atoi(tmdbIDStr); err == nil {
				tmdbID = id
			}
		}

		// Parse processed time
		processedTime, _ := time.Parse("2006-01-02 15:04:05", latestProcessedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		seriesPath := constructSeriesPath(destinationPath, properName, year)

		// Generate unique series ID to prevent BAZARR constraint violations
		uniqueSeriesID := generateUniqueSeriesID(tmdbID, properName, year)
		show := createSeriesResource(uniqueSeriesID, properName, year, tmdbID, seriesPath, processedTime, "", "")
		series = append(series, show)
	}

	return series, nil
}

// getEpisodesFromDatabase retrieves episodes for a specific series from the database
func getEpisodesFromDatabase(seriesId string) ([]interface{}, error) {
	var episodes []interface{}

	err := executeWithRetry(func() error {
		mediaHubDB, err := db.GetDatabaseConnection()
		if err != nil {
			return err
		}

		episodes, err = getEpisodesFromDatabaseInternal(mediaHubDB, seriesId)
		return err
	})

	return episodes, err
}

func getEpisodesFromDatabaseInternal(mediaHubDB *sql.DB, seriesId string) ([]interface{}, error) {
	seriesIDInt := safeAtoi(seriesId, 0)
	tmdbID := extractTMDBIDFromSeriesID(seriesIDInt)
	tmdbIDStr := strconv.Itoa(tmdbID)

	// Query episodes directly by TMDB ID, grouped to avoid duplicates
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			SUM(COALESCE(file_size, 0)) as total_file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		AND COALESCE(tmdb_id, '') = ?
		GROUP BY proper_name, season_number, episode_number
		ORDER BY CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)`

	rows, err := mediaHubDB.Query(query, tmdbIDStr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodes []interface{}

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt, language, quality string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		seasonNum := safeAtoi(seasonNumber, 1)
		episodeNum := safeAtoi(episodeNumber, 1)
		seriesIDInt := safeAtoi(seriesId, 1)
		episodeID := generateUniqueEpisodeID(seriesIDInt, seasonNum, episodeNum)

		processedTime := parseProcessedTime(processedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		episode := createEpisodeResource(episodeID, seriesId, seasonNum, episodeNum, properName, destinationPath, processedTime, fileSize, language, quality)
		episodes = append(episodes, episode)
	}

	return episodes, nil
}

// getEpisodesFromDatabaseByFolder retrieves episodes for a specific series filtered by folder
func getEpisodesFromDatabaseByFolder(folderPath, seriesId string) ([]interface{}, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	seriesIDInt := safeAtoi(seriesId, 0)
	tmdbID := extractTMDBIDFromSeriesID(seriesIDInt)
	tmdbIDStr := strconv.Itoa(tmdbID)

	// Query episodes directly by TMDB ID with folder filtering, grouped to avoid duplicates
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			SUM(COALESCE(file_size, 0)) as total_file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		AND COALESCE(tmdb_id, '') = ?
		AND base_path = ?
		GROUP BY proper_name, season_number, episode_number
		ORDER BY CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)`

	rows, err := mediaHubDB.Query(query, tmdbIDStr, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodes []interface{}

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize); err != nil {
			continue
		}

		seasonNum := safeAtoi(seasonNumber, 1)
		episodeNum := safeAtoi(episodeNumber, 1)
		seriesIDInt := safeAtoi(seriesId, 1)
		episodeID := generateUniqueEpisodeID(seriesIDInt, seasonNum, episodeNum)

		processedTime := parseProcessedTime(processedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		episode := createEpisodeResource(episodeID, seriesId, seasonNum, episodeNum, properName, destinationPath, processedTime, fileSize, "", "")
		episodes = append(episodes, episode)
	}

	return episodes, nil
}

// createEpisodeResource creates a properly formatted episode resource
func createEpisodeResource(id int, seriesId string, seasonNumber, episodeNumber int, seriesTitle, filePath string, airDate time.Time, fileSize int64, language, quality string) interface{} {
	episodeTitle := extractEpisodeTitle(filePath, seasonNumber, episodeNumber)
	qualityObj := detectQualityFromDatabase(quality, filePath)
	languages := getLanguagesFromDatabase(language)

	return map[string]interface{}{
		"id":                       id,
		"seriesId":                 seriesId,
		"tvdbId":                   0,
		"episodeFileId":            id,
		"seasonNumber":             seasonNumber,
		"episodeNumber":            episodeNumber,
		"title":                    episodeTitle,
		"airDate":                  airDate.Format("2006-01-02"),
		"airDateUtc":               airDate.Format("2006-01-02T15:04:05Z"),
		"overview":                 "",
		"hasFile":                  true,
		"monitored":                true,
		"absoluteEpisodeNumber":    episodeNumber,
		"unverifiedSceneNumbering": false,
		"series": map[string]interface{}{
			"id":    seriesId,
			"title": seriesTitle,
		},
		"episodeFile": map[string]interface{}{
			"id":           id,
			"seriesId":     seriesId,
			"seasonNumber": seasonNumber,
			"relativePath": filepath.Base(filePath),
			"path":         filePath,
			"size":         fileSize,
			"dateAdded":    airDate.Format("2006-01-02T15:04:05Z"),
			"quality": qualityObj,
			"languages": languages,
		},
	}
}



// getEpisodeFilesFromDatabase retrieves episode files for a specific series
func getEpisodeFilesFromDatabase(seriesId string) ([]interface{}, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	seriesIDInt := safeAtoi(seriesId, 0)
	tmdbID := extractTMDBIDFromSeriesID(seriesIDInt)
	tmdbIDStr := strconv.Itoa(tmdbID)

	// Query episode files directly by TMDB ID
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(processed_at, '') as processed_at,
			COALESCE(file_size, 0) as file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		AND COALESCE(tmdb_id, '') = ?
		ORDER BY CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)`

	rows, err := mediaHubDB.Query(query, tmdbIDStr)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodeFiles []interface{}

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt, language, quality string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		seasonNum := safeAtoi(seasonNumber, 1)
		episodeNum := safeAtoi(episodeNumber, 1)
		seriesIDInt := safeAtoi(seriesId, 1)
		episodeFileID := generateUniqueEpisodeFileID(seriesIDInt, seasonNum, episodeNum)

		processedTime := parseProcessedTime(processedAt)

		qualityObj := detectQualityFromDatabase(quality, destinationPath)
		languages := getLanguagesFromDatabase(language)

		episodeFile := map[string]interface{}{
			"id":           episodeFileID,
			"seriesId":     seriesId,
			"seasonNumber": seasonNum,
			"relativePath": filepath.Base(destinationPath),
			"path":         destinationPath,
			"size":         fileSize,
			"dateAdded":    processedTime.Format("2006-01-02T15:04:05Z"),
			"quality":      qualityObj,
			"languages": languages,
		}

		episodeFiles = append(episodeFiles, episodeFile)
	}

	return episodeFiles, nil
}

// getEpisodeFilesFromDatabaseByFolder retrieves episode files for a specific series filtered by folder
func getEpisodeFilesFromDatabaseByFolder(folderPath, seriesId string) ([]interface{}, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	seriesIDInt := safeAtoi(seriesId, 0)
	tmdbID := extractTMDBIDFromSeriesID(seriesIDInt)
	tmdbIDStr := strconv.Itoa(tmdbID)

	// Query episode files directly by TMDB ID with folder filtering
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(processed_at, '') as processed_at,
			COALESCE(file_size, 0) as file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		AND COALESCE(tmdb_id, '') = ?
		AND base_path = ?
		ORDER BY CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)`

	rows, err := mediaHubDB.Query(query, tmdbIDStr, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodeFiles []interface{}

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt, language, quality string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		seasonNum := safeAtoi(seasonNumber, 1)
		episodeNum := safeAtoi(episodeNumber, 1)
		seriesIDInt := safeAtoi(seriesId, 1)
		episodeFileID := generateUniqueEpisodeFileID(seriesIDInt, seasonNum, episodeNum)

		processedTime := parseProcessedTime(processedAt)

		qualityObj := detectQualityFromDatabase(quality, destinationPath)
		languages := getLanguagesFromDatabase(language)

		episodeFile := map[string]interface{}{
			"id":           episodeFileID,
			"seriesId":     seriesId,
			"seasonNumber": seasonNum,
			"relativePath": filepath.Base(destinationPath),
			"path":         destinationPath,
			"size":         fileSize,
			"dateAdded":    processedTime.Format("2006-01-02T15:04:05Z"),
			"quality":      qualityObj,
			"languages": languages,
		}

		episodeFiles = append(episodeFiles, episodeFile)
	}

	return episodeFiles, nil
}

// getMovieByIDFromDatabase retrieves a specific movie by ID from the CineSync database
func getMovieByIDFromDatabase(movieID int) (*MovieResource, error) {
	// Get all movies first, then find the one with the matching ID
	movies, err := getMoviesFromDatabase()
	if err != nil {
		return nil, err
	}

	// Find the movie with the matching ID
	for _, movie := range movies {
		if movie.ID == movieID {
			return &movie, nil
		}
	}

	return nil, nil // Movie not found
}

// getMovieByIDFromDatabaseByFolder retrieves a specific movie by ID filtered by folder
func getMovieByIDFromDatabaseByFolder(movieID int, folderPath string) (*MovieResource, error) {
	// Get movies from the specific folder first, then find the one with the matching ID
	movies, err := getMoviesFromDatabaseByFolder(folderPath)
	if err != nil {
		return nil, err
	}

	// Find the movie with the matching ID
	for _, movie := range movies {
		if movie.ID == movieID {
			return &movie, nil
		}
	}

	return nil, nil
}

// getMovieFilesFromDatabase retrieves all movie files from the CineSync database
func getMovieFilesFromDatabase() ([]MovieFile, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(year, 0) as year,
			COALESCE(tmdb_id, '') as tmdb_id,
			COALESCE(destination_path, '') as destination_path,
			MAX(processed_at) as latest_processed_at,
			COALESCE(file_size, 0) as file_size,
			COALESCE(language, '') as language,
			COALESCE(quality, '') as quality
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movieFiles []MovieFile

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt, language, quality string
		var year int
		var fileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &fileSize, &language, &quality); err != nil {
			continue
		}

		tmdbID, _ := strconv.Atoi(tmdbIDStr)
		if tmdbID == 0 {
			continue
		}

		addedTime, _ := time.Parse(time.RFC3339, latestProcessedAt)
		if addedTime.IsZero() {
			addedTime = time.Now().Add(-24 * time.Hour)
		}

		// Use TMDB ID as both the file ID and movie ID for consistency
		movieFile := createMovieFile(tmdbID, tmdbID, destinationPath, fileSize, addedTime, language, quality)
		movieFiles = append(movieFiles, movieFile)
	}

	return movieFiles, rows.Err()
}

// getMovieFilesFromDatabaseByFolder retrieves movie files filtered by folder
func getMovieFilesFromDatabaseByFolder(folderPath string) ([]MovieFile, error) {
	// Get all movie files first, then filter by folder path
	allMovieFiles, err := getMovieFilesFromDatabase()
	if err != nil {
		return nil, err
	}

	var movieFiles []MovieFile
	for _, movieFile := range allMovieFiles {
		if strings.Contains(movieFile.Path, folderPath) {
			movieFiles = append(movieFiles, movieFile)
		}
	}

	return movieFiles, nil
}

// getMovieFilesByMovieIDFromDatabase retrieves movie files for a specific movie ID
func getMovieFilesByMovieIDFromDatabase(movieID int) ([]MovieFile, error) {
	// Get all movie files first, then filter by movie ID
	allMovieFiles, err := getMovieFilesFromDatabase()
	if err != nil {
		return nil, err
	}

	var movieFiles []MovieFile
	for _, movieFile := range allMovieFiles {
		if movieFile.MovieId == movieID {
			movieFiles = append(movieFiles, movieFile)
		}
	}

	return movieFiles, nil
}

// getMovieFilesByMovieIDFromDatabaseByFolder retrieves movie files for a specific movie ID filtered by folder
func getMovieFilesByMovieIDFromDatabaseByFolder(movieID int, folderPath string) ([]MovieFile, error) {
	// Get movie files from the specific folder first, then filter by movie ID
	folderMovieFiles, err := getMovieFilesFromDatabaseByFolder(folderPath)
	if err != nil {
		return nil, err
	}

	var movieFiles []MovieFile
	for _, movieFile := range folderMovieFiles {
		if movieFile.MovieId == movieID {
			movieFiles = append(movieFiles, movieFile)
		}
	}

	return movieFiles, nil
}

// getMovieFileByIDFromDatabase retrieves a specific movie file by ID
func getMovieFileByIDFromDatabase(movieFileID int) (*MovieFile, error) {
	// Get all movie files first, then find the one with the matching ID
	movieFiles, err := getMovieFilesFromDatabase()
	if err != nil {
		return nil, err
	}

	// Find the movie file with the matching ID
	for _, movieFile := range movieFiles {
		if movieFile.ID == movieFileID {
			return &movieFile, nil
		}
	}

	return nil, nil // Movie file not found
}

// getMovieFileByIDFromDatabaseByFolder retrieves a specific movie file by ID filtered by folder
func getMovieFileByIDFromDatabaseByFolder(movieFileID int, folderPath string) (*MovieFile, error) {
	// Get movie files from the specific folder first, then find the one with the matching ID
	folderMovieFiles, err := getMovieFilesFromDatabaseByFolder(folderPath)
	if err != nil {
		return nil, err
	}

	// Find the movie file with the matching ID
	for _, movieFile := range folderMovieFiles {
		if movieFile.ID == movieFileID {
			return &movieFile, nil
		}
	}

	return nil, nil // Movie file not found
}

// createMovieFile creates a properly formatted MovieFile
func createMovieFile(id, movieID int, filePath string, fileSize int64, added time.Time, language, quality string) MovieFile {
	relativePath := filepath.Base(filePath)
	qualityObj := detectQualityFromDatabase(quality, filePath)
	languages := getLanguagesFromDatabase(language)

	return MovieFile{
		ID:           id,
		MovieId:      movieID,
		RelativePath: relativePath,
		Path:         filePath,
		Size:         fileSize,
		DateAdded:    added,
		Quality:      qualityObj,
		Languages:    languages,
		SceneName:    "",
		ReleaseGroup: "",
	}
}



func ClearTMDBCache() {
	tmdbMutex.Lock()
	tmdbCache = make(map[int]*TMDBMovieDetails)
	tmdbTVCache = make(map[int]*TMDBTVDetails)
	tmdbMutex.Unlock()
}
