import { Routes, Route } from 'react-router-dom';
import DebridDashboard from '../Debrid/DebridDashboard';
import DebridBrowser from '../Debrid/DebridBrowser';
import RepairQueue from '../Debrid/RepairQueue';
import RealDebridSettings from '../Debrid/Settings/RealDebridSettings';
import RcloneSettings from '../Debrid/Settings/RcloneSettings';
import ArrComingSoon from './ArrComingSoon';

export default function ArrDashboardRouter() {
  return (
    <Routes>
      {/* ArrDash temporarily disabled */}
      <Route index element={<ArrComingSoon />} />
      <Route path="movies" element={<ArrComingSoon />} />
      <Route path="series" element={<ArrComingSoon />} />
      <Route path="wanted" element={<ArrComingSoon />} />
      <Route path="search/movie" element={<ArrComingSoon />} />
      <Route path="search/tv" element={<ArrComingSoon />} />
      <Route path="settings/*" element={<ArrComingSoon />} />

      {/* Debrid */}
      <Route path="debrid" element={<DebridDashboard />} />
      <Route path="debrid/browser" element={<DebridBrowser />} />
      <Route path="debrid/repair" element={<RepairQueue />} />
      <Route path="debrid/settings" element={<RealDebridSettings />} />
      <Route path="debrid/settings/rclone" element={<RcloneSettings />} />

      {/* Fallback - keep users inside ArrDash splash */}
      <Route path="*" element={<ArrComingSoon />} />
    </Routes>
  );
}
