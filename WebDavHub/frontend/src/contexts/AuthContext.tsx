import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // On mount, check for stored credentials
  useEffect(() => {
    const stored = localStorage.getItem('cineSyncAuth');
    if (stored) {
      try {
        const { username, password } = JSON.parse(stored);
        if (username && password) {
          axios.defaults.auth = { username, password };
          // Verify credentials are still valid
          axios.get('/api/auth/test')
            .then(() => {
              setIsAuthenticated(true);
            })
            .catch(() => {
              // If credentials are invalid, clear them
              localStorage.removeItem('cineSyncAuth');
              delete axios.defaults.auth;
              setIsAuthenticated(false);
            })
            .finally(() => {
              setLoading(false);
            });
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string) => {
    setLoading(true);
    try {
      axios.defaults.auth = { username, password };
      await axios.get('/api/auth/test');
      setIsAuthenticated(true);
      localStorage.setItem('cineSyncAuth', JSON.stringify({ username, password }));
    } catch (error) {
      setIsAuthenticated(false);
      localStorage.removeItem('cineSyncAuth');
      delete axios.defaults.auth;
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    delete axios.defaults.auth;
    setIsAuthenticated(false);
    localStorage.removeItem('cineSyncAuth');
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, loading, login, logout }}>
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