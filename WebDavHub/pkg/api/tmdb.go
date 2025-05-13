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
)

var tmdbRateLimit = 40
var tmdbRateWindow = time.Minute
var tmdbRateMap = make(map[string][]time.Time)
var tmdbRateMu sync.Mutex

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