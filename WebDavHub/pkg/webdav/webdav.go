package webdav

import (
	"log"
	"net/http"

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
			Prefix:     "/",
			FileSystem: webdav.Dir(dir),
			LockSystem: webdav.NewMemLS(),
			Logger: func(r *http.Request, err error) {
				if err != nil {
					log.Printf("%s %s ERROR: %v", r.Method, r.URL.Path, err)
				} else {
					log.Printf("%s %s", r.Method, r.URL.Path)
				}
			},
		},
	}
}

// ServeHTTP handles HTTP requests for WebDAV
func (h *WebDAVHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.handler.ServeHTTP(w, r)
}
