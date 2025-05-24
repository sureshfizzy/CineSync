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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <Topbar toggleTheme={toggleTheme} mode={mode} onMenuClick={isMobile ? handleDrawerToggle : undefined} />

      <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>

        {!isMobile && (
          <Box
            component="nav"
            sx={{
              width: 200,
              flexShrink: 0,
              bgcolor: 'background.paper',
              borderRight: `1px solid ${theme.palette.divider}`,
              height: '100%',
            }}
          >
            <Sidebar
              currentView={view}
              onViewChange={handleViewChange}
              onRefresh={handleRefresh}
            />
          </Box>
        )}

        {isMobile && (
          <Drawer
            variant="temporary"
            anchor="left"
            open={mobileOpen}
            onClose={handleDrawerToggle}
            ModalProps={{ keepMounted: true }}
            sx={{
              display: { xs: 'block', md: 'none' },
              '& .MuiDrawer-paper': {
                boxSizing: 'border-box',
                width: 200,
                bgcolor: 'background.paper',
                borderRight: `1px solid ${theme.palette.divider}`,
                height: '100vh',
                overflow: 'hidden',
              },
            }}
          >
            <Box sx={{ height: '100%', overflowY: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              <Sidebar
                onNavigate={handleSidebarNavigate}
                currentView={view}
                onViewChange={handleViewChange}
                onRefresh={handleRefresh}
              />
            </Box>
          </Drawer>
        )}

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            p: { xs: 2, sm: 3, md: 4 },
            overflowY: 'auto',
            height: '100%',
          }}
        >
          <Outlet context={contextValue} />
        </Box>
      </Box>
    </Box>
  );
} 