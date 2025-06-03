package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"cinesync/pkg/logger"
)

// ConfigValue represents a configuration value with metadata
type ConfigValue struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Type        string `json:"type"` // string, boolean, integer, array
	Required    bool   `json:"required"`
}

// ConfigResponse represents the response structure for configuration
type ConfigResponse struct {
	Config []ConfigValue `json:"config"`
	Status string        `json:"status"`
}

// UpdateConfigRequest represents the request structure for updating configuration
type UpdateConfigRequest struct {
	Updates []ConfigValue `json:"updates"`
}

// getEnvFilePath returns the path to the .env file
func getEnvFilePath() string {
	cwd, err := os.Getwd()
	if err != nil {
		logger.Warn("Could not determine current working directory.")
		return "../.env"
	}
	parentDir := filepath.Dir(cwd)
	return filepath.Join(parentDir, ".env")
}

// getConfigDefinitions returns the configuration definitions with categories and descriptions
func getConfigDefinitions() []ConfigValue {
	return []ConfigValue{
		// Directory Paths
		{Key: "SOURCE_DIR", Category: "Directory Paths", Type: "string", Required: true, Description: "Source directory for input files"},
		{Key: "DESTINATION_DIR", Category: "Directory Paths", Type: "string", Required: true, Description: "Destination directory for output files"},
		{Key: "USE_SOURCE_STRUCTURE", Category: "Directory Paths", Type: "boolean", Required: false, Description: "Use source structure for organizing files"},

		// Media Folders Configuration
		{Key: "CINESYNC_LAYOUT", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable CineSync layout organization"},
		{Key: "4K_SEPARATION", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable automatic 4K content separation into separate folders"},
		{Key: "ANIME_SEPARATION", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable anime separation"},
		{Key: "CUSTOM_SHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for TV shows"},
		{Key: "CUSTOM_4KSHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for 4K TV shows"},
		{Key: "CUSTOM_ANIME_SHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for anime shows"},
		{Key: "CUSTOM_MOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for movies"},
		{Key: "CUSTOM_4KMOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for 4K movies"},
		{Key: "CUSTOM_ANIME_MOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for anime movies"},

		// Resolution Folder Mappings Configuration
		// Resolution Structure Controls (moved from Media Folders)
		{Key: "SHOW_RESOLUTION_STRUCTURE", Category: "Resolution Folder Mappings Configuration", Type: "boolean", Required: false, Description: "Enable resolution-based structure for shows"},
		{Key: "MOVIE_RESOLUTION_STRUCTURE", Category: "Resolution Folder Mappings Configuration", Type: "boolean", Required: false, Description: "Enable resolution-based structure for movies"},

		// Show Resolution Folder Mappings
		{Key: "SHOW_RESOLUTION_FOLDER_REMUX_4K", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 4K Remux TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_REMUX_1080P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 1080p Remux TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_REMUX_DEFAULT", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Default folder name for Remux TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_2160P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 2160p (4K) TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_1080P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 1080p TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_720P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 720p TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_480P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 480p TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_DVD", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for DVD quality TV shows"},
		{Key: "SHOW_RESOLUTION_FOLDER_DEFAULT", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Default folder name for TV shows"},

		// Movie Resolution Folder Mappings
		{Key: "MOVIE_RESOLUTION_FOLDER_REMUX_4K", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 4K Remux movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_REMUX_1080P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 1080p Remux movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_REMUX_DEFAULT", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Default folder name for Remux movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_2160P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 2160p (4K) movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_1080P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 1080p movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_720P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 720p movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_480P", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for 480p movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_DVD", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Folder name for DVD quality movies"},
		{Key: "MOVIE_RESOLUTION_FOLDER_DEFAULT", Category: "Resolution Folder Mappings Configuration", Type: "string", Required: false, Description: "Default folder name for movies"},

		// Logging Configuration
		{Key: "LOG_LEVEL", Category: "Logging Configuration", Type: "string", Required: false, Description: "Set the log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)"},

		// Rclone Mount Configuration
		{Key: "RCLONE_MOUNT", Category: "Rclone Mount Configuration", Type: "boolean", Required: false, Description: "Enable or disable rclone mount verification"},
		{Key: "MOUNT_CHECK_INTERVAL", Category: "Rclone Mount Configuration", Type: "integer", Required: false, Description: "Interval (in seconds) for checking rclone mount availability"},

		// TMDb/IMDB Configuration
		{Key: "TMDB_API_KEY", Category: "TMDb/IMDB Configuration", Type: "string", Required: true, Description: "Your TMDb API key for accessing TMDb services"},
		{Key: "LANGUAGE", Category: "TMDb/IMDB Configuration", Type: "string", Required: false, Description: "Language for TMDb API requests"},
		{Key: "ANIME_SCAN", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable anime-specific scanning"},
		{Key: "TMDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable TMDb folder ID functionality"},
		{Key: "IMDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable IMDb folder ID functionality"},
		{Key: "TVDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable TVDb folder ID functionality"},

		// Renaming Structure Configuration
		{Key: "RENAME_ENABLED", Category: "Renaming Structure Configuration", Type: "boolean", Required: false, Description: "Enable or disable file renaming based on TMDb data"},
		{Key: "MEDIAINFO_PARSER", Category: "Renaming Structure Configuration", Type: "boolean", Required: false, Description: "Determines if MediaInfo will be used to gather metadata information"},
		{Key: "RENAME_TAGS", Category: "Renaming Structure Configuration", Type: "array", Required: false, Description: "Optional tags to include in file renaming"},
		{Key: "MEDIAINFO_TAGS", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Specifies the tags from MediaInfo to be used for renaming"},

		// Movie Collection Settings
		{Key: "MOVIE_COLLECTION_ENABLED", Category: "Movie Collection Settings", Type: "boolean", Required: false, Description: "Enable or disable separating movie files based on collections"},

		// System Configuration
		{Key: "RELATIVE_SYMLINK", Category: "System Configuration", Type: "boolean", Required: false, Description: "Create relative symlinks instead of absolute symlinks"},
		{Key: "MAX_PROCESSES", Category: "System Configuration", Type: "integer", Required: false, Description: "Set the maximum number of parallel processes for creating symlinks"},

		// File Handling Configuration
		{Key: "SKIP_EXTRAS_FOLDER", Category: "File Handling Configuration", Type: "boolean", Required: false, Description: "Enable or disable the creation and processing of extras folder files"},
		{Key: "JUNK_MAX_SIZE_MB", Category: "File Handling Configuration", Type: "integer", Required: false, Description: "Maximum allowed file size for junks in MB"},
		{Key: "ALLOWED_EXTENSIONS", Category: "File Handling Configuration", Type: "array", Required: false, Description: "Allowed file extensions for processing"},
		{Key: "SKIP_ADULT_PATTERNS", Category: "File Handling Configuration", Type: "boolean", Required: false, Description: "Enable or disable skipping of specific file patterns"},

		// Real-Time Monitoring Configuration
		{Key: "SLEEP_TIME", Category: "Real-Time Monitoring Configuration", Type: "integer", Required: false, Description: "Sleep time (in seconds) for real-time monitoring script"},
		{Key: "SYMLINK_CLEANUP_INTERVAL", Category: "Real-Time Monitoring Configuration", Type: "integer", Required: false, Description: "Cleanup interval for deleting broken symbolic links"},

		// Plex Integration Configuration
		{Key: "ENABLE_PLEX_UPDATE", Category: "Plex Integration Configuration", Type: "boolean", Required: false, Description: "Enable or disable Plex library updates"},
		{Key: "PLEX_URL", Category: "Plex Integration Configuration", Type: "string", Required: false, Description: "URL for your Plex Media Server"},
		{Key: "PLEX_TOKEN", Category: "Plex Integration Configuration", Type: "string", Required: false, Description: "Token for your Plex Media Server"},

		// WebDAV Configuration
		{Key: "CINESYNC_WEBDAV", Category: "WebDAV Configuration", Type: "boolean", Required: false, Description: "Enable or disable WebDAV access for CineSync"},
		{Key: "CINESYNC_IP", Category: "WebDAV Configuration", Type: "string", Required: false, Description: "The IP address to bind the WebDAV server"},
		{Key: "CINESYNC_API_PORT", Category: "WebDAV Configuration", Type: "integer", Required: false, Description: "The port on which the API server runs"},
		{Key: "CINESYNC_UI_PORT", Category: "WebDAV Configuration", Type: "integer", Required: false, Description: "The port on which the UI server runs"},
		{Key: "WEBDAV_AUTH_ENABLED", Category: "WebDAV Configuration", Type: "boolean", Required: false, Description: "Enable or disable WebDAV authentication"},
		{Key: "WEBDAV_USERNAME", Category: "WebDAV Configuration", Type: "string", Required: false, Description: "Username for WebDAV authentication"},
		{Key: "WEBDAV_PASSWORD", Category: "WebDAV Configuration", Type: "string", Required: false, Description: "Password for WebDAV authentication"},

		// Database Configuration
		{Key: "DB_THROTTLE_RATE", Category: "Database Configuration", Type: "integer", Required: false, Description: "Throttle rate for database operations (requests per second)"},
		{Key: "DB_MAX_RETRIES", Category: "Database Configuration", Type: "integer", Required: false, Description: "Maximum number of retries for database operations"},
		{Key: "DB_RETRY_DELAY", Category: "Database Configuration", Type: "string", Required: false, Description: "Delay (in seconds) between retry attempts for database operations"},
		{Key: "DB_BATCH_SIZE", Category: "Database Configuration", Type: "integer", Required: false, Description: "Batch size for processing records from the database"},
		{Key: "DB_MAX_WORKERS", Category: "Database Configuration", Type: "integer", Required: false, Description: "Maximum number of parallel workers for database operations"},
	}
}

// readEnvFile reads the .env file and returns a map of key-value pairs
func readEnvFile() (map[string]string, error) {
	envPath := getEnvFilePath()
	file, err := os.Open(envPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open .env file: %v", err)
	}
	defer file.Close()

	envVars := make(map[string]string)
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		// Parse key=value pairs
		if strings.Contains(line, "=") {
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				value := strings.TrimSpace(parts[1])

				// Remove quotes if present
				if (strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) ||
				   (strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
					value = value[1 : len(value)-1]
				}

				envVars[key] = value
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading .env file: %v", err)
	}

	return envVars, nil
}

// writeEnvFile writes the environment variables back to the .env file
func writeEnvFile(envVars map[string]string) error {
	envPath := getEnvFilePath()

	// Read the original file to preserve comments and structure
	originalFile, err := os.Open(envPath)
	if err != nil {
		return fmt.Errorf("failed to open .env file: %v", err)
	}
	defer originalFile.Close()

	var lines []string
	scanner := bufio.NewScanner(originalFile)
	updatedKeys := make(map[string]bool)

	for scanner.Scan() {
		line := scanner.Text()
		trimmedLine := strings.TrimSpace(line)

		// If it's a comment or empty line, keep as is
		if trimmedLine == "" || strings.HasPrefix(trimmedLine, "#") {
			lines = append(lines, line)
			continue
		}

		// If it's a key=value pair, check if we need to update it
		if strings.Contains(trimmedLine, "=") {
			parts := strings.SplitN(trimmedLine, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				if newValue, exists := envVars[key]; exists {
					// Quote the value if it contains spaces or special characters
					quotedValue := newValue
					if strings.Contains(newValue, " ") || strings.Contains(newValue, "#") {
						quotedValue = fmt.Sprintf("\"%s\"", newValue)
					}
					lines = append(lines, fmt.Sprintf("%s=%s", key, quotedValue))
					updatedKeys[key] = true
				} else {
					// Keep the original line if key not in updates
					lines = append(lines, line)
				}
			} else {
				lines = append(lines, line)
			}
		} else {
			lines = append(lines, line)
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error reading .env file: %v", err)
	}

	// Add any new keys that weren't in the original file
	for key, value := range envVars {
		if !updatedKeys[key] {
			quotedValue := value
			if strings.Contains(value, " ") || strings.Contains(value, "#") {
				quotedValue = fmt.Sprintf("\"%s\"", value)
			}
			lines = append(lines, fmt.Sprintf("%s=%s", key, quotedValue))
		}
	}

	// Close the original file before writing
	originalFile.Close()

	// Write directly to the original file instead of using temp file + rename
	file, err := os.OpenFile(envPath, os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return fmt.Errorf("failed to open .env file for writing: %v", err)
	}
	defer file.Close()

	for _, line := range lines {
		if _, err := file.WriteString(line + "\n"); err != nil {
			return fmt.Errorf("failed to write to .env file: %v", err)
		}
	}

	// Ensure data is written to disk
	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync .env file: %v", err)
	}

	return nil
}

// validateConfigValue validates a configuration value based on its type
func validateConfigValue(config ConfigValue) error {
	switch config.Type {
	case "boolean":
		if config.Value != "" {
			_, err := strconv.ParseBool(config.Value)
			if err != nil {
				return fmt.Errorf("invalid boolean value for %s: %s", config.Key, config.Value)
			}
		}
	case "integer":
		if config.Value != "" {
			_, err := strconv.Atoi(config.Value)
			if err != nil {
				return fmt.Errorf("invalid integer value for %s: %s", config.Key, config.Value)
			}
		}
	case "array":
		// Arrays are comma-separated values, basic validation
		if config.Value != "" && !regexp.MustCompile(`^[^,]+(,[^,]+)*$`).MatchString(config.Value) {
			return fmt.Errorf("invalid array format for %s: %s", config.Key, config.Value)
		}
	}

	// Check required fields
	if config.Required && config.Value == "" {
		return fmt.Errorf("required field %s cannot be empty", config.Key)
	}

	return nil
}

// HandleGetConfig handles GET requests for configuration
func HandleGetConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Read current environment variables
	envVars, err := readEnvFile()
	if err != nil {
		logger.Error("Failed to read .env file: %v", err)
		http.Error(w, "Failed to read configuration", http.StatusInternalServerError)
		return
	}

	// Get configuration definitions
	definitions := getConfigDefinitions()

	// Build response with current values
	var configValues []ConfigValue
	for _, def := range definitions {
		value := envVars[def.Key]
		configValues = append(configValues, ConfigValue{
			Key:         def.Key,
			Value:       value,
			Description: def.Description,
			Category:    def.Category,
			Type:        def.Type,
			Required:    def.Required,
		})
	}

	// Sort by category and then by key
	sort.Slice(configValues, func(i, j int) bool {
		if configValues[i].Category != configValues[j].Category {
			return configValues[i].Category < configValues[j].Category
		}
		return configValues[i].Key < configValues[j].Key
	})

	response := ConfigResponse{
		Config: configValues,
		Status: "success",
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(response); err != nil {
		logger.Error("Failed to encode config response: %v", err)
		http.Error(w, "Failed to encode response", http.StatusInternalServerError)
	}
}

// HandleUpdateConfig handles POST requests for updating configuration
func HandleUpdateConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request UpdateConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Validate all updates first
	for _, update := range request.Updates {
		if err := validateConfigValue(update); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
	}

	// Read current environment variables
	envVars, err := readEnvFile()
	if err != nil {
		logger.Error("Failed to read .env file: %v", err)
		http.Error(w, "Failed to read configuration", http.StatusInternalServerError)
		return
	}

	// Apply updates
	for _, update := range request.Updates {
		if update.Value == "" {
			delete(envVars, update.Key)
		} else {
			envVars[update.Key] = update.Value
		}
		logger.Info("Configuration updated successfully")
	}

	// Write back to file
	if err := writeEnvFile(envVars); err != nil {
		logger.Error("Failed to write .env file: %v", err)
		http.Error(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "message": "Configuration updated successfully"})
}
