import { useState } from 'react';
import { useSSEEventListener, useCentralizedSSE } from './useCentralizedSSE';

interface UseConfigUpdatesOptions {
  onConfigChange?: () => void;
  onAuthSettingsChange?: () => void;
  onServerRestartRequired?: () => void;
  enabled?: boolean;
}

export function useConfigUpdates(options: UseConfigUpdatesOptions = {}) {
  const { onConfigChange, onAuthSettingsChange, onServerRestartRequired, enabled = true } = options;
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const { connectionState } = useCentralizedSSE();

  // Listen for config-related events through the centralized SSE
  useSSEEventListener(
    ['config_changed', 'auth_settings_changed', 'server_restart_required', 'connected', 'ping'],
    (event) => {
      switch (event.type) {
        case 'config_changed':
          setLastUpdate(event.timestamp);
          if (onConfigChange) {
            onConfigChange();
          }
          break;
        case 'auth_settings_changed':
          setLastUpdate(event.timestamp);
          if (onAuthSettingsChange) {
            onAuthSettingsChange();
          }
          break;
        case 'server_restart_required':
          setLastUpdate(event.timestamp);
          if (onServerRestartRequired) {
            onServerRestartRequired();
          }
          break;
        case 'connected':
        case 'ping':
          break;
      }
    },
    {
      source: 'config',
      dependencies: [onConfigChange, onAuthSettingsChange, onServerRestartRequired],
      enabled
    }
  );

  return {
    isConnected: connectionState.isConnected,
    lastUpdate,
    reconnect: connectionState.reconnectAttempts > 0 ? () => {
      window.location.reload();
    } : undefined
  };
}
