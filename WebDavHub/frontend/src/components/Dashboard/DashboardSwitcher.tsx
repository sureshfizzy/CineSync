import { useLocation } from 'react-router-dom';
import DashboardCurrent from './Dashboard';
import ArrDashboardRouter from '../ArrDashboard/ArrDashboardRouter';

export default function DashboardSwitcher() {
  const location = useLocation();
  if (location.pathname.startsWith('/dashboard/') && location.pathname !== '/dashboard') {
    return <ArrDashboardRouter />;
  }

  // Default Symlinks dashboard
  return <DashboardCurrent />;
}