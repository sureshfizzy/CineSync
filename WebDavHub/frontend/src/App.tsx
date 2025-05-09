import { useState, useMemo, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import FileBrowser from './components/FileBrowser';
import { CircularProgress, Box } from '@mui/material';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, authEnabled } = useAuth();
  if (!authEnabled) {
    // If auth is disabled, always allow access
    return <>{children}</>;
  }
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function AppContent({ toggleTheme, mode }: { toggleTheme: () => void; mode: 'light' | 'dark' }) {
  const { authEnabled, isAuthenticated } = useAuth();
  return (
    <Router>
      <Routes>
        {/* Always define /login, but redirect if auth is disabled or already authenticated */}
        <Route
          path="/login"
          element={
            !authEnabled ? (
              <Navigate to="/dashboard" replace />
            ) : isAuthenticated ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Login toggleTheme={toggleTheme} mode={mode} />
            )
          }
        />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout toggleTheme={toggleTheme} mode={mode} />
            </PrivateRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="files/*" element={<FileBrowser />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('cineSyncTheme');
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('cineSyncTheme', mode);
  }, [mode]);

  const toggleTheme = () => setMode((prev) => (prev === 'light' ? 'dark' : 'light'));
  const theme = useMemo(() =>
    createTheme({
      palette: {
        mode,
        ...(mode === 'light'
          ? {
              background: {
                default: '#ffffff',
                paper: '#ffffff',
              },
              primary: { main: '#1976d2' },
              secondary: { main: '#fbbf24' },
              success: { main: '#22c55e' },
              divider: 'rgba(0, 0, 0, 0.12)',
            }
          : {
              background: {
                default: '#000000',
                paper: '#000000',
              },
              primary: { main: '#2196f3' },
              secondary: { main: '#fbbf24' },
              success: { main: '#22c55e' },
              divider: 'rgba(255, 255, 255, 0.12)',
            }),
      },
      components: {
        MuiAppBar: {
          styleOverrides: {
            root: {
              backgroundColor: mode === 'light' ? '#ffffff' : '#000000',
              borderBottom: `1px solid ${mode === 'light' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)'}`,
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backgroundColor: mode === 'light' ? '#ffffff' : '#000000',
              border: `1px solid ${mode === 'light' ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.12)'}`,
            },
          },
        },
      },
    }),
    [mode]
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <AppContent toggleTheme={toggleTheme} mode={mode} />
      </AuthProvider>
    </ThemeProvider>
  );
} 
