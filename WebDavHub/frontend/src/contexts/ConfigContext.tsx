import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useConfigUpdates } from '../hooks/useConfigUpdates';
import RestartRequiredPopup from '../components/RestartRequiredPopup';
import axios from 'axios';
import { getAuthHeaders } from './AuthContext';

interface RuntimeConfig {
  tmdbApiKey?: string;
  apiPort?: number;
  ip?: string;
  webdavEnabled?: boolean;
  destinationDir?: string;
  sourceDir?: string;
}

interface ConfigContextType {
  config: RuntimeConfig;
  isLoading: boolean;
  error: string | null;
  refreshConfig: () => Promise<void>;
  isConnected: boolean;
  lastUpdate: number | null;
  triggerConfigStatusRefresh: () => void;
}

const ConfigContext = createContext<ConfigContextType | undefined>(undefined);

interface ConfigProviderProps {
  children: ReactNode;
}

export function ConfigProvider({ children }: ConfigProviderProps) {
  const [config, setConfig] = useState<RuntimeConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRestartPopup, setShowRestartPopup] = useState(false);

  const refreshConfig = async () => {
    try {
      setError(null);

      // Fetch current configuration from the API
      const response = await fetch('/api/config', {
        headers: getAuthHeaders({
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch configuration');
      }

      const data = await response.json();
      
      // Extract relevant configuration values
      const newConfig: RuntimeConfig = {};
      
      if (data.config && Array.isArray(data.config)) {
        data.config.forEach((item: any) => {
          switch (item.key) {
            case 'TMDB_API_KEY':
              newConfig.tmdbApiKey = item.value;
              break;
            case 'CINESYNC_PORT':
              newConfig.apiPort = item.value ? parseInt(item.value, 10) : undefined;
              break;
            case 'CINESYNC_IP':
              newConfig.ip = item.value;
              break;

            case 'DESTINATION_DIR':
              newConfig.destinationDir = item.value;
              break;
            case 'SOURCE_DIR':
              newConfig.sourceDir = item.value;
              break;
          }
        });
      }

      setConfig(newConfig);
      
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load configuration';
      setError(errorMessage);
      console.error('Failed to refresh configuration:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Function to trigger config status refresh in other components
  const triggerConfigStatusRefresh = () => {
    window.dispatchEvent(new CustomEvent('config-status-refresh', {
      detail: { timestamp: Date.now() }
    }));
  };

  // Handle configuration changes via SSE
  const handleConfigChange = () => {
    refreshConfig();
    triggerConfigStatusRefresh();
  };

  // Handle authentication settings changes via SSE
  const handleAuthSettingsChange = () => {
    refreshConfig();
    triggerConfigStatusRefresh();
    localStorage.removeItem('cineSyncJWT');
    window.location.reload();
  };

  // Handle server restart required via SSE
  const handleServerRestartRequired = () => {
    refreshConfig();
    triggerConfigStatusRefresh();
    setShowRestartPopup(true);
  };

  // Handle server restart action
  const handleRestart = async () => {
    try {
      await axios.post('/api/restart', null, { headers: getAuthHeaders() });
    } catch (error) {
      console.error('Failed to restart server:', error);
      throw error;
    }
  };

  // Use the configuration updates hook
  const { isConnected, lastUpdate } = useConfigUpdates({
    onConfigChange: handleConfigChange,
    onAuthSettingsChange: handleAuthSettingsChange,
    onServerRestartRequired: handleServerRestartRequired,
    enabled: true
  });

  // Initial configuration load
  useEffect(() => {
    refreshConfig();
  }, []);

  const contextValue: ConfigContextType = {
    config,
    isLoading,
    error,
    refreshConfig,
    isConnected,
    lastUpdate,
    triggerConfigStatusRefresh
  };

  return (
    <ConfigContext.Provider value={contextValue}>
      {children}
      <RestartRequiredPopup
        open={showRestartPopup}
        onClose={() => setShowRestartPopup(false)}
        onRestart={handleRestart}
        newApiPort={config.apiPort?.toString()}
      />
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
}

// Hook for getting specific configuration values with fallbacks
export function useConfigValue<T>(key: keyof RuntimeConfig, fallback: T): T {
  const { config } = useConfig();
  const value = config[key];
  return value !== undefined ? (value as T) : fallback;
}

