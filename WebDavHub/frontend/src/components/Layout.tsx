import { Box, useMediaQuery, useTheme, IconButton, Drawer } from '@mui/material';
import { Outlet, useOutletContext } from 'react-router-dom';
import MenuIcon from '@mui/icons-material/Menu';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';

interface LayoutProps {
  toggleTheme: () => void;
  mode: 'light' | 'dark';
}

type ContextType = {
  view: 'list' | 'poster';
  setView: (view: 'list' | 'poster') => void;
  handleRefresh: () => void;
};

export function useLayoutContext() {
  return useOutletContext<ContextType>();
}

export default function Layout({ toggleTheme, mode }: LayoutProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  
  // Get initial view from localStorage or default to 'poster'
  const getInitialView = () => {
    const saved = localStorage.getItem('fileViewMode');
    return saved === 'poster' || saved === 'list' ? saved as 'poster' | 'list' : 'poster';
  };
  const [view, setView] = useState<'list' | 'poster'>(getInitialView);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Save view mode to localStorage whenever it changes
  const handleViewChange = (newView: 'list' | 'poster') => {
    setView(newView);
    localStorage.setItem('fileViewMode', newView);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  // Close sidebar drawer after navigation (mobile only)
  const handleSidebarNavigate = () => {
    setMobileOpen(false);
  };

  const contextValue: ContextType = {
    view,
    setView: handleViewChange,
    handleRefresh,
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
            <Sidebar 
              onNavigate={handleSidebarNavigate} 
              currentView={view}
              onViewChange={handleViewChange}
              onRefresh={handleRefresh}
            />
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
            <Sidebar 
              currentView={view}
              onViewChange={handleViewChange}
              onRefresh={handleRefresh}
            />
          </Box>
        )}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, bgcolor: 'background.default', p: { xs: 2, sm: 3, md: 4 } }}>
          <Outlet context={contextValue} />
        </Box>
      </Box>
    </Box>
  );
} 