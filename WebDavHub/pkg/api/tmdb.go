package api

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"cinesync/pkg/logger"
	"encoding/json"
	"fmt"
	"strconv"
	"cinesync/pkg/db"
)

// WithTmdbValidation wraps TMDB handlers with common validation and queue management
func WithTmdbValidation(handler func(w http.ResponseWriter, r *http.Request, apiKey string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Acquire queue lock for concurrent processing
		acquireTmdbQueue()
		defer releaseTmdbQueue()

		ip := r.RemoteAddr
		if colon := strings.LastIndex(ip, ":"); colon != -1 {
			ip = ip[:colon]
		}

		if !checkTmdbRateLimit(ip) {
			http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		tmdbApiKey := getTmdbApiKey()
		if tmdbApiKey == "" {
			logger.Warn("TMDB_API_KEY not set in environment")
			http.Error(w, "TMDB API key not configured", http.StatusInternalServerError)
			return
		}

		handler(w, r, tmdbApiKey)
	}
}

// getTmdbApiKey returns the TMDB API key with fallback mechanism
func getTmdbApiKey() string {
	envKey := strings.TrimSpace(os.Getenv("TMDB_API_KEY"))

	placeholderValues := []string{
		"",
		"your_tmdb_api_key_here",
		"your-tmdb-api-key",
		"placeholder",
		"none",
		"null",
	}

	for _, placeholder := range placeholderValues {
		if strings.ToLower(envKey) == placeholder {
			return "a4f28c50ae81b7529a05b61910d64398"
		}
	}

	return envKey
}

var tmdbRateLimit = 500 // TMDB legacy limits removed, now ~50 req/sec (500 per 10s)
var tmdbRateWindow = 10 * time.Second
var tmdbRateMap = make(map[string][]time.Time)
var tmdbRateMu sync.Mutex

// HTTP client for faster TMDB requests
var tmdbHttpClient = &http.Client{
	Timeout: 5 * time.Second,
}

// Global TMDB request queue to allow concurrent processing
var tmdbQueue = make(chan struct{}, 20)
var tmdbQueueInitialized = false
var tmdbQueueMu sync.Mutex
var tmdbRequestCounter = 0
var tmdbCounterMu sync.Mutex

// Simple in-memory cache for details
var tmdbDetailsCache = struct {
	mu    sync.Mutex
	items map[string][]byte
}{items: make(map[string][]byte)}

// Initialize the TMDB queue
func initTmdbQueue() {
	tmdbQueueMu.Lock()
	defer tmdbQueueMu.Unlock()
	if !tmdbQueueInitialized {
		// Fill the queue with tokens to allow concurrent requests
		for i := 0; i < 20; i++ {
			tmdbQueue <- struct{}{}
		}
		tmdbQueueInitialized = true
	}
}

// Acquire queue lock for sequential TMDB processing
func acquireTmdbQueue() {
	initTmdbQueue()
	<-tmdbQueue

	// Increment counter
	tmdbCounterMu.Lock()
	tmdbRequestCounter++
	tmdbCounterMu.Unlock()
}

// Release queue lock after TMDB processing
func releaseTmdbQueue() {
	tmdbQueue <- struct{}{}
}

func checkTmdbRateLimit(ip string) bool {
	tmdbRateMu.Lock()
	defer tmdbRateMu.Unlock()
	now := time.Now()
	windowStart := now.Add(-tmdbRateWindow)
	times := tmdbRateMap[ip]

	var newTimes []time.Time
	for _, t := range times {
		if t.After(windowStart) {
			newTimes = append(newTimes, t)
		}
	}
	if len(newTimes) >= tmdbRateLimit {
		tmdbRateMap[ip] = newTimes
		return false
	}
	// Add this request
	newTimes = append(newTimes, now)
	tmdbRateMap[ip] = newTimes
	return true
}

// waitForRateLimit waits until the rate limit window allows a new request
func waitForRateLimit(ip string) {
	for {
		tmdbRateMu.Lock()
		now := time.Now()
		windowStart := now.Add(-tmdbRateWindow)
		times := tmdbRateMap[ip]

		var newTimes []time.Time
		for _, t := range times {
			if t.After(windowStart) {
				newTimes = append(newTimes, t)
			}
		}

		if len(newTimes) < tmdbRateLimit {
			// We can proceed
			newTimes = append(newTimes, now)
			tmdbRateMap[ip] = newTimes
			tmdbRateMu.Unlock()
			return
		}

		// Calculate how long to wait
		oldestRequest := newTimes[0]
		waitTime := tmdbRateWindow - now.Sub(oldestRequest)
		tmdbRateMu.Unlock()
		time.Sleep(waitTime + 100*time.Millisecond)
	}
}

func HandleTmdbProxy(w http.ResponseWriter, r *http.Request, tmdbApiKey string) {

	query := r.URL.Query().Get("query")
	year := r.URL.Query().Get("year")
	mediaType := r.URL.Query().Get("mediaType")
	if query == "" {
		http.Error(w, "Missing query parameter", http.StatusBadRequest)
		return
	}

	params := url.Values{}
	params.Set("api_key", tmdbApiKey)
	params.Set("query", query)
	params.Set("include_adult", "false")
	if year != "" {
		params.Set("year", year)
	}

	var tmdbUrl string
	if mediaType == "tv" {
		tmdbUrl = "https://api.themoviedb.org/3/search/tv?" + params.Encode()
	} else {
		tmdbUrl = "https://api.themoviedb.org/3/search/movie?" + params.Encode()
	}

	resp, err := tmdbHttpClient.Get(tmdbUrl)
	if err != nil {
		logger.Warn("Error forwarding to TMDb: %v", err)
		http.Error(w, "Failed to contact TMDb", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func HandleTmdbDetails(w http.ResponseWriter, r *http.Request, tmdbApiKey string) {

	id := r.URL.Query().Get("id")
	mediaType := r.URL.Query().Get("mediaType") // optional: "movie" or "tv"
	query := r.URL.Query().Get("query")
	seasonNumber := r.URL.Query().Get("season")
	episodeNumbers := r.URL.Query().Get("episodes") // comma-separated list of episode numbers
	skipCache := r.URL.Query().Get("skipCache") == "true" // skip caching for temporary lookups

	if id != "" {
		// Use id-based cache key
		cacheKey := "id:" + id + ":" + mediaType

		// Only check cache if skipCache is false
		if !skipCache {
			tmdbDetailsCache.mu.Lock()
			if data, ok := tmdbDetailsCache.items[cacheKey]; ok {
				tmdbDetailsCache.mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-TMDB-Details-Cache", "HIT")
				// Don't re-cache data that's already cached - reduces excessive DB writes
				w.Write(data)
				return
			}
			tmdbDetailsCache.mu.Unlock()
		}
		// Fetch details directly by ID
		var detailsUrl string
		var resp *http.Response
		var err error
		if mediaType == "tv" {
			detailsUrl = "https://api.themoviedb.org/3/tv/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
			resp, err = tmdbHttpClient.Get(detailsUrl)
		} else if mediaType == "movie" {
			detailsUrl = "https://api.themoviedb.org/3/movie/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
			resp, err = tmdbHttpClient.Get(detailsUrl)
		} else {
			// Try TV first, then fallback to movie if not found
			detailsUrl = "https://api.themoviedb.org/3/tv/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
			resp, err = tmdbHttpClient.Get(detailsUrl)
			if err != nil || resp.StatusCode != 200 {
				if resp != nil {
					resp.Body.Close()
				}
				detailsUrl = "https://api.themoviedb.org/3/movie/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
				resp, err = tmdbHttpClient.Get(detailsUrl)
			}
		}
		if err != nil || resp.StatusCode != 200 {
			if err != nil {
				logger.Warn("TMDb details fetch by ID failed - Network error: %v", err)
			} else {
				logger.Warn("TMDb details fetch by ID failed - HTTP %d: ID '%s' not found for media type '%s'", resp.StatusCode, id, mediaType)
			}
			http.Error(w, "Failed to fetch details from TMDb", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			http.Error(w, "Failed to read TMDb response", http.StatusInternalServerError)
			return
		}

		// If TV, fetch episodes for each season or specific episodes
		if mediaType == "tv" {
			var details map[string]interface{}
			if err := json.Unmarshal(body, &details); err == nil {
				if seasons, ok := details["seasons"].([]interface{}); ok {
					for _, s := range seasons {
						season, ok := s.(map[string]interface{})
						if !ok { continue }
						sn, ok := season["season_number"].(float64)
						if !ok { continue }

						// If season number is specified, only fetch that season
						if seasonNumber != "" && fmt.Sprintf("%d", int(sn)) != seasonNumber {
							continue
						}

						seasonUrl := "https://api.themoviedb.org/3/tv/" + id + "/season/" + fmt.Sprintf("%d", int(sn)) + "?api_key=" + url.QueryEscape(tmdbApiKey)
						seasonResp, err := tmdbHttpClient.Get(seasonUrl)
						if err == nil && seasonResp.StatusCode == 200 {
							seasonBody, _ := io.ReadAll(seasonResp.Body)
							seasonResp.Body.Close()
							var seasonDetails map[string]interface{}
							if err := json.Unmarshal(seasonBody, &seasonDetails); err == nil {
								if episodes, ok := seasonDetails["episodes"].([]interface{}); ok {
									// If specific episodes are requested, filter them
									if episodeNumbers != "" {
										requestedEps := make(map[int]bool)
										for _, epStr := range strings.Split(episodeNumbers, ",") {
											if epNum, err := strconv.Atoi(strings.TrimSpace(epStr)); err == nil {
												requestedEps[epNum] = true
											}
										}
										filteredEpisodes := make([]interface{}, 0)
										for _, ep := range episodes {
											if epMap, ok := ep.(map[string]interface{}); ok {
												if epNum, ok := epMap["episode_number"].(float64); ok {
													if requestedEps[int(epNum)] {
														filteredEpisodes = append(filteredEpisodes, ep)
													}
												}
											}
										}
										season["episodes"] = filteredEpisodes
									} else {
										season["episodes"] = episodes
									}
								}
							}
						}
					}
				}
				// re-marshal
				body, _ = json.Marshal(details)
			}
		}
		// Only cache if skipCache is false
		if !skipCache {
			// Store in id-based cache (format for DB cache)
			tmdbDetailsCache.mu.Lock()
			tmdbDetailsCache.items[cacheKey] = body
			tmdbDetailsCache.mu.Unlock()

			// Format and upsert for persistent DB cache
			var tmdbObj map[string]interface{}
			if err := json.Unmarshal(body, &tmdbObj); err == nil {
				idVal, _ := tmdbObj["id"].(float64)
				title, _ := tmdbObj["title"].(string)
				if title == "" {
					title, _ = tmdbObj["name"].(string)
				}
				posterPath, _ := tmdbObj["poster_path"].(string)
				releaseDate, _ := tmdbObj["release_date"].(string)
				firstAirDate, _ := tmdbObj["first_air_date"].(string)

				// Determine actual media type from the response if not provided
				actualMediaType := mediaType
				if actualMediaType == "" {
					if _, hasFirstAirDate := tmdbObj["first_air_date"]; hasFirstAirDate {
						actualMediaType = "tv"
					} else if _, hasReleaseDate := tmdbObj["release_date"]; hasReleaseDate {
						actualMediaType = "movie"
					} else {
						if _, hasName := tmdbObj["name"]; hasName && title == "" {
							actualMediaType = "tv"
						} else {
							actualMediaType = "movie"
						}
					}
				}

				// Only cache if we have a valid media type
				if actualMediaType == "movie" || actualMediaType == "tv" {
					resultJson := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"first_air_date":%q,"media_type":%q}`,
						int(idVal), title, posterPath, releaseDate, firstAirDate, actualMediaType)
					db.UpsertTmdbCache(cacheKey, resultJson)
				}
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-TMDB-Details-Cache", "MISS")
		w.Write(body)
		return
	}

	if query == "" {
		http.Error(w, "Missing query parameter", http.StatusBadRequest)
		return
	}

	cacheKey := "query:" + mediaType + ":" + query

	// Only check cache if skipCache is false
	if !skipCache {
		tmdbDetailsCache.mu.Lock()
		if data, ok := tmdbDetailsCache.items[cacheKey]; ok {
			tmdbDetailsCache.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-TMDB-Details-Cache", "HIT")
			w.Write(data)
			return
		}
		tmdbDetailsCache.mu.Unlock()
	}

	// 1. Search for the movie/TV show to get the ID
	searchType := "movie"
	if mediaType == "tv" {
		searchType = "tv"
	}
	searchUrl := "https://api.themoviedb.org/3/search/" + searchType + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&query=" + url.QueryEscape(query) + "&include_adult=false"
	resp, err := tmdbHttpClient.Get(searchUrl)
	if err != nil || resp.StatusCode != 200 {
		logger.Warn("TMDb search failed: %v", err)
		http.Error(w, "Failed to search TMDb", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	var searchResult struct {
		Results []struct {
			ID    int    `json:"id"`
			Title string `json:"title"`
			Name  string `json:"name"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&searchResult); err != nil || len(searchResult.Results) == 0 {
		http.Error(w, "No results found", http.StatusNotFound)
		return
	}
	id = fmt.Sprint(searchResult.Results[0].ID)

	// 2. Fetch details with credits, keywords, etc
	var detailsUrl string
	if searchType == "tv" {
		detailsUrl = "https://api.themoviedb.org/3/tv/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
	} else {
		detailsUrl = "https://api.themoviedb.org/3/movie/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
	}
	detailsResp, err := tmdbHttpClient.Get(detailsUrl)
	if err != nil || detailsResp.StatusCode != 200 {
		if err != nil {
			logger.Warn("TMDb details fetch failed after search - Network error: %v", err)
		} else {
			logger.Warn("TMDb details fetch failed after search - HTTP %d: ID '%s' not found", detailsResp.StatusCode, id)
		}
		http.Error(w, "Failed to fetch details from TMDb", http.StatusBadGateway)
		return
	}
	defer detailsResp.Body.Close()
	body, err := io.ReadAll(detailsResp.Body)
	if err != nil {
		http.Error(w, "Failed to read TMDb response", http.StatusInternalServerError)
		return
	}

	// If TV, fetch episodes for each season
	if searchType == "tv" {
		var details map[string]interface{}
		if err := json.Unmarshal(body, &details); err == nil {
			if seasons, ok := details["seasons"].([]interface{}); ok {
				for _, s := range seasons {
					season, ok := s.(map[string]interface{})
					if !ok { continue }
					sn, ok := season["season_number"].(float64)
					if !ok { continue }
					seasonUrl := "https://api.themoviedb.org/3/tv/" + id + "/season/" + fmt.Sprintf("%d", int(sn)) + "?api_key=" + url.QueryEscape(tmdbApiKey)
					seasonResp, err := tmdbHttpClient.Get(seasonUrl)
					if err == nil && seasonResp.StatusCode == 200 {
						seasonBody, _ := io.ReadAll(seasonResp.Body)
						seasonResp.Body.Close()
						var seasonDetails map[string]interface{}
						if err := json.Unmarshal(seasonBody, &seasonDetails); err == nil {
							if episodes, ok := seasonDetails["episodes"]; ok {
								season["episodes"] = episodes
							}
						}
					}
				}
				// re-marshal
				body, _ = json.Marshal(details)
			}
		}
	}

	// Only cache if skipCache is false
	if !skipCache {
		tmdbDetailsCache.mu.Lock()
		tmdbDetailsCache.items[cacheKey] = body
		tmdbDetailsCache.mu.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-TMDB-Details-Cache", "MISS")
	w.Write(body)
}

// HandleTmdbCategoryContent fetches popular/trending content for category folders
func HandleTmdbCategoryContent(w http.ResponseWriter, r *http.Request, tmdbApiKey string) {

	categoryType := r.URL.Query().Get("category")
	if categoryType == "" {
		http.Error(w, "Missing category parameter", http.StatusBadRequest)
		return
	}

	// Determine content type and endpoint based on category
	var endpoint string
	var mediaType string

	// Detect if category is for movies, shows, or anime using configured folder names
	contentType := detectCategoryContentType(categoryType)

	// Set endpoint and parameters based on detected content type
	params := url.Values{}
	params.Set("api_key", tmdbApiKey)
	params.Set("page", "1")

	switch contentType {
	case "anime_tv":
		mediaType = "tv"
		endpoint = "https://api.themoviedb.org/3/discover/tv"
		params.Set("with_genres", "16") // Animation genre
		params.Set("with_original_language", "ja") // Japanese language
		params.Set("sort_by", "vote_average.desc") // Sort by rating for quality anime
		params.Set("vote_count.gte", "100") // Minimum votes for popular anime
		params.Set("with_keywords", "210024") // Anime keyword

	case "anime_movie":
		mediaType = "movie"
		endpoint = "https://api.themoviedb.org/3/discover/movie"
		params.Set("with_genres", "16") // Animation genre
		params.Set("with_original_language", "ja") // Japanese language
		params.Set("sort_by", "vote_average.desc") // Sort by rating for quality anime
		params.Set("vote_count.gte", "50") // Minimum votes for popular anime movies
		params.Set("with_keywords", "210024") // Anime keyword

	case "tv":
		mediaType = "tv"
		endpoint = "https://api.themoviedb.org/3/tv/top_rated"

	case "movie":
		mediaType = "movie"
		endpoint = "https://api.themoviedb.org/3/movie/popular"

	default:
		mediaType = "movie"
		endpoint = "https://api.themoviedb.org/3/movie/popular"
	}

	tmdbUrl := endpoint + "?" + params.Encode()

	resp, err := tmdbHttpClient.Get(tmdbUrl)
	if err != nil {
		logger.Warn("Error fetching category content from TMDb: %v", err)
		http.Error(w, "Failed to contact TMDb", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Warn("TMDb API returned status %d for category content", resp.StatusCode)
		http.Error(w, "TMDb API error", http.StatusBadGateway)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Warn("Error reading TMDb response: %v", err)
		http.Error(w, "Failed to read TMDb response", http.StatusInternalServerError)
		return
	}

	// Parse response to limit results and add media type
	var tmdbResponse map[string]interface{}
	if err := json.Unmarshal(body, &tmdbResponse); err != nil {
		logger.Warn("Error parsing TMDb response: %v", err)
		http.Error(w, "Failed to parse TMDb response", http.StatusInternalServerError)
		return
	}

	// Limit to first 20 results and add media type
	if results, ok := tmdbResponse["results"].([]interface{}); ok {
		if len(results) > 20 {
			tmdbResponse["results"] = results[:20]
		}

		// Add media_type to each result for frontend processing
		for _, result := range tmdbResponse["results"].([]interface{}) {
			if resultMap, ok := result.(map[string]interface{}); ok {
				resultMap["media_type"] = mediaType
			}
		}
	}

	// Convert back to JSON
	responseBody, err := json.Marshal(tmdbResponse)
	if err != nil {
		logger.Warn("Error marshaling response: %v", err)
		http.Error(w, "Failed to process response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(responseBody)
}

// detectCategoryContentType determines the content type based on category folder name
func detectCategoryContentType(categoryName string) string {
	categoryLower := strings.ToLower(categoryName)

	// First, check environment variable values
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}

		envKey := parts[0]
		envValue := strings.ToLower(parts[1])

		// Skip empty values
		if envValue == "" {
			continue
		}

		// Check if the category name matches this environment variable's value
		if envValue == categoryLower {
			// Determine content type based on environment variable name
			envKeyUpper := strings.ToUpper(envKey)

			// Check for anime patterns first (most specific)
			if strings.Contains(envKeyUpper, "ANIME") {
				if strings.Contains(envKeyUpper, "MOVIE") {
					return "anime_movie"
				}
				if strings.Contains(envKeyUpper, "SHOW") || strings.Contains(envKeyUpper, "TV") {
					return "anime_tv"
				}
				return "anime_tv" // Default anime to TV
			}

			// Check for show patterns
			if strings.Contains(envKeyUpper, "SHOW") {
				return "tv"
			}

			// Check for movie patterns
			if strings.Contains(envKeyUpper, "MOVIE") {
				return "movie"
			}
		}
	}

	// Check if this is a source directory name when USE_SOURCE_STRUCTURE is enabled
	if os.Getenv("USE_SOURCE_STRUCTURE") == "true" {
		sourceDirStr := os.Getenv("SOURCE_DIR")
		if sourceDirStr != "" {
			// Split by comma and check each source directory
			dirs := strings.Split(sourceDirStr, ",")
			for _, dir := range dirs {
				dir = strings.TrimSpace(dir)
				if dir != "" {
					baseName := strings.ToLower(filepath.Base(dir))
					if baseName == categoryLower {
						// Determine content type based on source directory name patterns
						return detectContentTypeFromDirectoryName(baseName)
					}
				}
			}
		}
	}

	// Fallback to keyword-based detection on the folder name itself
	if strings.Contains(categoryLower, "anime") {
		if strings.Contains(categoryLower, "movie") || strings.Contains(categoryLower, "film") {
			return "anime_movie"
		}
		return "anime_tv"
	}

	if strings.Contains(categoryLower, "movie") || strings.Contains(categoryLower, "cinema") || strings.Contains(categoryLower, "film") {
		return "movie"
	}

	if strings.Contains(categoryLower, "show") || strings.Contains(categoryLower, "tv") || strings.Contains(categoryLower, "series") {
		return "tv"
	}

	// Check resolution folder patterns
	if strings.Contains(categoryLower, "4k") || strings.Contains(categoryLower, "uhd") || strings.Contains(categoryLower, "hd") {
		if strings.Contains(categoryLower, "show") || strings.Contains(categoryLower, "series") || strings.Contains(categoryLower, "tv") {
			return "tv"
		}
		return "movie"
	}

	// Default to movie
	return "movie"
}

// detectContentTypeFromDirectoryName determines content type based on directory name patterns
func detectContentTypeFromDirectoryName(dirName string) string {
	dirLower := strings.ToLower(dirName)

	// Check for anime patterns first (most specific)
	if strings.Contains(dirLower, "anime") {
		if strings.Contains(dirLower, "movie") || strings.Contains(dirLower, "film") {
			return "anime_movie"
		}
		return "anime_tv"
	}

	// Check for show/TV patterns
	if strings.Contains(dirLower, "show") || strings.Contains(dirLower, "tv") ||
	   strings.Contains(dirLower, "series") || strings.Contains(dirLower, "episode") {
		return "tv"
	}

	// Check for movie patterns
	if strings.Contains(dirLower, "movie") || strings.Contains(dirLower, "cinema") ||
	   strings.Contains(dirLower, "film") {
		return "movie"
	}

	// Check resolution patterns and try to infer from context
	if strings.Contains(dirLower, "4k") || strings.Contains(dirLower, "uhd") ||
	   strings.Contains(dirLower, "hd") || strings.Contains(dirLower, "quality") {
		// If it contains show/series indicators, it's TV
		if strings.Contains(dirLower, "show") || strings.Contains(dirLower, "series") ||
		   strings.Contains(dirLower, "tv") {
			return "tv"
		}
		// Otherwise assume movie for quality-based directories
		return "movie"
	}

	// Default to movie for unknown patterns
	return "movie"
}