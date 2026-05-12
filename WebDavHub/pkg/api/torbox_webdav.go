package api

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
	"cinesync/pkg/torbox"
)

const torBoxWebDAVRoot = "__all__"

func HandleTorBoxWebDAV(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, PROPFIND, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Depth")
	w.Header().Set("DAV", "1, 2")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	cfg, err := validateTorBoxConfig()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	reqPath := strings.TrimPrefix(r.URL.Path, "/api/torbox/webdav")
	if reqPath == "" {
		reqPath = "/"
	}

	switch r.Method {
	case "PROPFIND":
		handleTorBoxPropfind(w, r, reqPath)
	case "GET", "HEAD":
		handleTorBoxGet(w, r, cfg.APIKey, reqPath)
	case "DELETE":
		handleTorBoxDelete(w, r, cfg.APIKey, reqPath)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTorBoxPropfind(w http.ResponseWriter, r *http.Request, reqPath string) {
	depthHeader := strings.TrimSpace(r.Header.Get("Depth"))
	includeChildren := depthHeader == "" || depthHeader == "1" || depthHeader == "infinity"

	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}

	reqPath = strings.Trim(reqPath, "/")
	parts := []string{}
	if reqPath != "" {
		parts = strings.Split(reqPath, "/")
	}

	buf := realdebrid.GetResponseBuffer()
	defer realdebrid.PutResponseBuffer(buf)

	if len(parts) == 0 {
		buf.WriteString(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">`)
		basePath := "/api/torbox/webdav/"
		realdebrid.DirectoryResponse(buf, basePath, "")
		if includeChildren {
			realdebrid.DirectoryResponse(buf, basePath+torBoxWebDAVRoot+"/", "")
		}
		buf.WriteString(`</d:multistatus>`)
		writeMultistatus(w, buf.Bytes())
		return
	}

	if parts[0] != torBoxWebDAVRoot {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	items, err := torbox.LoadTorrentListFromStore()
	if err != nil {
		logger.Warn("[TorBox WebDAV] load store: %v", err)
		items = nil
	}

	if len(parts) == 1 {
		basePath := "/api/torbox/webdav/" + torBoxWebDAVRoot + "/"
		buf.WriteString(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">`)
		realdebrid.DirectoryResponse(buf, basePath, "")
		if includeChildren {
			seen := make(map[string]struct{}, len(items))
			for _, it := range items {
				name := strings.TrimSpace(it.Name)
				if name == "" {
					name = "torrent-" + strconv.Itoa(it.ID)
				}
				if _, dup := seen[name]; dup {
					continue
				}
				seen[name] = struct{}{}
				realdebrid.DirectoryResponse(buf, basePath+name+"/", it.Added)
			}
		}
		buf.WriteString(`</d:multistatus>`)
		writeMultistatus(w, buf.Bytes())
		return
	}

	torrentName := parts[1]
	item, ok := findTorBoxTorrentByName(items, torrentName)
	if !ok {
		http.Error(w, "Torrent not found", http.StatusNotFound)
		return
	}

	basePath := "/api/torbox/webdav/" + torBoxWebDAVRoot + "/" + torrentName + "/"
	buf.WriteString(`<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">`)
	realdebrid.DirectoryResponse(buf, basePath, item.Added)

	if includeChildren {
		files := item.Files
		if len(files) == 0 {
			if reloaded, err := torbox.LoadTorrentByIDFromStore(item.ID); err == nil && reloaded != nil {
				files = reloaded.Files
			}
		}
		seen := make(map[string]struct{}, len(files))
		for _, f := range files {
			name := strings.TrimSpace(f.Name)
			if name == "" {
				name = strings.TrimSpace(f.ShortName)
			}
			base := path.Base(name)
			if base == "" || base == "." || base == "/" {
				continue
			}
			if _, dup := seen[base]; dup {
				continue
			}
			seen[base] = struct{}{}
			realdebrid.FileResponse(buf, basePath+base, f.Size, item.Added)
		}
	}

	buf.WriteString(`</d:multistatus>`)
	writeMultistatus(w, buf.Bytes())
}

func handleTorBoxGet(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}
	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")
	if len(parts) < 3 || parts[0] != torBoxWebDAVRoot {
		http.Error(w, "Invalid file path", http.StatusBadRequest)
		return
	}

	torrentName := parts[1]
	baseName := path.Base(strings.Join(parts[2:], "/"))

	items, err := torbox.LoadTorrentListFromStore()
	if err != nil {
		http.Error(w, "Torrent store unavailable", http.StatusBadGateway)
		return
	}
	item, ok := findTorBoxTorrentByName(items, torrentName)
	if !ok {
		http.Error(w, "Torrent not found", http.StatusNotFound)
		return
	}

	files := item.Files
	if len(files) == 0 {
		if reloaded, lerr := torbox.LoadTorrentByIDFromStore(item.ID); lerr == nil && reloaded != nil {
			files = reloaded.Files
		}
	}

	var target *torbox.TorrentFile
	for i := range files {
		name := strings.TrimSpace(files[i].Name)
		if name == "" {
			name = strings.TrimSpace(files[i].ShortName)
		}
		if path.Base(name) == baseName {
			target = &files[i]
			break
		}
	}
	if target == nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}

	modTime := time.Now()
	if item.Added != "" {
		if t, perr := time.Parse(time.RFC3339, item.Added); perr == nil {
			modTime = t
		}
	}
	etag := fmt.Sprintf("\"tb-%d-%d-%d-%d\"", item.ID, target.ID, target.Size, modTime.Unix())

	if r.Method == "HEAD" {
		if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Length", strconv.FormatInt(target.Size, 10))
		w.Header().Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusOK)
		return
	}

	client := torbox.NewClient(apiKey)
	downloadURL, err := client.RequestDownloadLink(item.ID, target.ID)
	if err != nil {
		logger.Warn("[TorBox WebDAV] requestdl torrent=%d file=%d: %v", item.ID, target.ID, err)
		http.Error(w, "Failed to resolve download link", http.StatusBadGateway)
		return
	}

	w.Header().Set("ETag", etag)
	w.Header().Set("Last-Modified", modTime.UTC().Format(http.TimeFormat))
	http.Redirect(w, r, downloadURL, http.StatusFound)
}

func handleTorBoxDelete(w http.ResponseWriter, r *http.Request, apiKey string, reqPath string) {
	if decoded, err := url.PathUnescape(reqPath); err == nil {
		reqPath = decoded
	}
	reqPath = strings.Trim(reqPath, "/")
	parts := strings.Split(reqPath, "/")
	if len(parts) < 2 || parts[0] != torBoxWebDAVRoot {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	torrentName := parts[1]
	items, err := torbox.LoadTorrentListFromStore()
	if err != nil {
		http.Error(w, "Torrent store unavailable", http.StatusBadGateway)
		return
	}
	item, ok := findTorBoxTorrentByName(items, torrentName)
	if !ok {
		http.Error(w, "Torrent not found", http.StatusNotFound)
		return
	}

	client := torbox.NewClient(apiKey)
	if err := client.DeleteTorrent(item.ID); err != nil {
		logger.Warn("[TorBox WebDAV] delete torrent %d: %v", item.ID, err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	torbox.DeleteTorrentFromStore(strconv.Itoa(item.ID))
	w.WriteHeader(http.StatusNoContent)
}

func findTorBoxTorrentByName(items []torbox.TorrentItem, name string) (*torbox.TorrentItem, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, false
	}
	for i := range items {
		n := strings.TrimSpace(items[i].Name)
		if n == "" {
			n = "torrent-" + strconv.Itoa(items[i].ID)
		}
		if n == name {
			return &items[i], true
		}
	}
	return nil, false
}

func writeMultistatus(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "text/xml; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = w.Write(body)
}
