import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, Chip, Avatar, Grid, Skeleton, Paper, IconButton, useTheme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

interface MediaDetailsData {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  episode_run_time?: number[];
  genres?: { id: number; name: string }[];
  tagline?: string;
  vote_average?: number;
  vote_count?: number;
  status?: string;
  original_language?: string;
  production_countries?: { name: string }[];
  budget?: number;
  revenue?: number;
  credits?: {
    cast: { id: number; name: string; character: string; profile_path: string | null }[];
    crew: { id: number; name: string; job: string }[];
  };
  keywords?: { name: string }[];
  media_type?: string;
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
  const mediaType = location.state?.mediaType || 'movie';
  const tmdbId = location.state?.tmdbId;

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

  const releaseYear = (data.release_date || data.first_air_date || '').slice(0, 4);
  const runtime = data.runtime || (data.episode_run_time && data.episode_run_time[0]);
  const director = data.credits?.crew.find(c => c.job === 'Director');
  const writers = data.credits?.crew.filter(c => c.job === 'Screenplay' || c.job === 'Writer');
  const cast = data.credits?.cast.slice(0, 8) || [];
  const genres = data.genres || [];
  let keywordsArr: { name: string }[] = [];
  if (data.keywords) {
    if (Array.isArray(data.keywords)) {
      keywordsArr = data.keywords;
    } else if (
      typeof data.keywords === 'object' &&
      data.keywords !== null &&
      'results' in data.keywords &&
      Array.isArray((data.keywords as any).results)
    ) {
      keywordsArr = (data.keywords as any).results;
    }
  }
  const tags = keywordsArr.map(k => k.name);
  const country = data.production_countries?.[0]?.name;

  return (
    <Box sx={{ width: '100%', minHeight: '100%', bgcolor: 'background.default', color: 'text.primary', position: 'relative', display: 'flex', justifyContent: 'center' }}>
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
          {/* Poster and details in a row */}
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
            <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
              <img
                src={getPosterUrl(data.poster_path)}
                alt={data.title}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </Paper>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h3" fontWeight={700} gutterBottom sx={{ mb: 1 }}>
                {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                {genres.map(g => <Chip key={g.id} label={g.name} color="primary" variant="outlined" />)}
                {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" />}
                {data.status && <Chip label={data.status} color="default" variant="outlined" />}
                {country && <Chip label={country} color="default" variant="outlined" />}
              </Box>
              {data.tagline && <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1 }}>{data.tagline}</Typography>}
              <Typography variant="body1" sx={{ mb: 2 }}>{data.overview}</Typography>
              <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
                {director && <Typography><b>Director:</b> {director.name}</Typography>}
                {writers && writers.length > 0 && <Typography><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>}
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
                {tags.map(tag => <Chip key={tag} label={tag} size="small" variant="outlined" />)}
              </Box>
            </Box>
          </Box>
          {/* Cast row below poster/details */}
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" fontWeight={600} gutterBottom>Cast</Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', overflowX: 'auto', pb: 1 }}>
              {cast.map(actor => (
                <Box key={actor.id} sx={{ textAlign: 'center', width: 100 }}>
                  <Avatar
                    src={getPosterUrl(actor.profile_path, 'w185')}
                    alt={actor.name}
                    sx={{ width: 80, height: 80, mx: 'auto', mb: 1 }}
                  />
                  <Typography variant="body2" fontWeight={600}>{actor.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{actor.character}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
} 