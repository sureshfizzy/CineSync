
import { Box, Paper, Typography, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material';
import { FileItem } from './types';
import { TmdbResult } from '../api/tmdbApi';
import { getFileIcon } from './fileUtils';
import { getTmdbPosterUrl } from '../api/tmdbApi';
import CategoryPosterDisplay from './CategoryPosterDisplay';

interface PosterViewProps {
  files: FileItem[];
  tmdbData: { [key: string]: TmdbResult | null };
  imgLoadedMap: { [key: string]: boolean };
  onFileClick: (file: FileItem, tmdb: TmdbResult | null) => void;
  onImageLoad: (key: string) => void;
}

export default function PosterView({
  files,
  tmdbData,
  imgLoadedMap,
  onFileClick,
  onImageLoad,
}: PosterViewProps) {
  const theme = useTheme();

  if (files.length === 0) {
    return (
      <Box sx={{ gridColumn: '1/-1', textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">
          This folder is empty.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: {
        xs: 'repeat(2, 1fr)',
        sm: 'repeat(3, 1fr)',
        md: 'repeat(4, 1fr)',
        lg: 'repeat(5, 1fr)'
      },
      gap: 3,
      p: 1
    }}>
      {files.map((file) => {
        const tmdb = tmdbData[file.name];
        const isSeasonFolder = file.isSeasonFolder;
        const loaded = imgLoadedMap[file.name] || false;

        return (
          <Paper
            key={file.name}
            data-file-name={file.name}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              cursor: file.type === 'directory' ? 'pointer' : 'default',
              transition: 'all 0.2s ease-in-out',
              boxShadow: 2,
              borderRadius: 3,
              overflow: 'hidden',
              position: 'relative',
              '&:hover': {
                transform: 'translateY(-4px)',
                boxShadow: 6,
                background: theme.palette.action.selected
              },
              '&.alphabet-highlight': {
                backgroundColor: theme.palette.primary.main + '20',
                animation: 'pulse 2s ease-in-out',
              },
              '@keyframes pulse': {
                '0%': { backgroundColor: theme.palette.primary.main + '40' },
                '50%': { backgroundColor: theme.palette.primary.main + '20' },
                '100%': { backgroundColor: 'transparent' },
              }
            }}
            onClick={() => onFileClick(file, tmdb)}
          >
            <Box sx={{
              width: '100%',
              aspectRatio: '3/4',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: theme.palette.background.default,
              p: 0,
              position: 'relative',
              overflow: 'hidden',
            }}>
              {(() => {
                const posterPath = file.posterPath || (tmdb && tmdb.poster_path);
                const title = file.title || (tmdb && tmdb.title) || file.name;
                const hasPosterPath = !!posterPath;

                // Handle category folders with special display
                if (file.isCategoryFolder && file.type === 'directory') {
                  return (
                    <CategoryPosterDisplay
                      categoryName={file.name}
                      onLoad={() => onImageLoad(file.name)}
                    />
                  );
                }

                const isPosterCandidate = file.type === 'directory' && !isSeasonFolder && hasPosterPath;

                if (isPosterCandidate) {
                  return (
                    <>
                      {/* Show skeleton only if no poster path is available */}
                      {!loaded && !hasPosterPath && (
                        <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                      )}

                      {/* Blurred background image (shows immediately if poster path available) */}
                      {hasPosterPath && !loaded && (
                        <img
                          src={getTmdbPosterUrl(posterPath, 'w92') || ''}
                          alt={`${title} (loading)`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            display: 'block',
                            opacity: 1,
                            filter: 'blur(8px)',
                            transform: 'scale(1.1)',
                            transition: 'opacity 0.3s ease-in-out',
                          }}
                        />
                      )}

                      {/* Main high-quality image */}
                      <img
                        src={hasPosterPath ? getTmdbPosterUrl(posterPath) || '' : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}
                        alt={title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          position: 'absolute',
                          top: 0, left: 0, right: 0, bottom: 0,
                          display: 'block',
                          opacity: loaded && hasPosterPath ? 1 : 0,
                          filter: 'blur(0px)',
                          transform: 'scale(1)',
                          transition: 'opacity 0.4s ease-in-out',
                          zIndex: 1,
                        }}
                        onLoad={() => onImageLoad(file.name)}
                        onError={() => onImageLoad(file.name)}
                      />

                      {!hasPosterPath && loaded && (
                        <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                          {getFileIcon(file.name, file.type)}
                        </Box>
                      )}
                    </>
                  );
                } else {
                  // Show folder icon for directories without TMDB data
                  return file.type === 'directory' ? getFileIcon(file.name, file.type) : null;
                }
              })()}
            </Box>
            {/* Only show bottom title section for non-category folders */}
            {!file.isCategoryFolder && (
              <Box sx={{
                width: '100%',
                p: { xs: '6px 8px', sm: '4px 12px' },
                background: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`
              }}>
                <Typography
                  sx={{
                    fontWeight: 500,
                    textAlign: 'center',
                    fontSize: { xs: '0.9rem', sm: '1rem' },
                    wordBreak: 'break-all',
                    mb: 0.5,
                    lineHeight: 1.2,
                    maxHeight: '1.4em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'block',
                  }}
                >
                  {file.type === 'directory' && !file.isSeasonFolder && tmdb && tmdb.title
                    ? (tmdb.release_date ? tmdb.title.replace(/\s*\(\d{4}\)$/, '') : tmdb.title)
                    : file.name}
                </Typography>
                {tmdb && tmdb.release_date && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      fontWeight: 500,
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                    {tmdb.release_date
                      ? new Date(tmdb.release_date).getFullYear()
                      : ''}
                  </Typography>
                )}
              </Box>
            )}
          </Paper>
        );
      })}
    </Box>
  );
}