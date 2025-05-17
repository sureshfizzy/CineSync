import { useState } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import ShowHeader from './ShowHeader';
import SeasonList from './SeasonList';
import SeasonDialog from './SeasonDialog';
import CastList from './CastList';
import useSeasonFolders from './useSeasonFolders';
import { MediaDetailsData } from './types';
import DetailsDialog from './DetailsDialog';
import VideoPlayerDialog from '../VideoPlayer/VideoPlayerDialog';

interface TVShowInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

export default function TVShowInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: TVShowInfoProps) {
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<any>(null);
  const [selectedSeasonFolder, setSelectedSeasonFolder] = useState<any>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  const {
    seasonFolders,
    loadingFiles,
    errorFiles,
    fetchSeasonFolders,
    handleViewDetails,
    handleDeleted,
    handleError,
    detailsDialogOpen,
    setDetailsDialogOpen,
    selectedFile,
    setSelectedFile,
    detailsData,
    videoPlayerOpen,
    setVideoPlayerOpen,
  } = useSeasonFolders({ data, folderName, currentPath, mediaType, setSnackbar });

  return (
    <Box sx={{ width: '100%' }}>
      <ShowHeader data={data} getPosterUrl={getPosterUrl} />
      <SeasonList
        data={data}
        seasonFolders={seasonFolders}
        setSeasonDialogOpen={setSeasonDialogOpen}
        setSelectedSeason={setSelectedSeason}
        setSelectedSeasonFolder={setSelectedSeasonFolder}
      />
      <SeasonDialog
        open={seasonDialogOpen}
        onClose={() => setSeasonDialogOpen(false)}
        selectedSeason={selectedSeason}
        selectedSeasonFolder={selectedSeasonFolder}
        loadingFiles={loadingFiles}
        errorFiles={errorFiles}
        fetchSeasonFolders={fetchSeasonFolders}
        handleViewDetails={handleViewDetails}
        handleDeleted={handleDeleted}
        handleError={handleError}
        setVideoPlayerOpen={setVideoPlayerOpen}
        setSelectedFile={setSelectedFile}
      />
      <CastList data={data} getPosterUrl={getPosterUrl} />
      <DetailsDialog
        open={detailsDialogOpen}
        onClose={() => setDetailsDialogOpen(false)}
        selectedFile={selectedFile}
        detailsData={detailsData}
      />
      <VideoPlayerDialog
        open={videoPlayerOpen}
        onClose={() => setVideoPlayerOpen(false)}
        url={selectedFile?.videoUrl}
        title={selectedFile?.name}
        mimeType={selectedFile?.videoMimeType}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
} 