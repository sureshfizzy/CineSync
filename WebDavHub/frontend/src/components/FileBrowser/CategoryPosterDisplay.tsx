import { useState, useEffect, useRef } from 'react';
import { Box, Skeleton, Typography } from '@mui/material';
import { useTheme } from '@mui/material';
import { TmdbResult, getTmdbBackdropUrl, fetchCategoryContent } from '../api/tmdbApi';

interface CategoryPosterDisplayProps {
  categoryName: string;
  onLoad?: () => void;
}

// Cache for category content to prevent re-fetching
const categoryContentCache = new Map<string, TmdbResult>();

export default function CategoryPosterDisplay({ categoryName, onLoad }: CategoryPosterDisplayProps) {
  const theme = useTheme();
  const [content, setContent] = useState<TmdbResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    // Prevent multiple loads for the same category
    if (hasLoadedRef.current) return;

    const loadCategoryContent = async () => {
      // Check cache first
      if (categoryContentCache.has(categoryName)) {
        const cachedContent = categoryContentCache.get(categoryName);
        setContent(cachedContent || null);
        setLoading(false);
        hasLoadedRef.current = true;
        onLoad?.();
        return;
      }

      setLoading(true);
      try {
        const results = await fetchCategoryContent(categoryName);
        if (results && results.length > 0) {
          // Use category name as seed for consistent selection (deterministic)
          const seed = categoryName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
          const index = seed % Math.min(results.length, 10);
          const selectedContent = results[index];

          // Cache the selected content
          categoryContentCache.set(categoryName, selectedContent);
          setContent(selectedContent);
        }
      } catch (error) {
        console.error('Error loading category content:', error);
      } finally {
        setLoading(false);
        hasLoadedRef.current = true;
        onLoad?.();
      }
    };

    loadCategoryContent();
  }, [categoryName]);

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  if (loading) {
    return (
      <Skeleton
        variant="rectangular"
        width="100%"
        height="100%"
        animation="wave"
        sx={{ borderRadius: 1 }}
      />
    );
  }

  if (!content) {
    return (
      <Box sx={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: theme.palette.background.default,
        borderRadius: 1,
        color: theme.palette.text.secondary,
        fontSize: '0.875rem',
      }}>
        No content available
      </Box>
    );
  }

  const backdropPath = content.backdrop_path;
  const title = content.title || content.name || 'Unknown';

  // Format category name: replace underscores and dashes with spaces
  const formattedCategoryName = categoryName.replace(/[_-]/g, ' ');

  return (
    <Box sx={{
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 1,
      background: theme.palette.background.default,
    }}>
      {!imageLoaded && backdropPath && (
        <Skeleton
          variant="rectangular"
          width="100%"
          height="100%"
          animation="wave"
          sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}

      {backdropPath ? (
        <>
          {/* Background image with blur */}
          <img
            src={getTmdbBackdropUrl(backdropPath, 'w1280') || ''}
            alt={title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: imageLoaded ? (theme.palette.mode === 'light' ? 0.8 : 0.6) : 0,
              filter: theme.palette.mode === 'light'
                ? 'blur(2px) brightness(0.7) contrast(1.2)'
                : 'blur(2px)',
              transition: 'opacity 0.3s ease-in-out',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            onLoad={handleImageLoad}
            onError={handleImageLoad}
          />

          {/* Category title overlay */}
          <Box sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
          }}>
            <Typography
              variant="h6"
              sx={{
                color: 'white',
                fontWeight: 600,
                textAlign: 'center',
                textShadow: theme.palette.mode === 'light'
                  ? '2px 2px 8px rgba(0,0,0,0.9), 0px 0px 16px rgba(0,0,0,0.7)'
                  : '2px 2px 4px rgba(0,0,0,0.8)',
                px: 2,
                fontSize: { xs: '1rem', sm: '1.1rem', md: '1.25rem' },
                lineHeight: 1.2,
              }}
            >
              {formattedCategoryName}
            </Typography>
          </Box>
        </>
      ) : (
        <Box sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.palette.background.paper,
          color: theme.palette.text.secondary,
          fontSize: '0.875rem',
        }}>
          <Typography
            variant="h6"
            sx={{
              color: theme.palette.text.secondary,
              fontWeight: 600,
              textAlign: 'center',
              px: 2,
            }}
          >
            {categoryName}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
