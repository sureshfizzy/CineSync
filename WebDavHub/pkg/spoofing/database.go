package spoofing

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/db"
)

// getMoviesFromDatabase retrieves movies from the CineSync database and formats them for Radarr
func getMoviesFromDatabase() ([]MovieResource, error) {
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
			COALESCE(file_size, 0) as file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movies []MovieResource
	movieID := 1

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt string
		var year int
		var fileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &fileSize); err != nil {
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

		movie := createMovieResource(movieID, properName, year, tmdbID, destinationPath, addedTime, fileSize)
		movies = append(movies, movie)
		movieID++
	}

	return movies, rows.Err()
}

// createMovieResource creates a properly formatted MovieResource with actual file size
func createMovieResource(id int, title string, year, tmdbID int, filePath string, added time.Time, fileSize int64) MovieResource {
	return createMovieResourceInternal(id, title, year, tmdbID, filePath, added, fileSize)
}

// createMovieResourceInternal
func createMovieResourceInternal(id int, title string, year, tmdbID int, filePath string, added time.Time, fileSize int64) MovieResource {

	relativePath := filepath.Base(filePath)
	if strings.Contains(filePath, title) {
		if parts := strings.Split(filePath, title); len(parts) > 1 {
			relativePath = title + parts[1]
		}
	}

	movieFile := &MovieFile{
		ID:           id,
		MovieId:      id,
		RelativePath: relativePath,
		Path:         filePath,
		Size:         fileSize,
		DateAdded:    added,
		Quality: Quality{
			Quality: QualityDefinition{
				ID:         1,
				Name:       "Unknown",
				Source:     "unknown",
				Resolution: 0,
			},
			Revision: QualityRevision{Version: 1, Real: 0, IsRepack: false},
		},
		Languages: []Language{{ID: 1, Name: "Unknown"}},
	}

	return MovieResource{
		ID:                  id,
		Title:               title,
		OriginalTitle:       title,
		SortTitle:           title,
		Status:              "released",
		Overview:            "",
		Year:                year,
		HasFile:             true,
		MovieFileId:         id,
		Path:                filepath.Dir(filePath),
		QualityProfileId:    1,
		Monitored:           true,
		MinimumAvailability: "released",
		IsAvailable:         true,
		Runtime:             0,
		CleanTitle:          strings.ToLower(strings.ReplaceAll(title, " ", "")),
		ImdbId:              "",
		TmdbId:              tmdbID,
		TitleSlug:           strings.ToLower(strings.ReplaceAll(title, " ", "-")),
		RootFolderPath:      "/movies",
		Certification:       "",
		Genres:              []string{},
		Tags:                []int{},
		Added:               added,
		Images:              []interface{}{},
		Popularity:          0,
		MovieFile:           movieFile,
		SizeOnDisk:          fileSize,
	}
}

// createSeriesResource creates a properly formatted SeriesResource
func createSeriesResource(id int, title string, year, tmdbID int, filePath string, added time.Time) SeriesResource {
	return SeriesResource{
		ID:               id,
		Title:            title,
		AlternateTitles:  []interface{}{},
		SortTitle:        title,
		Status:           "continuing",
		Year:             year,
		Path:             filePath,
		QualityProfileId: 1,
		SeasonFolder:     true,
		Monitored:        true,
		Runtime:          0,
		TvdbId:           tmdbID,
		TvRageId:         0,
		TvMazeId:         0,
		SeriesType:       "standard",
		CleanTitle:       strings.ToLower(strings.ReplaceAll(title, " ", "")),
		TitleSlug:        strings.ToLower(strings.ReplaceAll(title, " ", "-")),
		RootFolderPath:   "/tv",
		Genres:           []string{},
		Tags:             []int{},
		Added:            added,
		Images:           []interface{}{},
		Seasons:          []interface{}{},
	}
}

// getSeriesFromDatabase retrieves TV series from the CineSync database and formats them for Sonarr
func getSeriesFromDatabase() ([]SeriesResource, error) {
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
			SUM(COALESCE(file_size, 0)) as total_file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var series []SeriesResource
	seriesID := 1

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt string
		var year int
		var totalFileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &totalFileSize); err != nil {
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

		show := createSeriesResource(seriesID, properName, year, tmdbID, destinationPath, addedTime)

		series = append(series, show)
		seriesID++
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
			COALESCE(file_size, 0) as file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'MOVIE'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND base_path = ?
		GROUP BY proper_name, year, tmdb_id
		ORDER BY proper_name, year
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var movies []MovieResource
	movieID := 1

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt string
		var year int
		var fileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &fileSize); err != nil {
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

		movie := createMovieResource(movieID, properName, year, tmdbID, destinationPath, processedTime, fileSize)
		movies = append(movies, movie)
		movieID++
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
		ORDER BY proper_name, year
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var series []SeriesResource
	seriesID := 1

	for rows.Next() {
		var properName, tmdbIDStr, destinationPath, latestProcessedAt string
		var year int
		var totalFileSize int64

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt, &totalFileSize); err != nil {
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

		show := createSeriesResource(seriesID, properName, year, tmdbID, destinationPath, processedTime)

		series = append(series, show)
		seriesID++
	}

	return series, nil
}

// getEpisodesFromDatabase retrieves episodes for a specific series from the database
func getEpisodesFromDatabase(seriesId string) ([]interface{}, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	// Map the seriesId back to the series name
	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(processed_at, '') as processed_at,
			COALESCE(file_size, 0) as file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		ORDER BY proper_name, CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodes []interface{}
	episodeID := 1

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize); err != nil {
			continue
		}

		// Convert season and episode numbers to integers
		seasonNum := 1
		if sn, err := strconv.Atoi(seasonNumber); err == nil {
			seasonNum = sn
		}

		episodeNum := 1
		if en, err := strconv.Atoi(episodeNumber); err == nil {
			episodeNum = en
		}

		// Parse processed time
		processedTime, _ := time.Parse("2006-01-02 15:04:05", processedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		episode := createEpisodeResource(episodeID, seriesId, seasonNum, episodeNum, properName, destinationPath, processedTime, fileSize)
		episodes = append(episodes, episode)
		episodeID++
	}

	return episodes, nil
}

// getEpisodesFromDatabaseByFolder retrieves episodes for a specific series filtered by folder
func getEpisodesFromDatabaseByFolder(folderPath, seriesId string) ([]interface{}, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `
		SELECT
			COALESCE(proper_name, '') as proper_name,
			COALESCE(season_number, '') as season_number,
			COALESCE(episode_number, '') as episode_number,
			COALESCE(destination_path, '') as destination_path,
			COALESCE(processed_at, '') as processed_at,
			COALESCE(file_size, 0) as file_size
		FROM processed_files
		WHERE UPPER(media_type) = 'TV'
		AND destination_path IS NOT NULL
		AND destination_path != ''
		AND proper_name IS NOT NULL
		AND proper_name != ''
		AND season_number IS NOT NULL
		AND episode_number IS NOT NULL
		AND base_path = ?
		ORDER BY proper_name, CAST(season_number AS INTEGER), CAST(episode_number AS INTEGER)
		LIMIT 1000`

	rows, err := mediaHubDB.Query(query, folderPath)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var episodes []interface{}
	episodeID := 1

	for rows.Next() {
		var properName, seasonNumber, episodeNumber, destinationPath, processedAt string
		var fileSize int64

		if err := rows.Scan(&properName, &seasonNumber, &episodeNumber, &destinationPath, &processedAt, &fileSize); err != nil {
			continue
		}

		// Convert season and episode numbers to integers
		seasonNum := 1
		if sn, err := strconv.Atoi(seasonNumber); err == nil {
			seasonNum = sn
		}

		episodeNum := 1
		if en, err := strconv.Atoi(episodeNumber); err == nil {
			episodeNum = en
		}

		// Parse processed time
		processedTime, _ := time.Parse("2006-01-02 15:04:05", processedAt)
		if processedTime.IsZero() {
			processedTime = time.Now().Add(-24 * time.Hour)
		}

		episode := createEpisodeResource(episodeID, seriesId, seasonNum, episodeNum, properName, destinationPath, processedTime, fileSize)
		episodes = append(episodes, episode)
		episodeID++
	}

	return episodes, nil
}

// createEpisodeResource creates a properly formatted episode resource
func createEpisodeResource(id int, seriesId string, seasonNumber, episodeNumber int, seriesTitle, filePath string, airDate time.Time, fileSize int64) interface{} {
	// Extract episode title from file path if possible
	episodeTitle := fmt.Sprintf("S%02dE%02d", seasonNumber, episodeNumber)

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
			"quality": map[string]interface{}{
				"quality": map[string]interface{}{
					"id":         1,
					"name":       "Unknown",
					"source":     "unknown",
					"resolution": 0,
				},
				"revision": map[string]interface{}{
					"version":  1,
					"real":     0,
					"isRepack": false,
				},
			},
			"languages": []map[string]interface{}{
				{
					"id":   1,
					"name": "Unknown",
				},
			},
		},
	}
}
