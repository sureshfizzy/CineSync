import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, InputAdornment, IconButton, useTheme, Paper, Chip, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon } from '@mui/icons-material';
import axios from 'axios';

interface TMDBMovie {
  id: number;
  title: string;
  release_date: string;
  overview: string;
}

interface MovieOption {
  id: number;
  title: string;
  year?: number;
  tmdb_id?: number;
  source: 'tmdb';
}

interface MovieSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (movie: MovieOption) => void;
  currentValue?: string;
}

const MovieSelectionDialog: React.FC<MovieSelectionDialogProps> = ({
  open,
  onClose,
  onSelect,
  currentValue
}) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [movies, setMovies] = useState<MovieOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setMovies([]);
      if (currentValue) {
        setSearchQuery(currentValue);
      }
    }
  }, [open, currentValue]);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchMovies(searchQuery);
    } else {
      setMovies([]);
    }
  }, [searchQuery]);

  const searchMovies = async (query: string) => {
    setLoading(true);
    try {
      const tmdbResponse = await axios.get('/api/tmdb/search', {
        params: { 
          query,
          mediaType: 'movie'
        }
      });

      let tmdbResults: MovieOption[] = [];
      if (tmdbResponse.data && tmdbResponse.data.results) {
        tmdbResults = tmdbResponse.data.results
          .slice(0, 20)
          .map((movie: TMDBMovie) => ({
            id: movie.id,
            title: movie.title,
            year: movie.release_date ? new Date(movie.release_date).getFullYear() : undefined,
            tmdb_id: movie.id,
            source: 'tmdb' as const
          }));
      }

      setMovies(tmdbResults);
    } catch (error) {
      setMovies([]);
    } finally {
      setLoading(false);
    }
  };

  const handleMovieSelect = (selectedMovie: MovieOption) => {
    onSelect(selectedMovie);
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
          Manual Import - Select Movie
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            placeholder="Search for movies..."
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
              Searching movies...
            </Typography>
          </Box>
        ) : (
          <TableContainer component={Paper} sx={{ height: 'calc(70vh - 200px)' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell align="center">Year</TableCell>
                  <TableCell align="center">TMDB ID</TableCell>
                  <TableCell align="center">Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {movies.map((movie, index) => (
                  <TableRow 
                    key={`${movie.source}-${movie.id}-${index}`} 
                    hover 
                    sx={{ cursor: 'pointer' }}
                    onClick={() => handleMovieSelect(movie)}
                  >
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {movie.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        From TMDB Search
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Typography variant="body2">
                        {movie.year || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {movie.tmdb_id ? (
                        <Chip
                          label={movie.tmdb_id}
                          size="small"
                          color="primary"
                          sx={{ fontSize: '0.7rem', height: 20 }}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={movie.source.toUpperCase()}
                        size="small"
                        color="info"
                        sx={{ fontSize: '0.7rem', height: 20 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {movies.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={4} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        {searchQuery ? 'No movies found matching your search.' : 'Start typing to search for movies...'}
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

export default MovieSelectionDialog;