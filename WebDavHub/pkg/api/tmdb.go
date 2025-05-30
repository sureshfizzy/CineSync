package api

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"cinesync/pkg/logger"
	"encoding/json"
	"fmt"
	"strconv"
	"cinesync/pkg/db"
)

var tmdbRateLimit = 40
var tmdbRateWindow = time.Minute
var tmdbRateMap = make(map[string][]time.Time)
var tmdbRateMu sync.Mutex

// Simple in-memory cache for details
var tmdbDetailsCache = struct {
	mu    sync.Mutex
	items map[string][]byte
}{items: make(map[string][]byte)}

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

func HandleTmdbProxy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Rate limiting by client IP
	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		ip = ip[:colon]
	}
	if !checkTmdbRateLimit(ip) {
		logger.Warn("Rate limit exceeded for IP: %s", ip)
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Rate limit exceeded (40 requests per minute). Please try again later.", http.StatusTooManyRequests)
		return
	}

	tmdbApiKey := os.Getenv("TMDB_API_KEY")
	if tmdbApiKey == "" {
		logger.Warn("TMDB_API_KEY not set in environment")
		http.Error(w, "TMDB API key not configured", http.StatusInternalServerError)
		return
	}

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

	resp, err := http.Get(tmdbUrl)
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

func HandleTmdbDetails(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ip := r.RemoteAddr
	if colon := strings.LastIndex(ip, ":"); colon != -1 {
		ip = ip[:colon]
	}
	if !checkTmdbRateLimit(ip) {
		logger.Warn("Rate limit exceeded for IP: %s", ip)
		w.Header().Set("Retry-After", "60")
		http.Error(w, "Rate limit exceeded (40 requests per minute). Please try again later.", http.StatusTooManyRequests)
		return
	}

	tmdbApiKey := os.Getenv("TMDB_API_KEY")
	if tmdbApiKey == "" {
		logger.Warn("TMDB_API_KEY not set in environment")
		http.Error(w, "TMDB API key not configured", http.StatusInternalServerError)
		return
	}

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
			resp, err = http.Get(detailsUrl)
		} else if mediaType == "movie" {
			detailsUrl = "https://api.themoviedb.org/3/movie/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
			resp, err = http.Get(detailsUrl)
		} else {
			// Try TV first, then fallback to movie if not found
			detailsUrl = "https://api.themoviedb.org/3/tv/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
			resp, err = http.Get(detailsUrl)
			if err != nil || resp.StatusCode != 200 {
				if resp != nil {
					resp.Body.Close()
				}
				detailsUrl = "https://api.themoviedb.org/3/movie/" + id + "?api_key=" + url.QueryEscape(tmdbApiKey) + "&append_to_response=credits,keywords"
				resp, err = http.Get(detailsUrl)
			}
		}
		if err != nil || resp.StatusCode != 200 {
			logger.Warn("TMDb details fetch by ID failed: %v", err)
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
						seasonResp, err := http.Get(seasonUrl)
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
				if releaseDate == "" {
					releaseDate, _ = tmdbObj["first_air_date"].(string)
				}
				resultJson := fmt.Sprintf(`{"id":%d,"title":%q,"poster_path":%q,"release_date":%q,"media_type":%q}`,
					int(idVal), title, posterPath, releaseDate, mediaType)
				db.UpsertTmdbCache(cacheKey, resultJson)
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
	resp, err := http.Get(searchUrl)
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
	detailsResp, err := http.Get(detailsUrl)
	if err != nil || detailsResp.StatusCode != 200 {
		logger.Warn("TMDb details fetch failed: %v", err)
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
					seasonResp, err := http.Get(seasonUrl)
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