import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Card, CardContent, CardMedia, Grid, Chip, useTheme, alpha } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { getTmdbSeasonPosterUrl } from '../../api/tmdbApi';
import { SeasonOption } from './types';

interface SeasonSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  seasons: SeasonOption[];
  onSeasonClick: (seasonNumber: number) => void;
}

const SeasonSelectionDialog: React.FC<SeasonSelectionDialogProps> = ({ open, onClose, seasons, onSeasonClick }) => {
  const theme = useTheme();

  // Deduplicate seasons by season_number to prevent duplicates
  const uniqueSeasons = seasons.filter((season, index, self) =>
    index === self.findIndex(s => s.season_number === season.season_number)
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
            📺 Select Season
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
          Choose the season for your content
        </Typography>

        <Grid container spacing={2}>
          {uniqueSeasons.map((season) => (
            <Grid item xs={12} sm={6} md={4} key={season.id}>
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
                onClick={() => onSeasonClick(season.season_number)}
              >
                {season.poster_path && (
                  <CardMedia
                    component="img"
                    height="200"
                    image={getTmdbSeasonPosterUrl(season.poster_path) || ''}
                    alt={season.name}
                    sx={{
                      objectFit: 'cover',
                      backgroundColor: alpha(theme.palette.background.paper, 0.1),
                    }}
                  />
                )}
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography variant="h6" component="div" sx={{ fontWeight: 600 }}>
                      {season.name}
                    </Typography>
                    <Chip
                      label={`${season.episode_count} episodes`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  </Box>

                  {season.air_date && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Air Date: {new Date(season.air_date).getFullYear()}
                    </Typography>
                  )}

                  {season.overview && (
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
                      {season.overview}
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

export default SeasonSelectionDialog;
