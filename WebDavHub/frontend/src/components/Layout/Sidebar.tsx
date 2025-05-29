import { useEffect, useState } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Typography, useTheme, useMediaQuery } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import StarIcon from '@mui/icons-material/Star';
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
  { text: 'Favorites', icon: <StarIcon />, path: '/favorites' },
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
      width: 200,
      bgcolor: 'background.paper',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${theme.palette.divider}`,
      pt: { xs: '64px', md: 0 }
    }}>
      <List sx={{ flex: 1, pt: { xs: 2, md: 2 } }}>
        {navItems.map((item) => (
          <NavLink
            key={item.text}
            to={item.path}
            style={{
              textDecoration: 'none',
              color: 'inherit',
              display: 'block',
              margin: '4px 8px',
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
              <ListItemIcon sx={{ color: theme.palette.text.primary, minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItem>
          </NavLink>
        ))}
      </List>

      {isMobileOrTablet && (
        <Box sx={{ px: 2, py: 1.5, borderTop: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 2, px: 1 }}>VIEW OPTIONS</Typography>
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
              <ListItemIcon sx={{ minWidth: 40 }}>
                <GridViewIcon />
              </ListItemIcon>
              <ListItemText primary="Poster View" />
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
              <ListItemIcon sx={{ minWidth: 40 }}>
                <ViewListIcon />
              </ListItemIcon>
              <ListItemText primary="List View" />
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
              <ListItemIcon sx={{ minWidth: 40 }}>
                <RefreshIcon />
              </ListItemIcon>
              <ListItemText primary="Refresh" />
            </ListItem>
          </List>
        </Box>
      )}

      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ color: theme.palette.text.secondary, mb: 1 }}>WEBDAV STATUS</Typography>
        <Box sx={{
          bgcolor: 'background.paper',
          borderRadius: 2,
          p: 2,
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: 1
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <FiberManualRecordIcon sx={{ color: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main, fontSize: 16, mr: 1 }} />
            <Typography variant="body2" sx={{ color: webdavStats.webdavStatus === 'Active' ? theme.palette.success.main : theme.palette.error.main, fontWeight: 600 }}>{webdavStats.webdavStatus === 'Active' ? 'Online' : 'Offline'}</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>IP: {loading ? '...' : webdavStats.ip || 'N/A'}</Typography><br />
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>Port: {loading ? '...' : webdavStats.port || 'N/A'}</Typography><br />
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <WifiIcon sx={{ color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled, fontSize: 18, mr: 1 }} />
            <Typography variant="caption" sx={{ color: webdavStats.webdavStatus === 'Active' ? '#0ea5e9' : theme.palette.text.disabled }}>{webdavStats.webdavStatus === 'Active' ? 'WebDAV Active' : 'WebDAV Inactive'}</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
