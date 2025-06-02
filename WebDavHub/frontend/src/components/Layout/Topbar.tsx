import { AppBar, Box, Toolbar, Typography, IconButton, Avatar, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface TopbarProps {
  toggleTheme: () => void;
  mode: 'light' | 'dark';
  onMenuClick?: () => void;
}

export default function Topbar({ toggleTheme, mode, onMenuClick }: TopbarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderBottom: '1px solid',
        borderColor: 'divider',
        zIndex: theme.zIndex.drawer + 1
      }}
    >
      <Toolbar sx={{ minHeight: 56, px: { xs: 1.5, sm: 2 }, display: 'flex', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          {onMenuClick && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={onMenuClick}
              size="small"
              sx={{ mr: 0.5, display: { md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              color: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              fontSize: { xs: '1.1rem', sm: '1.25rem' }
            }}
          >
            CineSync
            <span style={{ marginLeft: 6, color: theme.palette.text.secondary, fontWeight: 500, fontSize: 12 }}>v2.0.0</span>
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.3, sm: 0.5 } }}>
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton size="small" onClick={toggleTheme} sx={{ color: 'text.secondary' }}>
              {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Account">
            <IconButton size="small" sx={{ ml: 0.5 }}>
              <Avatar sx={{ bgcolor: 'primary.main', width: isMobile ? 24 : 28, height: isMobile ? 24 : 28 }}>A</Avatar>
            </IconButton>
          </Tooltip>
          {!isMobile && (
            <Typography variant="body2" sx={{ ml: 0.5, fontWeight: 500, color: 'text.primary', fontSize: '0.875rem' }}>{user?.username || ''}</Typography>
          )}
          <Tooltip title="Logout">
            <IconButton size="small" sx={{ ml: 0.5 }} onClick={handleLogout} color="error">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
}