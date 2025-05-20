import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, Skeleton, IconButton, useTheme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MovieInfo from '../components/MovieInfo/index';
import TVShowInfo from '../components/TVShowInfo';
import { MediaDetailsData } from '../types/MediaTypes';
import axios from 'axios';
import CircularProgress from '@mui/material/CircularProgress';
import MovieIcon from '@mui/icons-material/Movie';
import { motion, AnimatePresence } from 'framer-motion';

function getPosterUrl(path: string | null, size = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

function getBackdropUrl(path: string | null, size = 'w1280') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

export default function MediaDetails() {
  const { folderName } = useParams<{ folderName: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<MediaDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const theme = useTheme();
  const mediaType = location.state?.mediaType || 'movie';
  const tmdbId = location.state?.tmdbId;
  const currentPath = location.state?.currentPath || '';
  const lastRequestRef = useRef<{ tmdbId?: any; currentPath?: string }>({});
  const tmdbDataFromNav = location.state?.tmdbData;

  useEffect(() => {
    // Only use navigation state if it contains credits (full details)
    if (tmdbDataFromNav && tmdbDataFromNav.credits) {
      setData(tmdbDataFromNav);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('cineSyncJWT');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Guard: Only proceed if this is a new request
    if (
      lastRequestRef.current.tmdbId === tmdbId &&
      lastRequestRef.current.currentPath === currentPath
    ) {
      setLoading(false);
      return;
    }
    lastRequestRef.current = { tmdbId, currentPath };

    // Only fetch TMDB details from API
    fetchTmdbDetails();

    function fetchTmdbDetails() {
      let url = '';
      if (tmdbId) {
        url = `/api/tmdb/details?id=${tmdbId}&mediaType=${mediaType}`;
      } else {
        url = `/api/tmdb/details?query=${encodeURIComponent(folderName || '')}&mediaType=${mediaType}`;
      }
      axios.get(url, { headers })
        .then(res => {
          setData(res.data);
          setLoading(false);
        })
        .catch(err => {
          if (err.response && err.response.status === 401) {
            setError('You must be logged in to view details.');
          } else {
            setError('Failed to load details');
          }
          setLoading(false);
        });
    }
  }, [folderName, mediaType, tmdbId, currentPath, tmdbDataFromNav]);

  // Always render backdrop and back button
  return (
    <Box sx={{ width: '100%', minHeight: '100vh', bgcolor: 'background.default', position: 'relative' }}>
      {/* Improved Backdrop: edge-to-edge, with gradient overlay */}
      {data?.backdrop_path && (
        <Box sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 0,
          pointerEvents: 'none',
        }}>
          <Box sx={{
            width: '100%',
            height: '100%',
            backgroundImage: `linear-gradient(to bottom, ${theme.palette.mode === 'light' ? 'rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 60%, rgba(255,255,255,1) 100%' : 'rgba(20,20,20,0.85) 0%, rgba(20,20,20,0.7) 60%, rgba(20,20,20,1) 100%'}), url(${getBackdropUrl(data.backdrop_path)})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: theme.palette.mode === 'light' ? 'blur(2px) brightness(1.05)' : 'blur(2px) brightness(0.7)',
          }} />
        </Box>
      )}
      {/* Back button at very top left, always visible */}
      <IconButton
        onClick={() => navigate(-1)}
        sx={{
          position: 'fixed',
          top: 16,
          left: 16,
          zIndex: 100,
          bgcolor: theme.palette.background.default,
          color: theme.palette.text.primary,
          boxShadow: 2,
          '&:hover': {
            bgcolor: theme.palette.action.hover,
          },
        }}
      >
        <ArrowBackIcon />
      </IconButton>
      {/* Main content area: animate only this */}
      <Box sx={{
        position: 'relative',
        zIndex: 1,
        p: { xs: 1, md: 3 },
        pt: { xs: 2, md: 4 },
        maxWidth: 1200,
        width: '100%',
        mx: 'auto',
        minHeight: 400,
        mt: { xs: 1, md: 3 },
        mb: { xs: 2, md: 4 },
        background: 'none',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loading-spinner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}
            >
              <CircularProgress size={44} thickness={4} color="primary" />
            </motion.div>
          ) : error ? (
            <motion.div
              key="error-message"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <Box sx={{ p: 4 }}><Typography color="error">{error}</Typography></Box>
            </motion.div>
          ) : data ? (
            <motion.div
              key="media-details-content"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              <Box sx={{ position: 'relative', zIndex: 1 }}>
                {mediaType === 'tv' ? (
                  <TVShowInfo
                    data={data}
                    getPosterUrl={getPosterUrl}
                    folderName={folderName || ''}
                    currentPath={currentPath}
                    mediaType={mediaType as 'movie' | 'tv'}
                  />
                ) : (
                  <MovieInfo
                    data={data}
                    getPosterUrl={getPosterUrl}
                    folderName={folderName || ''}
                    currentPath={currentPath}
                    mediaType={mediaType as 'movie' | 'tv'}
                  />
                )}
              </Box>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Box>
    </Box>
  );
} 