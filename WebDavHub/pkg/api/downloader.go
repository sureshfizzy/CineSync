package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cinesync/pkg/db"
	"cinesync/pkg/logger"
	"cinesync/pkg/realdebrid"
)

type DownloadQueueItem struct {
	ID                    int      `json:"id"`
	TmdbID                int      `json:"tmdbId"`
	Title                 string   `json:"title"`
	Year                  *int     `json:"year,omitempty"`
	MediaType             string   `json:"mediaType"`
	SeasonNumber          *int     `json:"seasonNumber,omitempty"`
	EpisodeNumber         *int     `json:"episodeNumber,omitempty"`
	EpisodeTitle          string   `json:"episodeTitle,omitempty"`
	Quality               string   `json:"quality"`
	Indexer               string   `json:"indexer"`
	Protocol              string   `json:"protocol"`
	DownloadID            string   `json:"downloadId,omitempty"`
	ReleaseTitle          string   `json:"releaseTitle"`
	Size                  int64    `json:"size"`
	Status                string   `json:"status"`
	TrackedDownloadStatus string   `json:"trackedDownloadStatus"`
	TrackedDownloadState  string   `json:"trackedDownloadState"`
	StatusMessages        []string `json:"statusMessages"`
	EventType             string   `json:"eventType,omitempty"`
	ErrorMessage          string   `json:"errorMessage,omitempty"`
	AddedAt               int64    `json:"addedAt"`
	UpdatedAt             int64    `json:"updatedAt"`
	CompletedAt           *int64   `json:"completedAt,omitempty"`
}

type AddToQueueRequest struct {
	TmdbID        int    `json:"tmdbId"`
	Title         string `json:"title"`
	Year          *int   `json:"year,omitempty"`
	MediaType     string `json:"mediaType"`
	SeasonNumber  *int   `json:"seasonNumber,omitempty"`
	EpisodeNumber *int   `json:"episodeNumber,omitempty"`
	EpisodeTitle  string `json:"episodeTitle,omitempty"`
	Quality       string `json:"quality"`
	Indexer       string `json:"indexer"`
	ReleaseTitle  string `json:"releaseTitle"`
	Size          int64  `json:"size"`
}

// HandleDownloadQueue handles all /api/library/queue requests.
func HandleDownloadQueue(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "/api/library/queue" {
		switch r.Method {
		case http.MethodGet:
			handleGetDownloadQueue(w, r)
		case http.MethodPost:
			handleAddToDownloadQueue(w, r)
		case http.MethodDelete:
			handleClearDownloadQueue(w, r)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}
	switch r.Method {
	case http.MethodPut:
		handleUpdateQueueItem(w, r)
	case http.MethodDelete:
		handleDeleteQueueItem(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleDownloadHistory handles /api/library/history requests.
func HandleDownloadHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		q := r.URL.Query()
		q.Set("status", "completed")
		r.URL.RawQuery = q.Encode()
		handleGetDownloadQueue(w, r)
	case http.MethodDelete:
		q := r.URL.Query()
		q.Set("scope", "history")
		r.URL.RawQuery = q.Encode()
		handleClearDownloadQueue(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleGetDownloadQueue(w http.ResponseWriter, r *http.Request) {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	status := r.URL.Query().Get("status")
	mediaType := r.URL.Query().Get("mediaType")
	limit, offset := 100, 0
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = v
	}
	if v, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && v >= 0 {
		offset = v
	}

	where := " WHERE 1=1"
	var args []interface{}
	if status == "" {
		where += " AND status IN ('queued','downloading','importing','failed','paused')"
	} else {
		where += " AND status = ?"
		args = append(args, status)
	}
	if mediaType != "" {
		where += " AND media_type = ?"
		args = append(args, mediaType)
	}

	var totalCount int
	if err := database.QueryRow("SELECT COUNT(1) FROM download_queue"+where, args...).Scan(&totalCount); err != nil {
		logger.Error("Failed to count download queue: %v", err)
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		return
	}

	query := `SELECT id, tmdb_id, title, year, media_type, season_number, episode_number,
		episode_title, quality, indexer, COALESCE(protocol,'torrent'), COALESCE(rd_torrent_id,''),
		release_title, size, status,
		COALESCE(tracked_download_status,'ok'), COALESCE(tracked_download_state,''),
		COALESCE(status_messages,''), COALESCE(event_type,''),
		error_message, added_at, updated_at, completed_at
		FROM download_queue` + where + " ORDER BY added_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := database.Query(query, args...)
	if err != nil {
		logger.Error("Failed to query download queue: %v", err)
		http.Error(w, "Database query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := []DownloadQueueItem{}
	for rows.Next() {
		var item DownloadQueueItem
		var errMsg, episodeTitle sql.NullString
		var seasonNum, episodeNum, year, completedAt sql.NullInt64
		var statusMsgsJSON string

		if err := rows.Scan(
			&item.ID, &item.TmdbID, &item.Title, &year, &item.MediaType,
			&seasonNum, &episodeNum, &episodeTitle, &item.Quality,
			&item.Indexer, &item.Protocol, &item.DownloadID,
			&item.ReleaseTitle, &item.Size, &item.Status,
			&item.TrackedDownloadStatus, &item.TrackedDownloadState,
			&statusMsgsJSON, &item.EventType,
			&errMsg, &item.AddedAt, &item.UpdatedAt, &completedAt,
		); err != nil {
			logger.Error("Failed to scan download queue row: %v", err)
			continue
		}

		if year.Valid {
			v := int(year.Int64)
			item.Year = &v
		}
		if seasonNum.Valid {
			v := int(seasonNum.Int64)
			item.SeasonNumber = &v
		}
		if episodeNum.Valid {
			v := int(episodeNum.Int64)
			item.EpisodeNumber = &v
		}
		if episodeTitle.Valid {
			item.EpisodeTitle = episodeTitle.String
		}
		if errMsg.Valid {
			item.ErrorMessage = errMsg.String
		}
		if completedAt.Valid {
			v := completedAt.Int64
			item.CompletedAt = &v
		}
		if statusMsgsJSON != "" {
			_ = json.Unmarshal([]byte(statusMsgsJSON), &item.StatusMessages)
		}
		if item.StatusMessages == nil {
			item.StatusMessages = []string{}
		}
		items = append(items, item)
	}

	writePagedJSON(w, items, totalCount)
}

func handleAddToDownloadQueue(w http.ResponseWriter, r *http.Request) {
	var req AddToQueueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.TmdbID == 0 || req.Title == "" || req.MediaType == "" {
		http.Error(w, "Missing required fields: tmdbId, title, mediaType", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	now := time.Now().Unix()
	result, err := database.Exec(
		`INSERT INTO download_queue
		(tmdb_id, title, year, media_type, season_number, episode_number, episode_title,
		 quality, indexer, release_title, size, status, tracked_download_status,
		 tracked_download_state, event_type, protocol, added_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'ok', 'downloading', 'grabbed', 'torrent', ?, ?)`,
		req.TmdbID, req.Title, req.Year, req.MediaType, req.SeasonNumber, req.EpisodeNumber,
		req.EpisodeTitle, req.Quality, req.Indexer, req.ReleaseTitle, req.Size, now, now,
	)
	if err != nil {
		logger.Error("Failed to add to download queue: %v", err)
		http.Error(w, "Failed to add to download queue", http.StatusInternalServerError)
		return
	}

	newID, _ := result.LastInsertId()
	logger.Info("Added to download queue: %s (TMDB ID: %d)", req.Title, req.TmdbID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"id":      newID,
		"message": fmt.Sprintf("'%s' added to download queue", req.Title),
	})
}

func handleDeleteQueueItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	var rdTorrentID sql.NullString
	_ = database.QueryRow("SELECT rd_torrent_id FROM download_queue WHERE id = ?", id).Scan(&rdTorrentID)

	result, err := database.Exec("DELETE FROM download_queue WHERE id = ?", id)
	if err != nil {
		logger.Error("Failed to delete queue item: %v", err)
		http.Error(w, "Failed to delete queue item", http.StatusInternalServerError)
		return
	}
	if n, _ := result.RowsAffected(); n == 0 {
		http.Error(w, "Queue item not found", http.StatusNotFound)
		return
	}

	if r.URL.Query().Get("removeFromClient") != "false" && rdTorrentID.Valid && rdTorrentID.String != "" {
		go cancelRDTorrent(rdTorrentID.String)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Queue item deleted"})
}

func handleClearDownloadQueue(w http.ResponseWriter, r *http.Request) {
	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	scope := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("scope")))
	if scope == "" {
		scope = "queue"
	}

	var deleteSQL, cancelSQL string
	switch scope {
	case "queue":
		deleteSQL = "DELETE FROM download_queue WHERE status IN ('queued','downloading','importing','failed','paused')"
		cancelSQL = "SELECT rd_torrent_id FROM download_queue WHERE status IN ('queued','downloading','importing','failed','paused') AND rd_torrent_id IS NOT NULL AND rd_torrent_id != ''"
	case "history":
		deleteSQL = "DELETE FROM download_queue WHERE status = 'completed'"
	case "all":
		deleteSQL = "DELETE FROM download_queue"
		cancelSQL = "SELECT rd_torrent_id FROM download_queue WHERE rd_torrent_id IS NOT NULL AND rd_torrent_id != ''"
	default:
		http.Error(w, "Invalid scope (use: queue, history, all)", http.StatusBadRequest)
		return
	}

	if cancelSQL != "" {
		if rows, err := database.Query(cancelSQL); err == nil {
			defer rows.Close()
			for rows.Next() {
				var rdID string
				if rows.Scan(&rdID) == nil && rdID != "" {
					go cancelRDTorrent(rdID)
				}
			}
		}
	}

	result, err := database.Exec(deleteSQL)
	if err != nil {
		logger.Error("Failed to clear download queue (%s): %v", scope, err)
		http.Error(w, "Failed to clear queue", http.StatusInternalServerError)
		return
	}

	deleted, _ := result.RowsAffected()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true, "scope": scope, "deleted": deleted, "message": "Queue cleared",
	})
}

func cancelRDTorrent(torrentID string) {
	cfg, err := validateRealDebridConfig()
	if err != nil {
		return
	}
	client := realdebrid.NewClient(cfg.APIKey)
	if err := client.DeleteTorrent(torrentID); err != nil {
		logger.Warn("cancelRDTorrent: failed to delete RD torrent %s: %v", torrentID, err)
	} else {
		logger.Info("cancelRDTorrent: deleted RD torrent %s", torrentID)
	}
}

// ImportQueueItem is called from main.go when a torrent finishes on RD.
func ImportQueueItem(tmdbID int64, mediaType, title, torrentFilename string, queueID int64) {
	cfg := realdebrid.GetConfigManager().GetConfig()
	mountPath := cfg.RcloneSettings.MountPath
	if mountPath == "" {
		return
	}
	if len(mountPath) == 2 && mountPath[1] == ':' {
		mountPath = mountPath + `\`
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		return
	}

	var rootFolder, cleanTitle string
	var year sql.NullInt64
	if err = database.QueryRow(
		`SELECT root_folder, title, year FROM library_items WHERE tmdb_id=? AND media_type=? LIMIT 1`,
		tmdbID, mediaType,
	).Scan(&rootFolder, &cleanTitle, &year); err != nil {
		logger.Warn("[Import] library_items not found: tmdb_id=%d media_type=%s: %v", tmdbID, mediaType, err)
		return
	}

	destFolderName := cleanTitle
	if year.Valid && year.Int64 > 0 {
		destFolderName = fmt.Sprintf("%s (%d)", cleanTitle, year.Int64)
	}

	if torrentFilename == "" {
		logger.Warn("[Import] No torrent filename for queue item %d", queueID)
		return
	}

	mountEntryName := torrentFilename
	if !cfg.RcloneSettings.RetainFolderExtension {
		if dirName := realdebrid.GetDirectoryName(torrentFilename); dirName != "" {
			mountEntryName = dirName
		}
	}

	candidate := filepath.Join(mountPath, realdebrid.ALL_TORRENTS, mountEntryName)

	srcDir := ""
	singleFile := ""
	for attempt := 0; attempt < 10; attempt++ {
		var currentStatus string
		if dbErr := database.QueryRow(`SELECT status FROM download_queue WHERE id=?`, queueID).Scan(&currentStatus); dbErr != nil || currentStatus == "failed" {
			return
		}
		if info, statErr := os.Stat(candidate); statErr == nil {
			if info.IsDir() {
				srcDir = candidate
			} else if realdebrid.IsVideoFile(info.Name()) {
				singleFile = candidate
			}
			break
		} else {
			logger.Debug("[Import] Waiting for mount dir (attempt %d/10): %v", attempt+1, statErr)
			time.Sleep(5 * time.Second)
		}
	}
	if srcDir == "" && singleFile == "" {
		logger.Warn("[Import] Source not found on mount: %s", mountEntryName)
		return
	}

	tmdbIDStr := fmt.Sprintf("%d", tmdbID)
	yearStr := ""
	if year.Valid && year.Int64 > 0 {
		yearStr = fmt.Sprintf("%d", year.Int64)
	}
	now := time.Now()
	symlinkCount := 0

	doSymlink := func(srcPath string, size int64) {
		dest := filepath.Join(rootFolder, destFolderName, filepath.Base(srcPath))
		if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
			return
		}
		if _, err := os.Lstat(dest); err == nil {
			symlinkCount++
		} else if err := os.Symlink(srcPath, dest); err != nil {
			logger.Warn("[Import] Symlink failed %s: %v", filepath.Base(srcPath), err)
			return
		} else {
			logger.Info("[Import] Symlinked: %s -> %s", srcPath, dest)
			symlinkCount++
		}
		basePath := srcDir
		if basePath == "" {
			basePath = filepath.Dir(srcPath)
		}
		_, _ = database.Exec(
			`INSERT OR REPLACE INTO processed_files
			 (file_path, destination_path, base_path, root_folder, tmdb_id, media_type, proper_name, year, file_size, processed_at)
			 VALUES (?,?,?,?,?,?,?,?,?,?)`,
			srcPath, dest, basePath, rootFolder, tmdbIDStr, mediaType, cleanTitle, yearStr, size, now.Format("2006-01-02 15:04:05"),
		)
	}

	if singleFile != "" {
		if info, err := os.Stat(singleFile); err == nil {
			doSymlink(singleFile, info.Size())
		}
	} else {
		_ = filepath.Walk(srcDir, func(srcPath string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() || !realdebrid.IsVideoFile(info.Name()) {
				return nil
			}
			doSymlink(srcPath, info.Size())
			return nil
		})
	}

	if symlinkCount == 0 {
		logger.Warn("[Import] No video files found in %q, queue item %d not marked complete", srcDir, queueID)
		return
	}
	if _, err := database.Exec(
		`UPDATE download_queue SET status='completed', tracked_download_state='imported',
		 event_type='downloadFolderImported', completed_at=COALESCE(completed_at,?), updated_at=? WHERE id=?`,
		now.Unix(), now.Unix(), queueID,
	); err != nil {
		logger.Warn("[Import] download_queue update failed: %v", err)
	} else {
		logger.Info("[Import] Imported %d file(s) for queue item %d (%s)", symlinkCount, queueID, destFolderName)
	}
}

func handleUpdateQueueItem(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "Invalid item ID", http.StatusBadRequest)
		return
	}

	var body struct {
		Status       string `json:"status"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	valid := map[string]bool{
		"queued": true, "downloading": true, "importing": true,
		"completed": true, "failed": true, "paused": true,
	}
	if !valid[body.Status] {
		http.Error(w, "Invalid status value", http.StatusBadRequest)
		return
	}

	database, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	_, err = database.Exec(
		"UPDATE download_queue SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
		body.Status, body.ErrorMessage, time.Now().Unix(), id,
	)
	if err != nil {
		logger.Error("Failed to update queue item: %v", err)
		http.Error(w, "Failed to update queue item", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "message": "Queue item updated"})
}
