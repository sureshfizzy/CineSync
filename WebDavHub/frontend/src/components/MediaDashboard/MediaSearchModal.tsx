import { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, Box, CircularProgress, Chip, IconButton, Divider, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Switch, Stepper, Step, StepLabel } from '@mui/material';
import { Close as CloseIcon, Search as SearchIcon, Movie as MovieIcon, Tv as TvIcon, Star as StarIcon, CalendarToday as CalendarIcon, Add as AddIcon } from '@mui/icons-material';
import axios from 'axios';
import { SearchResult } from './types';
import FolderSelector from '../FileOperations/FolderSelector';
import { normalizeMediaType } from '../../utils/mediaType';
import { getAuthHeaders } from '../../contexts/AuthContext';

interface MediaSearchModalProps {
  open: boolean;
  onClose: () => void;
  mediaType: 'movie' | 'tv';
  initialQuery?: string;
}

interface AddConfig {
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  seriesType?: string;
  seasonFolder: boolean;
  tags: string[];
}

const defaultConfig: AddConfig = {
  rootFolder: '',
  qualityProfile: 'HD-1080p',
  monitorPolicy: 'all',
  seriesType: 'standard',
  seasonFolder: true,
  tags: []
};

export default function MediaSearchModal({ open, onClose, mediaType, initialQuery }: MediaSearchModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [config, setConfig] = useState<AddConfig>(defaultConfig);
  const [adding, setAdding] = useState(false);
  const [rootFolders, setRootFolders] = useState<string[]>([]);
  
  // State for adding new root folder
  const [folderSelectorOpen, setFolderSelectorOpen] = useState(false);

  const steps = ['Search', 'Configure', 'Add'];

  const handleFolderSelect = async (path: string) => {
    try {
      const response = await fetch('/api/root-folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: path
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to add root folder' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const newFolder = await response.json();
      
      // Update the root folders list
      const updatedRootFolders = [...rootFolders, newFolder.path];
      setRootFolders(updatedRootFolders);
      
      // Set the new folder as selected
      setConfig({ ...config, rootFolder: newFolder.path });
      
      // Close folder selector
      setFolderSelectorOpen(false);
    } catch (err) {
      console.error('Failed to add root folder:', err);
    }
  };

  useEffect(() => {
    if (open) {
      setSearchQuery(initialQuery || '');
      setSearchResults([]);
      setSelectedResult(null);
      setActiveStep(0);
      setConfig(defaultConfig);
      // Load root folders from API
      (async () => {
        try {
          const response = await fetch('/api/root-folders', { headers: getAuthHeaders() });
          if (response.ok) {
            const folders = await response.json();
            const paths = folders.map((folder: any) => folder.path);
            setRootFolders(paths);
            if (paths.length > 0) {
              setConfig((c) => ({ ...c, rootFolder: paths[0] }));
            }
          } else {
            setRootFolders([]);
          }
        } catch {
          setRootFolders([]);
        }
      })();
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchMedia(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, mediaType]);

  const searchMedia = async (query: string) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/tmdb/search', {
        params: {
          query,
          mediaType: normalizeMediaType(mediaType)
        }
      });

      if (response.data && response.data.results) {
        const results: SearchResult[] = response.data.results
          .slice(0, 20)
          .map((item: any) => ({
            id: item.id,
            title: item.title,
            name: item.name,
            overview: item.overview || '',
            poster_path: item.poster_path,
            backdrop_path: item.backdrop_path,
            release_date: item.release_date,
            first_air_date: item.first_air_date,
            media_type: mediaType,
            vote_average: item.vote_average || 0,
            genre_ids: item.genre_ids || []
          }));
        setSearchResults(results);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleResultSelect = (result: SearchResult) => {
    setSelectedResult(result);
    setActiveStep(1);
  };

  const handleAddToLibrary = async () => {
    if (!selectedResult) return;

    setAdding(true);
    try {
      const endpoint = mediaType === 'movie' ? '/api/library/movie' : '/api/library/series';
      
      await axios.post(endpoint, {
        tmdbId: selectedResult.id,
        title: selectedResult.title || selectedResult.name,
        year: selectedResult.release_date ? new Date(selectedResult.release_date).getFullYear() : 
              selectedResult.first_air_date ? new Date(selectedResult.first_air_date).getFullYear() : null,
        rootFolder: config.rootFolder,
        qualityProfile: config.qualityProfile,
        monitorPolicy: config.monitorPolicy,
        seriesType: config.seriesType,
        seasonFolder: config.seasonFolder,
        tags: config.tags
      });

      setActiveStep(2);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Failed to add to library:', error);
    } finally {
      setAdding(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).getFullYear().toString();
  };

  const getImageUrl = (path?: string) => {
    if (!path) return '';
    return `https://image.tmdb.org/t/p/w200${path}`;
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0:
        return (
          <Box>
            <TextField
              fullWidth
              label={`Search ${mediaType === 'movie' ? 'Movies' : 'TV Series'}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              InputProps={{
                endAdornment: loading ? <CircularProgress size={20} /> : <SearchIcon />
              }}
              sx={{ mb: 2 }}
            />
            
            <List sx={{ maxHeight: 400, overflow: 'auto' }}>
              {searchResults.map((result) => (
                <ListItem
                  key={result.id}
                  onClick={() => handleResultSelect(result)}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    mb: 1,
                    '&:hover': {
                      bgcolor: 'action.hover'
                    }
                  }}
                >
                  <ListItemAvatar>
                    <Avatar
                      src={getImageUrl(result.poster_path)}
                      sx={{ width: 56, height: 84, borderRadius: 1 }}
                    >
                      {mediaType === 'movie' ? <MovieIcon /> : <TvIcon />}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="subtitle1" fontWeight={600}>
                          {result.title || result.name}
                        </Typography>
                        <Chip
                          icon={<CalendarIcon />}
                          label={formatDate(result.release_date || result.first_air_date)}
                          size="small"
                          variant="outlined"
                        />
                        {result.vote_average > 0 && (
                          <Chip
                            icon={<StarIcon />}
                            label={result.vote_average.toFixed(1)}
                            size="small"
                            color="primary"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {result.overview || 'No overview available'}
                      </Typography>
                    }
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        );

      case 1:
        return (
          <Box>
            {selectedResult && (
              <Box sx={{ mb: 3, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <Avatar
                    src={getImageUrl(selectedResult.poster_path)}
                    sx={{ width: 80, height: 120, borderRadius: 1 }}
                  >
                    {mediaType === 'movie' ? <MovieIcon /> : <TvIcon />}
                  </Avatar>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" gutterBottom>
                      {selectedResult.title || selectedResult.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      {formatDate(selectedResult.release_date || selectedResult.first_air_date)}
                    </Typography>
                    <Typography variant="body2">
                      {selectedResult.overview}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth>
                <InputLabel>Root Folder</InputLabel>
                <Select
                  value={config.rootFolder}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '__ADD_NEW__') {
                      setFolderSelectorOpen(true);
                    } else {
                      setConfig({ ...config, rootFolder: value });
                    }
                  }}
                  label="Root Folder"
                >
                  {rootFolders.map((p) => (
                    <MenuItem key={p} value={p}>{p}</MenuItem>
                  ))}
                  <MenuItem value="__ADD_NEW__" sx={{ color: 'primary.main', fontWeight: 500 }}>
                    <AddIcon fontSize="small" sx={{ mr: 1 }} />
                    Add New Root Folder...
                  </MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Quality Profile</InputLabel>
                <Select
                  value={config.qualityProfile}
                  onChange={(e) => setConfig({ ...config, qualityProfile: e.target.value })}
                  label="Quality Profile"
                >
                  <MenuItem value="HD-1080p">HD - 1080p</MenuItem>
                  <MenuItem value="HD-720p">HD - 720p</MenuItem>
                  <MenuItem value="4K">Ultra-HD</MenuItem>
                  <MenuItem value="Any">Any</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Monitor</InputLabel>
                <Select
                  value={config.monitorPolicy}
                  onChange={(e) => setConfig({ ...config, monitorPolicy: e.target.value })}
                  label="Monitor"
                >
                  <MenuItem value="all">All Episodes</MenuItem>
                  <MenuItem value="future">Future Episodes</MenuItem>
                  <MenuItem value="missing">Missing Episodes</MenuItem>
                  <MenuItem value="existing">Existing Episodes</MenuItem>
                  <MenuItem value="first">First Season</MenuItem>
                  <MenuItem value="latest">Latest Season</MenuItem>
                  <MenuItem value="none">None</MenuItem>
                </Select>
              </FormControl>

              {mediaType === 'tv' && (
                <FormControl fullWidth>
                  <InputLabel>Series Type</InputLabel>
                  <Select
                    value={config.seriesType}
                    onChange={(e) => setConfig({ ...config, seriesType: e.target.value })}
                    label="Series Type"
                  >
                    <MenuItem value="standard">Standard</MenuItem>
                    <MenuItem value="anime">Anime</MenuItem>
                    <MenuItem value="daily">Daily</MenuItem>
                  </Select>
                </FormControl>
              )}

              {mediaType === 'tv' && (
                <FormControlLabel
                  control={
                    <Switch
                      checked={config.seasonFolder}
                      onChange={(e) => setConfig({ ...config, seasonFolder: e.target.checked })}
                    />
                  }
                  label="Season Folder"
                />
              )}
            </Box>
          </Box>
        );

      case 2:
        return (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" gutterBottom>
              Successfully Added!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selectedResult?.title || selectedResult?.name} has been added to your library.
            </Typography>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: 600 }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {mediaType === 'movie' ? <MovieIcon /> : <TvIcon />}
          <Typography variant="h6">
            Add {mediaType === 'movie' ? 'Movie' : 'Series'}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider />

      <Box sx={{ px: 3, py: 2 }}>
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      <DialogContent sx={{ minHeight: 400 }}>
        {renderStepContent()}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        {activeStep === 0 && (
          <Button onClick={onClose} variant="outlined">
            Cancel
          </Button>
        )}
        {activeStep === 1 && (
          <>
            <Button onClick={() => setActiveStep(0)} variant="outlined">
              Back
            </Button>
            <Button
              onClick={handleAddToLibrary}
              variant="contained"
              disabled={adding}
              startIcon={adding ? <CircularProgress size={16} /> : null}
            >
              {adding ? 'Adding...' : 'Add to Library'}
            </Button>
          </>
        )}
        {activeStep === 2 && (
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        )}
      </DialogActions>

      {/* Folder Selector */}
      <FolderSelector
        open={folderSelectorOpen}
        onClose={() => setFolderSelectorOpen(false)}
        onSelect={handleFolderSelect}
      />
    </Dialog>
  );
}
