import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Box, Card, CardContent, Typography, useTheme, alpha, Skeleton, Chip, IconButton } from '@mui/material';
import { Movie as MovieIcon, Tv as TvIcon, AccessTime as TimeIcon, ChevronLeft, ChevronRight } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { searchTmdb, getTmdbPosterUrl } from '../api/tmdbApi';
import axios from 'axios';
import { useSymlinkCreatedListener } from '../../hooks/useMediaHubUpdates';

const MotionCard = motion(Card);

// Memoized media card component to prevent unnecessary re-renders
const MediaCard = React.memo(({
  media,
  index,
  posterUrl,
  displayTitle,
  subtitle,
  description,
  formatTimeAgo,
  theme
}: {
  media: RecentMedia;
  index: number;
  posterUrl?: string;
  displayTitle: string;
  subtitle: string | null;
  description?: string;
  formatTimeAgo: (date: string) => string;
  theme: any;
}) => (
  <MotionCard
    key={`${media.path}-${media.updatedAt}`}
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    transition={{ duration: 0.3, delay: index * 0.1 }}
    tabIndex={0}
    role="button"
    aria-label={`${displayTitle} - ${media.type === 'movie' ? 'Movie' : 'TV Show'}`}
    sx={{
      minWidth: { xs: 140, sm: 160 },
      maxWidth: { xs: 140, sm: 160 },
      flexShrink: 0,
      borderRadius: 3,
      overflow: 'hidden',
      position: 'relative',
      cursor: 'pointer',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      bgcolor: 'background.paper',
      border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,

      '&:hover': {
        transform: 'translateY(-6px) scale(1.05)',
        boxShadow: `
          0 4px 16px ${alpha(theme.palette.primary.main, 0.25)},
          0 2px 8px ${alpha(theme.palette.primary.main, 0.15)},
          0 1px 4px ${alpha(theme.palette.common.black, 0.1)},
          inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}
        `,
        zIndex: 5,
        // Add a subtle border glow effect
        border: `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
        '& .poster-overlay': {
          opacity: 1,
        },
        '& .media-chip': {
          transform: 'scale(1.1)',
        },
        '& .poster-image': {
          transform: 'scale(1.08)',
        },
      },
      // Touch device support
      '&:active': {
        transform: 'translateY(-2px) scale(1.02)',
      },
      // Focus for keyboard navigation
      '&:focus-visible': {
        outline: `2px solid ${theme.palette.primary.main}`,
        outlineOffset: 2,
      },
    }}
  >
    {/* Poster/Thumbnail */}
    <Box
      sx={{
        height: { xs: 200, sm: 220 },
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.secondary.main, 0.08)} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, ${alpha(theme.palette.common.black, 0.1)} 100%)`,
          zIndex: 1,
        },
      }}
    >
      {/* TMDB Poster */}
      {posterUrl && (
        <Box
          component="img"
          className="poster-image"
          src={posterUrl}
          alt={displayTitle}
          sx={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            imageRendering: 'high-quality',
            filter: 'contrast(1.05) saturate(1.1)',
            backfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
          }}
          style={{
            WebkitImageSmoothing: true,
            WebkitBackfaceVisibility: 'hidden',
          } as React.CSSProperties}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      {/* Media Type Icon */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 3,
        }}
      >
        <Chip
          className="media-chip"
          icon={media.type === 'movie' ? <MovieIcon sx={{ fontSize: 14 }} /> : <TvIcon sx={{ fontSize: 14 }} />}
          label={media.type === 'movie' ? 'Movie' : 'TV'}
          size="small"
          sx={{
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(12px)',
            fontSize: '0.7rem',
            fontWeight: 700,
            height: 24,
            border: `1px solid ${alpha(theme.palette.divider, 0.2)}`,
            boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.1)}`,
            transition: 'all 0.2s ease',
            '& .MuiChip-label': {
              px: 0.5,
            },
          }}
        />
      </Box>

      {/* Description Overlay */}
      <Box
        className="poster-overlay"
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          background: `linear-gradient(180deg, transparent 0%, ${alpha(theme.palette.common.black, 0.85)} 100%)`,
          backdropFilter: 'blur(2px)',
          opacity: 0,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 2,
          p: 1.5,
        }}
      >
        {description && description.trim() && (
          <Typography
            variant="body2"
            sx={{
              color: 'white',
              fontSize: '0.75rem',
              lineHeight: 1.3,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {description}
          </Typography>
        )}
      </Box>
    </Box>

    {/* Content */}
    <CardContent sx={{ p: { xs: 1, sm: 1.5 }, '&:last-child': { pb: { xs: 1, sm: 1.5 } } }}>
      <Typography
        variant="subtitle2"
        fontWeight="600"
        sx={{
          fontSize: { xs: '0.8rem', sm: '0.875rem' },
          lineHeight: 1.2,
          mb: 0.5,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: 'text.primary',
        }}
      >
        {displayTitle}
      </Typography>

      {subtitle && (
        <Typography
          variant="caption"
          sx={{
            fontSize: { xs: '0.7rem', sm: '0.75rem' },
            fontWeight: 500,
            color: 'primary.main',
            display: 'block',
            mb: 0.3,
          }}
        >
          {subtitle}
        </Typography>
      )}

      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mt: subtitle ? 0.2 : 0.4,
      }}>
        <TimeIcon sx={{
          fontSize: { xs: 12, sm: 14 },
          color: alpha(theme.palette.text.secondary, 0.7)
        }} />
        <Typography
          variant="caption"
          sx={{
            fontSize: { xs: '0.7rem', sm: '0.75rem' },
            fontWeight: 500,
            color: alpha(theme.palette.text.secondary, 0.8),
          }}
        >
          {formatTimeAgo(media.updatedAt)}
        </Typography>
      </Box>
    </CardContent>
  </MotionCard>
));

interface RecentMedia {
  name: string;
  path: string;
  folderName: string;
  updatedAt: string;
  type: 'movie' | 'tvshow' | 'tv' | 'other';
  tmdbId?: string;
  showName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  filename?: string;
}

const RecentlyAddedMedia: React.FC = () => {
  // All state hooks at the top
  const [recentMedia, setRecentMedia] = useState<RecentMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [posterUrls, setPosterUrls] = useState<Record<string, string>>({});
  const [tmdbTitles, setTmdbTitles] = useState<Record<string, string>>({});
  const [tmdbDescriptions, setTmdbDescriptions] = useState<Record<string, string>>({});

  // All refs at the top
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fetchingIds = useRef<Set<string>>(new Set());
  const fetchTimeoutRef = useRef<number | null>(null);

  // Theme hook
  const theme = useTheme();

  // Fetch recent media function
  const fetchRecentMedia = useCallback(async () => {
    try {
      const response = await axios.get('/api/recent-media');
      const data = response.data;

      if (!data || !Array.isArray(data)) {
        console.error('Recent media API returned invalid data:', data);
        setRecentMedia([]);
        return;
      }

      const mediaItems: RecentMedia[] = data.map((item: any) => ({
        name: item.name || 'Unknown',
        path: item.path || '',
        folderName: item.folderName || '',
        updatedAt: item.updatedAt || new Date().toISOString(),
        type: item.type || 'unknown',
        tmdbId: item.tmdbId || '',
        showName: item.showName || '',
        seasonNumber: item.seasonNumber || null,
        episodeNumber: item.episodeNumber || null,
        episodeTitle: item.episodeTitle || '',
        filename: item.filename || ''
      }));

      setRecentMedia(mediaItems);
    } catch (err) {
      console.error('Failed to fetch recent media:', err);
      setRecentMedia([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data fetching effect
  useEffect(() => {
    fetchRecentMedia();
  }, [fetchRecentMedia]);

  // Listen for real-time symlink creation events
  useSymlinkCreatedListener((data) => {
    console.log('New symlink created, refreshing recent media:', data);
    // Refresh the recent media list when a new symlink is created
    fetchRecentMedia();
  }, [fetchRecentMedia]);

  // Optimized TMDB data fetching with debouncing and better batching
  useEffect(() => {
    // Clear any existing timeout
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
    }

    // Debounce the fetch to prevent rapid successive calls
    fetchTimeoutRef.current = window.setTimeout(() => {
      const fetchTmdbData = async () => {
        // Create a map of unique media items to avoid duplicates
        const uniqueMedia = new Map<string, RecentMedia>();
        const missingKeys: string[] = [];

        // Identify missing data in a single pass
        for (const media of recentMedia) {
          if (media.tmdbId) {
            const cacheKey = `${media.tmdbId}-${media.type}`;
            uniqueMedia.set(cacheKey, media);

            const hasPoster = posterUrls[cacheKey];
            const hasTitle = tmdbTitles[cacheKey];
            const hasDescription = tmdbDescriptions[cacheKey];
            const isCurrentlyFetching = fetchingIds.current.has(cacheKey);

            if ((!hasPoster || !hasTitle || !hasDescription) && !isCurrentlyFetching) {
              missingKeys.push(cacheKey);
            }
          }
        }

        if (missingKeys.length === 0) return;

        missingKeys.forEach(key => fetchingIds.current.add(key));

      try {
        const promises = missingKeys.map(async (cacheKey) => {
          const media = uniqueMedia.get(cacheKey)!;
          const mediaType = media.type === 'movie' ? 'movie' : 'tv';

          try {
            const result = await searchTmdb(media.tmdbId!, undefined, mediaType);
            return { cacheKey, result, media };
          } catch (error) {
            console.error('Failed to fetch TMDB data for', media.name, error);
            return { cacheKey, result: null, media };
          }
        });

        const results = await Promise.allSettled(promises);

        // Process results and batch state updates
        const newPosterUrls: Record<string, string> = {};
        const newTmdbTitles: Record<string, string> = {};
        const newTmdbDescriptions: Record<string, string> = {};

        results.forEach((promiseResult) => {
          if (promiseResult.status === 'fulfilled') {
            const { cacheKey, result } = promiseResult.value;
            if (result) {
              if (result.poster_path) {
                const posterUrl = getTmdbPosterUrl(result.poster_path, 'w342');
                if (posterUrl) newPosterUrls[cacheKey] = posterUrl;
              }
              if (result.title) newTmdbTitles[cacheKey] = result.title;
              if (result.overview) newTmdbDescriptions[cacheKey] = result.overview;
            }
          }
        });

        // Single batch update to minimize re-renders
        if (Object.keys(newPosterUrls).length > 0 ||
            Object.keys(newTmdbTitles).length > 0 ||
            Object.keys(newTmdbDescriptions).length > 0) {

          setPosterUrls(prev => ({ ...prev, ...newPosterUrls }));
          setTmdbTitles(prev => ({ ...prev, ...newTmdbTitles }));
          setTmdbDescriptions(prev => ({ ...prev, ...newTmdbDescriptions }));
        }
      } finally {
        // Always clean up fetching state
        missingKeys.forEach(key => fetchingIds.current.delete(key));
      }
    };

      if (recentMedia.length > 0) {
        fetchTmdbData();
      }
    }, 100); // 100ms debounce

    // Cleanup timeout on unmount
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, [recentMedia]);

  // Check scroll position and update navigation button states
  const checkScrollPosition = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;

      // Add small tolerance for floating point precision
      const tolerance = 2;
      const maxScrollLeft = scrollWidth - clientWidth;

      setCanScrollLeft(scrollLeft > tolerance);
      setCanScrollRight(scrollLeft < maxScrollLeft - tolerance);
    }
  }, []);

  // Scroll functions - memoized to prevent unnecessary re-renders
  const scrollLeft = useCallback(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const cardWidth = 160;
      const gap = 12;
      const scrollAmount = (cardWidth + gap) * 3;

      container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });

      // Update scroll position after animation
      setTimeout(checkScrollPosition, 300);
    }
  }, [checkScrollPosition]);

  const scrollRight = useCallback(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const cardWidth = 160;
      const gap = 12;
      const scrollAmount = (cardWidth + gap) * 3;

      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });

      // Update scroll position after animation
      setTimeout(checkScrollPosition, 300);
    }
  }, [checkScrollPosition]);

  // Update scroll position on media change and scroll events
  useEffect(() => {
    checkScrollPosition();
  }, [recentMedia, checkScrollPosition]);

  // Check scroll position when TMDB data loads (content size might change)
  useEffect(() => {
    const timeoutId = setTimeout(checkScrollPosition, 200);
    return () => clearTimeout(timeoutId);
  }, [posterUrls, tmdbTitles, tmdbDescriptions, checkScrollPosition]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollPosition);
      window.addEventListener('resize', checkScrollPosition);

      // Initial check after a short delay to ensure content is rendered
      const timeoutId = setTimeout(checkScrollPosition, 100);

      return () => {
        container.removeEventListener('scroll', checkScrollPosition);
        window.removeEventListener('resize', checkScrollPosition);
        clearTimeout(timeoutId);
      };
    }
  }, [checkScrollPosition]);

  // Memoized utility functions to prevent unnecessary re-calculations
  const formatTimeAgo = useCallback((dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    return date.toLocaleDateString();
  }, []);

  const getDisplayTitle = useCallback((media: RecentMedia) => {
    if (media.tmdbId) {
      const cacheKey = `${media.tmdbId}-${media.type}`;
      const tmdbTitle = tmdbTitles[cacheKey];
      if (tmdbTitle) {
        return tmdbTitle;
      }
    }

    // Fallback to showName for TV shows (handle both "tv" and "tvshow")
    if ((media.type === 'tvshow' || media.type === 'tv') && media.showName) {
      return media.showName;
    }

    // Final fallback to filename
    return media.name;
  }, [tmdbTitles]);

  const getSubtitle = useCallback((media: RecentMedia) => {
    if ((media.type === 'tvshow' || media.type === 'tv') && media.seasonNumber && media.episodeNumber) {
      const seasonEpisode = `S${String(media.seasonNumber).padStart(2, '0')}E${String(media.episodeNumber).padStart(2, '0')}`;
      if (media.episodeTitle && media.episodeTitle.trim() !== '') {
        return `${seasonEpisode} • ${media.episodeTitle}`;
      }
      return seasonEpisode;
    }
    return null;
  }, []);

  // Memoized loading skeleton to prevent unnecessary re-renders
  const loadingSkeleton = useMemo(() => (
    <Box>
      <Typography variant="h5" fontWeight="700" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TvIcon sx={{ color: 'primary.main' }} />
        Recently Added Media
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
        {[...Array(6)].map((_, index) => (
          <Box key={index} sx={{ minWidth: 200, flexShrink: 0 }}>
            <Skeleton variant="rectangular" width={200} height={300} sx={{ borderRadius: 2, mb: 1 }} />
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="60%" />
          </Box>
        ))}
      </Box>
    </Box>
  ), []);

  // Memoized empty state to prevent unnecessary re-renders
  const emptyState = useMemo(() => (
    <Box>
      <Typography variant="h5" fontWeight="700" sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TvIcon sx={{ color: 'primary.main' }} />
        Recently Added Media
      </Typography>
      <Card sx={{
        p: 4,
        textAlign: 'center',
        bgcolor: alpha(theme.palette.background.paper, 0.5),
        border: '1px dashed',
        borderColor: alpha(theme.palette.divider, 0.5)
      }}>
        <Typography variant="body1" color="text.secondary">
          No recent media found
        </Typography>
      </Card>
    </Box>
  ), [theme.palette.background.paper, theme.palette.divider]);

  // Conditional rendering based on state
  if (loading) {
    return loadingSkeleton;
  }

  if (recentMedia.length === 0) {
    return emptyState;
  }

  return (
    <Box>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: { xs: 1.5, sm: 2 }
      }}>
        <Box sx={{
          backgroundColor: `${theme.palette.primary.main}15`,
          borderRadius: '12px',
          p: 0.8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${theme.palette.primary.main}30`,
        }}>
          <TvIcon sx={{
            color: 'primary.main',
            fontSize: { xs: 16, sm: 20 }
          }} />
        </Box>
        <Typography
          variant="h6"
          fontWeight="600"
          sx={{
            fontSize: { xs: '1rem', sm: '1.25rem' }
          }}
        >
          Recently Added Media
        </Typography>
      </Box>

      {/* Navigation Container */}
      <Box sx={{ position: 'relative' }}>
        {/* Left Navigation Arrow - Desktop Only */}
        <IconButton
          onClick={scrollLeft}
          disabled={!canScrollLeft}
          sx={{
            position: 'absolute',
            left: -16,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 20,
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(12px)',
            border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
            width: 36,
            height: 36,
            opacity: canScrollLeft ? 1 : 0.3,
            transition: 'all 0.2s ease',
            display: { xs: 'none', lg: 'flex' },
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: alpha(theme.palette.primary.main, 0.4),
              transform: 'translateY(-50%) scale(1.05)',
            },
            '&:disabled': {
              opacity: 0.3,
              cursor: 'not-allowed',
            },
          }}
        >
          <ChevronLeft sx={{ color: 'text.primary', fontSize: 20 }} />
        </IconButton>

        {/* Right Navigation Arrow - Desktop Only */}
        <IconButton
          onClick={scrollRight}
          disabled={!canScrollRight}
          sx={{
            position: 'absolute',
            right: -16,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 20,
            bgcolor: alpha(theme.palette.background.paper, 0.95),
            backdropFilter: 'blur(12px)',
            border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
            width: 36,
            height: 36,
            opacity: canScrollRight ? 1 : 0.3,
            transition: 'all 0.2s ease',
            display: { xs: 'none', lg: 'flex' },
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              borderColor: alpha(theme.palette.primary.main, 0.4),
              transform: 'translateY(-50%) scale(1.05)',
            },
            '&:disabled': {
              opacity: 0.3,
              cursor: 'not-allowed',
            },
          }}
        >
          <ChevronRight sx={{ color: 'text.primary', fontSize: 20 }} />
        </IconButton>

        {/* Scrollable Content */}
        <Box
          ref={scrollContainerRef}
          sx={{
            display: 'flex',
            gap: { xs: 1, sm: 1.5 },
            overflowX: 'auto',
            overflowY: 'hidden',
            pb: { xs: 1.5, sm: 2 },
            pt: { xs: 1, sm: 1 },
            px: { xs: 3, sm: 4 },
            mx: { xs: -3, sm: -4 },
            scrollBehavior: 'smooth',

            '&::-webkit-scrollbar': {
              display: 'none',
            },
            // Firefox
            scrollbarWidth: 'none',
            // IE and Edge
            msOverflowStyle: 'none',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: { xs: 8, sm: 12 },
              background: `linear-gradient(90deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.background.default, 0.6)} 70%, transparent 100%)`,
              zIndex: 10,
              pointerEvents: 'none',
              display: { xs: 'block', md: 'none' },
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: { xs: 0, sm: 0 },
              background: 'transparent',
              zIndex: 10,
              pointerEvents: 'none',
              display: 'none',
            },
            // Smooth momentum scrolling on iOS
            WebkitOverflowScrolling: 'touch',
          }}
        >
        <AnimatePresence>
          {recentMedia.map((media, index) => {
            const cacheKey = `${media.tmdbId}-${media.type}`;
            return (
              <MediaCard
                key={`${media.path}-${media.updatedAt}`}
                media={media}
                index={index}
                posterUrl={posterUrls[cacheKey]}
                displayTitle={getDisplayTitle(media)}
                subtitle={getSubtitle(media)}
                description={tmdbDescriptions[cacheKey]}
                formatTimeAgo={formatTimeAgo}
                theme={theme}
              />
            );
          })}
        </AnimatePresence>
        </Box>
      </Box>
    </Box>
  );
};

export default RecentlyAddedMedia;
