package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

var (
	errMissingID = errors.New("missing id")
	errInvalidID = errors.New("invalid id")
)

func getPathSegments(r *http.Request, prefix string) []string {
	prefix = strings.TrimRight(prefix, "/")
	if !strings.HasPrefix(r.URL.Path, prefix) {
		return nil
	}
	path := strings.TrimPrefix(r.URL.Path, prefix)
	path = strings.TrimPrefix(path, "/")
	if path == "" {
		return nil
	}
	return strings.Split(path, "/")
}

func getIDParamOrPath(r *http.Request, prefix string) (int, error) {
	idParam := strings.TrimSpace(r.URL.Query().Get("id"))
	if idParam == "" {
		parts := getPathSegments(r, prefix)
		if len(parts) == 0 || parts[0] == "" {
			return 0, errMissingID
		}
		idParam = parts[0]
	}
	id, err := strconv.Atoi(idParam)
	if err != nil {
		return 0, errInvalidID
	}
	return id, nil
}
