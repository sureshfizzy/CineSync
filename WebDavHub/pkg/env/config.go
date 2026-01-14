package env

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
	"cinesync/pkg/logger"
	"cinesync/pkg/config"
)

// LoadEnv loads environment variables from .env file
func LoadEnv() error {
    envPath := config.GetEnvFilePath()

	if _, statErr := os.Stat(envPath); statErr != nil {
		return statErr
	}

	if err := godotenv.Load(envPath); err != nil {
		return err
	}

        logger.Debug("Environment variables loaded from %s", envPath)
	return nil
}

// ReloadEnv reloads environment variables from .env file at runtime
func ReloadEnv() error {
    envPath := config.GetEnvFilePath()

    // Load new environment variables - use Overload to override existing values
    err := godotenv.Overload(envPath)
    if err != nil {
        logger.Warn("Could not reload .env from %s", envPath)
        return err
    }

    logger.Info("Environment variables reloaded successfully from %s", envPath)
    return nil
}

// GetString returns the environment variable value or a default if not set
func GetString(key string, defaultValue string) string {
	value, exists := os.LookupEnv(key)
	if !exists {
		return defaultValue
	}

	return value
}

// GetInt returns the environment variable value as int or a default if not set
func GetInt(key string, defaultValue int) int {
	valueStr, exists := os.LookupEnv(key)
	if !exists {
		return defaultValue
	}

	value, err := strconv.Atoi(valueStr)
	if err != nil {
		logger.Warn("Environment variable %s is not a valid integer, using default value %d instead", key, defaultValue)
		return defaultValue
	}

	return value
}

// IsBool returns whether the environment variable is set to "true" or uses the default
func IsBool(key string, defaultValue bool) bool {
	value, exists := os.LookupEnv(key)
	if !exists {
		return defaultValue
	}

	enabled := value == "1" || value == "true" || value == "yes" || value == "y"
	return enabled
}

// SetEnvVar sets an environment variable
func SetEnvVar(key, value string) {
	os.Setenv(key, value)
}

// Spoofing configuration functions

// IsSpoofingEnabled returns whether spoofing mode is enabled
func IsSpoofingEnabled() bool {
	return IsBool("SPOOFING_ENABLED", false)
}

// GetSpoofingService returns which service to spoof (radarr or sonarr)
func GetSpoofingService() string {
	service := GetString("SPOOFING_SERVICE", "radarr")
	if service != "radarr" && service != "sonarr" {
		logger.Warn("Invalid SPOOFING_SERVICE value '%s', defaulting to 'radarr'", service)
		return "radarr"
	}
	return service
}

// GetSpoofingInstanceName returns the instance name for the spoofed service
func GetSpoofingInstanceName() string {
	return GetString("SPOOFING_INSTANCE_NAME", "CineSync")
}

// GetSpoofingVersion returns the version to report for the spoofed service
func GetSpoofingVersion() string {
	return GetString("SPOOFING_VERSION", "5.14.0.9383")
}

// GetSpoofingBranch returns the branch name to report
func GetSpoofingBranch() string {
	return GetString("SPOOFING_BRANCH", "master")
}

// GetSpoofingAPIKey returns the API key for spoofed service authentication
func GetSpoofingAPIKey() string {
	return GetString("SPOOFING_API_KEY", "1234567890abcdef1234567890abcdef")
}

// File Handling configuration functions

func IsReplaceIllegalCharactersEnabled() bool {
	return IsBool("REPLACE_ILLEGAL_CHARACTERS", true)
}

func GetColonReplacementMode() string {
	mode := GetString("COLON_REPLACEMENT", "Smart Replace")
	validModes := map[string]bool{
		"Delete":                        true,
		"Replace with Dash":             true,
		"Replace with Space Dash":       true,
		"Replace with Space Dash Space": true,
		"Smart Replace":                 true,
	}
	if !validModes[mode] {
		logger.Warn("Invalid COLON_REPLACEMENT mode '%s', defaulting to 'Smart Replace'", mode)
		return "Smart Replace"
	}
	return mode
}
