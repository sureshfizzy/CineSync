import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, IconButton, useTheme, useMediaQuery } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MovieInfo from '../components/MovieInfo/MovieInfo';
import TVShowInfo from '../components/TVShowInfo/TVShowInfo';
import { MediaDetailsData } from '../types/MediaTypes';
import axios from 'axios';
import CircularProgress from '@mui/material/CircularProgress';
import { motion, AnimatePresence } from 'framer-motion';
import { useSymlinkCreatedListener } from '../hooks/useMediaHubUpdates';
import ArrSearchModal from '../components/ArrDashboard/ArrSearchModal';

function getPosterUrl(path: string | null, size = 'w500') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

function getBackdropUrl(path: string | null, size = 'w1280') {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined;
}

export default function MediaDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const urlPath = params['*'] || '';
  const fullPath = '/' + urlPath;

  const pathParts = fullPath.split('/').filter(Boolean);
  // Support URL format: /media/:type/:tmdbId (type is 'movie' or 'tv')
  // Also support legacy: /media/tmdb/:tmdbId and /media/<folder path>
  const isTypedTmdbRoute = (pathParts[0] === 'movie' || pathParts[0] === 'tv') && pathParts[1];
  const isLegacyTmdbRoute = pathParts[0] === 'tmdb' && pathParts[1];
  const tmdbIdFromUrl = isTypedTmdbRoute ? pathParts[1] : (isLegacyTmdbRoute ? pathParts[1] : undefined);
  const mediaTypeFromUrl = isTypedTmdbRoute ? (pathParts[0] as 'movie' | 'tv') : undefined;
  const legacyFolderParts = (isTypedTmdbRoute || isLegacyTmdbRoute) ? pathParts.slice(2) : pathParts;
  const folderName = (location.state?.folderName as string) || (legacyFolderParts.length > 0 ? legacyFolderParts[legacyFolderParts.length - 1] : '');
  const currentPath = location.state?.currentPath || ('/' + legacyFolderParts.slice(0, -1).join('/') + (legacyFolderParts.length > 1 ? '/' : ''));
  const returnPage = location.state?.returnPage || 1;
  const returnSearch = location.state?.returnSearch || '';

  const [data, setData] = useState<MediaDetailsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [pendingFolderName, setPendingFolderName] = useState<string | null>(null);
  const [arrSearchOpen, setArrSearchOpen] = useState(false);
  const [arrSearchMediaType, setArrSearchMediaType] = useState<'movie' | 'tv'>('movie');
  const [arrSearchQuery, setArrSearchQuery] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const mediaType = mediaTypeFromUrl || location.state?.mediaType || 'movie';
  const tmdbId = location.state?.tmdbId || tmdbIdFromUrl;
  const lastRequestRef = useRef<{ tmdbId?: any; currentPath?: string; folderName?: string; requestKey?: string }>({});
  const tmdbDataFromNav = location.state?.tmdbData;
  const transitionTimeoutRef = useRef<number | null>(null);

  const handleOpenArrSearch = useCallback((title: string, type: 'movie' | 'tv') => {
    setArrSearchMediaType(type);
    setArrSearchQuery(title);
    setArrSearchOpen(true);
  }, []);

  // Function to handle smooth folder name transitions
  const handleFolderNameChange = useCallback((newFolderName: string, newTmdbId?: string | number) => {
    if (newFolderName === folderName && (!newTmdbId || newTmdbId === tmdbId)) return;

    // Clear any existing transition timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Start transition
    setIsTransitioning(true);
    setPendingFolderName(newFolderName);

    // Add a brief delay to allow for smooth visual transition
    transitionTimeoutRef.current = window.setTimeout(() => {
      const nextTmdbId = newTmdbId || tmdbId;
      const prevState = (location.state as any) || {};
      const baseState = {
        ...prevState,
        mediaType,
        tmdbId: nextTmdbId,
        currentPath,
        folderName: newFolderName,
        tmdbData: undefined,
        isTransition: true
      };

      if (isTypedTmdbRoute || isLegacyTmdbRoute) {
        navigate(location.pathname, {
          state: baseState,
          replace: true
        });
      } else {
        const pathParts = fullPath.split('/').filter(Boolean);
        pathParts[pathParts.length - 1] = newFolderName;
        const newFullPath = '/' + pathParts.join('/');
        navigate(`/media${newFullPath}`, {
          state: baseState,
          replace: true
        });
      }

      // Reset transition state after navigation and allow time for data fetch
      setTimeout(() => {
        setIsTransitioning(false);
        setPendingFolderName(null);
      }, 500); // Longer delay to allow for data fetching
    }, 400); // Slightly longer delay for smoother transition
  }, [folderName, fullPath, navigate, mediaType, tmdbId, currentPath, isTypedTmdbRoute, isLegacyTmdbRoute, location.pathname, location.state]);

  const testTransition = useCallback(() => {
    const testFolderName = `${folderName} (Test)`;

    handleFolderNameChange(testFolderName);
  }, [folderName, handleFolderNameChange]);

  // Expose test functions to window for console testing (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).testMediaDetailsTransition = testTransition;
      (window as any).testSymlinkUpdate = (oldName: string, newName: string) => {
        import('../utils/symlinkUpdates').then(({ triggerFolderNameUpdate }) => {
          triggerFolderNameUpdate({
            oldFolderName: oldName,
            newFolderName: newName,
            newPath: `/test/path/${newName}`,
            timestamp: Date.now()
          });
        });
      };
    }
    return () => {
      if (import.meta.env.DEV) {
        delete (window as any).testMediaDetailsTransition;
        delete (window as any).testSymlinkUpdate;
      }
    };
  }, [testTransition]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Listen for folder name changes from symlink operations
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.startsWith('symlink_folder_update_') && e.newValue) {
        try {
          const updateData = JSON.parse(e.newValue);
          // Check if this update applies to current folder (exact match or wildcard)
          if ((updateData.oldFolderName === folderName || updateData.oldFolderName === '*') && updateData.newFolderName) {
            handleFolderNameChange(updateData.newFolderName, updateData.tmdbId);
          }
        } catch (err) {
        }
      }
    };

    // Custom event listener (fallback for same-tab communication)
    const handleCustomEvent = (e: CustomEvent) => {
      const updateData = e.detail;
      // Check if this update applies to current folder (exact match or wildcard)
      if ((updateData.oldFolderName === folderName || updateData.oldFolderName === '*') && updateData.newFolderName) {
        handleFolderNameChange(updateData.newFolderName, updateData.tmdbId);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('symlink-folder-update', handleCustomEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('symlink-folder-update', handleCustomEvent as EventListener);
    };
  }, [folderName, handleFolderNameChange]);

  // Listen for real-time symlink creation events from MediaHub
  useSymlinkCreatedListener((data) => {
    const newFolderName = data.new_folder_name;
    const mediaName = data.media_name;

    if (newFolderName && (
      newFolderName === folderName ||
      mediaName === folderName ||
      (data.destination_file && currentPath && data.destination_file.includes(currentPath))
    )) {
      handleFolderNameChange(newFolderName, data.tmdb_id);
    }
  }, [folderName, currentPath, handleFolderNameChange]);

  useEffect(() => {


    // Clear any stale data first to prevent stuck metadata
    setData(null);
    setError(null);
    setLoading(true);

    // Only use navigation state if it contains credits (full details) AND it's not a transition
    const isTransition = location.state?.isTransition;
    if (tmdbDataFromNav && tmdbDataFromNav.credits && !isTransition) {

      setData(tmdbDataFromNav);
      setLoading(false);
      return;
    }

    const token = localStorage.getItem('cineSyncJWT');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Create a unique request key that includes folderName for better deduplication
    const requestKey = `${tmdbId || 'query'}-${folderName}-${currentPath}-${mediaType}`;

    // Guard: Only proceed if this is a new request
    if (lastRequestRef.current.requestKey === requestKey) {
      setLoading(false);
      return;
    }
    lastRequestRef.current = { tmdbId, currentPath, folderName, requestKey };

    // Only fetch TMDB details from API
    fetchTmdbDetails();

    function fetchTmdbDetails() {
      let url = '';
      if (tmdbId) {
        url = `/api/tmdb/details?id=${tmdbId}&mediaType=${mediaType}`;
      } else {
        // Extract title and year from folder name for better TMDB search
        const extractTitleAndYear = (name: string) => {
          // Match patterns like "Movie Name (2014)" or "Movie Name (2014) [Quality]"
          const match = name.match(/^(.+?)\s*\((\d{4})\)/);
          if (match) {
            return { title: match[1].trim(), year: match[2] };
          }
          return { title: name, year: undefined };
        };

        const { title, year } = extractTitleAndYear(folderName || '');
        const params = new URLSearchParams({
          query: title,
          mediaType: mediaType
        });
        if (year) {
          params.set('year', year);
        }
        url = `/api/tmdb/details?${params.toString()}`;
      }



      axios.get(url, { headers })
        .then(res => {
          setData(res.data);
          setLoading(false);
        })
        .catch(err => {
          if (err.response && err.response.status === 401) {
            setError('You must be logged in to view details.');
          } else if (err.response && err.response.status === 404) {
            setError(`No TMDB data found for "${folderName}"`);
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
          overflow: 'hidden'
        }}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: isMobile ? 0.2 : 0.3,
              ease: 'easeOut'
            }}
            style={{
              width: '100%',
              height: '100%',
              willChange: 'opacity',
              transform: 'translateZ(0)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden'
            }}
          >
            <Box sx={{
              width: '100%',
              height: '100%',
              backgroundImage: `linear-gradient(to bottom, ${theme.palette.mode === 'light' ? 'rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.85) 60%, rgba(255,255,255,1) 100%' : 'rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,1) 100%'}), url(${getBackdropUrl(data.backdrop_path)})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: theme.palette.mode === 'light' ? 'blur(1px) brightness(1.05)' : 'blur(1px) brightness(0.7)',
              transform: 'scale(1.02) translateZ(0)', // Add hardware acceleration
              willChange: 'transform, opacity',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden'
            }} />
          </motion.div>
        </Box>
      )}
      <ArrSearchModal
        open={arrSearchOpen}
        onClose={() => setArrSearchOpen(false)}
        mediaType={arrSearchMediaType}
        initialQuery={arrSearchQuery}
      />

      {/* Back button at very top left, always visible */}
      <IconButton
        onClick={() => {
          const urlPath = currentPath.replace(/\/$/, '');
          const searchParams = new URLSearchParams();
          if (returnPage > 1) {
            searchParams.set('page', returnPage.toString());
          }
          if (returnSearch) {
            searchParams.set('search', returnSearch);
          }
          const queryString = searchParams.toString();
          navigate(`/files${urlPath}${queryString ? `?${queryString}` : ''}`);
        }}
        sx={{
          position: 'fixed',
          top: { xs: 8, md: 16 },
          left: { xs: 8, md: 16 },
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

      {/* Temporary test button for transition (remove in production) */}
      {import.meta.env.DEV && (
        <IconButton
          onClick={testTransition}
          sx={{
            position: 'fixed',
            top: { xs: 8, md: 16 },
            right: { xs: 8, md: 16 },
            zIndex: 100,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            boxShadow: 2,
            '&:hover': {
              bgcolor: 'primary.dark',
            },
          }}
          title="Test Transition"
        >
          <Typography variant="caption" sx={{ fontSize: '10px' }}>TEST</Typography>
        </IconButton>
      )}
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
          {loading || isTransitioning ? (
            <motion.div
              key={isTransitioning ? "transitioning-spinner" : "loading-spinner"}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{
                duration: isMobile ? 0.2 : 0.3,
                ease: [0.4, 0, 0.2, 1]
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: 300,
                willChange: 'opacity, transform',
                transform: 'translateZ(0)',
                gap: 16
              }}
            >
              <CircularProgress size={44} thickness={4} color="primary" />
              {isTransitioning && pendingFolderName && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.3 }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                    Updating to "{pendingFolderName}"...
                  </Typography>
                </motion.div>
              )}
            </motion.div>
          ) : error ? (
            <motion.div
              key="error-message"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: isMobile ? 0.15 : 0.2 }}
              style={{
                willChange: 'opacity',
                transform: 'translateZ(0)'
              }}
            >
              <Box sx={{ p: 4 }}><Typography color="error">{error}</Typography></Box>
            </motion.div>
          ) : data ? (
            <motion.div
              key={`media-details-content-${folderName}-${data.id}`}
              initial={{ opacity: 0, y: isMobile ? 15 : 25, scale: 0.98 }}
              animate={{
                opacity: isTransitioning ? 0.6 : 1,
                y: 0,
                scale: isTransitioning ? 0.96 : 1
              }}
              exit={{ opacity: 0, y: isMobile ? -10 : -15, scale: 0.95 }}
              transition={{
                duration: isMobile ? 0.3 : 0.4,
                ease: [0.25, 0.46, 0.45, 0.94],
                opacity: { duration: isMobile ? 0.2 : 0.25 },
                y: { duration: isMobile ? 0.3 : 0.4 },
                scale: { duration: isMobile ? 0.25 : 0.35 }
              }}
              style={{
                willChange: 'opacity, transform',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                position: 'relative'
              }}
            >
              <Box sx={{ position: 'relative', zIndex: 1 }}>
                {/* Transition overlay */}
                {isTransitioning && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.1)',
                      zIndex: 10,
                      borderRadius: 2,
                      pointerEvents: 'none',
                      transition: 'opacity 0.3s ease-out'
                    }}
                  />
                )}

                {mediaType === 'tv' ? (
                  <TVShowInfo
                    data={data}
                    getPosterUrl={getPosterUrl}
                    folderName={folderName || ''}
                    currentPath={currentPath}
                    mediaType={mediaType as 'movie' | 'tv'}
                    onSearchMissing={handleOpenArrSearch}
                  />
                ) : (
                  <MovieInfo
                    data={data}
                    getPosterUrl={getPosterUrl}
                    folderName={folderName || ''}
                    currentPath={currentPath}
                    mediaType={mediaType as 'movie' | 'tv'}
                    onSearchMissing={handleOpenArrSearch}
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