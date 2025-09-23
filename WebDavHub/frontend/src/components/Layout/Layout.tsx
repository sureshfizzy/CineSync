import { Box, useMediaQuery, useTheme, Drawer } from '@mui/material';
import { Outlet, useOutletContext, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import ArrSidebar from './ArrSidebar.tsx';
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
  const location = useLocation();

  const isMediaDetailsPage = location.pathname.startsWith('/media/');

  // Get initial view from localStorage or default to 'poster'
  const getInitialView = () => {
    const saved = localStorage.getItem('fileViewMode');
    return saved === 'poster' || saved === 'list' ? saved as 'poster' | 'list' : 'poster';
  };
  const [view, setView] = useState<'list' | 'poster'>(getInitialView);

  // Save view mode to localStorage whenever it changes
  const handleViewChange = (newView: 'list' | 'poster') => {
    setView(newView);
    localStorage.setItem('fileViewMode', newView);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const handleRefresh = () => {
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

  const [activeDashboardView, setActiveDashboardView] = useState<'current' | 'arrdash'>(() => {
    const saved = localStorage.getItem('dashboardView');
    return saved === 'arrdash' ? 'arrdash' : 'current';
  });

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.view === 'arrdash' || detail?.view === 'current') {
        setActiveDashboardView(detail.view);
      }
    };
    window.addEventListener('dashboardViewChanged', handler as EventListener);
    return () => window.removeEventListener('dashboardViewChanged', handler as EventListener);
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', bgcolor: 'background.default' }}>
      <Topbar toggleTheme={toggleTheme} mode={mode} onMenuClick={isMobile ? handleDrawerToggle : undefined} />

      <Box sx={{
        display: 'flex',
        flexGrow: 1,
        overflow: 'hidden',
        pt: { xs: '56px', sm: '64px' } // Add top padding to account for fixed header
      }}>

        {!isMobile && !isMediaDetailsPage && (
          <Box
            component="nav"
            sx={{
              width: 180,
              flexShrink: 0,
              bgcolor: 'background.paper',
              borderRight: `1px solid ${theme.palette.divider}`,
              height: '100%',
            }}
          >
            {location.pathname === '/dashboard' && activeDashboardView === 'arrdash' ? (
              <ArrSidebar />
            ) : (
              <Sidebar
                currentView={view}
                onViewChange={handleViewChange}
                onRefresh={handleRefresh}
              />
            )}
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
                width: 180,
                bgcolor: 'background.paper',
                borderRight: `1px solid ${theme.palette.divider}`,
                height: '100vh',
                overflow: 'hidden',
                pt: { xs: '56px', sm: '64px' }, // Add top padding for fixed header
              },
            }}
          >
            {location.pathname === '/dashboard' && activeDashboardView === 'arrdash' ? (
              <ArrSidebar />
            ) : (
              <Sidebar
                onNavigate={handleSidebarNavigate}
                currentView={view}
                onViewChange={handleViewChange}
                onRefresh={handleRefresh}
              />
            )}
          </Drawer>
        )}

        <Box
          component="main"
          sx={{
            flexGrow: 1,
            bgcolor: 'background.default',
            p: { xs: 1, sm: 1.5, md: 2 },
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