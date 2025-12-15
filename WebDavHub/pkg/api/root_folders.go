package api

import (
	"cinesync/pkg/logger"
	"cinesync/pkg/db"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// RootFolder represents a root folder configuration
type RootFolder struct {
	ID              int    `json:"id"`
	Path            string `json:"path"`
	Name            string `json:"name,omitempty"`
	IsSystemManaged bool   `json:"isSystemManaged,omitempty"`
}

// HandleRootFolders handles root folder management requests
func HandleRootFolders(w http.ResponseWriter, r *http.Request) {
	logger.Info("Request: %s %s", r.Method, r.URL.Path)
	
	switch r.Method {
	case http.MethodGet:
		handleGetRootFolders(w, r)
	case http.MethodPost:
		handleAddRootFolder(w, r)
	case http.MethodPut:
		handleUpdateRootFolder(w, r)
	case http.MethodDelete:
		handleDeleteRootFolder(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleGetRootFolders retrieves all root folders from both root_folders table and processed_files table
func handleGetRootFolders(w http.ResponseWriter, r *http.Request) {
	// Initialize library table if it doesn't exist
	if err := InitLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	// Get database connection
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Use a map to track unique paths and avoid duplicates
	folderMap := make(map[string]RootFolder)
	idCounter := 1

	// First, get manually added root folders from root_folders table
	query := `SELECT id, path FROM root_folders ORDER BY path`
	rows, err := mediaHubDB.Query(query)
	if err != nil {
		logger.Error("Failed to query root folders: %v", err)
		http.Error(w, "Failed to retrieve root folders", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var path string
		if err := rows.Scan(&id, &path); err != nil {
			logger.Warn("Failed to scan root folder row: %v", err)
			continue
		}
		folderMap[path] = RootFolder{
			ID:              id,
			Path:            path,
			IsSystemManaged: false,
		}
	}

	if err := rows.Err(); err != nil {
		logger.Error("Error iterating root folders: %v", err)
		http.Error(w, "Failed to retrieve root folders", http.StatusInternalServerError)
		return
	}

	// Then, get root folders from processed_files table
	processedQuery := `
		SELECT DISTINCT root_folder as folder_path 
		FROM processed_files 
		WHERE root_folder IS NOT NULL 
		AND root_folder != '' 
		ORDER BY root_folder`
	
	processedRows, err := mediaHubDB.Query(processedQuery)
	if err != nil {
		logger.Error("Failed to query processed_files root folders: %v", err)
	} else {
		defer processedRows.Close()

		for processedRows.Next() {
			var folderPath string
			if err := processedRows.Scan(&folderPath); err != nil {
				logger.Warn("Failed to scan processed_files root folder row: %v", err)
				continue
			}
			
			// Only add if not already in the map
			if _, exists := folderMap[folderPath]; !exists {
				folderMap[folderPath] = RootFolder{
					ID:               idCounter,
					Path:             folderPath,
					IsSystemManaged:  true,
				}
				idCounter++
			}
		}

		if err := processedRows.Err(); err != nil {
			logger.Error("Error iterating processed_files root folders: %v", err)
		}
	}

	// Convert map to slice and sort by path
	var folders []RootFolder
	for _, folder := range folderMap {
		folders = append(folders, folder)
	}

	// Sort by path
	sort.Slice(folders, func(i, j int) bool {
		return folders[i].Path < folders[j].Path
	})

	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(folders)
}

// handleAddRootFolder adds a new root folder
func handleAddRootFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	// Initialize library table if it doesn't exist
	if err := InitLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	// Get database connection
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Insert new root folder
	query := `INSERT INTO root_folders (path) VALUES (?)`
	result, err := mediaHubDB.Exec(query, req.Path)
	if err != nil {
		logger.Error("Failed to insert root folder: %v", err)
		http.Error(w, "Failed to add root folder", http.StatusInternalServerError)
		return
	}

	id, err := result.LastInsertId()
	if err != nil {
		logger.Error("Failed to get last insert ID: %v", err)
		http.Error(w, "Failed to add root folder", http.StatusInternalServerError)
		return
	}

	
	newFolder := RootFolder{
		ID:              int(id),
		Path:            req.Path,
		IsSystemManaged: false,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(newFolder)
}

// handleUpdateRootFolder updates an existing root folder
func handleUpdateRootFolder(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID   int    `json:"id"`
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		http.Error(w, "Path is required", http.StatusBadRequest)
		return
	}

	updatedFolder := RootFolder{
		ID:   req.ID,
		Path: req.Path,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updatedFolder)
}

// handleDeleteRootFolder deletes a root folder (only from root_folders table)
func handleDeleteRootFolder(w http.ResponseWriter, r *http.Request) {
	// Extract ID from URL path
	path := strings.TrimPrefix(r.URL.Path, "/api/root-folders/")
	if path == "" {
		http.Error(w, "Folder ID is required", http.StatusBadRequest)
		return
	}

	folderID, err := strconv.Atoi(path)
	if err != nil {
		http.Error(w, "Invalid folder ID", http.StatusBadRequest)
		return
	}

	// Initialize library table if it doesn't exist (includes root_folders table)
	if err := InitLibraryTable(); err != nil {
		logger.Error("Failed to initialize library table: %v", err)
		http.Error(w, "Database initialization failed", http.StatusInternalServerError)
		return
	}

	// Get database connection
	mediaHubDB, err := db.GetDatabaseConnection()
	if err != nil {
		logger.Error("Failed to get database connection: %v", err)
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}

	// Only delete from root_folders table (manually added folders)
	// Folders from processed_files cannot be deleted as they're system-managed
	query := `DELETE FROM root_folders WHERE id = ?`
	result, err := mediaHubDB.Exec(query, folderID)
	if err != nil {
		logger.Error("Failed to delete root folder: %v", err)
		http.Error(w, "Failed to delete root folder", http.StatusInternalServerError)
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		logger.Error("Failed to get rows affected: %v", err)
		http.Error(w, "Failed to delete root folder", http.StatusInternalServerError)
		return
	}

	if rowsAffected == 0 {
		http.Error(w, "Root folder not found or cannot be deleted (system-managed)", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// getFolderNameFromPath extracts a display name from a folder path
func getFolderNameFromPath(path string) string {
	cleanPath := strings.Trim(path, "/")
	parts := strings.Split(cleanPath, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return cleanPath
}