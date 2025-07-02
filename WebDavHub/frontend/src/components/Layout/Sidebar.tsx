import { useEffect, useState } from 'react';
import { Box, List, ListItemButton, ListItemIcon, ListItemText, Typography, useTheme, useMediaQuery, alpha } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import StarIcon from '@mui/icons-material/Star';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WifiIcon from '@mui/icons-material/Wifi';
import ViewListIcon from '@mui/icons-material/ViewList';
import GridViewIcon from '@mui/icons-material/GridView';
import RefreshIcon from '@mui/icons-material/Refresh';
import { NavLink } from 'react-router-dom';
import axios from 'axios';

const navItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Browse', icon: <FolderIcon />, path: '/browse' },
  { text: 'File Operations', icon: <AssignmentIcon />, path: '/file-operations' },
  { text: 'Favorites', icon: <StarIcon />, path: '/favorites' },
  { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

interface SidebarProps {
  onNavigate?: () => void;
  onViewChange?: (view: 'list' | 'poster') => void;
  currentView?: 'list' | 'poster';
  onRefresh?: () => void;
}

export default function Sidebar({ onNavigate, onViewChange, currentView, onRefresh }: SidebarProps) {
  const theme = useTheme();
  const isMobileOrTablet = useMediaQuery(theme.breakpoints.down('md'));
  const [webdavStats, setWebdavStats] = useState({ ip: '', port: '', webdavStatus: '', });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/api/stats').then(res => {
      setWebdavStats({
        ip: res.data.ip,
        port: res.data.port,
        webdavStatus: res.data.webdavStatus,
      });
    }).finally(() => setLoading(false));
  }, []);

  return (
    <Box sx={{
      width: 180,
      bgcolor: 'background.paper',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${theme.palette.divider}`,
      pt: { xs: '56px', md: 0 }
    }}>
      <List sx={{ flex: 1, pt: { xs: 1.5, md: 1.5 } }}>
        {navItems.map((item) => (
          <NavLink
            key={item.text}
            to={item.path}
            style={{
              textDecoration: 'none',
              color: 'inherit',
              display: 'block',
              margin: '3px 8px',
            }}
            className={({ isActive }) => isActive ? 'active-nav' : ''}
            onClick={onNavigate}
          >
            {({ isActive }) => (
              <ListItemButton
                sx={{
                  borderRadius: 2,
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.06),
                  },
                  ...(isActive && {
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                  }),
                  transition: 'background-color 0.2s ease-in-out',
                }}
              >
                <ListItemIcon
                  sx={{
                    color: isActive ? theme.palette.primary.main : theme.palette.text.primary,
                    minWidth: 32,
                    transition: 'color 0.2s ease-in-out',
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? theme.palette.primary.main : 'inherit'
                  }}
                  sx={{
                    '& .MuiListItemText-primary': {
                      transition: 'color 0.2s ease-in-out'
                    }
                  }}
                />
              </ListItemButton>
            )}
          </NavLink>
        ))}
      </List>

      {isMobileOrTablet && (
        <Box sx={{ px: 1.5, py: 1.5, borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>
          <Typography
            variant="subtitle2"
            sx={{
              color: theme.palette.text.secondary,
              mb: 1.5,
              px: 0.5,
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase'
            }}
          >
            View Options
          </Typography>
          <List sx={{ p: 0 }}>
            <ListItemButton
              onClick={() => onViewChange?.('poster')}
              selected={currentView === 'poster'}
              sx={{
                borderRadius: 3,
                mb: 1,
                position: 'relative',
                overflow: 'hidden',
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main,
                  '& .MuiListItemIcon-root': {
                    color: theme.palette.primary.main,
                  }
                },
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.06),
                },
                transition: 'background-color 0.2s ease-in-out',
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, transition: 'color 0.2s ease-in-out' }}>
                <GridViewIcon />
              </ListItemIcon>
              <ListItemText
                primary="Poster View"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: currentView === 'poster' ? 600 : 500
                }}
                sx={{
                  '& .MuiListItemText-primary': {
                    transition: 'color 0.2s ease-in-out',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }
                }}
              />
            </ListItemButton>
            <ListItemButton
              onClick={() => onViewChange?.('list')}
              selected={currentView === 'list'}
              sx={{
                borderRadius: 2,
                mb: 1,
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main,
                  '& .MuiListItemIcon-root': {
                    color: theme.palette.primary.main,
                  }
                },
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.06),
                },
                transition: 'background-color 0.2s ease-in-out',
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, transition: 'color 0.2s ease-in-out' }}>
                <ViewListIcon />
              </ListItemIcon>
              <ListItemText
                primary="List View"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: currentView === 'list' ? 600 : 500
                }}
                sx={{
                  '& .MuiListItemText-primary': {
                    transition: 'color 0.2s ease-in-out'
                  }
                }}
              />
            </ListItemButton>
            <ListItemButton
              onClick={onRefresh}
              sx={{
                borderRadius: 3,
                position: 'relative',
                overflow: 'hidden',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                  color: theme.palette.primary.main,
                  '& .MuiListItemIcon-root': {
                    color: theme.palette.primary.main,
                  }
                },
                transition: 'all 0.2s ease-in-out',
              }}
            >
              <ListItemIcon sx={{
                minWidth: 32,
                color: theme.palette.text.secondary,
                transition: 'color 0.2s ease-in-out'
              }}>
                <RefreshIcon />
              </ListItemIcon>
              <ListItemText
                primary="Refresh"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: theme.palette.text.secondary
                }}
                sx={{
                  '& .MuiListItemText-primary': {
                    transition: 'color 0.2s ease-in-out'
                  }
                }}
              />
            </ListItemButton>
          </List>
        </Box>
      )}

      <Box sx={{ p: 1.5 }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: theme.palette.text.secondary,
            mb: 1,
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}
        >
          WebDAV Status
        </Typography>
        <Box sx={{
          bgcolor: alpha(theme.palette.background.default, 0.5),
          borderRadius: 3,
          p: 1.5,
          border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
          backdropFilter: 'blur(10px)',
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            bgcolor: alpha(theme.palette.background.default, 0.7),
            borderColor: alpha(theme.palette.divider, 0.5),
          }
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main,
                mr: 1,
                boxShadow: `0 0 8px ${webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main}`,
                animation: webdavStats.webdavStatus === 'Active' ? 'pulse 2s infinite' : 'none',
                '@keyframes pulse': {
                  '0%': { opacity: 1 },
                  '50%': { opacity: 0.5 },
                  '100%': { opacity: 1 },
                }
              }}
            />
            <Typography
              variant="body2"
              sx={{
                color: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main,
                fontWeight: 700,
                fontSize: '0.8rem',
                letterSpacing: '0.01em'
              }}
            >
              {webdavStats.webdavStatus === 'Active' ? 'Online' : 'Offline'}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem', display: 'block', mb: 0.3 }}>
            IP: <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>{loading ? '...' : webdavStats.ip || 'N/A'}</span>
          </Typography>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem', display: 'block', mb: 0.8 }}>
            Port: <span style={{ color: theme.palette.text.primary, fontWeight: 600 }}>{loading ? '...' : webdavStats.port || 'N/A'}</span>
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <WifiIcon sx={{
              color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled,
              fontSize: 16,
              mr: 0.8,
              transition: 'all 0.2s ease-in-out'
            }} />
            <Typography
              variant="caption"
              sx={{
                color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled,
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.01em'
              }}
            >
              {webdavStats.webdavStatus === 'Active' ? 'WebDAV Active' : 'WebDAV Inactive'}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
