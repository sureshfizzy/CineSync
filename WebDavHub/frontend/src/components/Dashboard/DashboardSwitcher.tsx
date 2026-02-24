import { useLocation } from 'react-router-dom';
import DashboardCurrent from './Dashboard';
import MediaDashboardRouter from '../MediaDashboard/MediaDashboardRouter';

export default function DashboardSwitcher() {
  const location = useLocation();

  if (location.pathname.startsWith('/Mediadashboard/')) {
    return <MediaDashboardRouter />;
  }
  if (location.pathname.startsWith('/dashboard/debrid')) {
    return <MediaDashboardRouter />;
  }
  if (location.pathname.startsWith('/dashboard/') && location.pathname !== '/dashboard') {
    return <DashboardCurrent />;
  }

  if (location.pathname === '/Mediadashboard') {
    return <MediaDashboardRouter />;
  }

  // Default Symlinks dashboard
  return <DashboardCurrent />;
}
