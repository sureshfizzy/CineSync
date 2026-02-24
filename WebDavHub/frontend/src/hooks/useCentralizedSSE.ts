import { useEffect, useRef, useState, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  timestamp: number;
  data: any;
  source?: string;
}

export interface SSEConnectionState {
  isConnected: boolean;
  connectionError: string | null;
  lastEvent: SSEEvent | null;
  reconnectAttempts: number;
}

export interface SSEEventHandler {
  id: string;
  eventTypes: string[];
  callback: (event: SSEEvent) => void;
  source?: string;
}

/**
 * Centralized SSE hook that manages multiple connections for different sources
 * This replaces multiple individual SSE connections throughout the app
 * Uses existing backend endpoints until a unified endpoint is available
 */
export function useCentralizedSSE() {
  const [connectionState, setConnectionState] = useState<SSEConnectionState>({
    isConnected: false,
    connectionError: null,
    lastEvent: null,
    reconnectAttempts: 0
  });

  const eventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const eventHandlersRef = useRef<Map<string, SSEEventHandler>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Map of sources to their endpoints
  const sourceEndpoints = {
    'mediahub': '/api/mediahub/events',
    'dashboard': '/api/dashboard/events',
    'file-operations': '/api/file-operations/events',
    'jobs': '/api/jobs/events',
    'config': '/api/config/events'
  };

  // Update overall connection state based on individual connections
  const updateConnectionState = useCallback(() => {
    const hasConnections = eventSourcesRef.current.size > 0;
    setConnectionState(prev => ({
      ...prev,
      isConnected: hasConnections,
      connectionError: hasConnections ? null : 'No active connections'
    }));
  }, []);

  // Clean up connections that are no longer needed
  const cleanupUnusedConnections = useCallback(() => {
    const usedSources = new Set<string>();
    eventHandlersRef.current.forEach(handler => {
      if (handler.source) {
        usedSources.add(handler.source);
      }
    });

    eventSourcesRef.current.forEach((eventSource, source) => {
      if (!usedSources.has(source)) {
        console.log(`Cleaning up unused SSE connection for ${source}`);
        eventSource.close();
        eventSourcesRef.current.delete(source);
      }
    });

    updateConnectionState();
  }, [updateConnectionState]);

  // Dispatch events to registered handlers
  const dispatchSSEEvent = useCallback((event: SSEEvent) => {
    eventHandlersRef.current.forEach((handler) => {
      // Check if handler is interested in this event type
      const isInterestedInType = handler.eventTypes.includes('*') ||
                                handler.eventTypes.includes(event.type);

      // Check if handler is interested in this source (if specified)
      const isInterestedInSource = !handler.source ||
                                  !event.source ||
                                  handler.source === event.source;

      if (isInterestedInType && isInterestedInSource) {
        try {
          handler.callback(event);
        } catch (error) {
          console.error(`Error in SSE handler ${handler.id}:`, error);
        }
      }
    });
  }, []);

  // Connect to a specific source
  const connectToSource = useCallback((source: string) => {
    if (eventSourcesRef.current.has(source)) {
      return;
    }

    const endpoint = sourceEndpoints[source as keyof typeof sourceEndpoints];
    if (!endpoint) {
      console.warn(`Unknown SSE source: ${source}`);
      return;
    }

    try {
      const token = localStorage.getItem('cineSyncJWT');
      const params = new URLSearchParams();
      if (token) params.set('token', token);
      const eventSourceUrl = params.toString()
        ? `${endpoint}?${params.toString()}`
        : endpoint;

      const eventSource = new EventSource(eventSourceUrl);
      eventSourcesRef.current.set(source, eventSource);

      eventSource.onopen = () => {
        console.log(`SSE connection established for ${source}`);
        updateConnectionState();
      };

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle connection confirmation
          if (data.type === 'connected') {
            console.log(`SSE connection confirmed for ${source}`);
            return;
          }

          // Create standardized event object
          const sseEvent: SSEEvent = {
            type: data.type,
            timestamp: data.timestamp || Date.now(),
            data: data.data || data,
            source: source
          };

          // Update last event
          setConnectionState(prev => ({
            ...prev,
            lastEvent: sseEvent
          }));

          // Dispatch to all registered handlers
          dispatchSSEEvent(sseEvent);

          console.log(`Received SSE event from ${source}:`, sseEvent.type, sseEvent);
        } catch (err) {
          console.warn(`Failed to parse SSE message from ${source}:`, err);
        }
      };

      eventSource.onerror = (error) => {
        console.warn(`SSE connection error for ${source}:`, error);
        eventSourcesRef.current.delete(source);
        updateConnectionState();
      };

    } catch (error) {
      console.error(`Failed to establish SSE connection for ${source}:`, error);
    }
  }, [updateConnectionState, dispatchSSEEvent]);

  // Register an event handler and ensure its source connection exists
  const registerHandler = useCallback((handler: SSEEventHandler) => {
    eventHandlersRef.current.set(handler.id, handler);

    // Ensure connection exists for this handler's source
    if (handler.source && !eventSourcesRef.current.has(handler.source)) {
      connectToSource(handler.source);
    }

    return () => {
      eventHandlersRef.current.delete(handler.id);
      setTimeout(() => {
        cleanupUnusedConnections();
      }, 3000);
    };
  }, [connectToSource, cleanupUnusedConnections]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourcesRef.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourcesRef.current.clear();

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  return {
    connectionState,
    registerHandler,
    reconnect: () => {
      const activeSources = Array.from(eventSourcesRef.current.keys());
      eventSourcesRef.current.forEach((eventSource) => {
        eventSource.close();
      });
      eventSourcesRef.current.clear();

      activeSources.forEach(source => {
        connectToSource(source);
      });
    }
  };
}

// Global singleton instance
let globalSSEInstance: ReturnType<typeof useCentralizedSSE> | null = null;

/**
 * Get or create the global SSE instance
 */
export function getGlobalSSEInstance() {
  if (!globalSSEInstance) {
    throw new Error('Global SSE instance not initialized. Make sure to use SSEProvider or call useCentralizedSSE() in a component first.');
  }
  return globalSSEInstance;
}

/**
 * Safely get the global SSE instance without throwing an error
 */
export function getGlobalSSEInstanceSafe() {
  return globalSSEInstance;
}

/**
 * Hook for listening to specific event types through the centralized SSE
 * This version waits for the global SSE instance to be available
 */
export function useSSEEventListener(
  eventTypes: string | string[],
  callback: (event: SSEEvent) => void,
  options: {
    source?: string;
    dependencies?: any[];
    enabled?: boolean;
  } = {}
) {
  const { source, dependencies = [], enabled = true } = options;

  const eventTypesArray = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  const handlerId = useRef(`handler_${Date.now()}_${Math.random()}`);
  const [isReady, setIsReady] = useState(false);

  // Check if global instance is available
  useEffect(() => {
    const checkInstance = () => {
      if (globalSSEInstance) {
        setIsReady(true);
      } else {
        setTimeout(checkInstance, 100);
      }
    };
    checkInstance();
  }, []);

  useEffect(() => {
    if (!enabled || !isReady || !globalSSEInstance) return;

    // Use global instance
    const unregister = globalSSEInstance.registerHandler({
      id: handlerId.current,
      eventTypes: eventTypesArray,
      callback,
      source
    });

    return unregister;
  }, [enabled, source, callback, isReady, ...eventTypesArray, ...dependencies]);
}

/**
 * Hook that creates and manages the global SSE instance
 * Should be used once at the app level
 */
export function useGlobalSSE() {
  const sseInstance = useCentralizedSSE();

  useEffect(() => {
    if (!globalSSEInstance) {
      globalSSEInstance = sseInstance;
      console.log('Global SSE instance initialized');
    }
  }, [sseInstance]);

  return sseInstance;
}
