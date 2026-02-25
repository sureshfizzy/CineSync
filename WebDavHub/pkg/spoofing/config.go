package spoofing

import (
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"gopkg.in/yaml.v3"
	"cinesync/pkg/logger"
)

// SpoofingConfig holds the configuration for spoofing services
type SpoofingConfig struct {
	Enabled        bool            `yaml:"enabled" json:"enabled"`
	InstanceName   string          `json:"instanceName"`
	Version        string          `yaml:"version" json:"version"`
	Branch         string          `yaml:"branch" json:"branch"`
	APIKey         string          `yaml:"apiKey" json:"apiKey"`
	AppGuid        string          `yaml:"appGuid" json:"appGuid"`
	ServiceType    string          `yaml:"serviceType" json:"serviceType"`
	FolderMode     bool            `yaml:"folderMode" json:"folderMode"`
	FolderMappings []FolderMapping `yaml:"folderMappings" json:"folderMappings"`
}

const hardcodedInstanceName = "CineSync"

const configFileName = "config.yml"

// DefaultConfig returns the default spoofing configuration
func DefaultConfig() *SpoofingConfig {
	return &SpoofingConfig{
		Enabled:        false,
		InstanceName:   hardcodedInstanceName,
		Version:        "5.14.0.9383",
		Branch:         "master",
		APIKey:         generateAPIKey(),
		AppGuid:        generateGUID(),
		ServiceType:    "auto", // Default to auto mode to support both Radarr and Sonarr
		FolderMode:     false,
		FolderMappings: []FolderMapping{},
	}
}

// generateAPIKey generates a random 32-character API key like Radarr/Sonarr
func generateAPIKey() string {
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		hash := md5.Sum([]byte(fmt.Sprintf("cinesync-%d", time.Now().UnixNano())))
		return hex.EncodeToString(hash[:])
	}
	return hex.EncodeToString(bytes)
}

// generateGUID
func generateGUID() string {
	bytes := make([]byte, 16)
	_, err := rand.Read(bytes)
	if err != nil {
		sum := md5.Sum([]byte(fmt.Sprintf("cinesync-guid-%d", time.Now().UnixNano())))
		bytes = sum[:]
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	hexStr := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", hexStr[0:8], hexStr[8:12], hexStr[12:16], hexStr[16:20], hexStr[20:32])
}

// RegenerateAPIKey generates a new API key for the configuration
func RegenerateAPIKey() string {
	return generateAPIKey()
}

// GetApplicationName returns the application name
func (c *SpoofingConfig) GetApplicationName() string {
	return "CineSync Universal Media Server"
}

// Validate checks if the configuration is valid
func (c *SpoofingConfig) Validate() error {
	if c.Enabled && c.APIKey == "" {
		return fmt.Errorf("API key is required when spoofing is enabled")
	}

	// Set defaults
	c.InstanceName = hardcodedInstanceName
	if c.Version == "" {
		c.Version = "5.14.0.9383"
	}
	if c.Branch == "" {
		c.Branch = "master"
	}
	if strings.TrimSpace(c.AppGuid) == "" {
		c.AppGuid = generateGUID()
	}
	if c.ServiceType == "" {
		c.ServiceType = "auto"
	}

	// Validate service type
	if c.ServiceType != "radarr" && c.ServiceType != "sonarr" && c.ServiceType != "auto" {
		return fmt.Errorf("invalid service type: %s (must be 'radarr', 'sonarr', or 'auto')", c.ServiceType)
	}

	return nil
}

// Global configuration instance and mutex for thread safety
var (
	config     *SpoofingConfig
	configMux  sync.RWMutex
)

// getConfigPath returns the path to the configuration file
func getConfigPath() string {
	return filepath.Join("..", "db", configFileName)
}

// loadConfigFromFile loads configuration from YAML file
func loadConfigFromFile() (*SpoofingConfig, error) {
	configPath := getConfigPath()

	// Check if file exists
	fileInfo, err := os.Stat(configPath)
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("Config file does not exist")
	}

	if fileInfo.Size() == 0 {
		return nil, fmt.Errorf("Config file is empty")
	}

	// Read file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %v", err)
	}

	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("Config file contains only whitespace")
	}

	// Parse YAML
	var cfg SpoofingConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %v", err)
	}

	// Always set hardcoded instance name
	cfg.InstanceName = hardcodedInstanceName

	return &cfg, nil
}

// saveConfigToFile saves configuration to YAML file
func saveConfigToFile(cfg *SpoofingConfig) error {
	configPath := getConfigPath()

	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	// Marshal to YAML
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
	}

	// Write to file
	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write config file: %v", err)
	}

	return nil
}

// InitializeConfig initializes the configuration system and ensures YAML file exists
func InitializeConfig() error {
	configMux.Lock()
	defer configMux.Unlock()

	// Try to load from file first
	if cfg, err := loadConfigFromFile(); err == nil {
		config = cfg
		if strings.TrimSpace(config.AppGuid) == "" {
			config.AppGuid = generateGUID()
			if err := saveConfigToFile(config); err != nil {
				return fmt.Errorf("failed to persist generated appGuid: %v", err)
			}
		}
	} else {
		configPath := getConfigPath()
		if _, statErr := os.Stat(configPath); statErr == nil {
			logger.Info("Config file exists but is empty or invalid, creating default configuration: %v", err)
		} else {
			logger.Info("Config file not found, creating default configuration")
		}

		config = &SpoofingConfig{
			Enabled:      false,
			InstanceName: hardcodedInstanceName,
			Version:      "5.14.0.9383",
			Branch:       "master",
			APIKey:       generateAPIKey(),
			AppGuid:      generateGUID(),
			ServiceType:  "auto",
		}

		// Save default config to file
		if err := saveConfigToFile(config); err != nil {
			return fmt.Errorf("failed to save default config: %v", err)
		}
		logger.Info("Created and saved default spoofing configuration with generated API key")
	}

	return nil
}

// GetConfig returns the current spoofing configuration
func GetConfig() *SpoofingConfig {
	configMux.RLock()
	defer configMux.RUnlock()

	if config == nil {
		config = DefaultConfig()
		logger.Warn("Config was nil, using default config")
	}

	return config
}

// SetConfig updates the spoofing configuration and saves it to file
func SetConfig(newConfig *SpoofingConfig) error {
	if err := newConfig.Validate(); err != nil {
		return err
	}

	configMux.Lock()
	defer configMux.Unlock()

	config = newConfig

	if err := saveConfigToFile(config); err != nil {
		return fmt.Errorf("failed to save config: %v", err)
	}

	return nil
}
