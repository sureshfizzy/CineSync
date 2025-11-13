package webdav

import (
	"net/http"

	"cinesync/pkg/logger"
	"golang.org/x/net/webdav"

)

// WebDAVHandler handles WebDAV requests
type WebDAVHandler struct {
	handler *webdav.Handler
}

// NewWebDAVHandler creates a new WebDAV handler
func NewWebDAVHandler(dir string) *WebDAVHandler {
	return &WebDAVHandler{
		handler: &webdav.Handler{
			Prefix:     "",
			FileSystem: webdav.Dir(dir),
			LockSystem: webdav.NewMemLS(),
			Logger: func(r *http.Request, err error) {
				if err != nil {
				logger.Error("WebDAV request error: method=%s path=%s err=%v", r.Method, r.URL.Path, err)
				} else {
				logger.Info("WebDAV request: method=%s path=%s", r.Method, r.URL.Path)
				}
			},
		},
	}
}

// ServeHTTP handles HTTP requests for WebDAV
func (h *WebDAVHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
}
