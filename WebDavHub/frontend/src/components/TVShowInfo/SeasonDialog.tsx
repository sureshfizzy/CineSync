import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, CircularProgress, Paper, useTheme, alpha } from '@mui/material';
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
  const theme = useTheme();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          maxWidth: { xs: '95vw', md: 1000 },
          width: { xs: '95vw', md: 'auto' },
          m: 0,
          bgcolor: theme.palette.mode === 'dark'
            ? 'linear-gradient(145deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)'
            : theme.palette.background.paper,
          backgroundImage: theme.palette.mode === 'dark'
            ? 'linear-gradient(145deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)'
            : 'none',
          border: theme.palette.mode === 'dark'
            ? `1px solid ${alpha('#ffffff', 0.15)}`
            : 'none',
          borderRadius: 4,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)'
            : '0 8px 32px rgba(0, 0, 0, 0.12)',
          overflow: 'hidden',
        }
      }}
    >
      <DialogTitle
        sx={{
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.8) 50%, rgba(0, 0, 0, 0.6) 100%)'
            : 'linear-gradient(135deg, rgba(248, 250, 252, 0.9) 0%, rgba(241, 245, 249, 0.95) 100%)',
          backdropFilter: 'blur(12px)',
          color: theme.palette.mode === 'dark' ? '#ffffff' : theme.palette.text.primary,
          borderBottom: theme.palette.mode === 'dark'
            ? `1px solid ${alpha('#3b82f6', 0.2)}`
            : `1px solid ${alpha('#3b82f6', 0.15)}`,
          fontWeight: 700,
          fontSize: '1.5rem',
          py: 3,
          px: 4,
          position: 'relative',
          '&::before': theme.palette.mode === 'dark' ? {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(59, 130, 246, 0.4) 50%, transparent 100%)',
          } : {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(59, 130, 246, 0.3) 50%, transparent 100%)',
          },
          '&::after': theme.palette.mode === 'dark' ? {
            content: '""',
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '60%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(59, 130, 246, 0.3) 50%, transparent 100%)',
          } : {
            content: '""',
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '60%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(59, 130, 246, 0.2) 50%, transparent 100%)',
          },
        }}
      >
        {selectedSeason?.name || 'Episodes'}
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 16,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            color: theme.palette.mode === 'dark'
              ? alpha('#ffffff', 0.8)
              : 'grey.500',
            bgcolor: theme.palette.mode === 'dark'
              ? alpha('#ffffff', 0.05)
              : 'transparent',
            border: theme.palette.mode === 'dark'
              ? `1px solid ${alpha('#ffffff', 0.1)}`
              : 'none',
            backdropFilter: 'blur(10px)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '&:hover': {
              color: theme.palette.mode === 'dark'
                ? '#ffffff'
                : theme.palette.text.primary,
              bgcolor: theme.palette.mode === 'dark'
                ? alpha('#ffffff', 0.12)
                : alpha(theme.palette.action.hover, 0.1),
              border: theme.palette.mode === 'dark'
                ? `1px solid ${alpha('#ffffff', 0.2)}`
                : 'none',
              transform: 'translateY(-50%) scale(1.05)',
              boxShadow: theme.palette.mode === 'dark'
                ? `0 8px 25px ${alpha('#000000', 0.4)}`
                : 'none',
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers={false}
        sx={{
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(180deg, #0f0f0f 0%, #1a1a1a 50%, #0a0a0a 100%)'
            : 'background.default',
          minHeight: 400,
          p: 0,
          position: 'relative',
          '&::before': theme.palette.mode === 'dark' ? {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '20px',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.02) 0%, transparent 100%)',
            pointerEvents: 'none',
          } : {},
        }}
      >
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
              <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: { xs: 2, sm: 3, md: 4 },
                p: { xs: 2, sm: 3, md: 4 },
                position: 'relative',
                '&::before': theme.palette.mode === 'dark' ? {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '90%',
                  height: '1px',
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)',
                } : {},
              }}>
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
                  <Paper
                    key={file.name}
                    elevation={0}
                    sx={{
                      p: 3,
                      borderRadius: 3,
                      bgcolor: theme.palette.mode === 'dark'
                        ? alpha('#ffffff', 0.02)
                        : 'background.paper',
                      border: theme.palette.mode === 'dark'
                        ? `1px solid ${alpha('#ffffff', 0.08)}`
                        : `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                      boxShadow: theme.palette.mode === 'dark'
                        ? `0 4px 20px ${alpha('#000000', 0.4)}`
                        : '0 2px 12px rgba(0,0,0,0.08)',
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        bgcolor: theme.palette.mode === 'dark'
                          ? alpha('#ffffff', 0.04)
                          : alpha(theme.palette.background.paper, 0.95),
                        boxShadow: theme.palette.mode === 'dark'
                          ? `0 8px 32px ${alpha('#000000', 0.6)}`
                          : '0 4px 20px rgba(0,0,0,0.12)',
                      }
                    }}
                  >
                    <Box sx={{ flex: 1 }}>
                      <Typography
                        variant="body1"
                        sx={{
                          fontWeight: 600,
                          mb: 1,
                          color: theme.palette.mode === 'dark'
                            ? '#ffffff'
                            : theme.palette.text.primary
                        }}
                      >
                        {file.name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, fontSize: '0.875rem', mb: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.mode === 'dark'
                              ? alpha('#ffffff', 0.7)
                              : 'text.secondary'
                          }}
                        >
                          {file.size}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.mode === 'dark'
                              ? alpha('#ffffff', 0.5)
                              : 'text.secondary'
                          }}
                        >
                          •
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: theme.palette.mode === 'dark'
                              ? alpha('#ffffff', 0.7)
                              : 'text.secondary'
                          }}
                        >
                          {file.modified}
                        </Typography>
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{
                          color: theme.palette.mode === 'dark'
                            ? alpha('#ffffff', 0.6)
                            : 'text.secondary',
                          fontStyle: 'italic'
                        }}
                      >
                        No metadata found for this file.
                      </Typography>
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