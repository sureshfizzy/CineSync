package realdebrid

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client represents a Real-Debrid API client
type Client struct {
	apiKey     string
	baseURL    string
	webdavURL  string
	httpClient *http.Client
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

// ErrorResponse represents an error response from Real-Debrid API
type ErrorResponse struct {
	Error   string `json:"error"`
	ErrorCode int  `json:"error_code"`
}

// NewClient creates a new Real-Debrid client
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:    apiKey,
		baseURL:   "https://api.real-debrid.com/rest/1.0",
		webdavURL: "https://webdav.debrid.it",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SetAPIKey updates the API key
func (c *Client) SetAPIKey(apiKey string) {
	c.apiKey = apiKey
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
func (c *Client) UnrestrictLink(link string) (*DownloadLink, error) {
	if c.apiKey == "" {
		return nil, fmt.Errorf("API key not set")
	}

	payload := map[string]string{
		"link": link,
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+"/unrestrict/link", bytes.NewBuffer(jsonData))
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

	var downloadLink DownloadLink
	if err := json.NewDecoder(resp.Body).Decode(&downloadLink); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &downloadLink, nil
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

    resp, err := c.httpClient.Do(req)
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

    resp, err := c.httpClient.Do(req)
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
    resp, err := c.httpClient.Do(req)
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
        resp, err := c.httpClient.Do(req)
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

	resp, err := c.httpClient.Do(req)
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