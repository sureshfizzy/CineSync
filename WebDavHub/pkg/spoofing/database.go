package spoofing

import (
	"os"
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
			MAX(processed_at) as latest_processed_at
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

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt); err != nil {
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

		movie := createMovieResource(movieID, properName, year, tmdbID, destinationPath, addedTime)
		movies = append(movies, movie)
		movieID++
	}

	return movies, rows.Err()
}

// createMovieResource creates a properly formatted MovieResource
func createMovieResource(id int, title string, year, tmdbID int, filePath string, added time.Time) MovieResource {
	var fileSize int64
	if stat, err := os.Stat(filePath); err == nil {
		fileSize = stat.Size()
	}

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
			MAX(processed_at) as latest_processed_at
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

		if err := rows.Scan(&properName, &year, &tmdbIDStr, &destinationPath, &latestProcessedAt); err != nil {
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

		show := SeriesResource{
			ID:               seriesID,
			Title:            properName,
			AlternateTitles:  []interface{}{},
			SortTitle:        properName,
			Status:           "continuing",
			Year:             year,
			Path:             destinationPath,
			QualityProfileId: 1,
			SeasonFolder:     true,
			Monitored:        true,
			Runtime:          0,
			TvdbId:           tmdbID,
			TvRageId:         0,
			TvMazeId:         0,
			SeriesType:       "standard",
			CleanTitle:       strings.ToLower(strings.ReplaceAll(properName, " ", "")),
			TitleSlug:        strings.ToLower(strings.ReplaceAll(properName, " ", "-")),
			RootFolderPath:   "/tv",
			Genres:           []string{},
			Tags:             []int{},
			Added:            addedTime,
			Images:           []interface{}{},
			Seasons:          []interface{}{},
		}

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
