import { Box, List, ListItemButton, ListItemIcon, ListItemText, alpha, useTheme, Collapse } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import StorageIcon from '@mui/icons-material/Storage';
import DashboardIcon from '@mui/icons-material/Dashboard';
import BuildIcon from '@mui/icons-material/Build';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { NavLink, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function DebridSidebar() {
  const theme = useTheme();
  const location = useLocation();
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  // Check if we're in settings section
  useEffect(() => {
    setSettingsExpanded(location.pathname.startsWith('/dashboard/debrid/settings'));
  }, [location.pathname]);

  const handleSettingsClick = () => {
    setSettingsExpanded(!settingsExpanded);
  };

  const items = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard/debrid' },
    { text: 'Browser', icon: <FolderIcon />, path: '/dashboard/debrid/browser' },
    { text: 'Repair', icon: <BuildIcon />, path: '/dashboard/debrid/repair' },
  ];

  return (
    <Box sx={{ width: 180, bgcolor: 'background.paper', height: '100%', display: 'flex', flexDirection: 'column', borderRight: `1px solid ${theme.palette.divider}`, overflow: 'hidden' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', '&::-webkit-scrollbar': { width: '6px' }, '&::-webkit-scrollbar-track': { background: alpha(theme.palette.divider, 0.1), borderRadius: '3px' }, '&::-webkit-scrollbar-thumb': { background: alpha(theme.palette.text.secondary, 0.3), borderRadius: '3px' } }}>
        <List sx={{ pt: { xs: 1.5, md: 1.5 }, pb: 1 }}>
          {items.map(item => (
            <NavLink key={item.text} to={item.path} end style={{ textDecoration: 'none', color: 'inherit', display: 'block', margin: '3px 8px' }}>
              {({ isActive }) => (
                <ListItemButton selected={isActive} sx={{ borderRadius: 2, '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) }, ...(isActive && { bgcolor: alpha(theme.palette.primary.main, 0.1) }), transition: 'background-color 0.2s ease-in-out' }}>
                  <ListItemIcon sx={{ color: isActive ? theme.palette.primary.main : theme.palette.text.primary, minWidth: 32, transition: 'color 0.2s ease-in-out' }}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText primary={item.text} primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: isActive ? 600 : 500, color: isActive ? theme.palette.primary.main : 'inherit' }} />
                </ListItemButton>
              )}
            </NavLink>
          ))}

          {/* Settings with sub-items */}
          <Box sx={{ margin: '3px 8px' }}>
            <ListItemButton 
              onClick={handleSettingsClick}
              sx={{ 
                borderRadius: 2, 
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
                transition: 'background-color 0.2s ease-in-out'
              }}
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <SettingsIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText 
                primary="Settings" 
                primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
              />
              {settingsExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </ListItemButton>

            {/* Settings Sub-items */}
            <Collapse in={settingsExpanded} timeout={200}>
              <Box sx={{ pl: 2 }}>
                <NavLink to="/dashboard/debrid/settings" end style={{ textDecoration: 'none', color: 'inherit', display: 'block', margin: '3px 0' }}>
                  {({ isActive }) => (
                    <ListItemButton 
                      selected={isActive}
                      sx={{ 
                        borderRadius: 1, 
                        mx: 0.5, 
                        mb: 0.5,
                        py: 0.5,
                        '&:hover': {
                          bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                        }
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 30 }}>
                        <SettingsIcon fontSize="small" color="primary" />
                      </ListItemIcon>
                      <ListItemText 
                        primary={
                          <Box sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                            Real-Debrid
                          </Box>
                        } 
                      />
                    </ListItemButton>
                  )}
                </NavLink>
                
                <NavLink to="/dashboard/debrid/settings/rclone" end style={{ textDecoration: 'none', color: 'inherit', display: 'block', margin: '3px 0' }}>
                  {({ isActive }) => (
                    <ListItemButton 
                      selected={isActive}
                      sx={{ 
                        borderRadius: 1, 
                        mx: 0.5, 
                        mb: 0.5,
                        py: 0.5,
                        '&:hover': {
                          bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                        }
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 30 }}>
                        <StorageIcon fontSize="small" color="primary" />
                      </ListItemIcon>
                      <ListItemText 
                        primary={
                          <Box sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                            Rclone Mount
                          </Box>
                        } 
                      />
                    </ListItemButton>
                  )}
                </NavLink>
              </Box>
            </Collapse>
          </Box>
        </List>
      </Box>
    </Box>
  );
}


