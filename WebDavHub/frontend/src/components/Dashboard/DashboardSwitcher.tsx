import { useEffect, useState } from 'react';
import { Box, ToggleButton, ToggleButtonGroup, Paper } from '@mui/material';
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

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1, position: 'sticky', top: 0, zIndex: 2 }}>
        <Paper sx={{ p: 0.5, border: '1px solid', borderColor: 'divider' }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => {
              if (!v || v === view) return;
              setView(v);
              window.dispatchEvent(new CustomEvent('dashboardViewChanged', { detail: { view: v } }));
            }}
          >
            <ToggleButton value="current">Symlinks</ToggleButton>
            <ToggleButton value="arrdash">ArrDash</ToggleButton>
          </ToggleButtonGroup>
        </Paper>
      </Box>

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