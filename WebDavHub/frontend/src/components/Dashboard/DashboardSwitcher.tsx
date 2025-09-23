import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import DashboardCurrent from './Dashboard';
import ArrDashboard from './ArrDashboard';

type ViewMode = 'current' | 'arrdash';

export default function DashboardSwitcher() {
  const getInitial = (): ViewMode => {
    const saved = localStorage.getItem('dashboardView');
    return saved === 'arrdash' || saved === 'current' ? (saved as ViewMode) : 'current';
  };
  const [view, setView] = useState<ViewMode>(getInitial);

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
          <ArrDashboard />
        </Box>
      </Box>
    </Box>
  );
}