import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useLocation } from 'react-router-dom';
import DashboardCurrent from './Dashboard';
import ArrDashboardRouter from '../ArrDashboard/ArrDashboardRouter';

type ViewMode = 'current' | 'arrdash';

export default function DashboardSwitcher() {
  const location = useLocation();
  const getInitial = (): ViewMode => {
    const saved = localStorage.getItem('dashboardView');
    return saved === 'arrdash' || saved === 'current' ? (saved as ViewMode) : 'current';
  };
  const [view, setView] = useState<ViewMode>(getInitial);

  // Determine view based on URL path
  const isArrDashboardRoute = location.pathname.startsWith('/dashboard/') && 
    !['/dashboard'].includes(location.pathname);

  useEffect(() => {
    localStorage.setItem('dashboardView', view);
  }, [view]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.view === 'arrdash' || detail?.view === 'current') {
        setView(detail.view);
      }
    };
    window.addEventListener('dashboardHeaderToggle', handler as EventListener);
    return () => window.removeEventListener('dashboardHeaderToggle', handler as EventListener);
  }, []);

  // If we're on an ArrDashboard route, show ArrDashboardRouter
  if (isArrDashboardRoute) {
    return <ArrDashboardRouter />;
  }

  // Otherwise, show the traditional switcher
  return (
    <Box>
      <Box sx={{ position: 'relative', minHeight: '60vh' }}>
        <Box
          sx={{
            transition: 'opacity 280ms ease, transform 280ms ease',
            opacity: view === 'current' ? 1 : 0,
            transform: view === 'current' ? 'scale(1)' : 'scale(0.98)',
            position: view === 'current' ? 'relative' : 'absolute',
            inset: 0
          }}
        >
          <DashboardCurrent />
        </Box>

        <Box
          sx={{
            transition: 'opacity 280ms ease, transform 280ms ease',
            opacity: view === 'arrdash' ? 1 : 0,
            transform: view === 'arrdash' ? 'scale(1)' : 'scale(0.98)',
            position: view === 'arrdash' ? 'relative' : 'absolute',
            inset: 0
          }}
        >
          <ArrDashboardRouter />
        </Box>
      </Box>
    </Box>
  );
}