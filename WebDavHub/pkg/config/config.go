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
	"sync"
	"time"

	"cinesync/pkg/logger"
)

// SSE client management for configuration change notifications
var (
	configClients = make(map[chan string]bool)
	configMutex   sync.RWMutex
	// Callback function to update root directory when DESTINATION_DIR changes
	updateRootDirCallback func()
)

// SetUpdateRootDirCallback sets the callback function for updating root directory
func SetUpdateRootDirCallback(callback func()) {
	updateRootDirCallback = callback
}

// ConfigValue represents a configuration value with metadata
type ConfigValue struct {
	Key         string `json:"key"`
	Value       string `json:"value"`
	Description string `json:"description"`
	Category    string `json:"category"`
	Type        string `json:"type"` // string, boolean, integer, array
	Required    bool   `json:"required"`
	Beta        bool   `json:"beta,omitempty"`
	Disabled    bool   `json:"disabled,omitempty"`
	Locked      bool   `json:"locked,omitempty"`
	LockedBy    string `json:"lockedBy,omitempty"`
	Hidden      bool   `json:"hidden,omitempty"`
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
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return "/app/db/.env"
	}

	if os.Getenv("CONTAINER") == "docker" {
		return "/app/db/.env"
	}

	cwd, err := os.Getwd()
	if err != nil {
		logger.Warn("Could not determine current working directory.")
		return "../db/.env"
	}

	basename := filepath.Base(cwd)

	// Handle both MediaHub and WebDavHub directories
	if basename == "MediaHub" || basename == "WebDavHub" {
		parentDir := filepath.Dir(cwd)
		return filepath.Join(parentDir, "db", ".env")
	}

	return filepath.Join(cwd, "db", ".env")
}

// GetEnvFilePath returns the path to the .env file
func GetEnvFilePath() string {
	return getEnvFilePath()
}

// isConfigLocked checks if a configuration key is locked
func isConfigLocked(key string) (bool, string) {
	// Check MediaHub utils folder for client locked settings JSON
	if isMediaHubSettingLocked(key) {
		return true, "System Administrator"
	}

	return false, ""
}

// ClientLockedSetting represents a locked setting from JSON
type ClientLockedSetting struct {
	Locked bool        `json:"locked"`
	Value  interface{} `json:"value"`
}

// ClientLockedSettingsFile represents the JSON structure
type ClientLockedSettingsFile struct {
	LockedSettings map[string]ClientLockedSetting `json:"locked_settings"`
}

var (
	clientLockedCache *ClientLockedSettingsFile
	clientLockedMutex sync.RWMutex
)

// loadClientLockedSettings loads settings from MediaHub/utils/client_locked_settings.json
func loadClientLockedSettings() *ClientLockedSettingsFile {
	clientLockedMutex.RLock()
	if clientLockedCache != nil {
		defer clientLockedMutex.RUnlock()
		return clientLockedCache
	}
	clientLockedMutex.RUnlock()

	clientLockedMutex.Lock()
	defer clientLockedMutex.Unlock()

	// Double-check after acquiring write lock
	if clientLockedCache != nil {
		return clientLockedCache
	}

	jsonPath := filepath.Join("..", "MediaHub", "utils", "client_locked_settings.json")

	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		// No JSON file exists, return empty structure
		clientLockedCache = &ClientLockedSettingsFile{
			LockedSettings: make(map[string]ClientLockedSetting),
		}
		return clientLockedCache
	}

	data, err := os.ReadFile(jsonPath)
	if err != nil {
		clientLockedCache = &ClientLockedSettingsFile{
			LockedSettings: make(map[string]ClientLockedSetting),
		}
		return clientLockedCache
	}

	var lockData ClientLockedSettingsFile
	if err := json.Unmarshal(data, &lockData); err != nil {
		clientLockedCache = &ClientLockedSettingsFile{
			LockedSettings: make(map[string]ClientLockedSetting),
		}
		return clientLockedCache
	}

	clientLockedCache = &lockData
	return clientLockedCache
}

// isMediaHubSettingLocked checks if a setting is locked in MediaHub/utils JSON file
func isMediaHubSettingLocked(key string) bool {
	lockData := loadClientLockedSettings()
	if setting, exists := lockData.LockedSettings[key]; exists {
		return setting.Locked
	}
	return false
}


// GetConfigDefinitions returns the configuration definitions with categories and descriptions (exported)
func GetConfigDefinitions() []ConfigValue {
	return getConfigDefinitions()
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
		{Key: "4K_SEPARATION", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable automatic 4K content separation into separate folders (can also use _4K_SEPARATION for Kubernetes compatibility)"},
		{Key: "ANIME_SEPARATION", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable anime separation"},
		{Key: "KIDS_SEPARATION", Category: "Media Folders Configuration", Type: "boolean", Required: false, Description: "Enable kids/family content separation based on TMDB content ratings (G, PG, TV-Y, TV-G, TV-PG) and family genres"},
		{Key: "CUSTOM_SHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for TV shows"},
		{Key: "CUSTOM_4KSHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for 4K TV shows"},
		{Key: "CUSTOM_ANIME_SHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for anime shows"},
		{Key: "CUSTOM_MOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for movies"},
		{Key: "CUSTOM_4KMOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for 4K movies"},
		{Key: "CUSTOM_ANIME_MOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for anime movies"},
		{Key: "CUSTOM_KIDS_MOVIE_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for kids/family movies"},
		{Key: "CUSTOM_SPORTS_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for sports content"},
		{Key: "CUSTOM_KIDS_SHOW_FOLDER", Category: "Media Folders Configuration", Type: "string", Required: false, Description: "Custom folder name for kids/family TV shows"},

		// Resolution Folder Mappings Configuration
		// Resolution Structure Controls
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

		// MediaHub Service Configuration
		{Key: "MEDIAHUB_AUTO_START", Category: "MediaHub Service Configuration", Type: "boolean", Required: false, Description: "Enable or disable automatic startup of MediaHub service (including built-in RTM) when CineSync starts"},
		{Key: "RTM_AUTO_START", Category: "MediaHub Service Configuration", Type: "boolean", Required: false, Description: "Enable or disable automatic startup of standalone Real-Time Monitor when CineSync starts"},

		// TMDb/IMDB Configuration
		{Key: "TMDB_API_KEY", Category: "TMDb/IMDB Configuration", Type: "string", Required: false, Description: "Your TMDb API key for accessing TMDb services"},
		{Key: "LANGUAGE", Category: "TMDb/IMDB Configuration", Type: "string", Required: false, Description: "Language for TMDb API requests"},
		{Key: "ANIME_SCAN", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable anime-specific scanning"},
		{Key: "TMDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable TMDb folder ID functionality"},
		{Key: "IMDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable IMDb folder ID functionality"},
		{Key: "TVDB_FOLDER_ID", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable TVDb folder ID functionality"},
		{Key: "JELLYFIN_ID_FORMAT", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "When true: uses [tmdbid-12345] format. When false: uses {tmdb-12345} format"},
		{Key: "MOVIE_COLLECTION_ENABLED", Category: "TMDb/IMDB Configuration", Type: "boolean", Required: false, Description: "Enable or disable separating movie files based on collections"},
		{Key: "MOVIE_COLLECTIONS_FOLDER", Category: "TMDb/IMDB Configuration", Type: "string", Required: false, Description: "Folder name for movie collections"},

		// Renaming Structure Configuration
		{Key: "RENAME_ENABLED", Category: "Renaming Structure Configuration", Type: "boolean", Required: false, Description: "Enable or disable file renaming based on TMDb data"},
		{Key: "RENAME_TAGS", Category: "Renaming Structure Configuration", Type: "array", Required: false, Description: "Optional tags to include in file renaming"},
		{Key: "MEDIAINFO_PARSER", Category: "Renaming Structure Configuration", Type: "boolean", Required: false, Description: "Determines if MediaInfo will be used to gather metadata information"},
		{Key: "MEDIAINFO_RADARR_TAGS", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Specifies the tags from MediaInfo to be used for Radarr movie renaming"},
		{Key: "MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Sonarr standard episode format for MediaInfo renaming"},
		{Key: "MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Sonarr daily episode format for MediaInfo renaming"},
		{Key: "MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Sonarr anime episode format for MediaInfo renaming"},
		{Key: "MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT", Category: "Renaming Structure Configuration", Type: "string", Required: false, Description: "Sonarr season folder format for MediaInfo renaming"},

		// System Configuration
		{Key: "RELATIVE_SYMLINK", Category: "System Configuration", Type: "boolean", Required: false, Description: "Create relative symlinks instead of absolute symlinks"},
		{Key: "MAX_PROCESSES", Category: "System Configuration", Type: "integer", Required: false, Description: "Set the maximum number of parallel processes for creating symlinks"},
		{Key: "MAX_CORES", Category: "System Configuration", Type: "integer", Required: false, Description: "Set the maximum number of CPU cores to use (0 for auto-detect, specific number to limit CPU usage)"},

		// File Handling Configuration
		{Key: "SKIP_EXTRAS_FOLDER", Category: "File Handling Configuration", Type: "boolean", Required: false, Description: "Enable or disable the creation and processing of extras folder files"},
		{Key: "SHOW_EXTRAS_SIZE_LIMIT", Category: "File Handling Configuration", Type: "integer", Required: false, Description: "Maximum allowed file size for show extras in MB"},
		{Key: "MOVIE_EXTRAS_SIZE_LIMIT", Category: "File Handling Configuration", Type: "integer", Required: false, Description: "Maximum allowed file size for movie extras in MB (trailers, deleted scenes, etc.)"},
		{Key: "4K_SHOW_EXTRAS_SIZE_LIMIT", Category: "File Handling Configuration", Type: "integer", Required: false, Description: "Maximum allowed file size for 4K show extras in MB (higher limit for 4K content)"},
		{Key: "4K_MOVIE_EXTRAS_SIZE_LIMIT", Category: "File Handling Configuration", Type: "integer", Required: false, Description: "Maximum allowed file size for 4K movie extras in MB (higher limit for 4K content)"},
		{Key: "ALLOWED_EXTENSIONS", Category: "File Handling Configuration", Type: "array", Required: false, Description: "Allowed file extensions for processing"},
		{Key: "SKIP_ADULT_PATTERNS", Category: "File Handling Configuration", Type: "boolean", Required: false, Description: "Enable or disable skipping of specific file patterns"},
		{Key: "FILE_OPERATIONS_AUTO_MODE", Category: "File Handling Configuration", Type: "boolean", Required: false, Description: "Enable auto-processing mode for file operations", Hidden: true},

		// Real-Time Monitoring Configuration
		{Key: "SLEEP_TIME", Category: "Real-Time Monitoring Configuration", Type: "integer", Required: false, Description: "Sleep time (in seconds) for real-time monitoring script"},
		{Key: "SYMLINK_CLEANUP_INTERVAL", Category: "Real-Time Monitoring Configuration", Type: "integer", Required: false, Description: "Cleanup interval for deleting broken symbolic links"},

		// Plex Integration Configuration
		{Key: "ENABLE_PLEX_UPDATE", Category: "Plex Integration Configuration", Type: "boolean", Required: false, Description: "Enable or disable Plex library updates"},
		{Key: "PLEX_URL", Category: "Plex Integration Configuration", Type: "string", Required: false, Description: "URL for your Plex Media Server"},
		{Key: "PLEX_TOKEN", Category: "Plex Integration Configuration", Type: "string", Required: false, Description: "Token for your Plex Media Server"},

		// CineSync Configuration
		{Key: "CINESYNC_IP", Category: "CineSync Configuration", Type: "string", Required: false, Description: "The IP address to bind the CineSync server"},
		{Key: "CINESYNC_API_PORT", Category: "CineSync Configuration", Type: "integer", Required: false, Description: "The port on which the API server runs"},
		{Key: "CINESYNC_UI_PORT", Category: "CineSync Configuration", Type: "integer", Required: false, Description: "The port on which the UI server runs"},
		{Key: "CINESYNC_AUTH_ENABLED", Category: "CineSync Configuration", Type: "boolean", Required: false, Description: "Enable or disable CineSync authentication"},
		{Key: "CINESYNC_USERNAME", Category: "CineSync Configuration", Type: "string", Required: false, Description: "Username for CineSync authentication"},
		{Key: "CINESYNC_PASSWORD", Category: "CineSync Configuration", Type: "string", Required: false, Description: "Password for CineSync authentication"},

		// Database Configuration
		{Key: "DB_THROTTLE_RATE", Category: "Database Configuration", Type: "integer", Required: false, Description: "Throttle rate for database operations (requests per second)"},
		{Key: "DB_MAX_RETRIES", Category: "Database Configuration", Type: "integer", Required: false, Description: "Maximum number of retries for database operations"},
		{Key: "DB_RETRY_DELAY", Category: "Database Configuration", Type: "string", Required: false, Description: "Delay (in seconds) between retry attempts for database operations"},
		{Key: "DB_BATCH_SIZE", Category: "Database Configuration", Type: "integer", Required: false, Description: "Batch size for processing records from the database"},
		{Key: "DB_MAX_WORKERS", Category: "Database Configuration", Type: "integer", Required: false, Description: "Maximum number of parallel workers for database operations"},
	}
}

// createEnvFileFromEnvironment creates a .env file from current environment variables
func createEnvFileFromEnvironment() error {
	envPath := getEnvFilePath()
	logger.Info("Creating .env file from environment variables at: %s", envPath)

	// Get all configuration definitions
	definitions := getConfigDefinitions()

	// Collect environment variables that match our configuration
	envVars := make(map[string]string)
	for _, def := range definitions {
		if value := os.Getenv(def.Key); value != "" {
			envVars[def.Key] = value
		}
	}

	// If no environment variables found, create with minimal defaults
	if len(envVars) == 0 {
		logger.Warn("No environment variables found, creating .env with minimal defaults")
		envVars["SOURCE_DIR"] = "/source"
		envVars["DESTINATION_DIR"] = "/destination"
		envVars["CINESYNC_LAYOUT"] = "true"
		envVars["LOG_LEVEL"] = "INFO"
		envVars["CINESYNC_IP"] = "0.0.0.0"
		envVars["CINESYNC_API_PORT"] = "8082"
		envVars["CINESYNC_UI_PORT"] = "5173"
		envVars["CINESYNC_AUTH_ENABLED"] = "true"
		envVars["CINESYNC_USERNAME"] = "admin"
		envVars["CINESYNC_PASSWORD"] = "admin"
	}

	file, err := os.Create(envPath)
	if err != nil {
		return fmt.Errorf("failed to create .env file: %v", err)
	}
	defer file.Close()

	if _, err := file.WriteString("# Configuration file created from Docker environment variables\n\n"); err != nil {
		return fmt.Errorf("failed to write to .env file: %v", err)
	}

	for key, value := range envVars {
		quotedValue := value
		if strings.Contains(value, " ") || strings.Contains(value, "#") || strings.Contains(value, "\\") || value == "" {
			quotedValue = fmt.Sprintf("\"%s\"", value)
		}

		line := fmt.Sprintf("%s=%s\n", key, quotedValue)
		if _, err := file.WriteString(line); err != nil {
			return fmt.Errorf("failed to write to .env file: %v", err)
		}
	}

	if err := file.Sync(); err != nil {
		return fmt.Errorf("failed to sync .env file: %v", err)
	}

	logger.Info("Successfully created .env file with %d configuration values", len(envVars))
	return nil
}

// readEnvFile reads the .env file and returns a map of key-value pairs
func readEnvFile() (map[string]string, error) {
	envPath := getEnvFilePath()

	// Check if .env file exists
	if _, err := os.Stat(envPath); os.IsNotExist(err) {
		logger.Info(".env file not found at %s, creating from environment variables", envPath)

		// Create .env file from environment variables
		if createErr := createEnvFileFromEnvironment(); createErr != nil {
			logger.Error("Failed to create .env file: %v", createErr)
			return readFromEnvironment(), nil
		}
	} else {
		if fileInfo, err := os.Stat(envPath); err == nil && fileInfo.Size() == 0 {
			logger.Info(".env file exists but is empty at %s, populating from environment variables", envPath)

			if createErr := createEnvFileFromEnvironment(); createErr != nil {
				logger.Error("Failed to populate .env file: %v", createErr)
				return readFromEnvironment(), nil
			}
		}
	}

	file, err := os.Open(envPath)
	if err != nil {
		logger.Warn("Failed to open .env file: %v, falling back to environment variables", err)
		return readFromEnvironment(), nil
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
		logger.Warn("Error reading .env file: %v, falling back to environment variables", err)
		return readFromEnvironment(), nil
	}

	// Handle Kubernetes-compatible alternative: if _4K_SEPARATION is set but 4K_SEPARATION is not, use _4K_SEPARATION
	if _, has4K := envVars["4K_SEPARATION"]; !has4K {
		if value, hasAlt := envVars["_4K_SEPARATION"]; hasAlt {
			envVars["4K_SEPARATION"] = value
		}
	}

	return envVars, nil
}

// readFromEnvironment reads configuration directly from environment variables
func readFromEnvironment() map[string]string {
	logger.Info("Reading configuration directly from environment variables")

	definitions := getConfigDefinitions()
	envVars := make(map[string]string)

	for _, def := range definitions {
		if value := os.Getenv(def.Key); value != "" {
			envVars[def.Key] = value
		} else if def.Key == "4K_SEPARATION" {
			// Check for Kubernetes-compatible alternative _4K_SEPARATION
			if value := os.Getenv("_4K_SEPARATION"); value != "" {
				envVars[def.Key] = value
			}
		}
	}

	logger.Info("Read %d configuration values from environment", len(envVars))
	return envVars
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
	originalQuoting := make(map[string]bool)

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
				originalValue := strings.TrimSpace(parts[1])

				// Check if the original value was quoted
				wasQuoted := (strings.HasPrefix(originalValue, "\"") && strings.HasSuffix(originalValue, "\"")) ||
							(strings.HasPrefix(originalValue, "'") && strings.HasSuffix(originalValue, "'"))
				originalQuoting[key] = wasQuoted

				if newValue, exists := envVars[key]; exists {
					// Determine how to quote the new value
					quotedValue := newValue
					shouldQuote := wasQuoted ||
								  strings.Contains(newValue, " ") ||
								  strings.Contains(newValue, "#") ||
								  strings.Contains(newValue, "\\") ||
								  strings.Contains(newValue, "{") ||
								  strings.Contains(newValue, "}") ||
								  newValue == ""

					if shouldQuote {
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
			shouldQuote := strings.Contains(value, " ") ||
						  strings.Contains(value, "#") ||
						  strings.Contains(value, "\\") ||
						  strings.Contains(value, "{") ||
						  strings.Contains(value, "}") ||
						  value == ""

			if shouldQuote {
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
	// Get the definition for this config key to check if it's disabled
	definitions := getConfigDefinitions()
	var def *ConfigValue
	for _, d := range definitions {
		if d.Key == config.Key {
			def = &d
			break
		}
	}

	// Check if the configuration is disabled (beta features that are blocked)
	if def != nil && def.Disabled {
		return fmt.Errorf("configuration %s is currently disabled and cannot be modified", config.Key)
	}

	// Check if the configuration is locked by an administrator
	if locked, lockedBy := isConfigLocked(config.Key); locked {
		return fmt.Errorf("configuration %s is locked by %s and cannot be modified", config.Key, lockedBy)
	}

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
	envVars, _ := readEnvFile()

	// Get configuration definitions
	definitions := getConfigDefinitions()

	// Build response with current values
	var configValues []ConfigValue
	for _, def := range definitions {
		value := envVars[def.Key]
		locked, lockedBy := isConfigLocked(def.Key)
		configValues = append(configValues, ConfigValue{
			Key:         def.Key,
			Value:       value,
			Description: def.Description,
			Category:    def.Category,
			Type:        def.Type,
			Required:    def.Required,
			Beta:        def.Beta,
			Disabled:    def.Disabled,
			Locked:      locked,
			LockedBy:    lockedBy,
			Hidden:      def.Hidden,
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
	envVars, _ := readEnvFile()

	// Apply updates
	for _, update := range request.Updates {
		if update.Value == "" {
			delete(envVars, update.Key)
		} else {
			envVars[update.Key] = update.Value
		}
	}

	// Write back to file
	if err := writeEnvFile(envVars); err != nil {
		logger.Error("Failed to write .env file: %v", err)
		http.Error(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	// Set environment variables directly instead of reloading from file
	// This avoids issues with godotenv parsing backslashes as escape characters
	for key, value := range envVars {
		os.Setenv(key, value)
	}



	// Check for special configuration updates that require additional actions
	authSettingsChanged := false
	serverRestartRequired := false
	for _, update := range request.Updates {
		if update.Key == "DESTINATION_DIR" && update.Value != "" {
			logger.Info("DESTINATION_DIR updated, refreshing root directory")
			if updateRootDirCallback != nil {
				updateRootDirCallback()
			}
		}
		// Check if authentication settings changed
		if update.Key == "CINESYNC_AUTH_ENABLED" || update.Key == "CINESYNC_USERNAME" || update.Key == "CINESYNC_PASSWORD" {
			authSettingsChanged = true
			logger.Info("Authentication settings changed: %s", update.Key)
		}
		// Check if server restart is required
		if update.Key == "CINESYNC_IP" || update.Key == "CINESYNC_API_PORT" || update.Key == "CINESYNC_UI_PORT" {
			serverRestartRequired = true
			logger.Info("Server restart required for setting: %s", update.Key)
		}
	}

	// Notify all connected clients about configuration changes
	notifyConfigChange()

	// If auth settings changed, notify clients to re-authenticate
	if authSettingsChanged {
		notifyAuthSettingsChanged()
	}

	// If server restart is required, notify clients
	if serverRestartRequired {
		notifyServerRestartRequired()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success", "message": "Configuration updated successfully"})
}

// HandleUpdateConfigSilent handles configuration updates without triggering SSE notifications
func HandleUpdateConfigSilent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var request UpdateConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		logger.Error("Failed to decode config update request: %v", err)
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(request.Updates) == 0 {
		http.Error(w, "No updates provided", http.StatusBadRequest)
		return
	}

	// Read current environment variables
	envVars, _ := readEnvFile()

	// Apply updates
	for _, update := range request.Updates {
		if update.Value == "" {
			delete(envVars, update.Key)
		} else {
			envVars[update.Key] = update.Value
		}
	}

	// Write back to file
	if err := writeEnvFile(envVars); err != nil {
		http.Error(w, "Failed to save configuration", http.StatusInternalServerError)
		return
	}

	// Set environment variables directly
	for key, value := range envVars {
		os.Setenv(key, value)
	}

	// Handle special configuration updates that require additional actions (but no SSE notifications)
	for _, update := range request.Updates {
		if update.Key == "DESTINATION_DIR" && update.Value != "" {
			if updateRootDirCallback != nil {
				updateRootDirCallback()
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "success"})
}

// notifyConfigChange sends configuration change notifications to all connected SSE clients
func notifyConfigChange() {
	configMutex.RLock()
	defer configMutex.RUnlock()

	message := fmt.Sprintf("data: %s\n\n", `{"type":"config_changed","timestamp":`+fmt.Sprintf("%d", time.Now().Unix())+`}`)

	for client := range configClients {
		select {
		case client <- message:
		default:
		}
	}
}

// notifyAuthSettingsChanged sends auth settings change notifications to all connected SSE clients
func notifyAuthSettingsChanged() {
	configMutex.RLock()
	defer configMutex.RUnlock()

	message := fmt.Sprintf("data: %s\n\n", `{"type":"auth_settings_changed","timestamp":`+fmt.Sprintf("%d", time.Now().Unix())+`}`)

	for client := range configClients {
		select {
		case client <- message:
		default:
		}
	}
}

// notifyServerRestartRequired sends server restart required notifications to all connected SSE clients
func notifyServerRestartRequired() {
	configMutex.RLock()
	defer configMutex.RUnlock()

	message := fmt.Sprintf("data: %s\n\n", `{"type":"server_restart_required","timestamp":`+fmt.Sprintf("%d", time.Now().Unix())+`}`)

	for client := range configClients {
		select {
		case client <- message:
		default:
		}
	}
}

// HandleConfigEvents handles Server-Sent Events for configuration changes
func HandleConfigEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Cache-Control")

	// Create a channel for this client
	clientChan := make(chan string, 10)

	// Register the client
	configMutex.Lock()
	configClients[clientChan] = true
	configMutex.Unlock()

	// Handle client disconnect
	defer func() {
		configMutex.Lock()
		delete(configClients, clientChan)
		configMutex.Unlock()
		close(clientChan)
	}()

	// Keep connection alive and send messages
	for {
		select {
		case message := <-clientChan:
			fmt.Fprint(w, message)
			w.(http.Flusher).Flush()
		case <-r.Context().Done():
			return
		}
	}
}
