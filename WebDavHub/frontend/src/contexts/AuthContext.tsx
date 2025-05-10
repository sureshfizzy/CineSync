import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  authEnabled: boolean;
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

  // Configure axios defaults and interceptors
  useEffect(() => {
    // Set default headers for all requests
    axios.defaults.headers.common['Content-Type'] = 'application/json';
    
    // Add request interceptor to handle auth
    const interceptor = axios.interceptors.request.use(
      (config) => {
        // Skip auth header for auth-related endpoints
        if (config.url?.includes('/api/auth/')) {
          return config;
        }

        const stored = localStorage.getItem('cineSyncAuth');
        if (stored) {
          try {
            const { username, password } = JSON.parse(stored);
            if (username && password) {
              config.auth = { username, password };
            }
          } catch (e) {
            console.error('Failed to parse stored auth:', e);
          }
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(interceptor);
    };
  }, []);

  // Check authentication state
  useEffect(() => {
    const checkAuthState = async () => {
      // Prevent concurrent auth checks
      if (isCheckingAuth) {
        return;
      }

      // Use cached state if it's still valid
      const now = Date.now();
      if (authStateCache.isValid && (now - authStateCache.lastChecked) < CACHE_DURATION) {
        setIsAuthenticated(authStateCache.isAuthenticated);
        setAuthEnabled(authStateCache.authEnabled);
        setLoading(false);
        return;
      }

      isCheckingAuth = true;
      try {
        // Single API call to check auth state
        const stored = localStorage.getItem('cineSyncAuth');
        let credentials = null;
        
        if (stored) {
          try {
            credentials = JSON.parse(stored);
          } catch (e) {
            console.error('Failed to parse stored auth:', e);
          }
        }

        const response = await axios.post('/api/auth/check', null, {
          auth: credentials ? { username: credentials.username, password: credentials.password } : undefined
        });

        const { isAuthenticated: authState, authEnabled: enabled } = response.data;
        
        setIsAuthenticated(authState);
        setAuthEnabled(enabled);

        // Update cache
        authStateCache = {
          isAuthenticated: authState,
          authEnabled: enabled,
          lastChecked: now,
          isValid: true
        };

        // Clear invalid stored credentials
        if (!authState && stored) {
          localStorage.removeItem('cineSyncAuth');
        }
      } catch (error) {
        console.error('Auth state check failed:', error);
        // Fallback to requiring auth
        setAuthEnabled(true);
        setIsAuthenticated(false);
        localStorage.removeItem('cineSyncAuth');
        
        // Update cache
        authStateCache = {
          isAuthenticated: false,
          authEnabled: true,
          lastChecked: now,
          isValid: true
        };
      } finally {
        setLoading(false);
        isCheckingAuth = false;
      }
    };

    checkAuthState();
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      const response = await axios.post('/api/auth/login', null, {
        auth: { username, password }
      });
      
      if (response.status === 200) {
        localStorage.setItem('cineSyncAuth', JSON.stringify({ username, password }));
        setIsAuthenticated(true);
        // Update cache
        authStateCache = {
          isAuthenticated: true,
          authEnabled: true,
          lastChecked: Date.now(),
          isValid: true
        };
        console.log('Login successful for user:', username);
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          console.error('Authentication failed: Invalid credentials');
        } else {
          console.error('Authentication error:', error.response?.data || error.message);
        }
      }
      setIsAuthenticated(false);
      localStorage.removeItem('cineSyncAuth');
      // Update cache
      authStateCache = {
        isAuthenticated: false,
        authEnabled: true,
        lastChecked: Date.now(),
        isValid: true
      };
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    console.log('User logged out');
    localStorage.removeItem('cineSyncAuth');
    setIsAuthenticated(false);
    // Update cache
    authStateCache = {
      isAuthenticated: false,
      authEnabled: true,
      lastChecked: Date.now(),
      isValid: true
    };
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, login, logout, authEnabled }}>
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
