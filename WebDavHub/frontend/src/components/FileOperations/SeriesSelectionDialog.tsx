import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, InputAdornment, IconButton, useTheme, Paper, Chip, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon } from '@mui/icons-material';
import axios from 'axios';

interface TMDBSeries {
  id: number;
  name: string;
  first_air_date: string;
  overview: string;
}

interface SeriesOption {
  id: number;
  name: string;
  year?: number;
  tvdb_id?: number;
  imdb_id?: string;
  tmdb_id?: number;
  source: 'local' | 'tmdb';
}

interface SeriesSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (series: SeriesOption) => void;
  currentValue?: string;
}

const SeriesSelectionDialog: React.FC<SeriesSelectionDialogProps> = ({
  open,
  onClose,
  onSelect,
  currentValue
}) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [series, setSeries] = useState<SeriesOption[]>([]);
  const [loading, setLoading] = useState(false);


  useEffect(() => {
    if (open) {
      setSeries([]);
      if (currentValue) {
        setSearchQuery(currentValue);
      }
    }
  }, [open, currentValue]);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchSeries(searchQuery);
    } else {
      setSeries([]);
    }
  }, [searchQuery]);

  const searchSeries = async (query: string) => {
    setLoading(true);
    try {
      const tmdbResponse = await axios.get('/api/tmdb/search', {
        params: { 
          query,
          mediaType: 'tv'
        }
      });

      let tmdbResults: SeriesOption[] = [];
      if (tmdbResponse.data && tmdbResponse.data.results) {
        tmdbResults = tmdbResponse.data.results
          .slice(0, 20)
          .map((series: TMDBSeries) => ({
            id: series.id,
            name: series.name,
            year: series.first_air_date ? new Date(series.first_air_date).getFullYear() : undefined,
            tmdb_id: series.id,
            source: 'tmdb' as const
          }));
      }

      setSeries(tmdbResults);
    } catch (error) {
      setSeries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSeriesSelect = (selectedSeries: SeriesOption) => {
    onSelect(selectedSeries);
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
          Manual Import - Select Series
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            placeholder="Filter series"
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
              Loading series...
            </Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} sx={{ height: 'calc(70vh - 200px)' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell align="center">Year</TableCell>
                  <TableCell align="center">TVDB ID</TableCell>
                  <TableCell align="center">IMDb ID</TableCell>
                  <TableCell align="center">Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {series.map((seriesItem, index) => (
                  <TableRow 
                    key={`${seriesItem.source}-${seriesItem.id}-${index}`} 
                    hover 
                    sx={{ cursor: 'pointer' }}
                    onClick={() => handleSeriesSelect(seriesItem)}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {seriesItem.name}
                      </Typography>
                      {seriesItem.source === 'tmdb' && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          From TMDB Search
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        {seriesItem.year || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {seriesItem.tvdb_id ? (
                        <Chip
                          label={seriesItem.tvdb_id}
                          size="small"
                          color="primary"
                          sx={{ fontSize: '0.7rem', height: 20 }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {seriesItem.imdb_id ? (
                        <Chip
                          label={seriesItem.imdb_id}
                          size="small"
                          color="secondary"
                          sx={{ fontSize: '0.7rem', height: 20 }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={seriesItem.source.toUpperCase()}
                        size="small"
                        color={seriesItem.source === 'local' ? 'success' : 'info'}
                        sx={{ fontSize: '0.7rem', height: 20 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {series.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        {searchQuery ? 'No series found matching your search.' : 'Start typing to search for TV series...'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
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

export default SeriesSelectionDialog;