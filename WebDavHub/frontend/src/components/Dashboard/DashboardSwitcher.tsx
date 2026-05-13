import { useLocation } from 'react-router-dom';
import DashboardCurrent from './Dashboard';
import MediaDashboardRouter from '../MediaDashboard/MediaDashboardRouter';

export default function DashboardSwitcher() {
  const location = useLocation();

  const mediaRoutes = <MediaDashboardRouter />;

  if (location.pathname.startsWith('/Mediadashboard/')) {
    return mediaRoutes;
  }
  if (location.pathname.startsWith('/dashboard/debrid')) {
    return mediaRoutes;
  }
  if (location.pathname.startsWith('/dashboard/') && location.pathname !== '/dashboard') {
    return <DashboardCurrent />;
  }

  if (location.pathname === '/Mediadashboard') {
    return mediaRoutes;
  }

  // Default Symlinks dashboard
  return <DashboardCurrent />;
}
