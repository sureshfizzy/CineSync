import { Routes, Route, Navigate } from 'react-router-dom';
import ArrDashboard from './ArrDashboard';
import ArrSearchPage from './ArrSearchPage';
import RootFoldersManagement from './RootFoldersManagement';
import IndexerManagement from './IndexerManagement';

export default function ArrDashboardRouter() {
  return (
    <Routes>
      {/* Default route - shows all content */}
      <Route index element={<ArrDashboard filter="all" />} />
      
      {/* Filter routes */}
      <Route path="movies" element={<ArrDashboard filter="movies" />} />
      <Route path="series" element={<ArrDashboard filter="series" />} />
      <Route path="wanted" element={<ArrDashboard filter="wanted" />} />
      
      {/* Settings routes */}
      <Route path="settings" element={<Navigate to="/dashboard/settings/media-management" replace />} />
      <Route path="settings/media-management" element={<RootFoldersManagement />} />
      <Route path="settings/indexers" element={<IndexerManagement />} />
      
      {/* Search routes */}
      <Route path="search/movie" element={<ArrSearchPage mediaType="movie" />} />
      <Route path="search/tv" element={<ArrSearchPage mediaType="tv" />} />
      
      {/* Fallback - redirect to main dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
