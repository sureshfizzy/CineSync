import { Box, List, ListItemButton, ListItemIcon, ListItemText, alpha, useTheme } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import { NavLink } from 'react-router-dom';

export default function DebridSidebar() {
  const theme = useTheme();

  const items = [
    { text: 'Browse', icon: <FolderIcon />, path: '/dashboard/debrid' },
    { text: 'Settings', icon: <SettingsIcon />, path: '/dashboard/debrid/settings' },
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
        </List>
      </Box>
    </Box>
  );
}


