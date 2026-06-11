package plexkeepalive

import (
	"context"
	"io"
	"net/http"
	"strings"
	"time"

	"cinesync/pkg/config"
	"cinesync/pkg/env"
	"cinesync/pkg/logger"
)

const (
	pingURL      = "https://plex.tv/api/v2/ping"
	pingInterval = 24 * time.Hour
	initialDelay = time.Minute
)

var (
	client   = &http.Client{Timeout: 15 * time.Second}
	clientID string
)

// Start runs a daily keepalive ping in the background until ctx is cancelled.
func Start(ctx context.Context) {
	go func() {
		timer := time.NewTimer(initialDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				ping()
				timer.Reset(pingInterval)
			}
		}
	}()
}

// ping performs one keepalive request, or nothing if no token is configured yet.
func ping() {
	token := env.GetString("PLEX_TOKEN", "")
	if !tokenConfigured(token) {
		return
	}

	if clientID == "" {
		id, err := config.GetOrCreatePlexClientIdentifier()
		if err != nil {
			logger.Warn("Plex keepalive: could not obtain client identifier: %v", err)
		}
		clientID = id
	}

	req, err := http.NewRequest(http.MethodGet, pingURL, nil)
	if err != nil {
		logger.Error("Plex keepalive: failed to build request: %v", err)
		return
	}
	req.Header.Set("X-Plex-Token", strings.TrimSpace(token))
	req.Header.Set("X-Plex-Client-Identifier", clientID)
	req.Header.Set("X-Plex-Product", "CineSync")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		logger.Warn("Plex keepalive: ping to plex.tv failed: %v", err)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	switch resp.StatusCode {
	case http.StatusOK:
		logger.Debug("Plex keepalive: token refreshed via plex.tv ping")
	case http.StatusUnauthorized:
		logger.Warn("Plex keepalive: plex.tv returned 401 - PLEX_TOKEN is invalid or already removed from authorized devices")
	default:
		logger.Warn("Plex keepalive: unexpected response from plex.tv ping: HTTP %d", resp.StatusCode)
	}
}

func tokenConfigured(token string) bool {
	switch strings.ToLower(strings.TrimSpace(token)) {
	case "", "none", "null", "placeholder":
		return false
	}
	return true
}
