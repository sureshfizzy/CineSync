import { AppBar, Box, Toolbar, Typography, InputBase, IconButton, Avatar, Badge, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

interface TopbarProps {
  toggleTheme: () => void;
  mode: 'light' | 'dark';
  onMenuClick?: () => void;
}

export default function Topbar({ toggleTheme, mode, onMenuClick }: TopbarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', zIndex: 1201 }}>
      <Toolbar sx={{ minHeight: 64, px: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {onMenuClick && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={onMenuClick}
              sx={{ mr: 1, display: { md: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', display: 'flex', alignItems: 'center' }}>
            CineSync
            <span style={{ marginLeft: 8, color: theme.palette.text.secondary, fontWeight: 600, fontSize: 14 }}>v2.0.0</span>
          </Typography>
        </Box>

        {!isMobile && (
          <Box sx={{ 
            flex: 1, 
            mx: 4, 
            maxWidth: 400, 
            display: 'flex', 
            alignItems: 'center', 
            bgcolor: 'background.default', 
            borderRadius: 2, 
            px: 2 
          }}>
            <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />
            <InputBase placeholder="Search files and folders..." sx={{ flex: 1, color: 'text.primary' }} />
          </Box>
        )}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton size={isMobile ? "small" : "large"} onClick={toggleTheme} sx={{ color: 'text.secondary' }}>
              {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Account">
            <IconButton size={isMobile ? "small" : "large"} sx={{ ml: 1 }}>
              <Avatar sx={{ bgcolor: 'primary.main', width: isMobile ? 28 : 36, height: isMobile ? 28 : 36 }}>A</Avatar>
            </IconButton>
          </Tooltip>
          {!isMobile && (
            <Typography variant="body2" sx={{ ml: 1, fontWeight: 600, color: 'text.primary' }}>admin</Typography>
          )}
          <Tooltip title="Logout">
            <IconButton size={isMobile ? "small" : "large"} sx={{ ml: 1 }} onClick={handleLogout} color="error">
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>
    </AppBar>
  );
} 