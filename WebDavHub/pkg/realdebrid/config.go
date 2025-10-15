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
	
    // Apply updates (only enabled and apiKey)
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
	
	return status
}

