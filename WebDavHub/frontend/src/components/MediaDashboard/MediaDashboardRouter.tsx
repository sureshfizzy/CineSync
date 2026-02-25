import { Routes, Route } from 'react-router-dom';
import DebridDashboard from '../Debrid/DebridDashboard';
import DebridBrowser from '../Debrid/DebridBrowser';
import RepairQueue from '../Debrid/RepairQueue';
import RealDebridSettings from '../Debrid/Settings/RealDebridSettings';
import RcloneSettings from '../Debrid/Settings/RcloneSettings';
import MediaDashboard from './MediaDashboard';
import MediaSearchPage from './MediaSearchPage';
import RootFoldersManagement from './RootFoldersManagement';
import QualityProfilesManagement from './QualityProfilesManagement';
import IndexerManagement from './IndexerManagement';

export default function MediaDashboardRouter() {
  return (
    <Routes>
      <Route index element={<MediaDashboard filter="movies" />} />
      <Route path="movies" element={<MediaDashboard filter="movies" />} />
      <Route path="series" element={<MediaDashboard filter="series" />} />
      <Route path="wanted" element={<MediaDashboard filter="wanted" />} />
      <Route path="search/movie" element={<MediaSearchPage mediaType="movie" />} />
      <Route path="search/tv" element={<MediaSearchPage mediaType="tv" />} />
      <Route path="settings" element={<RootFoldersManagement />} />
      <Route path="settings/media-management" element={<RootFoldersManagement />} />
      <Route path="settings/indexers" element={<IndexerManagement />} />
      <Route path="settings/quality-profiles" element={<QualityProfilesManagement />} />

      {/* Debrid */}
      <Route path="debrid" element={<DebridDashboard />} />
      <Route path="debrid/browser" element={<DebridBrowser />} />
      <Route path="debrid/repair" element={<RepairQueue />} />
      <Route path="debrid/settings" element={<RealDebridSettings />} />
      <Route path="debrid/settings/rclone" element={<RcloneSettings />} />

      <Route path="*" element={<MediaDashboard filter="movies" />} />
    </Routes>
  );
}
