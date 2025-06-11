import { AppBar, Box, Toolbar, Typography, IconButton, Avatar, Tooltip, useMediaQuery, useTheme, Chip, alpha } from '@mui/material';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import logoImage from '../../assets/logo.png';

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
        bgcolor: mode === 'dark'
          ? alpha(theme.palette.background.paper, 0.8)
          : alpha('#ffffff', 0.9),
        backdropFilter: 'blur(24px)',
        borderBottom: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.08),
        zIndex: theme.zIndex.drawer + 1,
      }}
    >
      <Toolbar sx={{
        minHeight: { xs: 56, sm: 64 },
        px: { xs: 2, sm: 3 },
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
          {onMenuClick && (
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={onMenuClick}
              size="small"
              sx={{
                mr: 1,
                display: { md: 'none' },
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: theme.palette.primary.main,
                },
                transition: 'all 0.2s ease-in-out'
              }}
            >
              <MenuIcon />
            </IconButton>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: { xs: 36, sm: 40 },
                height: { xs: 36, sm: 40 },
                borderRadius: 2,
                overflow: 'hidden',
                boxShadow: `0 2px 12px ${alpha(theme.palette.primary.main, 0.2)}`,
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                '&:hover': {
                  transform: 'scale(1.05)',
                  boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                }
              }}
            >
              <img
                src={logoImage}
                alt="CineSync Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  fontSize: { xs: '1.25rem', sm: '1.35rem' },
                  letterSpacing: '-0.01em',
                  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
              >
                CineSync
              </Typography>
              <Chip
                label="v3.0"
                size="small"
                variant="outlined"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: theme.palette.primary.main,
                  borderColor: theme.palette.primary.main,
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  '& .MuiChip-label': {
                    px: 0.75
                  },
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
              />
            </Box>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
          <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} arrow>
            <IconButton
              size="small"
              onClick={toggleTheme}
              sx={{
                color: 'text.secondary',
                width: 36,
                height: 36,
                borderRadius: '50%',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: theme.palette.primary.main,
                },
                transition: 'all 0.2s ease-in-out'
              }}
            >
              {mode === 'dark' ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
            </IconButton>
          </Tooltip>

          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0.75, sm: 1 },
            bgcolor: alpha(theme.palette.background.default, 0.4),
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            borderRadius: 6,
            px: { xs: 1, sm: 1.25 },
            py: 0.5,
            backdropFilter: 'blur(12px)',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              bgcolor: alpha(theme.palette.background.default, 0.6),
              borderColor: alpha(theme.palette.divider, 0.2),
            }
          }}>
            <Avatar
              sx={{
                bgcolor: theme.palette.primary.main,
                width: { xs: 28, sm: 30 },
                height: { xs: 28, sm: 30 },
                fontSize: { xs: '0.75rem', sm: '0.8rem' },
                fontWeight: 600,
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  transform: 'scale(1.05)',
                }
              }}
            >
              {(user?.username || 'A').charAt(0).toUpperCase()}
            </Avatar>

            {!isMobile && (
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 500,
                  color: 'text.primary',
                  fontSize: '0.875rem',
                  letterSpacing: '0.005em'
                }}
              >
                {user?.username || 'Admin'}
              </Typography>
            )}

            <Tooltip title="Logout" arrow>
              <IconButton
                size="small"
                onClick={handleLogout}
                sx={{
                  color: 'text.secondary',
                  width: 28,
                  height: 28,
                  '&:hover': {
                    bgcolor: alpha(theme.palette.error.main, 0.1),
                    color: 'error.main',
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
}