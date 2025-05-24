import React from 'react';
import { Box, Paper, Typography, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material';
import { FileItem } from './types';
import { TmdbResult } from '../api/tmdbApi';
import { getFileIcon } from './fileUtils';
import { getTmdbPosterUrl } from '../api/tmdbApi';

interface PosterViewProps {
  files: FileItem[];
  tmdbData: { [key: string]: TmdbResult | null };
  folderHasAllowed: { [folder: string]: boolean };
  imgLoadedMap: { [key: string]: boolean };
  onFileClick: (file: FileItem, tmdb: TmdbResult | null) => void;
  onImageLoad: (key: string) => void;
}

export default function PosterView({
  files,
  tmdbData,
  folderHasAllowed,
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
                const isPosterCandidate = file.type === 'directory' && !isSeasonFolder && folderHasAllowed[file.name] !== false;
                const hasTmdbData = !!tmdb;
                const hasPosterPath = tmdb && tmdb.poster_path;

                if (isPosterCandidate) {
                  return (
                    <>
                      {!loaded && (
                        <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
                      )}

                      {hasTmdbData && (
                        <img
                          src={hasPosterPath ? getTmdbPosterUrl(tmdb.poster_path) || '' : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}
                          alt={tmdb.title || file.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            display: 'block',
                            opacity: loaded && hasPosterPath ? 1 : 0,
                            filter: loaded && hasPosterPath ? 'blur(0px)' : 'blur(5px)', 
                            transform: loaded && hasPosterPath ? 'scale(1)' : 'scale(1.05)',
                            transition: 'opacity 0.4s ease-in-out, filter 0.4s ease-in-out, transform 0.4s ease-in-out',
                          }}
                          onLoad={() => onImageLoad(file.name)}
                          onError={() => onImageLoad(file.name)}
                        />
                      )}

                      {hasTmdbData && !hasPosterPath && loaded && (
                        <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                          {getFileIcon(file.name, file.type)}
                        </Box>
                      )}
                    </>
                  );
                } else {
                  return file.type === 'directory' && folderHasAllowed[file.name] === false ? getFileIcon(file.name, file.type) : null;
                }
              })()}
            </Box>
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
          </Paper>
        );
      })}
    </Box>
  );
} 