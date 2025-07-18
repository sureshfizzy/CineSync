import { useEffect, useState } from 'react';
import { useSSEEventListener } from './useCentralizedSSE';

export interface MediaHubEvent {
  type: string;
  timestamp: number;
  data: any;
}

export interface MediaHubUpdateHook {
  isConnected: boolean;
  lastEvent: MediaHubEvent | null;
  connectionError: string | null;
}

/**
 * Custom hook for receiving real-time MediaHub updates via centralized SSE
 * Now uses the centralized SSE system instead of creating its own connection
 */
export function useMediaHubUpdates(): MediaHubUpdateHook {
  const [lastEvent, setLastEvent] = useState<MediaHubEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Listen for all MediaHub events through the centralized SSE
  useSSEEventListener(
    ['*'], // Listen to all event types
    (event) => {
      // Filter for MediaHub events (either by source or by known MediaHub event types)
      const mediaHubEventTypes = [
        'symlink_created',
        'file_processed',
        'source_file_updated',
        'scan_started',
        'scan_completed',
        'scan_failed',
        'error',
        'monitor_started',
        'monitor_stopped'
      ];

      const isMediaHubEvent = event.source === 'mediahub' ||
                             mediaHubEventTypes.includes(event.type);

      if (isMediaHubEvent) {
        // Convert to MediaHub event format for backward compatibility
        setLastEvent({
          type: event.type,
          timestamp: event.timestamp,
          data: event.data
        });
        setIsConnected(true);
        setConnectionError(null);
      }
    },
    {
      source: 'mediahub', // Only listen to events from MediaHub source
      dependencies: []
    }
  );

  return {
    isConnected,
    lastEvent,
    connectionError
  };
}

/**
 * Hook for listening to specific MediaHub event types
 */
export function useMediaHubEventListener(
  eventType: string,
  callback: (event: MediaHubEvent) => void,
  dependencies: any[] = []
) {
  const { lastEvent } = useMediaHubUpdates();

  useEffect(() => {
    if (lastEvent && lastEvent.type === eventType) {
      callback(lastEvent);
    }
  }, [lastEvent, eventType, ...dependencies]);
}

/**
 * Hook for listening to symlink creation events specifically
 */
export function useSymlinkCreatedListener(
  callback: (data: any) => void,
  dependencies: any[] = []
) {
  useMediaHubEventListener('symlink_created', (event) => {
    callback(event.data);
  }, dependencies);
}
