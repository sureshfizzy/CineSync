import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Card, CardContent, CardMedia, Grid, Chip, useTheme, alpha } from '@mui/material';
import { Close as CloseIcon, Star as StarIcon } from '@mui/icons-material';
import { getTmdbEpisodeStillUrl, formatRuntime } from '../../api/tmdbApi';
import { EpisodeOption } from './types';

interface EpisodeSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  episodes: EpisodeOption[];
  onEpisodeClick: (episodeNumber: number) => void;
  seasonNumber: number;
}

const EpisodeSelectionDialog: React.FC<EpisodeSelectionDialogProps> = ({ open, onClose, episodes, onEpisodeClick, seasonNumber }) => {
  const theme = useTheme();

  // Deduplicate episodes by episode_number to prevent duplicates
  const uniqueEpisodes = episodes.filter((episode, index, self) =>
    index === self.findIndex(e => e.episode_number === episode.episode_number)
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundColor: theme.palette.background.paper,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(25, 118, 210, 0.08) 100%)`
            : `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(25, 118, 210, 0.04) 100%)`,
          border: `2px solid ${theme.palette.primary.main + '60'}`,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6)'
            : '0 8px 32px rgba(0, 0, 0, 0.15)',
        }
      }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h5" component="h2" sx={{ fontWeight: 600, color: theme.palette.primary.main }}>
            🎬 Season {seasonNumber} Episodes
          </Typography>
          <IconButton
            aria-label="close"
            onClick={onClose}
            sx={{ color: 'grey.500' }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
          Choose the episode for your content
        </Typography>

        <Grid container spacing={2}>
          {uniqueEpisodes.map((episode) => (
            <Grid
              key={episode.id}
              size={{
                xs: 12,
                sm: 6,
                md: 4
              }}>
              <Card
                sx={{
                  cursor: 'pointer',
                  transition: 'all 0.2s ease-in-out',
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                  '&:hover': {
                    transform: 'translateY(-2px)',
                    boxShadow: `0 8px 25px ${alpha(theme.palette.primary.main, 0.15)}`,
                    border: `1px solid ${theme.palette.primary.main}`,
                  },
                }}
                onClick={() => onEpisodeClick(episode.episode_number)}
              >
                {episode.still_path && (
                  <CardMedia
                    component="img"
                    height="140"
                    image={getTmdbEpisodeStillUrl(episode.still_path) || ''}
                    alt={episode.name}
                    sx={{
                      objectFit: 'cover',
                      backgroundColor: alpha(theme.palette.background.paper, 0.1),
                    }}
                  />
                )}
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                      Episode {episode.episode_number}
                    </Typography>
                    {episode.vote_average && episode.vote_average > 0 && (
                      <Chip
                        icon={<StarIcon sx={{ fontSize: '16px !important' }} />}
                        label={episode.vote_average.toFixed(1)}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                    )}
                  </Box>

                  <Typography variant="subtitle1" sx={{ fontWeight: 500, mb: 1 }}>
                    {episode.name}
                  </Typography>

                  <Box sx={{ display: 'flex', gap: 2, mb: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                    {episode.air_date && (
                      <Typography variant="body2">
                        {new Date(episode.air_date).toLocaleDateString()}
                      </Typography>
                    )}
                    {episode.runtime && (
                      <>
                        <Typography variant="body2">•</Typography>
                        <Typography variant="body2">{formatRuntime(episode.runtime)}</Typography>
                      </>
                    )}
                  </Box>

                  {episode.overview && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        lineHeight: 1.4,
                      }}
                    >
                      {episode.overview}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </DialogContent>
    </Dialog>
  );
};

export default EpisodeSelectionDialog;
