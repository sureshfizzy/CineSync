import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, TextField, InputAdornment, IconButton, useTheme, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon } from '@mui/icons-material';
import { fetchSeasonsFromTmdb, searchTmdb } from '../api/tmdbApi';

interface SeasonOption {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  overview?: string;
}

interface SeasonSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (season: SeasonOption) => void;
  seriesId?: number;
  seriesName?: string;
  currentValue?: number;
}

const SeasonSelectionDialog: React.FC<SeasonSelectionDialogProps> = ({
  open,
  onClose,
  onSelect,
  seriesId,
  seriesName,
  currentValue
}) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [seasons, setSeasons] = useState<SeasonOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      if (seriesId) {
        loadSeasons();
      } else if (seriesName) {
        searchForSeriesTmdbId();
      }
    }
  }, [open, seriesId, seriesName]);

  const searchForSeriesTmdbId = async () => {
    if (!seriesName) return;

    setLoading(true);
    try {
      const tmdbResult = await searchTmdb(seriesName, undefined, 'tv');

      if (tmdbResult && tmdbResult.id) {
        const tmdbSeasons = await fetchSeasonsFromTmdb(tmdbResult.id.toString());

        if (tmdbSeasons && tmdbSeasons.length > 0) {
          const seasonOptions: SeasonOption[] = tmdbSeasons
            .filter((season) => season.season_number >= 0)
            .map((season) => ({
              seasonNumber: season.season_number,
              name: season.name,
              episodeCount: season.episode_count,
              airDate: season.air_date,
              overview: season.overview
            }));

          setSeasons(seasonOptions);
        } else {
          createFallbackSeasons();
        }
      } else {
        createFallbackSeasons();
      }
    } catch (error) {
      createFallbackSeasons();
    } finally {
      setLoading(false);
    }
  };

  const loadSeasons = async () => {
    if (!seriesId) return;

    setLoading(true);
    try {
      const tmdbSeasons = await fetchSeasonsFromTmdb(seriesId.toString());

      if (tmdbSeasons && tmdbSeasons.length > 0) {
        const seasonOptions: SeasonOption[] = tmdbSeasons
          .filter((season) => season.season_number >= 0) // Include season 0 (specials)
          .map((season) => ({
            seasonNumber: season.season_number,
            name: season.name,
            episodeCount: season.episode_count,
            airDate: season.air_date,
            overview: season.overview
          }));

        setSeasons(seasonOptions);
      } else {
        createFallbackSeasons();
      }
    } catch (error) {
      createFallbackSeasons();
    } finally {
      setLoading(false);
    }
  };

  const createFallbackSeasons = () => {
    const fallbackSeasons: SeasonOption[] = [];
    for (let i = 1; i <= 10; i++) {
      fallbackSeasons.push({
        seasonNumber: i,
        name: `Season ${i}`,
        episodeCount: 0
      });
    }
    setSeasons(fallbackSeasons);
  };

  const filteredSeasons = seasons.filter(season =>
    searchQuery === '' ||
    season.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    season.seasonNumber.toString().includes(searchQuery)
  );

  const handleSeasonSelect = (selectedSeason: SeasonOption) => {
    onSelect(selectedSeason);
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
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: '70vh',
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
          Select Season - {seriesName}
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            placeholder="Filter seasons"
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
            height: 300,
            flexDirection: 'column',
            gap: 2
          }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Loading seasons from TMDB...
            </Typography>
          </Box>
        ) : (
          <Box sx={{ height: 'calc(70vh - 200px)', overflow: 'auto' }}>
            {filteredSeasons.map((season) => (
              <Box
                key={season.seasonNumber}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  bgcolor: currentValue === season.seasonNumber ? 'action.selected' : 'inherit',
                  '&:hover': { bgcolor: 'action.hover' }
                }}
                onClick={() => handleSeasonSelect(season)}
              >
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
                </Typography>
              </Box>
            ))}
            {filteredSeasons.length === 0 && !loading && (
              <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {searchQuery ? 'No seasons found matching your search.' : 'No seasons available.'}
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

export default SeasonSelectionDialog;