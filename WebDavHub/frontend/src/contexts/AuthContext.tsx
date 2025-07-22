import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import axios from 'axios';
import { getGlobalSSEInstanceSafe } from '../hooks/useCentralizedSSE';

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  authEnabled: boolean;
  user: { username: string } | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [user, setUser] = useState<{ username: string } | null>(null);

  // Function to trigger SSE reconnection when auth state changes
  const triggerSSEReconnection = () => {
    const sseInstance = getGlobalSSEInstanceSafe();
    if (sseInstance) {
      console.log('Triggering SSE reconnection due to auth state change');
      sseInstance.reconnect();
    }
  };

  // Configure axios defaults and interceptors
  useEffect(() => {
    axios.defaults.headers.common['Content-Type'] = 'application/json';
    // Add request interceptor to attach JWT
    const interceptor = axios.interceptors.request.use(
      (config) => {
        // Skip auth header for auth-related endpoints and config-status
        if (config.url?.includes('/api/auth/') || config.url?.includes('/api/config-status')) {
          return config;
        }

        // For SSE endpoints, add token as query parameter instead of header
        if (config.url?.includes('/events')) {
          const token = localStorage.getItem('cineSyncJWT');
          if (token && !config.url.includes('token=')) {
            const separator = config.url.includes('?') ? '&' : '?';
            config.url = `${config.url}${separator}token=${encodeURIComponent(token)}`;
          }
          return config;
        }
        const token = localStorage.getItem('cineSyncJWT');
        if (token) {
          config.headers = config.headers || {};
          config.headers['Authorization'] = `Bearer ${token}`;
        } else {
          const authOptionalPaths = [
            '/api/health', '/api/auth/', '/api/download', '/api/config', '/api/mediahub/message',
            '/api/mediahub/events', '/api/mediahub/logs', '/api/file-operations', '/api/source-browse',
            '/api/database/', '/api/stats', '/api/jobs', '/api/python-bridge/terminate',
            '/api/v3/system/status', '/api/system/status', '/api/v3/health', '/api/v3/rootfolder',
            '/api/v3/qualityprofile', '/api/v3/languageprofile', '/api/v3/tag', '/api/v3/movie',
            '/api/v3/series', '/api/v3/episode', '/api/spoofing/config', '/api/spoofing/switch',
            '/api/spoofing/regenerate-key', '/api'
          ];

          const isAuthOptional = authOptionalPaths.some(path => config.url?.includes(path));

          if (!isAuthOptional) {
            config.headers = config.headers || {};
            config.headers['Authorization'] = `Bearer ${token}`;
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    // Add response interceptor to handle 401
    const respInterceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          // Check if this is an endpoint where auth might be optional
          const authOptionalPaths = [
            '/api/health', '/api/auth/', '/api/download', '/api/config', '/api/mediahub/message',
            '/api/mediahub/events', '/api/mediahub/logs', '/api/file-operations', '/api/source-browse',
            '/api/database/', '/api/stats', '/api/jobs', '/api/python-bridge/terminate',
            '/api/v3/system/status', '/api/system/status', '/api/v3/health', '/api/v3/rootfolder',
            '/api/v3/qualityprofile', '/api/v3/languageprofile', '/api/v3/tag', '/api/v3/movie',
            '/api/v3/series', '/api/v3/episode', '/api/spoofing/config', '/api/spoofing/switch',
            '/api/spoofing/regenerate-key', '/api'
          ];

          const isAuthOptional = authOptionalPaths.some(path =>
            error.config?.url?.includes(path)
          );

          if (!isAuthOptional) {
            localStorage.removeItem('cineSyncJWT');
            setIsAuthenticated(false);
            setUser(null);
            // Trigger SSE reconnection when token becomes invalid
            triggerSSEReconnection();
          }
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.request.eject(interceptor);
      axios.interceptors.response.eject(respInterceptor);
    };
  }, []);

  useEffect(() => {
    const checkAuthEnabled = async () => {
      setLoading(true);
      try {
        const res = await axios.get('/api/auth/enabled');
        setAuthEnabled(res.data.enabled);
        if (!res.data.enabled) {
          setIsAuthenticated(true);
          setUser({ username: 'Guest' });
          setLoading(false);
          return;
        }
      } catch {
        setAuthEnabled(true); // fallback to enabled if error
      }
      // If enabled, check JWT
      const token = localStorage.getItem('cineSyncJWT');
      if (token) {
        try {
          const meRes = await axios.get('/api/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(meRes.data);
          setIsAuthenticated(true);
          // Trigger SSE reconnection with existing token
          triggerSSEReconnection();
        } catch {
          setIsAuthenticated(false);
          setUser(null);
          localStorage.removeItem('cineSyncJWT');
          // Trigger SSE reconnection without token
          triggerSSEReconnection();
        }
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
      setLoading(false);
    };
    checkAuthEnabled();
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', { username, password });
      if (response.status === 200 && response.data.token) {
        localStorage.setItem('cineSyncJWT', response.data.token);
        // Fetch user info after login
        const meRes = await axios.get('/api/me', {
          headers: { Authorization: `Bearer ${response.data.token}` },
        });
        setUser(meRes.data);
        setIsAuthenticated(true);
        // Trigger SSE reconnection with new token
        triggerSSEReconnection();
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      console.error('Login failed:', error);
      setIsAuthenticated(false);
      setUser(null);
      localStorage.removeItem('cineSyncJWT');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('cineSyncJWT');
    setIsAuthenticated(false);
    setUser(null);
    // Trigger SSE reconnection without token
    triggerSSEReconnection();
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, login, logout, authEnabled, user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
