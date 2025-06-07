import { useEffect, useState } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Typography, useTheme, useMediaQuery } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import StarIcon from '@mui/icons-material/Star';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIcon from '@mui/icons-material/Assignment';
import WifiIcon from '@mui/icons-material/Wifi';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
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
  const isDark = theme.palette.mode === 'dark';
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
              margin: '2px 6px',
            }}
            className={({ isActive }) => isActive ? 'active-nav' : ''}
            onClick={onNavigate}
          >
            <ListItem
              button
              sx={{
                borderRadius: 2,
                '&:hover': {
                  bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                },
                '&.active-nav': {
                  bgcolor: theme.palette.action.selected,
                  fontWeight: 700,
                },
                transition: 'background-color 0.2s',
              }}
            >
              <ListItemIcon sx={{ color: theme.palette.text.primary, minWidth: 32 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              />
            </ListItem>
          </NavLink>
        ))}
      </List>

      {isMobileOrTablet && (
        <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 1.5, px: 0.5, fontSize: '0.75rem' }}>VIEW OPTIONS</Typography>
          <List sx={{ p: 0 }}>
            <ListItem
              button
              onClick={() => onViewChange?.('poster')}
              selected={currentView === 'poster'}
              sx={{
                borderRadius: 2,
                mb: 1,
                '&.Mui-selected': {
                  bgcolor: theme.palette.primary.main + '20',
                  color: theme.palette.primary.main,
                  '& .MuiListItemIcon-root': {
                    color: theme.palette.primary.main,
                  }
                },
                transition: 'background-color 0.2s',
              }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <GridViewIcon />
              </ListItemIcon>
              <ListItemText
                primary="Poster View"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              />
            </ListItem>
            <ListItem
              button
              onClick={() => onViewChange?.('list')}
              selected={currentView === 'list'}
              sx={{
                borderRadius: 2,
                mb: 1,
                '&.Mui-selected': {
                  bgcolor: theme.palette.primary.main + '20',
                  color: theme.palette.primary.main,
                  '& .MuiListItemIcon-root': {
                    color: theme.palette.primary.main,
                  }
                },
                transition: 'background-color 0.2s',
              }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <ViewListIcon />
              </ListItemIcon>
              <ListItemText
                primary="List View"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              />
            </ListItem>
            <ListItem
              button
              onClick={onRefresh}
              sx={{
                borderRadius: 2,
                color: theme.palette.primary.main,
                '& .MuiListItemIcon-root': {
                  color: theme.palette.primary.main,
                },
                transition: 'background-color 0.2s',
              }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <RefreshIcon />
              </ListItemIcon>
              <ListItemText
                primary="Refresh"
                primaryTypographyProps={{
                  fontSize: '0.875rem',
                  fontWeight: 500
                }}
              />
            </ListItem>
          </List>
        </Box>
      )}

      <Box sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 0.8, fontSize: '0.75rem' }}>WEBDAV STATUS</Typography>
        <Box sx={{
          bgcolor: 'background.paper',
          borderRadius: 2,
          p: 1.5,
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: 1
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.8 }}>
            <FiberManualRecordIcon sx={{ color: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main, fontSize: 12, mr: 0.8 }} />
            <Typography variant="body2" sx={{ color: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main, fontWeight: 600, fontSize: '0.8rem' }}>{webdavStats.webdavStatus === 'Active' ? 'Online' : 'Offline'}</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem' }}>IP: {loading ? '...' : webdavStats.ip || 'N/A'}</Typography><br />
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem' }}>Port: {loading ? '...' : webdavStats.port || 'N/A'}</Typography><br />
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 0.8 }}>
            <WifiIcon sx={{ color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled, fontSize: 14, mr: 0.8 }} />
            <Typography variant="caption" sx={{ color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled, fontSize: '0.7rem' }}>{webdavStats.webdavStatus === 'Active' ? 'WebDAV Active' : 'WebDAV Inactive'}</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
