import { useState, lazy, Suspense } from 'react';
import { Box, Snackbar, Alert, IconButton, Tooltip } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import { useNavigate } from 'react-router-dom';
import ShowHeader from './ShowHeader';
import SeasonList from './SeasonList';
import SeasonDialog from './SeasonDialog';
import CastList from './CastList';
import useSeasonFolders from './useSeasonFolders';
import { MediaDetailsData } from './types';
import DetailsDialog from './DetailsDialog';

interface TVShowInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

const VideoPlayerDialog = lazy(() => import('../VideoPlayer/VideoPlayerDialog'));

export default function TVShowInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: TVShowInfoProps) {
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<any>(null);
  const [selectedSeasonFolder, setSelectedSeasonFolder] = useState<any>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const navigate = useNavigate();

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
    <Box sx={{ position: 'relative' }}>
      <IconButton
        onClick={() => navigate(-1)}
        sx={{
          position: 'absolute',
          top: { xs: -24, md: 'calc(-47px)' },
          left: { xs: -8, md: 'calc(-47px)' },
          zIndex: 10,
          bgcolor: 'background.paper',
          color: 'primary.main',
          boxShadow: 2,
          '&:hover': { bgcolor: 'primary.main', color: 'background.paper' },
          borderRadius: '50%',
          width: 44,
          height: 44,
        }}
        size="large"
        aria-label="Back"
      >
        <ArrowBackIosNewIcon fontSize="medium" />
      </IconButton>
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <ShowHeader data={data} getPosterUrl={getPosterUrl} />
          </Box>
        </Box>
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
        {videoPlayerOpen && (
          <Suspense fallback={null}>
            <VideoPlayerDialog
              open={videoPlayerOpen}
              onClose={() => setVideoPlayerOpen(false)}
              url={selectedFile?.videoUrl}
              title={selectedFile?.name}
              mimeType={selectedFile?.videoMimeType}
            />
          </Suspense>
        )}
        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
        </Snackbar>
      </Box>
    </Box>
  );
} 