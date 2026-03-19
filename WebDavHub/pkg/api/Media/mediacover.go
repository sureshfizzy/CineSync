package media

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	tmdbImageBaseURL = "https://image.tmdb.org/t/p/"
	posterSize       = "w500"
	fanartSize       = "w1280"
)

// GetPath returns the local disk path for a media cover file
func GetPath(tmdbID int, coverType string) string {
	dir := filepath.Join("..", "db", "MediaCover", fmt.Sprintf("%d", tmdbID))
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, coverType+".jpg")
}

func FetchAndSave(tmdbID int, mediaType string) error {
	apiKey := GetAPIKey()
	url := fmt.Sprintf("https://api.themoviedb.org/3/%s/%d?api_key=%s", mediaType, tmdbID, apiKey)

	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("failed to fetch TMDB data: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("TMDB API returned status %d", resp.StatusCode)
	}

	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return fmt.Errorf("failed to decode TMDB response: %v", err)
	}

	posterPath, _ := data["poster_path"].(string)
	backdropPath, _ := data["backdrop_path"].(string)

	if posterPath != "" {
		downloadImage(
			fmt.Sprintf("%s%s%s", tmdbImageBaseURL, posterSize, posterPath),
			GetPath(tmdbID, "poster"),
		)
	}
	if backdropPath != "" {
		downloadImage(
			fmt.Sprintf("%s%s%s", tmdbImageBaseURL, fanartSize, backdropPath),
			GetPath(tmdbID, "fanart"),
		)
	}
	return nil
}

func downloadImage(imageURL, localPath string) error {
	resp, err := http.Get(imageURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download image: status %d", resp.StatusCode)
	}

	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, resp.Body)
	return err
}

// GetAPIKey returns the TMDB API key from the environment
func GetAPIKey() string {
	key := strings.TrimSpace(os.Getenv("TMDB_API_KEY"))
	for _, placeholder := range []string{"", "your_tmdb_api_key_here", "your-tmdb-api-key", "placeholder", "none", "null"} {
		if strings.ToLower(key) == placeholder {
			return "a4f28c50ae81b7529a05b61910d64398"
		}
	}
	return key
}
