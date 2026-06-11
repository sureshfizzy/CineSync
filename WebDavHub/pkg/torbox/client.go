package torbox

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/logger"
)

type Client struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{
		apiKey:  apiKey,
		baseURL: "https://api.torbox.app/v1/api",
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

type apiEnvelope[T any] struct {
	Success bool `json:"success"`
	Data    T    `json:"data"`
	Error   any  `json:"error,omitempty"`
	Message any  `json:"message,omitempty"`
}

type TorrentFile struct {
	ID        int    `json:"id"`
	ShortName string `json:"short_name"`
	Size      int64  `json:"size"`
	MimeType  string `json:"mimetype"`
	Name      string `json:"name"`
}

type TorrentItem struct {
	ID     int           `json:"id"`
	Name   string        `json:"name"`
	Hash   string        `json:"hash"`
	Status string        `json:"status"`
	Cached bool          `json:"cached"`
	Files  []TorrentFile `json:"files"`
	Size   int64         `json:"size,omitempty"`
	Added  string        `json:"added_at,omitempty"`
}

func (c *Client) do(req *http.Request) (*http.Response, []byte, error) {
	if c.apiKey == "" {
		return nil, nil, fmt.Errorf("API key not set")
	}

	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "CineSync/1.0 TorBox/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp, body, fmt.Errorf("read TorBox response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp, body, fmt.Errorf("TorBox API HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return resp, body, nil
}

func (c *Client) GetTorrentList(limit, offset int, bypassCache bool, id *int) ([]TorrentItem, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("limit must be positive")
	}
	if offset < 0 {
		return nil, fmt.Errorf("offset must be non-negative")
	}

	u, err := url.Parse(c.baseURL + "/torrents/mylist")
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", strconv.Itoa(offset))
	if bypassCache {
		q.Set("bypass_cache", "true")
	}
	if id != nil {
		q.Set("id", strconv.Itoa(*id))
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return nil, err
	}

	_, body, err := c.do(req)
	if err != nil {
		return nil, err
	}

	if id != nil {
		var env apiEnvelope[TorrentItem]
		if err := json.Unmarshal(body, &env); err != nil {
			return nil, fmt.Errorf("decode TorBox mylist (single): %w", err)
		}
		if !env.Success {
			return nil, fmt.Errorf("TorBox mylist: %s", strings.TrimSpace(string(body)))
		}
		if env.Data.ID == 0 {
			return nil, fmt.Errorf("TorBox mylist: empty torrent in response")
		}
		return []TorrentItem{env.Data}, nil
	}

	var env apiEnvelope[[]TorrentItem]
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("decode TorBox mylist (list): %w", err)
	}
	if !env.Success {
		return nil, fmt.Errorf("TorBox mylist: %s", strings.TrimSpace(string(body)))
	}
	if env.Data == nil {
		return nil, fmt.Errorf("TorBox mylist: missing data array")
	}
	return env.Data, nil
}

func (c *Client) GetAPIKeyStatus() map[string]interface{} {
	out := map[string]interface{}{
		"valid": false,
	}
	_, err := c.GetTorrentList(1, 0, false, nil)
	if err != nil {
		out["error"] = err.Error()
		return out
	}
	out["valid"] = true
	return out
}

func (c *Client) ControlTorrent(torrentID int, operation string) error {
	if torrentID <= 0 {
		return fmt.Errorf("invalid torrent id")
	}
	op := strings.ToLower(strings.TrimSpace(operation))
	if op == "" {
		return fmt.Errorf("operation is required")
	}

	body := map[string]any{
		"torrent_id": torrentID,
		"operation":  op,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", c.baseURL+"/torrents/controltorrent", bytes.NewReader(raw))
	if err != nil {
		return err
	}

	_, respBody, err := c.do(req)
	if err != nil {
		return err
	}
	if len(respBody) == 0 {
		return fmt.Errorf("TorBox controltorrent: empty response body")
	}

	var env struct {
		Success bool `json:"success"`
	}
	if err := json.Unmarshal(respBody, &env); err != nil {
		return fmt.Errorf("TorBox controltorrent: %w", err)
	}
	if !env.Success {
		return fmt.Errorf("TorBox controltorrent: %s", strings.TrimSpace(string(respBody)))
	}
	return nil
}

func (c *Client) DeleteTorrent(torrentID int) error {
	return c.ControlTorrent(torrentID, "delete")
}

func (c *Client) MakeRequestDLPermalink(torrentID int, fileID int) string {
	q := url.Values{}
	q.Set("token", c.apiKey)
	q.Set("torrent_id", strconv.Itoa(torrentID))
	q.Set("file_id", strconv.Itoa(fileID))
	q.Set("redirect", "true")
	return c.baseURL + "/torrents/requestdl?" + q.Encode()
}

func (c *Client) RequestDownloadLink(torrentID int, fileID int) (string, error) {
	if torrentID <= 0 {
		return "", fmt.Errorf("invalid torrent id")
	}
	if fileID < 0 {
		return "", fmt.Errorf("invalid file id")
	}

	u, err := url.Parse(c.baseURL + "/torrents/requestdl")
	if err != nil {
		return "", fmt.Errorf("requestdl url: %w", err)
	}
	q := u.Query()
	q.Set("token", c.apiKey)
	q.Set("torrent_id", strconv.Itoa(torrentID))
	q.Set("file_id", strconv.Itoa(fileID))
	u.RawQuery = q.Encode()

	req, err := http.NewRequest("GET", u.String(), nil)
	if err != nil {
		return "", err
	}
	_, body, err := c.do(req)
	if err != nil {
		return "", err
	}

	var env apiEnvelope[string]
	if err := json.Unmarshal(body, &env); err != nil {
		return "", fmt.Errorf("decode TorBox requestdl: %w", err)
	}
	if !env.Success || strings.TrimSpace(env.Data) == "" {
		return "", fmt.Errorf("TorBox requestdl: %s", strings.TrimSpace(string(body)))
	}
	return env.Data, nil
}

func (c *Client) LogDebug(format string, args ...any) {
	logger.Debug("[TorBox] "+format, args...)
}
