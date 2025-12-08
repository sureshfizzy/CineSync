import { AppBar, Box, Toolbar, Typography, IconButton, Avatar, Tooltip, useMediaQuery, useTheme, Chip, alpha, ToggleButton, ToggleButtonGroup, Paper, Menu, MenuItem } from '@mui/material';
import { useState, useEffect } from 'react';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import logoImage from '../../assets/logo.png';
import './topbar-fixes.css';

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
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleLogoClick = () => {
    // If currently on Debrid dashboard, keep user within Debrid
    if (location.pathname.startsWith('/dashboard/debrid')) {
      navigate('/dashboard/debrid');
    } else {
      navigate('/dashboard');
    }
  };

  const onDashboard = true;
  const getInitialView = (): 'current' | 'debrid' => {
    return location.pathname.startsWith('/dashboard/debrid') ? 'debrid' : 'current';
  };
  
  const [dashView, setDashView] = useState<'current' | 'debrid'>(getInitialView());
  const [dashMenuAnchor, setDashMenuAnchor] = useState<null | HTMLElement>(null);

  // Update dashboard view when route changes
  useEffect(() => {
    const newView = getInitialView();
    if (newView !== dashView) {
      setDashView(newView);
      localStorage.setItem('dashboardView', newView);
    }
  }, [location.pathname]);

  const handleHeaderToggle = (_: any, v: 'current' | 'debrid' | null) => {
    if (!v || v === dashView) return;
    setDashView(v);
    localStorage.setItem('dashboardView', v);
    
    // Navigate to appropriate route when switching views
    if (v === 'current') {
      navigate('/dashboard');
    } else if (v === 'debrid') {
      navigate('/dashboard/debrid');
    }
    
    window.dispatchEvent(new CustomEvent('dashboardHeaderToggle', { detail: { view: v } }));
    window.dispatchEvent(new CustomEvent('dashboardViewChanged', { detail: { view: v } }));
  };

  const openDashMenu = (e: React.MouseEvent<HTMLButtonElement>) => setDashMenuAnchor(e.currentTarget);
  const closeDashMenu = () => setDashMenuAnchor(null);
  const chooseDashView = (v: 'current' | 'debrid') => {
    closeDashMenu();
    if (v !== dashView) handleHeaderToggle(null, v);
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
        top: 0,
        left: 0,
        right: 0,
        // Ensure fixed positioning works on mobile
        position: 'fixed !important',
        transform: 'none !important',
        WebkitTransform: 'none !important',
        willChange: 'auto',
      }}
    >
      <Toolbar sx={{
        minHeight: { xs: 56, sm: 64 },
        px: { xs: 0, sm: 3 },
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.3, sm: 2 } }}>
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

          <Box
            onClick={handleLogoClick}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 1, sm: 1.5 },
              cursor: 'pointer',
              borderRadius: 2,
              p: 0.5,
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.04),
              }
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: { xs: 26, sm: 40 },
                height: { xs: 26, sm: 40 },
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

            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0.5, sm: 1 } }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  fontSize: { xs: '1.15rem', sm: '1.35rem' },
                  letterSpacing: '-0.01em',
                  fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                }}
              >
                CineSync
              </Typography>
              <Chip
                label="v3.1"
                size="small"
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: { xs: '0.6rem', sm: '0.65rem' },
                  fontWeight: 600,
                  color: theme.palette.primary.main,
                  borderColor: theme.palette.primary.main,
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  '& .MuiChip-label': {
                    px: 0.65
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
          {onDashboard && (
            <Paper sx={{
              p: 0.5,
              borderRadius: 999,
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.2),
              bgcolor: alpha(theme.palette.background.paper, 0.6),
              backdropFilter: 'blur(10px)',
              boxShadow: `0 4px 14px ${alpha(theme.palette.common.black, 0.08)}`,
              display: { xs: 'none', sm: 'block' }
            }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={dashView}
                onChange={handleHeaderToggle}
                sx={{
                  '& .MuiToggleButtonGroup-grouped': {
                    border: 0,
                    textTransform: 'none',
                    fontWeight: 700,
                    px: 1.5,
                    color: 'text.secondary',
                    transition: 'all 0.2s ease',
                    borderRadius: 999,
                    '&:not(:first-of-type)': { marginLeft: 0.5 },
                    '&:first-of-type': {
                      borderTopLeftRadius: 999,
                      borderBottomLeftRadius: 999,
                    },
                    '&:last-of-type': {
                      borderTopRightRadius: 999,
                      borderBottomRightRadius: 999,
                    },
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.06)
                    },
                    '&.Mui-focusVisible': {
                      outline: 'none',
                      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.4)}`,
                      borderRadius: 999,
                    }
                  },
                  '& .MuiToggleButton-root.Mui-selected': {
                    bgcolor: alpha(theme.palette.primary.main, 0.14),
                    color: theme.palette.mode === 'dark' ? '#fff' : theme.palette.primary.main,
                    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.4)}`,
                    borderRadius: 999,
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.18)
                    }
                  }
                }}
              >
                <ToggleButton value="current" aria-label="Symlinks view">
                  <LinkRoundedIcon sx={{ fontSize: 18, mr: 0.75 }} />
                  Symlinks
                </ToggleButton>
                <ToggleButton value="debrid" aria-label="Debrid view">
                  <CloudDownloadRoundedIcon sx={{ fontSize: 18, mr: 0.75 }} />
                  Debrid
                </ToggleButton>
              </ToggleButtonGroup>
            </Paper>
          )}

          {/* Mobile compact menu button for dashboard view switch */}
          {onDashboard && isMobile && (
            <>
              <IconButton
                size="small"
                onClick={openDashMenu}
                sx={{
                  color: 'text.secondary',
                  width: 36,
                  height: 36,
                  borderRadius: '10px',
                  border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
                  bgcolor: alpha(theme.palette.background.paper, 0.6),
                }}
                aria-label="Change dashboard view"
              >
                <DashboardRoundedIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={dashMenuAnchor}
                open={Boolean(dashMenuAnchor)}
                onClose={closeDashMenu}
                keepMounted
                slotProps={{ paper: { sx: { borderRadius: 2 } } }}
              >
                <MenuItem selected={dashView === 'current'} onClick={() => chooseDashView('current')}>
                  <LinkRoundedIcon sx={{ fontSize: 18, mr: 1 }} /> Symlinks
                </MenuItem>
                <MenuItem selected={dashView === 'debrid'} onClick={() => chooseDashView('debrid')}>
                  <CloudDownloadRoundedIcon sx={{ fontSize: 18, mr: 1 }} /> Debrid
                </MenuItem>
              </Menu>
            </>
          )}
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