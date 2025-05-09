import { Box, List, ListItem, ListItemIcon, ListItemText, Typography, Divider, Chip, useTheme, useMediaQuery } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import StarIcon from '@mui/icons-material/Star';
import HistoryIcon from '@mui/icons-material/History';
import DeleteIcon from '@mui/icons-material/Delete';
import WifiIcon from '@mui/icons-material/Wifi';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import { NavLink } from 'react-router-dom';

const navItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
  { text: 'Browse', icon: <FolderIcon />, path: '/files' },
  { text: 'Favorites', icon: <StarIcon />, path: '/favorites' },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export default function Sidebar({ onNavigate }: SidebarProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isMobileOrTablet = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Box sx={{
      width: 260,
      bgcolor: 'background.paper',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${theme.palette.divider}`,
      pt: { xs: '64px', md: 0 }
    }}>
      <Divider />
      <List sx={{ flex: 1, pt: { xs: 2, md: 0 } }}>
        {navItems.map((item) => (
          <NavLink
            key={item.text}
            to={item.path}
            style={{
              textDecoration: 'none',
              color: 'inherit',
            }}
            className={({ isActive }) => isActive ? 'active-nav' : ''}
            onClick={onNavigate}
          >
            <ListItem 
              button
              sx={{ 
                borderRadius: 2, 
                mx: 1, 
                my: 0.5,
                '&:hover': {
                  bgcolor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                },
                '&.active-nav': {
                  bgcolor: theme.palette.action.selected,
                  fontWeight: 700,
                },
              }}
            >
              <ListItemIcon sx={{ color: theme.palette.text.primary }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItem>
          </NavLink>
        ))}
      </List>
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
            <FiberManualRecordIcon sx={{ color: theme.palette.success.main, fontSize: 16, mr: 1 }} />
            <Typography variant="body2" sx={{ color: theme.palette.success.main, fontWeight: 600 }}>Online</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>IP: 0.0.0.0</Typography><br />
          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>Port: 8082</Typography><br />
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <WifiIcon sx={{ color: '#0ea5e9', fontSize: 18, mr: 1 }} />
            <Typography variant="caption" sx={{ color: '#0ea5e9' }}>WebDAV Active</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
} 