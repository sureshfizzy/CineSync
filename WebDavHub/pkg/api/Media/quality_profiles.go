package media

import (
	"cinesync/pkg/db"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type QualityProfile struct {
	ID             int      `json:"id"`
	Name           string   `json:"name"`
	MediaType      string   `json:"mediaType"`
	Qualities      []string `json:"qualities"`
	Cutoff         string   `json:"cutoff"`
	UpgradeAllowed bool     `json:"upgradeAllowed"`
	CreatedAt      string   `json:"createdAt,omitempty"`
	UpdatedAt      string   `json:"updatedAt,omitempty"`
}

type qualityProfileRequest struct {
	Name           string   `json:"name"`
	MediaType      string   `json:"mediaType"`
	Qualities      []string `json:"qualities"`
	Cutoff         string   `json:"cutoff"`
	UpgradeAllowed bool     `json:"upgradeAllowed"`
}

func HandleQualityProfiles(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if isAvailableRequest(r) {
			handleGetAvailableQualities(w, r)
			return
		}
		handleGetQualityProfiles(w, r)
	case http.MethodPost:
		handleCreateQualityProfile(w, r)
	case http.MethodPut:
		UpdateQualityProfile(w, r)
	case http.MethodDelete:
		handleDeleteQualityProfile(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func isAvailableRequest(r *http.Request) bool {
	value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("available")))
	return value == "1" || value == "true" || value == "yes"
}

func handleGetAvailableQualities(w http.ResponseWriter, r *http.Request) {
	mediaType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mediaType")))
	qualities, err := getAvailableQualities(mediaType)
	if err != nil {
		http.Error(w, "Failed to load qualities", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string][]string{"qualities": qualities})
}

func handleGetQualityProfiles(w http.ResponseWriter, r *http.Request) {
	mediaType := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("mediaType")))

	_ = DefaultQualityProfiles()

	profiles, err := getQualityProfiles(mediaType)
	if err != nil {
		http.Error(w, "Failed to retrieve quality profiles", http.StatusInternalServerError)
		return
	}

	if len(profiles) == 0 {
		profiles = []QualityProfile{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profiles)
}

func handleCreateQualityProfile(w http.ResponseWriter, r *http.Request) {
	var req qualityProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.MediaType = strings.ToLower(strings.TrimSpace(req.MediaType))
	if req.Name == "" || (req.MediaType != "movie" && req.MediaType != "tv") {
		http.Error(w, "Name and valid mediaType are required", http.StatusBadRequest)
		return
	}

	qualities := sanitizeQualities(req.Qualities)
	if len(qualities) == 0 {
		qualities, _ = getAvailableQualities(req.MediaType)
	}
	cutoff := strings.TrimSpace(req.Cutoff)
	if cutoff == "" && len(qualities) > 0 {
		cutoff = qualities[0]
	}

	now := time.Now().UTC().Format(time.RFC3339)

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		http.Error(w, "Database unavailable", http.StatusInternalServerError)
		return
	}

	qjson, _ := json.Marshal(qualities)
	res, err := mediaHubDB.Exec(
		`INSERT INTO quality_profiles (name, media_type, qualities, cutoff, upgrade_allowed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
		req.Name, req.MediaType, string(qjson), cutoff, boolToInt(req.UpgradeAllowed), now, now,
	)
	if err != nil {
		http.Error(w, "Failed to create quality profile", http.StatusInternalServerError)
		return
	}

	id, _ := res.LastInsertId()
	profile := QualityProfile{
		ID:             int(id),
		Name:           req.Name,
		MediaType:      req.MediaType,
		Qualities:      qualities,
		Cutoff:         cutoff,
		UpgradeAllowed: req.UpgradeAllowed,
		CreatedAt:      now,
		UpdatedAt:      now,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func UpdateQualityProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "Invalid profile ID", http.StatusBadRequest)
		return
	}

	var req qualityProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.MediaType = strings.ToLower(strings.TrimSpace(req.MediaType))
	if req.Name == "" || (req.MediaType != "movie" && req.MediaType != "tv") {
		http.Error(w, "Name and valid mediaType are required", http.StatusBadRequest)
		return
	}

	qualities := sanitizeQualities(req.Qualities)
	if len(qualities) == 0 {
		qualities, _ = getAvailableQualities(req.MediaType)
	}
	cutoff := strings.TrimSpace(req.Cutoff)
	if cutoff == "" && len(qualities) > 0 {
		cutoff = qualities[0]
	}

	now := time.Now().UTC().Format(time.RFC3339)
	qjson, _ := json.Marshal(qualities)

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		http.Error(w, "Database unavailable", http.StatusInternalServerError)
		return
	}

	_, err = mediaHubDB.Exec(
		`UPDATE quality_profiles
         SET name = ?, media_type = ?, qualities = ?, cutoff = ?, upgrade_allowed = ?, updated_at = ?
         WHERE id = ?`,
		req.Name, req.MediaType, string(qjson), cutoff, boolToInt(req.UpgradeAllowed), now, id,
	)
	if err != nil {
		http.Error(w, "Failed to update quality profile", http.StatusInternalServerError)
		return
	}

	profile := QualityProfile{
		ID:             atoiDefault(id),
		Name:           req.Name,
		MediaType:      req.MediaType,
		Qualities:      qualities,
		Cutoff:         cutoff,
		UpgradeAllowed: req.UpgradeAllowed,
		UpdatedAt:      now,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(profile)
}

func handleDeleteQualityProfile(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "Invalid profile ID", http.StatusBadRequest)
		return
	}

	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		http.Error(w, "Database unavailable", http.StatusInternalServerError)
		return
	}

	if _, err := mediaHubDB.Exec(`DELETE FROM quality_profiles WHERE id = ?`, id); err != nil {
		http.Error(w, "Failed to delete quality profile", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func getQualityProfiles(mediaType string) ([]QualityProfile, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return nil, err
	}

	query := `SELECT id, name, media_type, qualities, cutoff, upgrade_allowed, created_at, updated_at
              FROM quality_profiles`
	args := []interface{}{}
	if mediaType == "movie" || mediaType == "tv" {
		query += " WHERE media_type = ?"
		args = append(args, mediaType)
	}
	query += " ORDER BY name"

	rows, err := mediaHubDB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var profiles []QualityProfile
	seen := make(map[string]bool)
	for rows.Next() {
		var p QualityProfile
		var qualitiesJSON string
		var upgradeAllowed int
		if err := rows.Scan(&p.ID, &p.Name, &p.MediaType, &qualitiesJSON, &p.Cutoff, &upgradeAllowed, &p.CreatedAt, &p.UpdatedAt); err != nil {
			continue
		}
		p.UpgradeAllowed = upgradeAllowed == 1
		if qualitiesJSON != "" {
			_ = json.Unmarshal([]byte(qualitiesJSON), &p.Qualities)
		}
		key := p.MediaType + "::" + p.Name
		if seen[key] {
			continue
		}
		seen[key] = true
		profiles = append(profiles, p)
	}

	return profiles, rows.Err()
}

func getAvailableQualities(mediaType string) ([]string, error) {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return defaultQualities(), nil
	}

	query := `SELECT DISTINCT quality FROM processed_files WHERE quality IS NOT NULL AND quality != ''`
	args := []interface{}{}
	if mediaType == "movie" || mediaType == "tv" {
		query += " AND LOWER(media_type) = ?"
		args = append(args, mediaType)
	}
	query += " ORDER BY quality"

	rows, err := mediaHubDB.Query(query, args...)
	if err != nil {
		return defaultQualities(), nil
	}
	defer rows.Close()

	defaults := defaultQualities()
	seen := make(map[string]bool)
	for _, q := range defaults {
		seen[q] = true
	}
	list := append([]string{}, defaults...)

	for rows.Next() {
		var q string
		if err := rows.Scan(&q); err != nil {
			continue
		}
		q = strings.TrimSpace(q)
		if q == "" || seen[q] {
			continue
		}
		seen[q] = true
		list = append(list, q)
	}

	return list, nil
}

func defaultQualities() []string {
	return []string{
		"Raw-HD",
		"BR-DISK",
		"Remux-2160p",
		"Bluray-2160p",
		"WEB 2160p",
		"HDTV-2160p",
		"Remux-1080p",
		"Bluray-1080p",
		"WEB 1080p",
		"HDTV-1080p",
		"Bluray-720p",
		"WEB 720p",
		"HDTV-720p",
		"Bluray-576p",
		"Bluray-480p",
		"WEB 480p",
		"DVD-R",
		"DVD",
		"SDTV",
		"DVDSCR",
		"REGIONAL",
		"TELECINE",
		"TELESYNC",
		"CAM",
		"WORKPRINT",
		"Unknown",
	}
}

func defaultProfileQualities(name string) []string {
	switch name {
	case "HD-1080p":
		return []string{"HDTV-1080p", "WEB 1080p", "Bluray-1080p"}
	case "HD-720p":
		return []string{"HDTV-720p", "WEB 720p", "Bluray-720p"}
	case "4K-2160p":
		return []string{"HDTV-2160p", "WEB 2160p", "Bluray-2160p", "Remux-2160p", "BR-DISK", "Raw-HD"}
	case "Any":
		return defaultQualities()
	default:
		return defaultQualities()
	}
}

func sanitizeQualities(in []string) []string {
	seen := make(map[string]bool)
	var out []string
	for _, q := range in {
		q = strings.TrimSpace(q)
		if q == "" || seen[q] {
			continue
		}
		seen[q] = true
		out = append(out, q)
	}
	return out
}

func DefaultQualityProfiles() error {
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		return err
	}

	defaults := []struct {
		name      string
		mediaType string
	}{
		{"HD-1080p", "movie"},
		{"HD-720p", "movie"},
		{"4K-2160p", "movie"},
		{"Any", "movie"},
		{"HD-1080p", "tv"},
		{"HD-720p", "tv"},
		{"4K-2160p", "tv"},
		{"Any", "tv"},
	}

	qualities := defaultQualities()
	now := time.Now().UTC().Format(time.RFC3339)

	for _, d := range defaults {
		profileQualities := defaultProfileQualities(d.name)
		qjson, _ := json.Marshal(profileQualities)
		cutoff := ""
		if len(profileQualities) > 0 {
			cutoff = profileQualities[0]
		} else if len(qualities) > 0 {
			cutoff = qualities[0]
		}
		_, _ = mediaHubDB.Exec(
			`INSERT OR IGNORE INTO quality_profiles (name, media_type, qualities, cutoff, upgrade_allowed, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			d.name, d.mediaType, string(qjson), cutoff, 1, now, now,
		)
	}

	return nil
}

func boolToInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func atoiDefault(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return n
		}
		n = n*10 + int(r-'0')
	}
	return n
}