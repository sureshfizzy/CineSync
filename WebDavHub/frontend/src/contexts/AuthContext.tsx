import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  authEnabled: boolean;
  user: { username: string } | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Cache for auth state to prevent unnecessary checks
let authStateCache = {
  isAuthenticated: false,
  authEnabled: true,
  lastChecked: 0,
  isValid: false
};

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

// Flag to prevent concurrent auth checks
let isCheckingAuth = false;

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
        // Skip auth header for auth-related endpoints
        if (config.url?.includes('/api/auth/')) {
          return config;
        }
        const token = localStorage.getItem('cineSyncJWT');
        if (token) {
          config.headers = config.headers || {};
          config.headers['Authorization'] = `Bearer ${token}`;
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
          localStorage.removeItem('cineSyncJWT');
          setIsAuthenticated(false);
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
    const checkAuthState = async () => {
      setLoading(true);
      const token = localStorage.getItem('cineSyncJWT');
      try {
        if (token) {
          const meRes = await axios.get('/api/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          setUser(meRes.data);
          setIsAuthenticated(true);
          setAuthEnabled(true);
        } else {
          setIsAuthenticated(false);
          setUser(null);
        }
      } catch (error) {
        setIsAuthenticated(false);
        setAuthEnabled(true);
        setUser(null);
        localStorage.removeItem('cineSyncJWT');
      } finally {
        setLoading(false);
      }
    };
    checkAuthState();
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
