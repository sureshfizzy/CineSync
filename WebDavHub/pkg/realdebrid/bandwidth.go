package realdebrid

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"cinesync/pkg/logger"
)

// DownloadError represents an error from Real-Debrid's download servers
type DownloadError struct {
	Message string
	Code    int
}

func (e *DownloadError) Error() string {
	return fmt.Sprintf("download error: %s (code: %d)", e.Message, e.Code)
}

// IsBytesLimitReached checks if the error is a bandwidth limit error
func IsBytesLimitReached(err error) bool {
	if dlErr, ok := err.(*DownloadError); ok && dlErr.Message == "bytes_limit_reached" {
		return true
	}
	return false
}

// CheckDownloadResponse checks the response from a download server for errors
func CheckDownloadResponse(resp *http.Response) error {
	if resp == nil {
		return nil
	}

	if resp.StatusCode >= http.StatusBadRequest {
		if strings.Contains(resp.Request.Host, ".download.real-debrid.") {
			xError := resp.Header.Get("X-Error")
			if xError != "" {
				return &DownloadError{
					Message: xError,
					Code:    resp.StatusCode,
				}
			}
		}
	}

	return nil
}

// HandleBandwidthLimit handles bandwidth limit errors by marking the token as expired
func (c *Client) HandleBandwidthLimit(token string, err error) {
	if IsBytesLimitReached(err) {
		if tokenErr := c.tokenManager.SetTokenAsExpired(token, "bandwidth limit exceeded"); tokenErr != nil {
			logger.Error("Failed to set token as expired: %v", tokenErr)
		}
		logger.Warn("Token bandwidth limit reached. Rotating to next available token.")
	}
}

// DownloadFile downloads a file from Real-Debrid and handles bandwidth limits
func (c *Client) DownloadFile(ctx context.Context, downloadURL string, token string) (io.ReadCloser, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", downloadURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create download request: %w", err)
	}

	// Add Range header if present in context
	if rangeHeader, ok := ctx.Value("Range").(string); ok {
		req.Header.Set("Range", rangeHeader)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to download file: %w", err)
	}

	// Check for download errors including bandwidth limits
	if dlErr := CheckDownloadResponse(resp); dlErr != nil {
		resp.Body.Close()
		c.HandleBandwidthLimit(token, dlErr)
		return nil, dlErr
	}

	return resp.Body, nil
}

var (
	bandwidthResetJobStarted bool
	tokenRecoveryJobStarted  bool
	jobMutex                 sync.Mutex
)

// StartResetBandwidthJob starts a background job that resets all tokens
func (c *Client) StartResetBandwidthJob() {
	jobMutex.Lock()
	defer jobMutex.Unlock()
	if bandwidthResetJobStarted {
		return
	}
	bandwidthResetJobStarted = true

	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("Panic in bandwidth reset job: %v", r)
				jobMutex.Lock()
				bandwidthResetJobStarted = false
				jobMutex.Unlock()
				time.Sleep(1 * time.Minute)
				c.StartResetBandwidthJob()
			}
		}()

		now := time.Now()
		cetLocation, err := time.LoadLocation("CET")
		if err != nil {
			cetLocation = time.FixedZone("CET", 1*60*60)
		}

		tomorrow := now.Add(24 * time.Hour)
		nextMidnight := time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 0, 5, 0, 0, cetLocation)
		duration := nextMidnight.Sub(now)
		logger.Debug("Bandwidth reset job started. Next reset at 12AM CET (in %v)", duration)

		for {
			now := time.Now()
			tomorrow := now.Add(24 * time.Hour)
			nextMidnight := time.Date(tomorrow.Year(), tomorrow.Month(), tomorrow.Day(), 0, 5, 0, 0, cetLocation)
			duration := nextMidnight.Sub(now)
			
			time.Sleep(duration)

			c.tokenManager.ResetAllTokens()
		}
	}()
}

// StartTokenRecoveryJob monitors expired tokens and checks
func (c *Client) StartTokenRecoveryJob() {
	jobMutex.Lock()
	defer jobMutex.Unlock()

	if tokenRecoveryJobStarted {
		return
	}
	tokenRecoveryJobStarted = true

	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.Error("Panic in token recovery job: %v", r)
				jobMutex.Lock()
				tokenRecoveryJobStarted = false
				jobMutex.Unlock()
				time.Sleep(1 * time.Minute)
				c.StartTokenRecoveryJob()
			}
		}()

		logger.Debug("Token recovery job started. Checking expired tokens every minute.")

		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()

		for range ticker.C {
			expiredTokens := c.tokenManager.GetExpiredTokens()
			if len(expiredTokens) == 0 {
				continue
			}

			for _, token := range expiredTokens {
				verified := false

				keys := c.unrestrictCache.Keys()
				for _, key := range keys {
					cachedEntry, ok := c.unrestrictCache.Get(key)
					if !ok || cachedEntry == nil || cachedEntry.Download == nil {
						continue
					}
					
					// Try to verify the cached download link with HEAD request
					req, err := http.NewRequest("HEAD", cachedEntry.Download.Download, nil)
					if err != nil {
						continue
					}
					
					resp, err := c.httpClient.Do(req)
					if err != nil || resp == nil {
						continue
					}
					resp.Body.Close()

					// Check for bandwidth error
					if dlErr := CheckDownloadResponse(resp); dlErr != nil {
						if IsBytesLimitReached(dlErr) {
							break
						}
					} else {
						verified = true
						break
					}

					break
				}

				if !verified {
					req, err := http.NewRequest("GET", c.baseURL+"/user", nil)
					if err != nil {
						continue
					}

					req.Header.Set("Authorization", "Bearer "+token)
					resp, err := c.httpClient.Do(req)
					
					if err != nil || resp == nil {
						continue
					}
					resp.Body.Close()

					if resp.StatusCode == http.StatusOK {
						verified = true
					}
				}

				if verified {
					if err := c.tokenManager.SetTokenAsUnexpired(token); err != nil {
						logger.Error("Failed to set token as unexpired: %v", err)
					}
					c.unrestrictCache.Clear()
				}
			}
		}
	}()
}

// GetTokenManager returns the token manager for status checks
func (c *Client) GetTokenManager() *TokenManager {
	return c.tokenManager
}

