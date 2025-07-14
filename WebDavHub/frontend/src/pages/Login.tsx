import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  TextField,
  Typography,
  Paper,
  Alert,
  useTheme,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import logo from '../assets/logo.png';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login, authEnabled } = useAuth();
  const theme = useTheme();

  useEffect(() => {
    if (!authEnabled) {
      navigate('/dashboard', { replace: true });
    }
  }, [authEnabled, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid credentials');
    }
  };

  return (
    <Container component="main" maxWidth="xs" sx={{
      minHeight: '100vh',
      bgcolor: theme.palette.background.default,
      color: theme.palette.text.primary,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            bgcolor: theme.palette.background.paper,
            color: theme.palette.text.primary,
          }}
        >
          <img src={logo} alt="CineSync Logo" style={{ width: '220px', marginBottom: 16 }} />
          <Typography component="h1" variant="h4" sx={{ mb: 3 }}>
            CineSync
          </Typography>
          <Typography component="h2" variant="h5" sx={{ mb: 3 }}>
            Sign in
          </Typography>
          {error && (
            <Alert severity="error" sx={{ width: '100%', mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1, width: '100%' }}>
            <TextField
              margin="normal"
              required
              fullWidth
              id="username"
              label="Username"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <TextField
              margin="normal"
              required
              fullWidth
              name="password"
              label="Password"
              type="password"
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              sx={{ mt: 3, mb: 2 }}
            >
              Sign In
            </Button>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
} 