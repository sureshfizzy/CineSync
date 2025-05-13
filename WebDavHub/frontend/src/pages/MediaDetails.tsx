import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, Chip, Avatar, Grid, Skeleton, Paper, IconButton, useTheme, Tabs, Tab } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useAuth } from '../contexts/AuthContext';
import MediaPathInfo from '../components/MediaPathInfo';
import MovieInfo from '../components/MovieInfo';
import TVShowInfo from '../components/TVShowInfo';
import { MediaDetailsData } from '../types/MediaTypes';
import axios from 'axios';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`media-tabpanel-${index}`}
      aria-labelledby={`media-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ py: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

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
  const { isAuthenticated } = useAuth();
  const theme = useTheme();
  const hasSeasonFolders = location.state?.hasSeasonFolders || false;
  const mediaType = hasSeasonFolders ? 'tv' : 'movie';
  const tmdbId = location.state?.tmdbId;
  const currentPath = location.state?.currentPath || '';
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('cineSyncJWT');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
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
  }, [folderName, mediaType, tmdbId]);

  if (loading) {
    return (
      <Box sx={{ width: '100vw', minHeight: '100vh', bgcolor: 'background.default', p: 0 }}>
        <Skeleton variant="rectangular" width="100%" height={320} />
        <Box sx={{ p: 4 }}>
          <Skeleton variant="text" width={300} height={60} />
          <Skeleton variant="text" width={200} height={40} />
          <Skeleton variant="rectangular" width="100%" height={120} sx={{ my: 2 }} />
          <Skeleton variant="text" width={400} height={30} />
          <Skeleton variant="rectangular" width="100%" height={200} sx={{ my: 2 }} />
        </Box>
      </Box>
    );
  }
  if (error || !data) {
    return <Box sx={{ p: 4 }}><Typography color="error">{error || 'Not found'}</Typography></Box>;
  }

  return (
    <Box sx={{ width: '100%', minHeight: '100vh', bgcolor: 'background.default', position: 'relative' }}>
      {/* Improved Backdrop: edge-to-edge, with gradient overlay */}
      {data.backdrop_path && (
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
      {/* Content */}
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
      </Box>
    </Box>
  );
} 