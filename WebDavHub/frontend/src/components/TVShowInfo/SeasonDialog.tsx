import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress, Paper } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { SeasonFolderInfo } from './types';
import EpisodeCard from './EpisodeCard';
import { motion, AnimatePresence } from 'framer-motion';

interface SeasonDialogProps {
  open: boolean;
  onClose: () => void;
  selectedSeason: any;
  selectedSeasonFolder: SeasonFolderInfo | null;
  loadingFiles: boolean;
  errorFiles: string | null;
  fetchSeasonFolders: () => void;
  handleViewDetails: any;
  handleDeleted: any;
  handleError: any;
  setVideoPlayerOpen: any;
  setSelectedFile: any;
}

const SeasonDialog: React.FC<SeasonDialogProps> = ({
  open,
  onClose,
  selectedSeason,
  selectedSeasonFolder,
  loadingFiles,
  errorFiles,
  fetchSeasonFolders,
  handleViewDetails,
  handleDeleted,
  handleError,
  setVideoPlayerOpen,
  setSelectedFile,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { maxWidth: { xs: '95vw', md: 900 }, width: { xs: '95vw', md: 'auto' }, m: 0 } }}>
      <DialogTitle>
        {selectedSeason?.name || 'Episodes'}
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{ position: 'absolute', right: 12, top: 12, color: 'grey.500' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ bgcolor: 'background.default', minHeight: 300 }}>
        <AnimatePresence mode="wait">
          {loadingFiles ? (
            <motion.div
              key="loading-spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', minHeight: 120 }}
            >
              <CircularProgress size={18} />
              <Typography variant="body2">Loading episode files...</Typography>
            </motion.div>
          ) : errorFiles ? (
            <motion.div
              key="error-message"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Typography color="error" variant="body2" sx={{ mt: 2 }}>{errorFiles}</Typography>
            </motion.div>
          ) : selectedSeason && selectedSeasonFolder ? (
            <motion.div
              key="episodes-list"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {selectedSeason.episodes && selectedSeason.episodes.length > 0 && selectedSeasonFolder.episodes.map(file => {
                  const ep = selectedSeason.episodes.find((ep: any) => ep.episode_number === file.episodeNumber);
                  return ep ? (
                    <EpisodeCard
                      key={file.name}
                      file={file}
                      ep={ep}
                      selectedSeasonFolder={selectedSeasonFolder}
                      handleViewDetails={handleViewDetails}
                      fetchSeasonFolders={fetchSeasonFolders}
                      handleDeleted={handleDeleted}
                      handleError={handleError}
                      setVideoPlayerOpen={setVideoPlayerOpen}
                      setSelectedFile={setSelectedFile}
                    />
                  ) : null;
                })}
                {/* Show files with no metadata at the end */}
                {selectedSeasonFolder.episodes.filter(f => !selectedSeason.episodes.some((ep: any) => ep.episode_number === f.episodeNumber)).map(file => (
                  <Paper key={file.name} elevation={2} sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', boxShadow: 2, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>{file.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary', fontSize: '0.95em' }}>
                        <Typography variant="body2">{file.size}</Typography>
                        <Typography variant="body2">•</Typography>
                        <Typography variant="body2">{file.modified}</Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No metadata found for this file.</Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            </motion.div>
          ) : (
            <motion.div
              key="no-episodes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No episode files found.</Typography>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default SeasonDialog; 