import React, { useState, useEffect } from 'react';
import { Box, TextField, List, ListItem, ListItemAvatar, ListItemText, Avatar, Typography, CircularProgress, Chip, Card, CardContent, Divider, Paper, IconButton, Alert } from '@mui/material';
import Modal from '@mui/material/Modal';
import { useNavigate } from 'react-router-dom';
import ArrConfigCard from './ArrConfigCard';
import {
  Search as SearchIcon,
  Movie as MovieIcon,
  Tv as TvIcon,
  Star as StarIcon,
  CalendarToday as CalendarIcon,
  Add as AddIcon
} from '@mui/icons-material';
import axios from 'axios';
import { SearchResult } from './types';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';

interface ArrSearchPageProps {
  mediaType: 'movie' | 'tv';
  onBack?: () => void;
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

export default function ArrSearchPage({ mediaType, onBack }: ArrSearchPageProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<AddConfig>(defaultConfig);
  const [adding, setAdding] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [rootFolders, setRootFolders] = useState<string[]>([]);

  // Debug state changes
  useEffect(() => {
    console.log('showConfig changed to:', showConfig);
    console.log('selectedResult changed to:', selectedResult?.title || selectedResult?.name || 'null');
  }, [showConfig, selectedResult]);

  useEffect(() => {
    if (searchQuery.length >= 2) {
      searchMedia(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, mediaType]);

  // Handle escape key to close search page
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (showConfig) {
          resetConfig();
        } else {
          handleBack();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showConfig]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      const mediaTypePath = mediaType === 'movie' ? 'movies' : 'series';
      navigate(`/dashboard/${mediaTypePath}`);
    }
  };

  // Load root folders from API
  useEffect(() => {
    const loadRoots = async () => {
      try {
        const response = await fetch('/api/root-folders');
        if (response.ok) {
          const folders = await response.json();
          const bases = folders.map((folder: any) => folder.path);
          setRootFolders(bases);

          const byType = bases.find((p: string) => (mediaType === 'movie' ? /mov/i.test(p) : /(show|tv|series)/i.test(p)));
          if (byType) {
            setConfig((c) => ({ ...c, rootFolder: byType }));
          } else if (bases.length > 0) {
            const first = bases[0];
            setConfig((c) => ({ ...c, rootFolder: first }));
          }
        }
      } catch {
        // ignore; fallback to defaults
      }
    };
    loadRoots();
  }, [mediaType]);

  const searchMedia = async (query: string) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/tmdb/search', {
        params: {
          query,
          mediaType: mediaType === 'tv' ? 'tv' : 'movie'
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
    console.log('Result selected:', result.title || result.name);
    console.log('Setting selectedResult and showConfig to true');
    setSelectedResult(result);
    setShowConfig(true);
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

      setSuccessMessage(`${selectedResult.title || selectedResult.name} has been added to your library!`);
      setSelectedResult(null);
      setShowConfig(false);
      
      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(''), 5000);
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

  const resetConfig = () => {
    setSelectedResult(null);
    setShowConfig(false);
  };

  return (
    <ConfigurationWrapper>
      <Box sx={{ maxWidth: 1600, mx: 'auto', p: { xs: 1, sm: 2, md: 3 } }}>
        

        {/* Success Message */}
        {successMessage && (
          <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMessage('')}>
            {successMessage}
          </Alert>
        )}

        {/* Search Section */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <TextField
              fullWidth
              label={`Search ${mediaType === 'movie' ? 'Movies' : 'TV Series'}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="outlined"
              InputProps={{
                endAdornment: loading ? <CircularProgress size={20} /> : <SearchIcon />
              }}
              placeholder={`Enter ${mediaType === 'movie' ? 'movie' : 'series'} name...`}
            />
          </CardContent>
        </Card>

        {/* Placeholder message when no search is done */}
        {searchQuery.length < 2 && (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            minHeight: '300px',
            textAlign: 'center'
          }}>
            <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600 }}>
              It's easy to add a new {mediaType === 'movie' ? 'movie' : 'series'}, just start typing the name the {mediaType === 'movie' ? 'movie' : 'series'} you want to add.
            </Typography>
          </Box>
        )}

        {/* Search Results - Only show when there's a search query */}
        {searchQuery.length >= 2 && (
          <Box>
            <Typography variant="h6" gutterBottom>
              Search Results ({searchResults.length})
            </Typography>
            
            {searchResults.length === 0 && !loading && (
              <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'background.default' }}>
                <Typography color="text.secondary">
                  No results found for "{searchQuery}"
                </Typography>
              </Paper>
            )}

            {searchResults.length > 0 && (
              <List sx={{ bgcolor: 'background.paper', borderRadius: 1 }}>
                {searchResults.map((result, index) => (
                  <React.Fragment key={result.id}>
                    <ListItem
                      component="div"
                      onClick={() => handleResultSelect(result)}
                      sx={{
                        py: 2,
                        cursor: 'pointer',
                        '&:hover': {
                          bgcolor: 'action.hover'
                        }
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar
                          src={getImageUrl(result.poster_path)}
                          sx={{ width: 60, height: 90, borderRadius: 1, mr: 2 }}
                        >
                          {mediaType === 'movie' ? <MovieIcon /> : <TvIcon />}
                        </Avatar>
                      </ListItemAvatar>
                      
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                            <Typography variant="h6" fontWeight={600}>
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
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden'
                            }}
                          >
                            {result.overview || 'No overview available'}
                          </Typography>
                        }
                      />
                      
                      <IconButton 
                        color="primary" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResultSelect(result);
                        }}
                      >
                        <AddIcon />
                      </IconButton>
                    </ListItem>
                    {index < searchResults.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            )}
          </Box>
        )}

        {/* Configuration Panel - Show as overlay when result is selected (uses Modal/portal) */}
        <Modal open={!!showConfig && !!selectedResult} onClose={resetConfig}>
          <Box sx={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', p: 2 }}>
            {selectedResult && (
              <Box sx={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
                <ArrConfigCard
                mediaType={mediaType}
                title={(selectedResult.title ?? selectedResult.name) || ''}
                year={(selectedResult.release_date || selectedResult.first_air_date) ? formatDate(selectedResult.release_date || selectedResult.first_air_date)! : ''}
                posterUrl={getImageUrl(selectedResult.poster_path)}
                overview={selectedResult.overview}
                rootFolders={rootFolders}
                config={config}
                onChange={(partial) => setConfig({ ...config, ...partial })}
                onClose={resetConfig}
                onSubmit={handleAddToLibrary}
                submitting={adding}
                onRootFoldersUpdate={setRootFolders}
                />
              </Box>
            )}
          </Box>
        </Modal>
      </Box>
    </ConfigurationWrapper>
  );
}
