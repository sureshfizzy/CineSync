import { Box, useMediaQuery, useTheme, IconButton, Drawer } from '@mui/material';
import { Outlet } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/Menu';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

interface LayoutProps {
  toggleTheme: () => void;
  mode: 'light' | 'dark';
}

export default function Layout({ toggleTheme, mode }: LayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  // Close sidebar drawer after navigation (mobile only)
  const handleSidebarNavigate = () => {
    setMobileOpen(false);
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* Topbar always at the top, full width */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 1201 }}>
        <Topbar toggleTheme={toggleTheme} mode={mode} onMenuClick={isMobile ? handleDrawerToggle : undefined} />
      </Box>
      {/* Main area: sidebar + content */}
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {isMobile ? (
          <Drawer
            variant="temporary"
            anchor="left"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{
              keepMounted: true, // Better open performance on mobile
            }}
            sx={{
              display: { xs: 'block', md: 'none' },
              '& .MuiDrawer-paper': { 
                boxSizing: 'border-box', 
                width: 260,
                bgcolor: 'background.paper',
                borderRight: `1px solid ${theme.palette.divider}`
              },
            }}
          >
            <Sidebar onNavigate={handleSidebarNavigate} />
          </Drawer>
        ) : (
          <Box
            component="nav"
            sx={{
              width: 260,
              flexShrink: 0,
              display: { xs: 'none', md: 'block' },
              position: 'sticky',
              top: 64,
              height: 'calc(100vh - 64px)',
              zIndex: 1200,
            }}
          >
            <Sidebar />
          </Box>
        )}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, bgcolor: 'background.default', p: { xs: 2, sm: 3, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
} 