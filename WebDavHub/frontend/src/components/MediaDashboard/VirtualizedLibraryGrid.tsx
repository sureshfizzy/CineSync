import { useCallback, useEffect, useRef } from 'react';
import { Box, Paper, Typography, Skeleton, alpha, Chip, useTheme } from '@mui/material';
import { FileItem } from '../FileBrowser/types';
import { TmdbResult } from '../api/tmdbApi';
import PosterImage from '../FileBrowser/PosterImage';
import { getArrBadgeData, getQualityTone } from '../FileBrowser/fileUtils';
import { mediaTypeFromTmdb } from '../../utils/mediaType';
import '../FileBrowser/poster-optimizations.css';

interface VirtualizedLibraryGridProps {
  items: FileItem[];
  totalCount: number;
  loadingMore: boolean;
  onLoadMore: () => void;
  tmdbData: { [key: string]: TmdbResult | null };
  onFileClick: (file: FileItem, tmdb: TmdbResult | null) => void;
  onImageLoad: (key: string) => void;
}

export default function VirtualizedLibraryGrid({
  items,
  totalCount,
  loadingMore,
  onLoadMore,
  tmdbData,
  onFileClick,
  onImageLoad,
}: VirtualizedLibraryGridProps) {
  const theme = useTheme();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loadMoreRef.current || loadingMore || items.length >= totalCount) return;
    const el = loadMoreRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && items.length < totalCount) {
          onLoadMore();
        }
      },
      { rootMargin: '200px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadingMore, items.length, totalCount, onLoadMore]);

  const renderCard = useCallback(
    (file: FileItem) => {
      const tmdb = tmdbData[file.name];
      const posterPath = file.posterPath || (tmdb?.poster_path);
      const tmdbId = file.tmdbId || (tmdb?.id);
      const hasPosterPath = !!posterPath || !!tmdbId;
      const arrBadges = getArrBadgeData(file);
      const qualityTone = getQualityTone(arrBadges.quality);
      const title = tmdb?.title || file.name;
      const statusColor =
        arrBadges.statusTone === 'success'
          ? theme.palette.success.main
          : arrBadges.statusTone === 'warning'
            ? theme.palette.warning.main
            : arrBadges.statusTone === 'info'
              ? theme.palette.info.main
              : arrBadges.statusTone === 'error'
                ? theme.palette.error.main
                : theme.palette.text.secondary;

      return (
        <Paper
          key={file.name}
          className="poster-card"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
            cursor: 'pointer',
            transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            transform: 'translateZ(0)',
            boxShadow: 2,
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
            maxWidth: '100%',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: 6,
            },
          }}
          onClick={() => onFileClick(file, tmdb)}
        >
          <Box
            className="poster-image-container"
            sx={{
              width: '100%',
              aspectRatio: '3/4',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: theme.palette.background.default,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {arrBadges.quality && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  zIndex: 5,
                  bgcolor: alpha(
                    qualityTone === 'warning' ? '#ed6c02' : qualityTone === 'info' ? '#0288d1' : '#2e7d32',
                    0.9
                  ),
                  color: '#fff',
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  backdropFilter: 'blur(8px)',
                }}
              >
                {arrBadges.quality}
              </Box>
            )}
            {hasPosterPath ? (
              <PosterImage
                tmdbId={tmdbId}
                posterPath={posterPath}
                mediaType={mediaTypeFromTmdb(tmdb?.media_type, tmdb?.first_air_date)}
                size="w342"
                className="poster-image"
                alt={title}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                  imageRendering: 'auto',
                  backfaceVisibility: 'hidden',
                  transform: 'translateZ(0)',
                }}
                loading="lazy"
                decoding="async"
                onLoad={() => onImageLoad(file.name)}
                onError={() => onImageLoad(file.name)}
              />
            ) : (
              <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" sx={{ position: 'absolute', inset: 0 }} />
            )}
          </Box>
          <Box
            sx={{
              width: '100%',
              minWidth: 0,
              maxWidth: '100%',
              p: '4px 8px',
              background: theme.palette.background.paper,
              borderTop: `1px solid ${theme.palette.divider}`,
              flexShrink: 0,
              height: 72,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 0,
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
                minWidth: 0,
                textAlign: 'center',
                fontWeight: 500,
                fontSize: '0.8rem',
                lineHeight: 1.2,
              }}
            >
              {(tmdb?.release_date || tmdb?.first_air_date) ? (title || file.name).replace(/\s*\(\d{4}\)$/, '') : (title || file.name)}
            </Box>
            {(file.year || tmdb?.release_date || tmdb?.first_air_date) && (
              <Box
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                  minWidth: 0,
                  textAlign: 'center',
                  fontWeight: 500,
                  fontSize: '0.7rem',
                  color: theme.palette.text.secondary,
                }}
              >
                {file.year || new Date(tmdb?.release_date || tmdb?.first_air_date || '').getFullYear()}
              </Box>
            )}
            <Box sx={{ mt: 0.25, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              {arrBadges.monitored && (
                <Chip
                  size="small"
                  label="Monitored"
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    color: theme.palette.info.main,
                  }}
                />
              )}
              {arrBadges.statusLabel && (
                <Chip
                  size="small"
                  label={arrBadges.statusLabel}
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    bgcolor: alpha(statusColor, 0.12),
                    color: statusColor,
                  }}
                />
              )}
            </Box>
          </Box>
        </Paper>
      );
    },
    [tmdbData, onFileClick, onImageLoad, theme]
  );

  if (items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">No items to display.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        className="poster-grid"
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(3, minmax(0, 1fr))',
            md: 'repeat(4, minmax(0, 1fr))',
            lg: 'repeat(5, minmax(0, 1fr))',
          },
          gap: 3,
          p: 1,
          contain: 'none',
          alignContent: 'start',
        }}
      >
        {items.map((file) => renderCard(file))}
      </Box>
      {(loadingMore || items.length < totalCount) && (
        <Box ref={loadMoreRef} sx={{ py: 3, display: 'flex', justifyContent: 'center' }}>
          {loadingMore ? (
            <Typography color="text.secondary">Loading more...</Typography>
          ) : (
            <Typography color="text.secondary">
              {items.length} of {totalCount} loaded. Scroll for more.
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
