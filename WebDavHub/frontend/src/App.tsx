import { useState, useMemo, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Layout from './components/Layout/Layout';
import Login from './components/Auth/Login';
import Dashboard from './components/Dashboard/Dashboard';
import FileBrowser from './components/FileBrowser/FileBrowser';
import { CircularProgress, Box, Typography, Button, GlobalStyles } from '@mui/material';
import { motion } from 'framer-motion';
import { Dashboard as DashboardIcon } from '@mui/icons-material';
import { getTheme } from './theme';
import MediaDetails from './pages/MediaDetails';
import Settings from './pages/Settings';
import FileOperations from './pages/FileOperations';
import { TmdbProvider } from './contexts/TmdbContext';
import { ConfigProvider } from './contexts/ConfigContext';

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
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!isAuthenticated && authEnabled) {
      const timer = setTimeout(() => {
        navigate('/login', { state: { from: location }, replace: true });
      }, 5000);

      // Countdown timer
      const countdownInterval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => {
        clearTimeout(timer);
        clearInterval(countdownInterval);
      };
    }
  }, [isAuthenticated, authEnabled, navigate, location]);

  const handleDashboardClick = () => {
    navigate('/dashboard');
  };

  if (!isAuthenticated && authEnabled) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'linear-gradient(135deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.1) 100%)',
          p: 3
        }}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <Typography
            variant="h3"
            sx={{
              mb: 2,
              background: 'linear-gradient(45deg, #FF6B6B, #4ECDC4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 700
            }}
          >
            Access Denied
          </Typography>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <Typography
            variant="h6"
            color="text.secondary"
            sx={{ mb: 1, textAlign: 'center' }}
          >
            You need to be logged in to access this page.
          </Typography>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 3, textAlign: 'center' }}
          >
            Redirecting to login page in{' '}
            <motion.span
              key={countdown}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.2 }}
              style={{
                display: 'inline-block',
                fontWeight: 600,
                color: '#FF6B6B'
              }}
            >
              {countdown}
            </motion.span>
            {' '}seconds...
          </Typography>
        </motion.div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.5 }}
        >
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={() => navigate('/login', { state: { from: location }, replace: true })}
            sx={{
              borderRadius: 2,
              px: 4,
              py: 1.5,
              textTransform: 'none',
              fontSize: '1.1rem',
              boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
              '&:hover': {
                boxShadow: '0 6px 20px 0 rgba(0,118,255,0.23)',
              }
            }}
          >
            Go to Login
          </Button>
        </motion.div>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'linear-gradient(135deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.1) 100%)',
        p: 3
      }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <Typography
          variant="h3"
          sx={{
            mb: 2,
            background: 'linear-gradient(45deg, #FF6B6B, #4ECDC4)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontWeight: 700
          }}
        >
          404 - Page Not Found
        </Typography>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
      >
        <Typography
          variant="h6"
          color="text.secondary"
          sx={{ mb: 3, textAlign: 'center' }}
        >
          The page you're looking for doesn't exist.
        </Typography>
      </motion.div>

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <Button
          variant="contained"
          color="primary"
          size="large"
          startIcon={<DashboardIcon />}
          onClick={handleDashboardClick}
          sx={{
            borderRadius: 2,
            px: 4,
            py: 1.5,
            textTransform: 'none',
            fontSize: '1.1rem',
            boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
            '&:hover': {
              boxShadow: '0 6px 20px 0 rgba(0,118,255,0.23)',
            }
          }}
        >
          Back to Dashboard
        </Button>
      </motion.div>
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
        <Route path="file-operations" element={<FileOperations />} />
        <Route path="media/*" element={<MediaDetails />} />
        <Route path="settings" element={<Settings />} />
      </Route>

      {/* Catch all route - 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  // Read theme from localStorage or default to 'dark'
  const getInitialMode = () => {
    const saved = localStorage.getItem('themeMode');
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  };
  const [mode, setMode] = useState<'light' | 'dark'>(getInitialMode);

  // Save theme to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('themeMode', mode);
  }, [mode]);

  const theme = useMemo(() => getTheme(mode), [mode]);

  const toggleTheme = () => {
    setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{
        html: { height: '100%', backgroundColor: theme.palette.background.default },
        body: { minHeight: '100vh', height: '100%', backgroundColor: theme.palette.background.default }
      }} />
      <ConfigProvider>
        <AuthProvider>
          <TmdbProvider>
            <Router>
              <AppContent toggleTheme={toggleTheme} mode={mode} />
            </Router>
          </TmdbProvider>
        </AuthProvider>
      </ConfigProvider>
    </ThemeProvider>
  );
}

export default App;
