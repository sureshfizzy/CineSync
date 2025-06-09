import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import axios from 'axios';

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
          const authDisabledEndpoints = [
            '/api/mediahub/message',
            '/api/file-operations',
            '/api/database/',
            '/api/stats',
            '/api/config'
          ];

          const isAuthOptional = authDisabledEndpoints.some(endpoint =>
            config.url?.includes(endpoint)
          );

          if (!isAuthOptional) {
            config.headers = config.headers || {};
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
          const authOptionalEndpoints = [
            '/api/mediahub/message',
            '/api/file-operations',
            '/api/database/',
            '/api/stats',
            '/api/config'
          ];

          const isAuthOptional = authOptionalEndpoints.some(endpoint =>
            error.config?.url?.includes(endpoint)
          );

          if (!isAuthOptional) {
            localStorage.removeItem('cineSyncJWT');
            setIsAuthenticated(false);
            setUser(null);
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
        } catch {
          setIsAuthenticated(false);
          setUser(null);
          localStorage.removeItem('cineSyncJWT');
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
