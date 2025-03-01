package webdav

import (
	"net/http"
	"strings"

	"golang.org/x/net/webdav"
	"cinesync/pkg/logger"
)

// NewHandler creates a new WebDAV handler for the given directory
func NewHandler(rootDir string) *webdav.Handler {
	return &webdav.Handler{
		Prefix:     "/",
		FileSystem: webdav.Dir(rootDir),
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if err != nil {
				logger.Error("WebDAV %s %s ERROR: %v", r.Method, r.URL.Path, err)
			} else {
				logger.Info("WebDAV %s %s", r.Method, r.URL.Path)
			}
		},
	}
}

// IsWebDAVUserAgent checks if the user agent is from a WebDAV client
func IsWebDAVUserAgent(userAgent string) bool {
	webDAVClients := []string{
		"Microsoft-WebDAV",
		"DavClnt",
		"WebDAVFS",
		"WebDAVLib",
		"cadaver",
		"Cyberduck",
		"davfs2",
		"GoodReader",
		"NetDrive",
		"OwnCloud",
		"NextCloud",
		"rclone",
	}

	userAgent = strings.ToLower(userAgent)
	for _, client := range webDAVClients {
		if strings.Contains(userAgent, strings.ToLower(client)) {
			return true
		}
	}

	return false
}
