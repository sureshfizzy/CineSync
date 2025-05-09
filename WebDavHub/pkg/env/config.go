package env

import (
	"os"
	"strconv"
	"strings"
        "path/filepath"

	"github.com/joho/godotenv"
	"cinesync/pkg/logger"
)

// LoadEnv loads environment variables from .env file
func LoadEnv() {
    cwd, err := os.Getwd()
    if err != nil {
        logger.Warn("Could not determine current working directory.")
        return
    }

    parentDir := filepath.Dir(cwd)
    envPath := filepath.Join(parentDir, ".env")

    err = godotenv.Load(envPath)
    if err != nil {
        logger.Warn("Could not load .env from %s. Using defaults.", envPath)
    } else {
        logger.Debug("Environment variables loaded from %s", envPath)
    }
}

// IsWebDAVEnabled checks if WebDAV is enabled in the environment
func IsWebDAVEnabled() bool {
	value, exists := os.LookupEnv("CINESYNC_WEBDAV")
	if !exists {
		logger.Debug("WEBDAV environment variable not set, defaulting to false")
		return false
	}

	enabled := strings.ToLower(value) == "true"
	logger.Debug("WEBDAV environment variable set to %s", value)
	return enabled
}

// GetString returns the environment variable value or a default if not set
func GetString(key string, defaultValue string) string {
	value, exists := os.LookupEnv(key)
	if !exists {
		logger.Debug("Environment variable %s not set, using default value: %s", key, defaultValue)
		return defaultValue
	}

	return value
}

// GetInt returns the environment variable value as int or a default if not set
func GetInt(key string, defaultValue int) int {
	valueStr, exists := os.LookupEnv(key)
	if !exists {
		logger.Debug("Environment variable %s not set, using default value: %d", key, defaultValue)
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
		logger.Debug("Environment variable %s not set, using default value: %t", key, defaultValue)
		return defaultValue
	}

	enabled := value == "1" || value == "true" || value == "yes" || value == "y"
	return enabled
}
