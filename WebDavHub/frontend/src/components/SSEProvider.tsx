import { createContext, useContext, ReactNode } from 'react';
import { useGlobalSSE } from '../hooks/useCentralizedSSE';

interface SSEContextType {
  isConnected: boolean;
  connectionError: string | null;
}

const SSEContext = createContext<SSEContextType | null>(null);

interface SSEProviderProps {
  children: ReactNode;
}

/**
 * Provider component that initializes the global SSE instance
 * This should be placed at the root of your app to ensure
 * the centralized SSE system is available throughout
 */
export function SSEProvider({ children }: SSEProviderProps) {
  const sseInstance = useGlobalSSE();

  const contextValue: SSEContextType = {
    isConnected: sseInstance.connectionState.isConnected,
    connectionError: sseInstance.connectionState.connectionError
  };

  return (
    <SSEContext.Provider value={contextValue}>
      {children}
    </SSEContext.Provider>
  );
}

/**
 * Hook to access SSE connection status from anywhere in the app
 */
export function useSSEContext() {
  const context = useContext(SSEContext);
  if (!context) {
    return {
      isConnected: false,
      connectionError: null
    };
  }
  return context;
}
