import { List, ListItemButton, ListItemIcon, ListItemText, Box, Typography, alpha, Collapse } from '@mui/material';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import SearchIcon from '@mui/icons-material/Search';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import SettingsIcon from '@mui/icons-material/Settings';
import FolderIcon from '@mui/icons-material/Folder';
import StorageIcon from '@mui/icons-material/Storage';
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MediaSidebarFilter } from './types';

interface MediaSidebarProps {
  onFilterChange?: (filter: MediaSidebarFilter) => void;
  onSearchClick?: (mediaType: 'movie' | 'tv') => void;
}

export default function MediaSidebar({ onFilterChange, onSearchClick }: MediaSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Determine current filter from URL
  const getCurrentFilter = (): 'all' | 'movies' | 'series' | 'wanted' | 'settings' => {
    const path = location.pathname;
    if (path === '/Mediadashboard/movies') return 'movies';
    if (path === '/Mediadashboard/series') return 'series';
    if (path === '/Mediadashboard/wanted') return 'wanted';
    if (path.startsWith('/Mediadashboard/settings')) return 'settings';
    return 'all';
  };
  
  const filter = getCurrentFilter();
  const [moviesExpanded, setMoviesExpanded] = useState(true);
  const [seriesExpanded, setSeriesExpanded] = useState(true);
  const [settingsExpanded, setSettingsExpanded] = useState(filter === 'settings');

  useEffect(() => {
    localStorage.setItem('arrSidebarFilter', filter);
    const filterData: MediaSidebarFilter = {
      type: filter,
      searchOpen: moviesExpanded || seriesExpanded
    };
    onFilterChange?.(filterData);
  }, [filter, moviesExpanded, seriesExpanded, onFilterChange]);

  // Update settings expansion based on current filter
  useEffect(() => {
    setSettingsExpanded(filter === 'settings');
  }, [filter]);

  const handleMainClick = (value: 'movies' | 'series' | 'wanted' | 'settings') => {
    // Auto-expand clicked section and collapse the other, but don't toggle closed when re-clicking
    if (value === 'movies') {
      setMoviesExpanded(true);
      setSeriesExpanded(false);
      setSettingsExpanded(false);
      navigate('/Mediadashboard/movies');
    } else if (value === 'series') {
      setSeriesExpanded(true);
      setMoviesExpanded(false);
      setSettingsExpanded(false);
      navigate('/Mediadashboard/series');
    } else if (value === 'wanted') {
      setMoviesExpanded(false);
      setSeriesExpanded(false);
      setSettingsExpanded(false);
      navigate('/Mediadashboard/wanted');
    } else if (value === 'settings') {
      setMoviesExpanded(false);
      setSeriesExpanded(false);
      setSettingsExpanded(true);
      navigate('/Mediadashboard/settings/media-management');
    }
  };

  const handleSearchClick = (mediaType: 'movie' | 'tv') => {
    navigate(`/Mediadashboard/search/${mediaType}`);
    onSearchClick?.(mediaType);
  };

  return (
    <Box sx={{ p: 1 }}>
      <List dense disablePadding>
        
        {/* Movies Section */}
        <ListItemButton 
          selected={filter === 'movies'} 
          onClick={() => handleMainClick('movies')} 
          sx={{ 
            borderRadius: 1, 
            mx: 0.5, 
            mb: 0.5, 
            '&.Mui-selected': { 
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12) 
            } 
          }}
        >
          <ListItemIcon sx={{ minWidth: 34 }}>
            <MovieIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText 
            primary={
              <Typography variant="body2" fontWeight={700}>
                Movies
              </Typography>
            } 
          />
          
        </ListItemButton>

        {/* Movies Sub-items */}
        <Collapse in={moviesExpanded} timeout={200}>
          <Box sx={{ pl: 2 }}>
            <ListItemButton 
              onClick={() => handleSearchClick('movie')}
              sx={{ 
                borderRadius: 1, 
                mx: 0.5, 
                mb: 0.5,
                py: 0.5,
                '&:hover': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <SearchIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Typography variant="body2" fontWeight={500}>
                    Search Movies
                  </Typography>
                } 
              />
              
            </ListItemButton>
          </Box>
        </Collapse>

        {/* Series Section */}
        <ListItemButton 
          selected={filter === 'series'} 
          onClick={() => handleMainClick('series')} 
          sx={{ 
            borderRadius: 1, 
            mx: 0.5, 
            mb: 0.5, 
            '&.Mui-selected': { 
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12) 
            } 
          }}
        >
          <ListItemIcon sx={{ minWidth: 34 }}>
            <TvIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText 
            primary={
              <Typography variant="body2" fontWeight={700}>
                Series
              </Typography>
            } 
          />
          
        </ListItemButton>

        {/* Series Sub-items */}
        <Collapse in={seriesExpanded} timeout={200}>
          <Box sx={{ pl: 2 }}>
            <ListItemButton 
              onClick={() => handleSearchClick('tv')}
              sx={{ 
                borderRadius: 1, 
                mx: 0.5, 
                mb: 0.5,
                py: 0.5,
                '&:hover': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <SearchIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Typography variant="body2" fontWeight={500}>
                    Search Series
                  </Typography>
                } 
              />
              
            </ListItemButton>
          </Box>
        </Collapse>

        {/* Wanted Section */}
        <ListItemButton 
          selected={filter === 'wanted'} 
          onClick={() => handleMainClick('wanted')} 
          sx={{ 
            borderRadius: 1, 
            mx: 0.5, 
            mb: 0.5, 
            '&.Mui-selected': { 
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12) 
            } 
          }}
        >
          <ListItemIcon sx={{ minWidth: 34 }}>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText 
            primary={
              <Typography variant="body2" fontWeight={700}>
                Wanted
              </Typography>
            } 
          />
        </ListItemButton>

        {/* Settings Section */}
        <ListItemButton 
          selected={filter === 'settings'} 
          onClick={() => handleMainClick('settings')} 
          sx={{ 
            borderRadius: 1, 
            mx: 0.5, 
            mb: 0.5, 
            '&.Mui-selected': { 
              bgcolor: (t) => alpha(t.palette.primary.main, 0.12) 
            } 
          }}
        >
          <ListItemIcon sx={{ minWidth: 34 }}>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText 
            primary={
              <Typography variant="body2" fontWeight={700}>
                Settings
              </Typography>
            } 
          />
        </ListItemButton>

        {/* Settings Sub-items */}
        <Collapse in={settingsExpanded} timeout={200}>
          <Box sx={{ pl: 2 }}>
            <ListItemButton 
              onClick={() => navigate('/Mediadashboard/settings/media-management')}
              sx={{ 
                borderRadius: 1, 
                mx: 0.5, 
                mb: 0.5,
                py: 0.5,
                '&:hover': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <FolderIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Typography variant="body2" fontWeight={500}>
                    Media Management
                  </Typography>
                } 
              />
            </ListItemButton>
            
            <ListItemButton 
              onClick={() => navigate('/Mediadashboard/settings/indexers')}
              sx={{ 
                borderRadius: 1, 
                mx: 0.5, 
                mb: 0.5,
                py: 0.5,
                '&:hover': {
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.08)
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <StorageIcon fontSize="small" color="primary" />
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Typography variant="body2" fontWeight={500}>
                    Indexer Management
                  </Typography>
                } 
              />
            </ListItemButton>
          </Box>
        </Collapse>

      </List>
    </Box>
  );
}
