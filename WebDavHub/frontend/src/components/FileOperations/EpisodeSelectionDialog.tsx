import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, TextField, InputAdornment, IconButton, useTheme, Chip, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon } from '@mui/icons-material';
import { fetchEpisodesFromTmdb, searchTmdb } from '../api/tmdbApi';

interface EpisodeOption {
  episodeNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  runtime?: number;
  rating?: number;
}

interface EpisodeSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (episode: EpisodeOption) => void;
  seriesId?: number;
  seriesName?: string;
  seasonNumber?: number;
  currentValue?: number;
}

const EpisodeSelectionDialog: React.FC<EpisodeSelectionDialogProps> = ({
  open,
  onClose,
  onSelect,
  seriesId,
  seriesName,
  seasonNumber,
  currentValue
}) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [episodes, setEpisodes] = useState<EpisodeOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && seasonNumber !== undefined) {
      if (seriesId) {
        loadEpisodes();
      } else if (seriesName) {
        searchForSeriesTmdbId();
      }
    }
  }, [open, seriesId, seasonNumber, seriesName]);

  const searchForSeriesTmdbId = async () => {
    if (!seriesName || seasonNumber === undefined) return;
    
    setLoading(true);
    try {
      const tmdbResult = await searchTmdb(seriesName, undefined, 'tv');
      
      if (tmdbResult && tmdbResult.id) {
        const tmdbEpisodes = await fetchEpisodesFromTmdb(tmdbResult.id.toString(), seasonNumber);
        
        if (tmdbEpisodes && tmdbEpisodes.length > 0) {
          const episodeOptions: EpisodeOption[] = tmdbEpisodes.map((episode) => ({
            episodeNumber: episode.episode_number,
            name: episode.name,
            overview: episode.overview,
            airDate: episode.air_date,
            runtime: episode.runtime,
            rating: episode.vote_average
          }));
          
          setEpisodes(episodeOptions);
        } else {
          createFallbackEpisodes();
        }
      } else {
        createFallbackEpisodes();
      }
    } catch (error) {
      createFallbackEpisodes();
    } finally {
      setLoading(false);
    }
  };

  const loadEpisodes = async () => {
    if (!seriesId || seasonNumber === undefined) return;
    
    setLoading(true);
    try {
      const tmdbEpisodes = await fetchEpisodesFromTmdb(seriesId.toString(), seasonNumber);
      
      if (tmdbEpisodes && tmdbEpisodes.length > 0) {
        const episodeOptions: EpisodeOption[] = tmdbEpisodes.map((episode) => ({
          episodeNumber: episode.episode_number,
          name: episode.name,
          overview: episode.overview,
          airDate: episode.air_date,
          runtime: episode.runtime,
          rating: episode.vote_average
        }));
        
        setEpisodes(episodeOptions);
      } else {
        createFallbackEpisodes();
      }
    } catch (error) {
      createFallbackEpisodes();
    } finally {
      setLoading(false);
    }
  };

  const createFallbackEpisodes = () => {
    const fallbackEpisodes: EpisodeOption[] = [];
    for (let i = 1; i <= 24; i++) {
      fallbackEpisodes.push({
        episodeNumber: i,
        name: `Episode ${i}`,
        overview: `Episode ${i} of Season ${seasonNumber}`
      });
    }
    setEpisodes(fallbackEpisodes);
  };

  const filteredEpisodes = episodes.filter(episode =>
    searchQuery === '' || 
    episode.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    episode.episodeNumber.toString().includes(searchQuery) ||
    (episode.overview && episode.overview.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleEpisodeSelect = (selectedEpisode: EpisodeOption) => {
    onSelect(selectedEpisode);
    onClose();
  };

  const handleClose = () => {
    setSearchQuery('');
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="lg"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: '80vh',
            bgcolor: theme.palette.background.paper,
          }
        }
      }}
    >
      <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${theme.palette.divider}`,
        py: 2
      }}>
        <Typography variant="h6">
          Select Episode - {seriesName} Season {seasonNumber}
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            placeholder="Filter episodes"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            size="small"
          />
        </Box>

        {loading ? (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 400,
            flexDirection: 'column',
            gap: 2
          }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading episodes from TMDB...
            </Typography>
          </Box>
        ) : (
          <Box sx={{ height: 'calc(80vh - 200px)', overflow: 'auto' }}>
            {filteredEpisodes.map((episode) => (
              <Box
                key={episode.episodeNumber}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  bgcolor: currentValue === episode.episodeNumber ? 'action.selected' : 'inherit',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
                onClick={() => handleEpisodeSelect(episode)}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body1" sx={{ fontWeight: 500, minWidth: 80 }}>
                    Episode {episode.episodeNumber}
                  </Typography>
                  <Typography variant="body1" sx={{ flex: 1 }}>
                    {episode.name}
                  </Typography>
                  {episode.rating && episode.rating > 0 && (
                    <Chip
                      label={episode.rating.toFixed(1)}
                      size="small"
                      color={episode.rating >= 7 ? 'success' : episode.rating >= 5 ? 'warning' : 'error'}
                      sx={{ fontSize: '0.7rem' }}
                    />
                  )}
                </Box>
                {episode.overview && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {episode.overview.length > 200 ? `${episode.overview.substring(0, 200)}...` : episode.overview}
                  </Typography>
                )}
              </Box>
            ))}
            {filteredEpisodes.length === 0 && !loading && (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {searchQuery ? 'No episodes found matching your search.' : 'No episodes available.'}
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{
        p: 2,
        borderTop: `1px solid ${theme.palette.divider}`,
        justifyContent: 'flex-end'
      }}>
        <Button onClick={handleClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
};

export default EpisodeSelectionDialog;