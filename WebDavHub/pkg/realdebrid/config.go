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
    AdditionalAPIKeys []string `json:"additionalApiKeys" yaml:"additionalApiKeys"`
    RcloneSettings RcloneSettings `json:"rcloneSettings" yaml:"rcloneSettings"`
    HttpDavSettings HttpDavSettings `json:"httpDavSettings" yaml:"httpDavSettings"`
    RateLimit RateLimitSettings `json:"rateLimit" yaml:"rateLimit"`
}

// RcloneSettings represents rclone mount configuration
type RcloneSettings struct {
	Enabled              bool   `json:"enabled" yaml:"enabled"`
	MountPath            string `json:"mountPath" yaml:"mountPath"`
	RemoteName           string `json:"remoteName" yaml:"remoteName"`
	VfsCacheMode         string `json:"vfsCacheMode" yaml:"vfsCacheMode"`
	VfsCacheMaxSize      string `json:"vfsCacheMaxSize" yaml:"vfsCacheMaxSize"`
	VfsCacheMaxAge       string `json:"vfsCacheMaxAge" yaml:"vfsCacheMaxAge"`
	CachePath            string `json:"CachePath" yaml:"CachePath"`
	BufferSize           string `json:"bufferSize" yaml:"bufferSize"`
	DirCacheTime         string `json:"dirCacheTime" yaml:"dirCacheTime"`
	PollInterval         string `json:"pollInterval" yaml:"pollInterval"`
	RclonePath           string `json:"rclonePath" yaml:"rclonePath"`
	VfsReadChunkSize     string `json:"vfsReadChunkSize" yaml:"vfsReadChunkSize"`
	VfsReadChunkSizeLimit string `json:"vfsReadChunkSizeLimit" yaml:"vfsReadChunkSizeLimit"`
	StreamBufferSize     string `json:"streamBufferSize" yaml:"streamBufferSize"`
	ServeFromRclone      bool   `json:"serveFromRclone" yaml:"serveFromRclone"`
	RetainFolderExtension bool   `json:"retainFolderExtension" yaml:"retainFolderExtension"`
	AutoMountOnStart     bool   `json:"autoMountOnStart" yaml:"autoMountOnStart"`
	AttrTimeout          string `json:"attrTimeout" yaml:"attrTimeout"`
	VfsReadAhead         string `json:"vfsReadAhead" yaml:"vfsReadAhead"`
	VfsCachePollInterval string `json:"vfsCachePollInterval" yaml:"vfsCachePollInterval"`
	Timeout              string `json:"timeout" yaml:"timeout"`
	Contimeout           string `json:"contimeout" yaml:"contimeout"`
	LowLevelRetries      string `json:"lowLevelRetries" yaml:"lowLevelRetries"`
	Retries              string `json:"retries" yaml:"retries"`
	Transfers            string `json:"transfers" yaml:"transfers"`
	VfsReadWait          string `json:"vfsReadWait" yaml:"vfsReadWait"`
	VfsWriteWait         string `json:"vfsWriteWait" yaml:"vfsWriteWait"`
	TpsLimit             string `json:"tpsLimit" yaml:"tpsLimit"`
	TpsLimitBurst        string `json:"tpsLimitBurst" yaml:"tpsLimitBurst"`
	DriveChunkSize       string `json:"driveChunkSize" yaml:"driveChunkSize"`
	MaxReadAhead         string `json:"maxReadAhead" yaml:"maxReadAhead"`
	LogLevel             string `json:"logLevel" yaml:"logLevel"`
	LogFile              string `json:"logFile" yaml:"logFile"`
}

// HttpDavSettings represents HTTP DAV configuration
type HttpDavSettings struct {
    Enabled  bool   `json:"enabled" yaml:"enabled"`
    UserID   string `json:"userId" yaml:"userId"`
    Password string `json:"password" yaml:"password"`
    BaseURL  string `json:"baseUrl" yaml:"baseUrl"`
}

// RateLimitSettings controls API throttling and retry behavior
type RateLimitSettings struct {
    RequestsPerMinute int   `json:"requestsPerMinute" yaml:"requestsPerMinute"`
    Burst             int   `json:"burst" yaml:"burst"`
    MaxRetries        int   `json:"maxRetries" yaml:"maxRetries"`
    BaseBackoffMs     int   `json:"baseBackoffMs" yaml:"baseBackoffMs"`
    MaxBackoffMs      int   `json:"maxBackoffMs" yaml:"maxBackoffMs"`
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
                AdditionalAPIKeys: []string{},
                RcloneSettings: RcloneSettings{
                    Enabled:              false,
                    MountPath:            "",
                    RemoteName:           "CineSync",
                    VfsCacheMode:         "full",
                    VfsCacheMaxSize:      "100G",
                    VfsCacheMaxAge:       "24h",
                    CachePath:            "",
                    BufferSize:           "16M",
                    DirCacheTime:         "15s",
                    PollInterval:         "15s",
                    RclonePath:           "",
                    VfsReadChunkSize:     "64M",
                    VfsReadChunkSizeLimit: "128M",
                    StreamBufferSize:     "10M",
                    ServeFromRclone:      false,
                    RetainFolderExtension: false,
                    AutoMountOnStart:     true,
                    AttrTimeout:          "1s",
                    VfsReadAhead:         "128M",
                    VfsCachePollInterval: "30s",
                    Timeout:              "10m",
                    Contimeout:           "60s",
                    LowLevelRetries:      "3",
					Retries:              "3",
					Transfers:            "4",
					VfsReadWait:          "20ms",
					VfsWriteWait:         "1s",
					TpsLimit:             "10",
                    TpsLimitBurst:        "20",
                    DriveChunkSize:       "64M",
                    MaxReadAhead:         "256M",
                },
                HttpDavSettings: HttpDavSettings{
                    Enabled:  false,
                    UserID:   "",
                    Password: "",
                    BaseURL:  "https://dav.real-debrid.com/",
                },
                RateLimit: RateLimitSettings{
                    RequestsPerMinute: 220,
                    Burst:             50,
                    MaxRetries:        5,
                    BaseBackoffMs:     500,
                    MaxBackoffMs:      8000,
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
		configCopy.RcloneSettings.RemoteName = "CineSync"
	}
	if configCopy.RcloneSettings.VfsCacheMode == "" {
		configCopy.RcloneSettings.VfsCacheMode = "full"
	}
	if configCopy.RcloneSettings.VfsCacheMaxSize == "" {
		configCopy.RcloneSettings.VfsCacheMaxSize = "100G"
	}
	if configCopy.RcloneSettings.VfsCacheMaxAge == "" {
		configCopy.RcloneSettings.VfsCacheMaxAge = "24h"
	}
	if configCopy.RcloneSettings.BufferSize == "" {
		configCopy.RcloneSettings.BufferSize = "16M"
	}
	if configCopy.RcloneSettings.DirCacheTime == "" {
		configCopy.RcloneSettings.DirCacheTime = "15s"
	}
	if configCopy.RcloneSettings.PollInterval == "" {
		configCopy.RcloneSettings.PollInterval = "15s"
	}
	if configCopy.RcloneSettings.AttrTimeout == "" {
		configCopy.RcloneSettings.AttrTimeout = "1s"
	}
	if configCopy.RcloneSettings.VfsReadAhead == "" {
		configCopy.RcloneSettings.VfsReadAhead = "128M"
	}
	if configCopy.RcloneSettings.VfsCachePollInterval == "" {
		configCopy.RcloneSettings.VfsCachePollInterval = "30s"
	}
	if configCopy.RcloneSettings.Timeout == "" {
		configCopy.RcloneSettings.Timeout = "10m"
	}
	if configCopy.RcloneSettings.Contimeout == "" {
		configCopy.RcloneSettings.Contimeout = "60s"
	}
	if configCopy.RcloneSettings.LowLevelRetries == "" {
		configCopy.RcloneSettings.LowLevelRetries = "3"
	}
	if configCopy.RcloneSettings.Retries == "" {
		configCopy.RcloneSettings.Retries = "3"
	}
	if configCopy.RcloneSettings.Transfers == "" {
		configCopy.RcloneSettings.Transfers = "4"
	}
	if configCopy.RcloneSettings.VfsReadWait == "" {
		configCopy.RcloneSettings.VfsReadWait = "20ms"
	}
	if configCopy.RcloneSettings.VfsWriteWait == "" {
		configCopy.RcloneSettings.VfsWriteWait = "1s"
	}
	if configCopy.RcloneSettings.TpsLimit == "" {
		configCopy.RcloneSettings.TpsLimit = "10"
	}
	if configCopy.RcloneSettings.TpsLimitBurst == "" {
		configCopy.RcloneSettings.TpsLimitBurst = "20"
	}
	if configCopy.RcloneSettings.DriveChunkSize == "" {
		configCopy.RcloneSettings.DriveChunkSize = "64M"
	}
	if configCopy.RcloneSettings.MaxReadAhead == "" {
		configCopy.RcloneSettings.MaxReadAhead = "256M"
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
	
    // Apply updates (enabled, apiKey, rcloneSettings, and httpDavSettings)
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
		case "additionalApiKeys":
			if tokensInterface, ok := value.([]interface{}); ok {
				tokens := make([]string, 0, len(tokensInterface))
				for _, tokenInterface := range tokensInterface {
					if token, ok := tokenInterface.(string); ok {
						tokens = append(tokens, token)
					}
				}
				cm.config.AdditionalAPIKeys = tokens
			} else if tokens, ok := value.([]string); ok {
				cm.config.AdditionalAPIKeys = tokens
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
				if CachePath, ok := rcloneSettingsMap["CachePath"].(string); ok {
					rcloneSettings.CachePath = CachePath
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
				if vfsReadChunkSize, ok := rcloneSettingsMap["vfsReadChunkSize"].(string); ok && vfsReadChunkSize != "" {
					rcloneSettings.VfsReadChunkSize = vfsReadChunkSize
				}
				if vfsReadChunkSizeLimit, ok := rcloneSettingsMap["vfsReadChunkSizeLimit"].(string); ok && vfsReadChunkSizeLimit != "" {
					rcloneSettings.VfsReadChunkSizeLimit = vfsReadChunkSizeLimit
				}
				if streamBufferSize, ok := rcloneSettingsMap["streamBufferSize"].(string); ok && streamBufferSize != "" {
					rcloneSettings.StreamBufferSize = streamBufferSize
				}
				if serveFromRclone, ok := rcloneSettingsMap["serveFromRclone"].(bool); ok {
					rcloneSettings.ServeFromRclone = serveFromRclone
				}
				if retainFolderExtension, ok := rcloneSettingsMap["retainFolderExtension"].(bool); ok {
					rcloneSettings.RetainFolderExtension = retainFolderExtension
				}
				if autoMountOnStart, ok := rcloneSettingsMap["autoMountOnStart"].(bool); ok {
					rcloneSettings.AutoMountOnStart = autoMountOnStart
				}
				if attrTimeout, ok := rcloneSettingsMap["attrTimeout"].(string); ok && attrTimeout != "" {
					rcloneSettings.AttrTimeout = attrTimeout
				}
				if vfsReadAhead, ok := rcloneSettingsMap["vfsReadAhead"].(string); ok && vfsReadAhead != "" {
					rcloneSettings.VfsReadAhead = vfsReadAhead
				}
				if vfsCachePollInterval, ok := rcloneSettingsMap["vfsCachePollInterval"].(string); ok && vfsCachePollInterval != "" {
					rcloneSettings.VfsCachePollInterval = vfsCachePollInterval
				}
				if timeout, ok := rcloneSettingsMap["timeout"].(string); ok && timeout != "" {
					rcloneSettings.Timeout = timeout
				}
				if contimeout, ok := rcloneSettingsMap["contimeout"].(string); ok && contimeout != "" {
					rcloneSettings.Contimeout = contimeout
				}
				if lowLevelRetries, ok := rcloneSettingsMap["lowLevelRetries"].(string); ok && lowLevelRetries != "" {
					rcloneSettings.LowLevelRetries = lowLevelRetries
				}
				if retries, ok := rcloneSettingsMap["retries"].(string); ok && retries != "" {
					rcloneSettings.Retries = retries
				}
				if transfers, ok := rcloneSettingsMap["transfers"].(string); ok && transfers != "" {
					rcloneSettings.Transfers = transfers
				}
				if vfsReadWait, ok := rcloneSettingsMap["vfsReadWait"].(string); ok && vfsReadWait != "" {
					rcloneSettings.VfsReadWait = vfsReadWait
				}
				if vfsWriteWait, ok := rcloneSettingsMap["vfsWriteWait"].(string); ok && vfsWriteWait != "" {
					rcloneSettings.VfsWriteWait = vfsWriteWait
				}
				if tpsLimit, ok := rcloneSettingsMap["tpsLimit"].(string); ok && tpsLimit != "" {
					rcloneSettings.TpsLimit = tpsLimit
				}
				if tpsLimitBurst, ok := rcloneSettingsMap["tpsLimitBurst"].(string); ok && tpsLimitBurst != "" {
					rcloneSettings.TpsLimitBurst = tpsLimitBurst
				}
				if driveChunkSize, ok := rcloneSettingsMap["driveChunkSize"].(string); ok && driveChunkSize != "" {
					rcloneSettings.DriveChunkSize = driveChunkSize
				}
				if maxReadAhead, ok := rcloneSettingsMap["maxReadAhead"].(string); ok && maxReadAhead != "" {
					rcloneSettings.MaxReadAhead = maxReadAhead
				}
				if logLevel, ok := rcloneSettingsMap["logLevel"].(string); ok {
					rcloneSettings.LogLevel = logLevel
				}
				if logFile, ok := rcloneSettingsMap["logFile"].(string); ok {
					rcloneSettings.LogFile = logFile
				}
				
				cm.config.RcloneSettings = rcloneSettings
			}
		case "httpDavSettings":
			if httpDavSettingsMap, ok := value.(map[string]interface{}); ok {
				httpDavSettings := cm.config.HttpDavSettings
				
				if enabled, ok := httpDavSettingsMap["enabled"].(bool); ok {
					httpDavSettings.Enabled = enabled
				}
				if userId, ok := httpDavSettingsMap["userId"].(string); ok {
					httpDavSettings.UserID = userId
				}
				if password, ok := httpDavSettingsMap["password"].(string); ok {
					httpDavSettings.Password = password
				}
				httpDavSettings.BaseURL = "https://dav.real-debrid.com/"
				
				cm.config.HttpDavSettings = httpDavSettings
			}
        case "rateLimit":
            if rateLimitMap, ok := value.(map[string]interface{}); ok {
                rl := cm.config.RateLimit
                if rpm, ok := asInt(rateLimitMap["requestsPerMinute"]); ok && rpm > 0 { rl.RequestsPerMinute = rpm }
                if burst, ok := asInt(rateLimitMap["burst"]); ok && burst >= 0 { rl.Burst = burst }
                if maxRetries, ok := asInt(rateLimitMap["maxRetries"]); ok && maxRetries >= 0 { rl.MaxRetries = maxRetries }
                if baseMs, ok := asInt(rateLimitMap["baseBackoffMs"]); ok && baseMs >= 0 { rl.BaseBackoffMs = baseMs }
                if maxMs, ok := asInt(rateLimitMap["maxBackoffMs"]); ok && maxMs >= 0 { rl.MaxBackoffMs = maxMs }
                cm.config.RateLimit = rl
            }
		}
	}
	
	return cm.saveConfig()
}

// helper to coerce float64/json numbers to int safely
func asInt(v interface{}) (int, bool) {
    switch t := v.(type) {
    case int:
        return t, true
    case int64:
        return int(t), true
    case float64:
        return int(t), true
    case float32:
        return int(t), true
    default:
        return 0, false
    }
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

// IsServeFromRclone returns whether to serve from rclone mount
func (cm *ConfigManager) IsServeFromRclone() bool {
	cm.mutex.RLock()
	defer cm.mutex.RUnlock()
	return cm.config.RcloneSettings.ServeFromRclone
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
        config.RcloneSettings.RemoteName = "CineSync"
    }
    if config.RcloneSettings.VfsCacheMode == "" {
        config.RcloneSettings.VfsCacheMode = "full"
    }
    if config.RcloneSettings.VfsCacheMaxSize == "" {
        config.RcloneSettings.VfsCacheMaxSize = "100G"
    }
    if config.RcloneSettings.VfsCacheMaxAge == "" {
        config.RcloneSettings.VfsCacheMaxAge = "24h"
    }
    if config.RcloneSettings.BufferSize == "" {
        config.RcloneSettings.BufferSize = "16M"
    }
    if config.RcloneSettings.DirCacheTime == "" {
        config.RcloneSettings.DirCacheTime = "15s"
    }
    if config.RcloneSettings.PollInterval == "" {
        config.RcloneSettings.PollInterval = "15s"
    }
    if config.RcloneSettings.AttrTimeout == "" {
        config.RcloneSettings.AttrTimeout = "1s"
    }
    if config.RcloneSettings.VfsReadAhead == "" {
        config.RcloneSettings.VfsReadAhead = "128M"
    }
    if config.RcloneSettings.VfsCachePollInterval == "" {
        config.RcloneSettings.VfsCachePollInterval = "30s"
    }
    if config.RcloneSettings.Timeout == "" {
        config.RcloneSettings.Timeout = "10m"
    }
    if config.RcloneSettings.Contimeout == "" {
        config.RcloneSettings.Contimeout = "60s"
    }
    if config.RcloneSettings.LowLevelRetries == "" {
        config.RcloneSettings.LowLevelRetries = "3"
    }
    if config.RcloneSettings.Retries == "" {
        config.RcloneSettings.Retries = "3"
    }
    if config.RcloneSettings.Transfers == "" {
        config.RcloneSettings.Transfers = "4"
    }
    if config.RcloneSettings.VfsReadWait == "" {
        config.RcloneSettings.VfsReadWait = "20ms"
    }
	if config.RcloneSettings.VfsWriteWait == "" {
		config.RcloneSettings.VfsWriteWait = "1s"
	}
	if config.RcloneSettings.TpsLimit == "" {
        config.RcloneSettings.TpsLimit = "10"
    }
    if config.RcloneSettings.TpsLimitBurst == "" {
        config.RcloneSettings.TpsLimitBurst = "20"
    }
    if config.RcloneSettings.DriveChunkSize == "" {
        config.RcloneSettings.DriveChunkSize = "64M"
    }
    if config.RcloneSettings.MaxReadAhead == "" {
        config.RcloneSettings.MaxReadAhead = "256M"
    }

    config.HttpDavSettings.BaseURL = "https://dav.real-debrid.com/"

    // Apply defaults for rate limiting
    if config.RateLimit.RequestsPerMinute <= 0 {
        config.RateLimit.RequestsPerMinute = 220
    }
    if config.RateLimit.Burst <= 0 {
        config.RateLimit.Burst = 50
    }
    if config.RateLimit.MaxRetries <= 0 {
        config.RateLimit.MaxRetries = 5
    }
    if config.RateLimit.BaseBackoffMs <= 0 {
        config.RateLimit.BaseBackoffMs = 500
    }
    if config.RateLimit.MaxBackoffMs <= 0 {
        config.RateLimit.MaxBackoffMs = 8000
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
            Enabled:              false,
            MountPath:            "",
            RemoteName:           "realdebrid",
            VfsCacheMode:         "writes",
            VfsCacheMaxSize:      "100G",
            VfsCacheMaxAge:       "24h",
            CachePath:         "",
            BufferSize:           "16M",
            DirCacheTime:         "15s",
            PollInterval:         "15s",
            RclonePath:           "",
            VfsReadChunkSize:     "64M",
            VfsReadChunkSizeLimit: "128M",
            StreamBufferSize:     "10M",
            ServeFromRclone:      false,
            RetainFolderExtension: false,
            AutoMountOnStart:     false,
        },
        HttpDavSettings: HttpDavSettings{
            Enabled:  false,
            UserID:   "",
            Password: "",
            BaseURL:  "https://dav.real-debrid.com/",
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
	
	// Validate HTTP DAV settings if enabled
	if cm.config.HttpDavSettings.Enabled {
		if cm.config.HttpDavSettings.UserID == "" {
			errors = append(errors, "HTTP DAV User ID is required when HTTP DAV is enabled")
		}
		if cm.config.HttpDavSettings.Password == "" {
			errors = append(errors, "HTTP DAV Password is required when HTTP DAV is enabled")
		}
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
	
	// Add HTTP DAV status if enabled
	if cm.config.HttpDavSettings.Enabled {
		httpDavStatus := map[string]interface{}{
			"enabled":     cm.config.HttpDavSettings.Enabled,
			"userIdSet":   cm.config.HttpDavSettings.UserID != "",
			"passwordSet": cm.config.HttpDavSettings.Password != "",
			"baseUrl":     "https://dav.real-debrid.com/",
		}
		
		// Test connection if credentials are set
		if cm.config.HttpDavSettings.UserID != "" && cm.config.HttpDavSettings.Password != "" {
			httpDavClient := NewHttpDavClient(
				cm.config.HttpDavSettings.UserID,
				cm.config.HttpDavSettings.Password,
				"https://dav.real-debrid.com/",
			)
			
			if err := httpDavClient.TestConnection(); err != nil {
				httpDavStatus["connectionError"] = err.Error()
				httpDavStatus["connected"] = false
			} else {
				httpDavStatus["connected"] = true
			}
		} else {
			httpDavStatus["connected"] = false
		}
		
		status["httpDavStatus"] = httpDavStatus
	}
	
	return status
}

