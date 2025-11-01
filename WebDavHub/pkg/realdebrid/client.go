package realdebrid

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
	cmap "github.com/orcaman/concurrent-map/v2"
)

type contextKey string

const filenameContextKey contextKey = "filename"

// DownloadCacheEntry represents a cached download link with expiration
type DownloadCacheEntry struct {
	Download  *DownloadLink
	Generated time.Time
}

// FailedUnrestrictEntry represents a failed unrestriction attempt
type FailedUnrestrictEntry struct {
	Error     string
	ErrorCode int
	Timestamp time.Time
}

// Client represents a Real-Debrid API client
type Client struct {
	apiKey     string
	tokenManager *TokenManager
	baseURL    string
	webdavURL  string
	httpClient *http.Client
	unrestrictCache cmap.ConcurrentMap[string, *DownloadCacheEntry]
	failedUnrestrictCache cmap.ConcurrentMap[string, *FailedUnrestrictEntry]
	cacheMutex      sync.RWMutex
    limiter         *rateLimiter
}

// UserInfo represents Real-Debrid user information
type UserInfo struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Points   int    `json:"points"`
	Type     string `json:"type"`
	Expiration string `json:"expiration"`
}

// DownloadLink represents a download link response
type DownloadLink struct {
	ID      string `json:"id"`
	Filename string `json:"filename"`
	MimeType string `json:"mimeType"`
	Filesize int64  `json:"filesize"`
	Link    string `json:"link"`
	Host    string `json:"host"`
	Chunks  int    `json:"chunks"`
	CRC     int    `json:"crc"`
	Download string `json:"download"`
	Stream  string `json:"stream"`
}

// DownloadItem represents a single item from RD downloads
type DownloadItem struct {
    ID        string `json:"id"`
    Filename  string `json:"filename"`
    Filesize  int64  `json:"filesize"`
    Host      string `json:"host"`
    Status    string `json:"status"`
    Download  string `json:"download"`
    Link      string `json:"link"`
    Created   string `json:"created"`
}

// TorrentItem represents a torrent from RD
type TorrentItem struct {
    ID       string `json:"id"`
    Filename string `json:"filename"`
    Bytes    int64  `json:"bytes"`
    Files    int    `json:"files"`
    Added    string `json:"added"`
    Status   string `json:"status"`
}

// TrafficInfo represents current traffic information
type TrafficInfo struct {
    TodayBytes int64 `json:"today_bytes"`
}

// TrafficDetailResponse represents the structure
type TrafficDetailResponse struct {
    Bytes int64 `json:"bytes"`
}

// TrafficDetailsMap represents the full traffic details response
type TrafficDetailsMap map[string]TrafficDetailResponse

// ErrorResponse represents an error response from Real-Debrid API
type ErrorResponse struct {
	Error   string `json:"error"`
	ErrorCode int  `json:"error_code"`
}

var (
	globalClient *Client
	clientMutex  sync.RWMutex
	clientOnce   sync.Once
)

// GetOrCreateClient returns the global client instance or creates one
func GetOrCreateClient() *Client {
	clientMutex.RLock()
	if globalClient != nil {
		clientMutex.RUnlock()
		return globalClient
	}
	clientMutex.RUnlock()

	clientMutex.Lock()
	defer clientMutex.Unlock()

	if globalClient != nil {
		return globalClient
	}

	cfg := GetConfigManager().GetConfig()
	if cfg.APIKey == "" {
		return nil
	}

	globalClient = NewClient(cfg.APIKey)
	return globalClient
}

// ResetGlobalClient resets the global client
func ResetGlobalClient() {
	clientMutex.Lock()
	defer clientMutex.Unlock()
	globalClient = nil
}

// NewClient creates a new Real-Debrid client
func NewClient(apiKey string) *Client {
	cfg := GetConfigManager().GetConfig()
	tokens := []string{apiKey}
	tokens = append(tokens, cfg.AdditionalAPIKeys...)
	
    client := &Client{
		apiKey:    apiKey,
		tokenManager: NewTokenManager(tokens),
		baseURL:   "https://api.real-debrid.com/rest/1.0",
		webdavURL: "https://webdav.debrid.it",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		unrestrictCache: cmap.New[*DownloadCacheEntry](),
		failedUnrestrictCache: cmap.New[*FailedUnrestrictEntry](),
	}

	// Start background jobs for token management
	client.StartResetBandwidthJob()
	client.StartTokenRecoveryJob()

	return client
}

// rateLimiter implements a token bucket with retry/backoff helpers
type rateLimiter struct {
    mu sync.Mutex
    capacity int
    tokens float64
    refillRatePerSec float64
    last time.Time
    burst int
    maxRetries int
    baseBackoff time.Duration
    maxBackoff time.Duration
}

func newRateLimiterFromConfig() *rateLimiter {
    cfg := GetConfigManager().GetConfig()
    rl := cfg.RateLimit
    if rl.RequestsPerMinute <= 0 {
        rl.RequestsPerMinute = 220
    }
    if rl.Burst < 0 { rl.Burst = 0 }
    if rl.MaxRetries < 0 { rl.MaxRetries = 0 }
    if rl.BaseBackoffMs <= 0 { rl.BaseBackoffMs = 500 }
    if rl.MaxBackoffMs <= 0 { rl.MaxBackoffMs = 8000 }
    r := &rateLimiter{
        capacity: rl.Burst + 1,
        tokens: float64(rl.Burst + 1),
        refillRatePerSec: float64(rl.RequestsPerMinute) / 60.0,
        last: time.Now(),
        burst: rl.Burst,
        maxRetries: rl.MaxRetries,
        baseBackoff: time.Duration(rl.BaseBackoffMs) * time.Millisecond,
        maxBackoff: time.Duration(rl.MaxBackoffMs) * time.Millisecond,
    }
    return r
}

func (r *rateLimiter) waitToken(ctxDone <-chan struct{}) bool {
    if r == nil {
        return true
    }
    for {
        r.mu.Lock()
        now := time.Now()
        elapsed := now.Sub(r.last).Seconds()
        r.last = now
        r.tokens += elapsed * r.refillRatePerSec
        if r.tokens > float64(r.capacity) {
            r.tokens = float64(r.capacity)
        }
        if r.tokens >= 1.0 {
            r.tokens -= 1.0
            r.mu.Unlock()
            return true
        }
        r.mu.Unlock()
        select {
        case <-time.After(50 * time.Millisecond):
        case <-ctxDone:
            return false
        }
    }
}

func (c *Client) ensureLimiter() {
    if c.limiter == nil {
        c.limiter = newRateLimiterFromConfig()
    }
}

func (c *Client) doWithLimit(req *http.Request) (*http.Response, error) {
    c.ensureLimiter()
    attempt := 0

    filename := req.URL.Path
    if ctxFilename, ok := req.Context().Value(filenameContextKey).(string); ok && ctxFilename != "" {
        filename = ctxFilename
    }

    for {
        if ok := c.limiter.waitToken(req.Context().Done()); !ok {
            return nil, fmt.Errorf("request canceled")
        }

        resp, err := c.httpClient.Do(req)
        if err != nil {
            return nil, err
        }

        if resp.StatusCode >= 400 {
            bodyBytes, _ := io.ReadAll(resp.Body)
            resp.Body.Close()
            var errorResp ErrorResponse
            if json.Unmarshal(bodyBytes, &errorResp) == nil && (errorResp.ErrorCode == 36 || errorResp.ErrorCode == 34) {
                backoff := time.Duration(1<<uint(attempt)) * time.Second
                if backoff > 60*time.Second {
                    backoff = 60 * time.Second
                }
                backoff += time.Duration(rand.Float64() * float64(backoff) * 0.2)
                if errorResp.ErrorCode == 34 {
                    logger.Info("[RealDebrid] Rate limit (too_many_requests) for '%s', retrying in %v (attempt %d)", filename, backoff, attempt+1)
                } else {
                    logger.Info("[RealDebrid] Fair usage limit reached for '%s', retrying in %v (attempt %d)", filename, backoff, attempt+1)
                }
                time.Sleep(backoff)
                attempt++
                continue
            }
            resp.Body = io.NopCloser(bytes.NewReader(bodyBytes))
        }

        if resp.StatusCode != http.StatusTooManyRequests {
            if attempt > 0 && resp.StatusCode < 400 {
                logger.Info("[RealDebrid] Request for '%s' succeeded after %d attempts", filename, attempt+1)
            }
            return resp, nil
        }

        if attempt >= c.limiter.maxRetries {
            return nil, fmt.Errorf("rate limited (429) for %s after %d retries", filename, attempt)
        }

        resp.Body.Close()
        backoff := c.limiter.baseBackoff * time.Duration(1<<uint(attempt))
        if backoff > c.limiter.maxBackoff {
            backoff = c.limiter.maxBackoff
        }
        time.Sleep(backoff)
        attempt++
    }
}

// SetAPIKey updates the API key
func (c *Client) SetAPIKey(apiKey string) {
	c.apiKey = apiKey
    c.limiter = nil
}

// GetUserInfo retrieves user information from Real-Debrid
func (c *Client) GetUserInfo() (*UserInfo, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	req, err := http.NewRequest("GET", c.baseURL+"/user", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		var errorResp ErrorResponse
		if err := json.Unmarshal(body, &errorResp); err == nil {
			return nil, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
		}
		return nil, fmt.Errorf("API request failed with status %d", resp.StatusCode)
	}

	var userInfo UserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &userInfo, nil
}

// TestConnection tests the connection to Real-Debrid API
func (c *Client) TestConnection() error {
	_, err := c.GetUserInfo()
	return err
}

// GetWebDAVURL returns the WebDAV URL for Real-Debrid
func (c *Client) GetWebDAVURL() string {
	return c.webdavURL
}

// GetWebDAVCredentials returns the WebDAV credentials
func (c *Client) GetWebDAVCredentials() (username, password string) {
	return c.apiKey, "eeeeee" // Real-Debrid uses API key as username and placeholder password
}

// UnrestrictLink converts a restricted link to a direct download link
func (c *Client) UnrestrictLink(link string, filename ...string) (*DownloadLink, error) {
	if link == "" {
		return nil, fmt.Errorf("link parameter is empty")
	}

	processedLink := link
	if strings.HasPrefix(link, "https://real-debrid.com/d/") && len(link) > 39 {
		processedLink = link[0:39]
	}

	// Check cache first
	if failedEntry, exists := c.failedUnrestrictCache.Get(processedLink); exists {
		cacheDuration := getErrorCacheDuration(failedEntry.ErrorCode)
		if time.Since(failedEntry.Timestamp) < cacheDuration {
			return nil, fmt.Errorf("API error: %s (code: %d)", failedEntry.Error, failedEntry.ErrorCode)
		}
		c.failedUnrestrictCache.Remove(processedLink)
	}

	token, err := c.tokenManager.GetCurrentToken()
	if err != nil {
		return nil, fmt.Errorf("no available tokens: %w", err)
	}

	if cached, exists := c.unrestrictCache.Get(processedLink); exists {
		if time.Since(cached.Generated) < 24*time.Hour {
			return cached.Download, nil
		}
		c.unrestrictCache.Remove(processedLink)
	}

	payload := fmt.Sprintf("link=%s", processedLink)

	ctx := context.Background()
	if len(filename) > 0 && filename[0] != "" {
		ctx = context.WithValue(ctx, filenameContextKey, filename[0])
	}
	
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/unrestrict/link", strings.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.doWithLimit(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		var errorResp ErrorResponse
		if err := json.Unmarshal(body, &errorResp); err == nil {
			if isCacheableError(errorResp.ErrorCode) {
				c.failedUnrestrictCache.Set(processedLink, &FailedUnrestrictEntry{
					Error:     errorResp.Error,
					ErrorCode: errorResp.ErrorCode,
					Timestamp: time.Now(),
				})
			}
			return nil, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
		}
		return nil, fmt.Errorf("API request failed with status %d", resp.StatusCode)
	}

	var downloadLink DownloadLink
	if err := json.NewDecoder(resp.Body).Decode(&downloadLink); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	c.unrestrictCache.Set(processedLink, &DownloadCacheEntry{
		Download:  &downloadLink,
		Generated: time.Now(),
	})

	return &downloadLink, nil
}

// isCacheableError determines if an error code should be cached to prevent retries
func isCacheableError(errorCode int) bool {
	cacheableErrors := map[int]bool{
		19: true, // hoster_unavailable
		21: true, // unavailable_file
		23: true, // traffic_exhausted (bandwidth limit)
		27: true, // permission_denied
		28: true, // hoster_not_supported
		34: true, // too_many_requests (rate limit)
	}
	return cacheableErrors[errorCode]
}

// getErrorCacheDuration returns how long to cache specific error codes
func getErrorCacheDuration(errorCode int) time.Duration {
	switch errorCode {
	case 23: // traffic_exhausted - bandwidth limit (resets at midnight)
		return 30 * time.Minute
	case 19: // hoster_unavailable - temporary hoster issue
		return 15 * time.Minute
	case 34: // too_many_requests - rate limit
		return 10 * time.Minute
	case 21: // unavailable_file - file removed/unavailable
		return 1 * time.Hour
	case 27: // permission_denied - permanent
		return 1 * time.Hour
	case 28: // hoster_not_supported - permanent
		return 1 * time.Hour
	default:
		return 1 * time.Hour
	}
}


// GetDownloads retrieves the user's downloads list
func (c *Client) GetDownloads() ([]DownloadItem, error) {
    if c.apiKey == "" {
        return nil, fmt.Errorf("API key not set")
    }

    req, err := http.NewRequest("GET", c.baseURL+"/downloads", nil)
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }
    req.Header.Set("Authorization", "Bearer "+c.apiKey)
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.doWithLimit(req)
    if err != nil {
        return nil, fmt.Errorf("failed to make request: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        var errorResp ErrorResponse
        if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Error != "" {
            return nil, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
        }
        return nil, fmt.Errorf("API request failed with status %d", resp.StatusCode)
    }

    var items []DownloadItem
    if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    return items, nil
}

// GetDownloadsBatch attempts to fetch a specific window using common pagination params
func (c *Client) GetDownloadsBatch(limit, offset int) ([]DownloadItem, error) {
    if c.apiKey == "" {
        return nil, fmt.Errorf("API key not set")
    }

    if limit <= 0 { limit = 1000 }
    if offset < 0 { offset = 0 }

    url := fmt.Sprintf("%s/downloads?limit=%d&offset=%d", c.baseURL, limit, offset)
    req, err := http.NewRequest("GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }
    req.Header.Set("Authorization", "Bearer "+c.apiKey)
    req.Header.Set("Content-Type", "application/json")

    resp, err := c.doWithLimit(req)
    if err != nil {
        return nil, fmt.Errorf("failed to make request: %w", err)
    }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        var errorResp ErrorResponse
        if err := json.Unmarshal(body, &errorResp); err == nil && errorResp.Error != "" {
            return nil, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
        }
        return nil, fmt.Errorf("API request failed with status %d", resp.StatusCode)
    }

    var items []DownloadItem
    if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    return items, nil
}

// GetAllDownloads fetches all downloads in batches, using limit/offset pagination when supported
func (c *Client) GetAllDownloads(limitPerPage int) ([]DownloadItem, error) {
    if limitPerPage <= 0 { limitPerPage = 1000 }
    var all []DownloadItem
    offset := 0
    for {
        items, err := c.GetDownloadsBatch(limitPerPage, offset)
        if err != nil {
            // Fallback: if pagination not supported, return the default window
            if offset == 0 {
                return c.GetDownloads()
            }
            return all, nil
        }
        if len(items) == 0 {
            break
        }
        all = append(all, items...)
        if len(items) < limitPerPage {
            break
        }
        offset += limitPerPage
        if offset > 5_000_000 {
            break
        }
    }
    return all, nil
}


// GetTorrentsBatch tries common pagination patterns for torrents
func (c *Client) GetTorrentsBatch(limit, offset int) ([]TorrentItem, error) {
    if c.apiKey == "" {
        return nil, fmt.Errorf("API key not set")
    }
    if limit <= 0 { limit = 1000 }
    if offset < 0 { offset = 0 }

    url := fmt.Sprintf("%s/torrents?limit=%d&offset=%d", c.baseURL, limit, offset)
    req, err := http.NewRequest("GET", url, nil)
    if err != nil {
        return nil, fmt.Errorf("failed to create request: %w", err)
    }
    req.Header.Set("Authorization", "Bearer "+c.apiKey)
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.doWithLimit(req)
    if err != nil {
        return nil, fmt.Errorf("failed to make request: %w", err)
    }
    defer resp.Body.Close()
    if resp.StatusCode != http.StatusOK {
        body, _ := io.ReadAll(resp.Body)
        var er ErrorResponse
        _ = json.Unmarshal(body, &er)
        return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
    }
    var items []TorrentItem
    if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
        return nil, fmt.Errorf("failed to decode response: %w", err)
    }
    return items, nil
}

// GetAllTorrents fetches all torrents in batches
func (c *Client) GetAllTorrents(limitPerPage int, progressCallback func(int, int)) ([]TorrentItem, error) {
    if limitPerPage <= 0 { limitPerPage = 1000 }
    all := make([]TorrentItem, 0, limitPerPage)
    seen := make(map[string]struct{})

    // Strategy 1: limit/offset
    offset := 0
    for i := 0; i < 10000; i++ {
        items, err := c.GetTorrentsBatch(limitPerPage, offset)
        if err != nil {
            break
        }
        if len(items) == 0 {
            return all, nil
        }
        added := 0
        for _, it := range items {
            if _, ok := seen[it.ID]; ok {
                continue
            }
            seen[it.ID] = struct{}{}
            all = append(all, it)
            added++
        }

        if progressCallback != nil {
            progressCallback(len(all), len(all))
        }
        
        if len(items) < limitPerPage || added == 0 {
            return all, nil
        }
        offset += limitPerPage
        if offset > 10_000_000 {
            return all, nil
        }
    }

    // Strategy 2: page param
    page := 1
    for i := 0; i < 100000; i++ {
        url := fmt.Sprintf("%s/torrents?limit=%d&page=%d", c.baseURL, limitPerPage, page)
        req, err := http.NewRequest("GET", url, nil)
        if err != nil { break }
        req.Header.Set("Authorization", "Bearer "+c.apiKey)
        req.Header.Set("Content-Type", "application/json")
    resp, err := c.doWithLimit(req)
        if err != nil { break }
        if resp.StatusCode != http.StatusOK {
            resp.Body.Close()
            break
        }
        var items []TorrentItem
        if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
            resp.Body.Close()
            break
        }
        resp.Body.Close()
        if len(items) == 0 { break }
        added := 0
        for _, it := range items {
            if _, ok := seen[it.ID]; ok { continue }
            seen[it.ID] = struct{}{}
            all = append(all, it)
            added++
        }
        if len(items) < limitPerPage || added == 0 { break }
        page++
    }

    return all, nil
}

// TorrentFile represents a file within a torrent
type TorrentFile struct {
	ID       int    `json:"id"`
	Path     string `json:"path"`
	Bytes    int64  `json:"bytes"`
	Selected int    `json:"selected"`
}

// TorrentInfo represents detailed information about a torrent
type TorrentInfo struct {
	ID           string         `json:"id"`
	Filename     string         `json:"filename"`
	OriginalFilename string     `json:"original_filename,omitempty"`
	Hash         string         `json:"hash"`
	Bytes        int64          `json:"bytes"`
	OriginalBytes int64         `json:"original_bytes,omitempty"`
	Host         string         `json:"host"`
	Split        int            `json:"split"`
	Progress     float64        `json:"progress"`
	Status       string         `json:"status"`
	Added        string         `json:"added"`
	Files        []TorrentFile  `json:"files"`
	Links        []string       `json:"links"`
	Ended        string         `json:"ended,omitempty"`
	Speed        int64          `json:"speed,omitempty"`
	Seeders      int            `json:"seeders,omitempty"`
}

// GetTorrentInfo retrieves detailed information about a specific torrent
func (c *Client) GetTorrentInfo(torrentID string) (*TorrentInfo, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	req, err := http.NewRequest("GET", c.baseURL+"/torrents/info/"+torrentID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

    resp, err := c.doWithLimit(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned %d: %s", resp.StatusCode, string(body))
	}

	var info TorrentInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &info, nil
}

// IsValidAPIKey checks if the provided API key is valid
func (c *Client) IsValidAPIKey(apiKey string) bool {
	if apiKey == "" {
		return false
	}

	originalKey := c.apiKey
	c.apiKey = apiKey
	defer func() { c.apiKey = originalKey }()

	_, err := c.GetUserInfo()
	return err == nil
}

// GetAPIKeyStatus returns the status of the current API key
func (c *Client) GetAPIKeyStatus() map[string]interface{} {
	if c.apiKey == "" {
		return map[string]interface{}{
			"valid": false,
			"error": "No API key configured",
		}
	}

	userInfo, err := c.GetUserInfo()
	if err != nil {
		return map[string]interface{}{
			"valid": false,
			"error": err.Error(),
		}
	}

	return map[string]interface{}{
		"valid":      true,
		"username":   userInfo.Username,
		"email":      userInfo.Email,
		"points":     userInfo.Points,
		"type":       userInfo.Type,
		"expiration": userInfo.Expiration,
	}
}

// ClearUnrestrictCache clears all cached unrestricted links
func (c *Client) ClearUnrestrictCache() {
	c.unrestrictCache.Clear()
}

// GetUnrestrictCacheSize returns the number of cached unrestricted links
func (c *Client) GetUnrestrictCacheSize() int {
	return c.unrestrictCache.Count()
}

// CleanupExpiredCacheEntries removes expired cache entries
func (c *Client) CleanupExpiredCacheEntries() {
	now := time.Now()
	for item := range c.unrestrictCache.IterBuffered() {
		if now.Sub(item.Val.Generated) >= 24*time.Hour {
			c.unrestrictCache.Remove(item.Key)
		}
	}
}

// GetTrafficInfo retrieves current traffic information
func (c *Client) GetTrafficInfo() (*TrafficInfo, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	req, err := http.NewRequest("GET", c.baseURL+"/traffic/details", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		var errorResp ErrorResponse
		if err := json.Unmarshal(body, &errorResp); err == nil {
			return nil, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
		}
		return nil, fmt.Errorf("API request failed with status %d", resp.StatusCode)
	}

	var detailsMap TrafficDetailsMap
	if err := json.NewDecoder(resp.Body).Decode(&detailsMap); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	info := &TrafficInfo{
		TodayBytes: 0,
	}

	today := time.Now().Format("2006-01-02")
	if todayDetail, exists := detailsMap[today]; exists {
		info.TodayBytes = todayDetail.Bytes
	}

	return info, nil
}

// GetTorrentsLightweight retrieves torrents for checking
func (c *Client) GetTorrentsLightweight(limit int) ([]TorrentItem, int, error) {
	if c.apiKey == "" {
		return nil, 0, fmt.Errorf("API key not set")
	}
	
	if limit <= 0 {
		limit = 1
	}
	
	url := fmt.Sprintf("%s/torrents?limit=%d", c.baseURL, limit)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to create request: %w", err)
	}
	
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()
	
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		var errorResp ErrorResponse
		if err := json.Unmarshal(body, &errorResp); err == nil {
			return nil, 0, fmt.Errorf("API error: %s (code: %d)", errorResp.Error, errorResp.ErrorCode)
		}
		return nil, 0, fmt.Errorf("API request failed with status %d", resp.StatusCode)
	}

	totalCount := 0
	if totalHeader := resp.Header.Get("X-Total-Count"); totalHeader != "" {
		if count, err := strconv.Atoi(totalHeader); err == nil {
			totalCount = count
		}
	}
	
	var items []TorrentItem
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		return nil, 0, fmt.Errorf("failed to decode response: %w", err)
	}

	if totalCount == 0 {
		totalCount = len(items)
	}
	
	return items, totalCount, nil
}