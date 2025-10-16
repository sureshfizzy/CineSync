package realdebrid

import (
    "os"
    "path/filepath"
    "sync"

    "cinesync/pkg/logger"
    yaml "gopkg.in/yaml.v3"
)

// Config represents Real-Debrid configuration
type Config struct {
    Enabled bool   `json:"enabled" yaml:"enabled"`
    APIKey  string `json:"apiKey" yaml:"apiKey"`
    RcloneSettings RcloneSettings `json:"rcloneSettings" yaml:"rcloneSettings"`
}

// RcloneSettings represents rclone mount configuration
type RcloneSettings struct {
    Enabled         bool   `json:"enabled" yaml:"enabled"`
    MountPath       string `json:"mountPath" yaml:"mountPath"`
    RemoteName      string `json:"remoteName" yaml:"remoteName"`
    VfsCacheMode    string `json:"vfsCacheMode" yaml:"vfsCacheMode"`
    VfsCacheMaxSize string `json:"vfsCacheMaxSize" yaml:"vfsCacheMaxSize"`
    VfsCacheMaxAge  string `json:"vfsCacheMaxAge" yaml:"vfsCacheMaxAge"`
    BufferSize      string `json:"bufferSize" yaml:"bufferSize"`
    DirCacheTime    string `json:"dirCacheTime" yaml:"dirCacheTime"`
    PollInterval    string `json:"pollInterval" yaml:"pollInterval"`
    RclonePath      string `json:"rclonePath" yaml:"rclonePath"`
}

// ConfigManager manages Real-Debrid configuration
type ConfigManager struct {
	config     *Config
	configPath string
	mutex      sync.RWMutex
}

var (
	configManager *ConfigManager
	configOnce    sync.Once
)

// GetConfigManager returns the singleton config manager
func GetConfigManager() *ConfigManager {
	configOnce.Do(func() {
		configManager = &ConfigManager{
            config: &Config{
                Enabled: false,
                APIKey:  "",
                RcloneSettings: RcloneSettings{
                    Enabled:         false,
                    MountPath:       "",
                    RemoteName:      "realdebrid",
                    VfsCacheMode:    "writes",
                    VfsCacheMaxSize: "1G",
                    VfsCacheMaxAge:  "24h",
                    BufferSize:      "16M",
                    DirCacheTime:    "5m",
                    PollInterval:    "1m",
                    RclonePath:      "",
                },
            },
            configPath: filepath.Join("..", "db", "debrid.yml"),
		}
		configManager.loadConfig()
	})
	return configManager
}

// GetConfig returns the current configuration
func (cm *ConfigManager) GetConfig() *Config {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	// Return a copy to prevent external modifications
	configCopy := *cm.config
	
	// Ensure defaults are applied for rclone settings
	if configCopy.RcloneSettings.RemoteName == "" {
		configCopy.RcloneSettings.RemoteName = "realdebrid"
	}
	if configCopy.RcloneSettings.VfsCacheMode == "" {
		configCopy.RcloneSettings.VfsCacheMode = "writes"
	}
	if configCopy.RcloneSettings.VfsCacheMaxSize == "" {
		configCopy.RcloneSettings.VfsCacheMaxSize = "1G"
	}
	if configCopy.RcloneSettings.VfsCacheMaxAge == "" {
		configCopy.RcloneSettings.VfsCacheMaxAge = "24h"
	}
	if configCopy.RcloneSettings.BufferSize == "" {
		configCopy.RcloneSettings.BufferSize = "16M"
	}
	if configCopy.RcloneSettings.DirCacheTime == "" {
		configCopy.RcloneSettings.DirCacheTime = "5m"
	}
	if configCopy.RcloneSettings.PollInterval == "" {
		configCopy.RcloneSettings.PollInterval = "1m"
	}
	
	return &configCopy
}

// SetConfig updates the configuration
func (cm *ConfigManager) SetConfig(config *Config) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	cm.config = config
	return cm.saveConfig()
}

// UpdateConfig updates specific configuration fields
func (cm *ConfigManager) UpdateConfig(updates map[string]interface{}) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
    // Apply updates (enabled, apiKey, and rcloneSettings)
	for key, value := range updates {
		switch key {
		case "enabled":
			if enabled, ok := value.(bool); ok {
				cm.config.Enabled = enabled
			}
		case "apiKey":
			if apiKey, ok := value.(string); ok {
				cm.config.APIKey = apiKey
			}
		case "rcloneSettings":
			if rcloneSettingsMap, ok := value.(map[string]interface{}); ok {
				// Apply default values for empty fields
				rcloneSettings := cm.config.RcloneSettings // Start with defaults
				
				if enabled, ok := rcloneSettingsMap["enabled"].(bool); ok {
					rcloneSettings.Enabled = enabled
				}
				if mountPath, ok := rcloneSettingsMap["mountPath"].(string); ok && mountPath != "" {
					rcloneSettings.MountPath = mountPath
				}
				if remoteName, ok := rcloneSettingsMap["remoteName"].(string); ok && remoteName != "" {
					rcloneSettings.RemoteName = remoteName
				}
				if vfsCacheMode, ok := rcloneSettingsMap["vfsCacheMode"].(string); ok && vfsCacheMode != "" {
					rcloneSettings.VfsCacheMode = vfsCacheMode
				}
				if vfsCacheMaxSize, ok := rcloneSettingsMap["vfsCacheMaxSize"].(string); ok && vfsCacheMaxSize != "" {
					rcloneSettings.VfsCacheMaxSize = vfsCacheMaxSize
				}
				if vfsCacheMaxAge, ok := rcloneSettingsMap["vfsCacheMaxAge"].(string); ok && vfsCacheMaxAge != "" {
					rcloneSettings.VfsCacheMaxAge = vfsCacheMaxAge
				}
				if bufferSize, ok := rcloneSettingsMap["bufferSize"].(string); ok && bufferSize != "" {
					rcloneSettings.BufferSize = bufferSize
				}
				if dirCacheTime, ok := rcloneSettingsMap["dirCacheTime"].(string); ok && dirCacheTime != "" {
					rcloneSettings.DirCacheTime = dirCacheTime
				}
				if pollInterval, ok := rcloneSettingsMap["pollInterval"].(string); ok && pollInterval != "" {
					rcloneSettings.PollInterval = pollInterval
				}
				if rclonePath, ok := rcloneSettingsMap["rclonePath"].(string); ok {
					rcloneSettings.RclonePath = rclonePath // Allow empty string for PATH
				}
				
				cm.config.RcloneSettings = rcloneSettings
			}
		}
	}
	
	return cm.saveConfig()
}

// IsEnabled returns whether Real-Debrid is enabled
func (cm *ConfigManager) IsEnabled() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.Enabled
}

// GetAPIKey returns the API key
func (cm *ConfigManager) GetAPIKey() string {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.APIKey
}

// SetAPIKey updates the API key
func (cm *ConfigManager) SetAPIKey(apiKey string) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
	cm.config.APIKey = apiKey
	return cm.saveConfig()
}


// loadConfig loads configuration from file
func (cm *ConfigManager) loadConfig() error {
	dir := filepath.Dir(cm.configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		logger.Warn("Failed to create config directory %s: %v", dir, err)
	}

    data, err := os.ReadFile(cm.configPath)
    if err != nil {
        if os.IsNotExist(err) {
            logger.Info("Real-Debrid config file not found, using defaults")
            return cm.saveConfig()
        }
        return err
    }

    var config Config
    if err := yaml.Unmarshal(data, &config); err != nil {
        logger.Warn("Failed to parse Real-Debrid YAML config: %v", err)
        return err
    }

    // Apply defaults for missing rclone settings
    if config.RcloneSettings.RemoteName == "" {
        config.RcloneSettings.RemoteName = "realdebrid"
    }
    if config.RcloneSettings.VfsCacheMode == "" {
        config.RcloneSettings.VfsCacheMode = "writes"
    }
    if config.RcloneSettings.VfsCacheMaxSize == "" {
        config.RcloneSettings.VfsCacheMaxSize = "1G"
    }
    if config.RcloneSettings.VfsCacheMaxAge == "" {
        config.RcloneSettings.VfsCacheMaxAge = "24h"
    }
    if config.RcloneSettings.BufferSize == "" {
        config.RcloneSettings.BufferSize = "16M"
    }
    if config.RcloneSettings.DirCacheTime == "" {
        config.RcloneSettings.DirCacheTime = "5m"
    }
    if config.RcloneSettings.PollInterval == "" {
        config.RcloneSettings.PollInterval = "1m"
    }

    cm.config = &config
    logger.Info("Real-Debrid configuration loaded successfully")
    return nil
}

// saveConfig saves configuration to file
func (cm *ConfigManager) saveConfig() error {
	// Ensure the directory exists
	dir := filepath.Dir(cm.configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

    data, err := yaml.Marshal(cm.config)
	if err != nil {
		return err
	}

    if err := os.WriteFile(cm.configPath, data, 0644); err != nil {
		return err
	}

	logger.Info("Real-Debrid configuration saved successfully")
	return nil
}

// ResetConfig resets configuration to defaults
func (cm *ConfigManager) ResetConfig() error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()
	
    cm.config = &Config{
        Enabled: false,
        APIKey:  "",
        RcloneSettings: RcloneSettings{
            Enabled:         false,
            MountPath:       "",
            RemoteName:      "realdebrid",
            VfsCacheMode:    "writes",
            VfsCacheMaxSize: "1G",
            VfsCacheMaxAge:  "24h",
            BufferSize:      "16M",
            DirCacheTime:    "5m",
            PollInterval:    "1m",
            RclonePath:      "",
        },
    }
	
	return cm.saveConfig()
}

// ValidateConfig validates the current configuration
func (cm *ConfigManager) ValidateConfig() []string {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
	var errors []string
	
	if cm.config.Enabled && cm.config.APIKey == "" {
		errors = append(errors, "API key is required when Real-Debrid is enabled")
	}
	
    // Only requires API key when enabled
	
	return errors
}

// GetConfigStatus returns the configuration status
func (cm *ConfigManager) GetConfigStatus() map[string]interface{} {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	
    status := map[string]interface{}{
        "enabled":   cm.config.Enabled,
        "apiKeySet": cm.config.APIKey != "",
        "valid":     len(cm.ValidateConfig()) == 0,
        "errors":    cm.ValidateConfig(),
    }
	
	// Test API key if it's set
	if cm.config.APIKey != "" {
		client := NewClient(cm.config.APIKey)
		apiStatus := client.GetAPIKeyStatus()
		status["apiStatus"] = apiStatus
	}
	
	// Add rclone status if enabled
	if cm.config.RcloneSettings.Enabled && cm.config.RcloneSettings.MountPath != "" {
		rcloneManager := GetRcloneManager()
		rcloneStatus := rcloneManager.GetStatus(cm.config.RcloneSettings.MountPath)
		status["rcloneStatus"] = rcloneStatus
	}
	
	return status
}

