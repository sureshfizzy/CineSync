package torbox

import (
	"os"
	"path/filepath"
	"sync"

	"cinesync/pkg/logger"
	yaml "gopkg.in/yaml.v3"
)

type Config struct {
	Enabled bool   `json:"enabled" yaml:"enabled"`
	APIKey  string `json:"apiKey" yaml:"apiKey"`
}

type ConfigManager struct {
	config     *Config
	configPath string
	mutex      sync.RWMutex
}

var (
	configManager *ConfigManager
	configOnce    sync.Once
)

func GetConfigManager() *ConfigManager {
	configOnce.Do(func() {
		configManager = &ConfigManager{
			config: &Config{
				Enabled: false,
				APIKey:  "",
			},
			configPath: filepath.Join("..", "db", "torbox.yml"),
		}
		_ = configManager.loadConfig()
	})
	return configManager
}

func (cm *ConfigManager) GetConfig() *Config {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	cpy := *cm.config
	return &cpy
}

func (cm *ConfigManager) UpdateConfig(updates map[string]interface{}) error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

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

func (cm *ConfigManager) ResetConfig() error {
	cm.mutex.Lock()
	defer cm.mutex.Unlock()

	cm.config = &Config{
		Enabled: false,
		APIKey:  "",
	}
	return cm.saveConfig()
}

func (cm *ConfigManager) ValidateConfig() []string {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	var errs []string
	if cm.config.Enabled && cm.config.APIKey == "" {
		errs = append(errs, "API key is required when TorBox is enabled")
	}
	return errs
}

func (cm *ConfigManager) GetConfigStatus() map[string]interface{} {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()

	status := map[string]interface{}{
		"enabled":   cm.config.Enabled,
		"apiKeySet": cm.config.APIKey != "",
		"valid":     len(cm.ValidateConfig()) == 0,
		"errors":    cm.ValidateConfig(),
	}

	if cm.config.APIKey != "" {
		client := NewClient(cm.config.APIKey)
		status["apiStatus"] = client.GetAPIKeyStatus()
	}

	return status
}

func (cm *ConfigManager) loadConfig() error {
	dir := filepath.Dir(cm.configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		logger.Warn("Failed to create TorBox config directory %s: %v", dir, err)
	}

	data, err := os.ReadFile(cm.configPath)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Info("TorBox config file not found, using defaults")
			return cm.saveConfig()
		}
		return err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		logger.Warn("Failed to parse TorBox YAML config: %v", err)
		return err
	}

	cm.config = &cfg
	logger.Info("TorBox configuration loaded successfully")
	return nil
}

func (cm *ConfigManager) saveConfig() error {
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

	logger.Info("TorBox configuration saved successfully")
	return nil
}
