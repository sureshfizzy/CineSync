import { useState, useMemo, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import FileBrowser from './components/FileBrowser';
import { CircularProgress, Box, Typography } from '@mui/material';

// Loading component
function LoadingScreen() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <CircularProgress />
    </Box>
  );
}

// Not Found component
function NotFound() {
  const { isAuthenticated, authEnabled } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated && authEnabled) {
      const timer = setTimeout(() => {
        navigate('/login', { state: { from: location }, replace: true });
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, authEnabled, navigate, location]);

  if (!isAuthenticated && authEnabled) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Typography variant="h4" sx={{ mb: 2 }}>Access Denied</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>You need to be logged in to access this page.</Typography>
        <Typography variant="body2" color="text.secondary">Redirecting to login page in 5 seconds...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Typography variant="h4" sx={{ mb: 2 }}>404 - Page Not Found</Typography>
      <Typography variant="body1" color="text.secondary">The page you're looking for doesn't exist.</Typography>
    </Box>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, authEnabled } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!authEnabled) {
    // If auth is disabled, always allow access
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    // Redirect to login with the return url
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

function AppContent({ toggleTheme, mode }: { toggleTheme: () => void; mode: 'light' | 'dark' }) {
  const { authEnabled, isAuthenticated } = useAuth();
  const location = useLocation();

  return (
    <Routes>
      {/* Public routes */}
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

      {/* Protected routes */}
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
        <Route path="browse/*" element={<FileBrowser />} />
      </Route>

      {/* Catch all route - 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  const [mode, setMode] = useState<'light' | 'dark'>('dark');
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
        },
      }),
    [mode],
  );

  const toggleTheme = () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <Router>
          <AppContent toggleTheme={toggleTheme} mode={mode} />
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App; 
