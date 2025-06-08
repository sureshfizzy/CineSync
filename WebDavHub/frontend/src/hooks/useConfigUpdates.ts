import { useEffect, useRef, useState } from 'react';

interface ConfigUpdateEvent {
  type: 'config_changed' | 'auth_settings_changed' | 'server_restart_required' | 'connected' | 'ping';
  timestamp: number;
}

interface UseConfigUpdatesOptions {
  onConfigChange?: () => void;
  onAuthSettingsChange?: () => void;
  onServerRestartRequired?: () => void;
  enabled?: boolean;
}

export function useConfigUpdates(options: UseConfigUpdatesOptions = {}) {
  const { onConfigChange, onAuthSettingsChange, onServerRestartRequired, enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = () => {
    if (!enabled || eventSourceRef.current) {
      return;
    }

    try {
      const token = localStorage.getItem('cineSyncJWT');
      const eventSourceUrl = token
        ? `/api/config/events?token=${encodeURIComponent(token)}`
        : '/api/config/events';

      const eventSource = new EventSource(eventSourceUrl);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const data: ConfigUpdateEvent = JSON.parse(event.data);
          
          switch (data.type) {
            case 'config_changed':
              setLastUpdate(data.timestamp);
              if (onConfigChange) {
                onConfigChange();
              }
              break;
            case 'auth_settings_changed':
              setLastUpdate(data.timestamp);
              if (onAuthSettingsChange) {
                onAuthSettingsChange();
              }
              break;
            case 'server_restart_required':
              setLastUpdate(data.timestamp);
              if (onServerRestartRequired) {
                onServerRestartRequired();
              }
              break;
            case 'connected':
              break;
            case 'ping':
              break;
          }
        } catch (error) {
          console.warn('Failed to parse configuration SSE message:', error);
        }
      };

      eventSource.onerror = (error) => {
        console.warn('Configuration SSE connection error:', error);
        setIsConnected(false);
        
        // Close the current connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          console.error('Max configuration SSE reconnection attempts reached');
        }
      };

    } catch (error) {
      console.error('Failed to establish configuration SSE connection:', error);
      setIsConnected(false);
    }
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
    reconnectAttempts.current = 0;
  };

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return {
    isConnected,
    lastUpdate,
    reconnect: () => {
      disconnect();
      setTimeout(connect, 100);
    }
  };
}
