import React from 'react';
import { Paper, Box, Typography, IconButton, Chip, alpha, useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StarIcon from '@mui/icons-material/Star';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import FileActionMenu from '../FileBrowser/FileActionMenu';
import { EpisodeFileInfo, SeasonFolderInfo } from './types';
import { motion } from 'framer-motion';

interface EpisodeCardProps {
  file: EpisodeFileInfo;
  ep: any;
  selectedSeasonFolder: SeasonFolderInfo;
  handleViewDetails: any;
  fetchSeasonFolders: any;
  handleDeleted: any;
  handleError: any;
  setVideoPlayerOpen: any;
  setSelectedFile: any;
}

const EpisodeCard: React.FC<EpisodeCardProps> = ({
  file,
  ep,
  selectedSeasonFolder,
  handleViewDetails,
  fetchSeasonFolders,
  handleDeleted,
  handleError,
  setVideoPlayerOpen,
  setSelectedFile,
}) => {
  const theme = useTheme();
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        ease: [0.4, 0, 0.2, 1],
        opacity: { duration: 0.2 },
        y: { duration: 0.3 }
      }}
      style={{
        width: '100%',
        willChange: 'opacity, transform'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          borderRadius: { xs: 3, md: 4 },
          overflow: 'hidden',
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 50%, rgba(255,255,255,0.03) 100%)'
            : alpha(theme.palette.background.paper, 0.8),
          backdropFilter: 'blur(20px)',
          border: theme.palette.mode === 'dark'
            ? `1px solid ${alpha('#ffffff', 0.1)}`
            : `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          cursor: 'pointer',
          height: { xs: 'auto', sm: 140 },
          minHeight: { xs: 200, sm: 140 },
          position: 'relative',
          boxShadow: theme.palette.mode === 'dark'
            ? `0 8px 32px ${alpha('#000000', 0.6)}, inset 0 1px 0 ${alpha('#ffffff', 0.1)}`
            : '0 2px 8px rgba(0,0,0,0.06)',
          '&::before': theme.palette.mode === 'dark' ? {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 50%, rgba(255,255,255,0.01) 100%)',
            pointerEvents: 'none',
            borderRadius: 'inherit',
          } : {},
          '&:hover': {
            transform: { xs: 'translateY(-2px)', sm: 'translateY(-4px) scale(1.01)' },
            background: theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.08) 100%)'
              : alpha(theme.palette.background.paper, 0.95),
            border: theme.palette.mode === 'dark'
              ? `1px solid ${alpha(theme.palette.primary.main, 0.4)}`
              : `1px solid ${alpha(theme.palette.primary.main, 0.4)}`,
            boxShadow: theme.palette.mode === 'dark'
              ? `0 20px 60px ${alpha('#000000', 0.8)}, 0 0 0 1px ${alpha(theme.palette.primary.main, 0.2)}, inset 0 1px 0 ${alpha('#ffffff', 0.15)}`
              : '0 8px 25px rgba(0,0,0,0.1)',
            '& .episode-thumbnail img': {
              transform: 'scale(1.05)',
            },
            '& .play-overlay': {
              opacity: 1,
            }
          }
        }}
      >
        {/* Thumbnail Section */}
        <Box
          className="episode-thumbnail"
          sx={{
            position: 'relative',
            width: { xs: '100%', sm: 240 },
            minWidth: { xs: 'auto', sm: 240 },
            height: { xs: 160, sm: 140 },
            overflow: 'hidden',
            background: theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 100%)'
              : alpha(theme.palette.grey[200], 0.5),
            borderRadius: {
              xs: '16px 16px 0 0',
              sm: '16px 0 0 16px'
            },
          }}
          onClick={() => {
            let relPath = file.path;
            const match = relPath.match(/([\/](Shows|Movies)[\/].*)$/i);
            if (match) {
              relPath = match[1].replace(/^\+|^\/+/, '');
            } else if (relPath.startsWith('/')) {
              relPath = relPath.replace(/^\/+/, '');
            }
            const encodedPath = encodeURIComponent(relPath);
            const streamUrl = `/api/stream/${encodedPath}`;
            setSelectedFile({ ...file, videoUrl: streamUrl });
            setVideoPlayerOpen(true);
          }}
        >
          {ep.still_path ? (
            <>
              <img
                src={`https://image.tmdb.org/t/p/w400${ep.still_path}`}
                alt={ep.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center center',
                  transition: 'transform 0.3s ease',
                  display: 'block'
                }}
              />

              {/* Play Overlay */}
              <Box
                className="play-overlay"
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  bgcolor: alpha('#000000', 0.4),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'opacity 0.3s ease',
                }}
              >
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    bgcolor: alpha('#ffffff', 0.9),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'transform 0.2s ease',
                    '&:hover': {
                      transform: 'scale(1.1)',
                    }
                  }}
                >
                  <PlayArrowIcon sx={{
                    fontSize: 28,
                    color: '#000000',
                    ml: 0.5
                  }} />
                </Box>
              </Box>

              {/* Episode Number Badge */}
              <Box
                sx={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  bgcolor: alpha('#000000', 0.8),
                  color: 'white',
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 2,
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  backdropFilter: 'blur(8px)',
                }}
              >
                {ep.episode_number}
              </Box>
            </>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 1
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 32, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">
                No Preview
              </Typography>
            </Box>
          )}
        </Box>
        {/* Content Section */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            p: { xs: 2, sm: 3 },
            justifyContent: 'space-between',
            minWidth: 0,
            bgcolor: theme.palette.mode === 'dark'
              ? 'transparent'
              : alpha('#ffffff', 0.2),
          }}
        >
          {/* Header Row */}
          <Box sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            mb: { xs: 1.5, sm: 2 },
            gap: { xs: 1, sm: 2 }
          }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: '1rem', sm: '1.2rem' },
                  lineHeight: 1.3,
                  color: theme.palette.mode === 'dark'
                    ? '#ffffff'
                    : theme.palette.text.primary,
                  mb: 0.5,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {ep.name}
              </Typography>

              {/* Metadata Row */}
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 1, sm: 2 },
                flexWrap: 'wrap'
              }}>
                {ep.vote_average > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <StarIcon sx={{
                      fontSize: 16,
                      color: 'warning.main'
                    }} />
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 600,
                        color: 'warning.main',
                        fontSize: '0.875rem'
                      }}
                    >
                      {ep.vote_average.toFixed(1)}
                    </Typography>
                  </Box>
                )}

                {ep.runtime && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <AccessTimeIcon sx={{
                      fontSize: 16,
                      color: theme.palette.mode === 'dark'
                        ? alpha('#ffffff', 0.7)
                        : 'text.secondary'
                    }} />
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        fontSize: '0.875rem',
                        color: theme.palette.mode === 'dark'
                          ? alpha('#ffffff', 0.8)
                          : 'text.secondary'
                      }}
                    >
                      {ep.runtime}m
                    </Typography>
                  </Box>
                )}

                {ep.air_date && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <CalendarTodayIcon sx={{
                      fontSize: 16,
                      color: theme.palette.mode === 'dark'
                        ? alpha('#ffffff', 0.7)
                        : 'text.secondary'
                    }} />
                    <Typography
                      variant="body2"
                      sx={{
                        fontWeight: 500,
                        fontSize: '0.875rem',
                        color: theme.palette.mode === 'dark'
                          ? alpha('#ffffff', 0.8)
                          : 'text.secondary'
                      }}
                    >
                      {new Date(ep.air_date).toLocaleDateString()}
                    </Typography>
                  </Box>
                )}
              </Box>
            </Box>

            <FileActionMenu
              file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path, sourcePath: file.path }}
              currentPath={selectedSeasonFolder ? `${selectedSeasonFolder.folderName}`.replace(/^\/+/, '') : ''}
              onViewDetails={handleViewDetails}
              onRename={fetchSeasonFolders}
              onDeleted={handleDeleted}
              onError={handleError}
              onNavigateBack={undefined}
            />
          </Box>

          {/* Episode Overview */}
          {ep.overview && (
            <Typography
              variant="body2"
              sx={{
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: { xs: 2, sm: 3 },
                WebkitBoxOrient: 'vertical',
                color: theme.palette.mode === 'dark'
                  ? alpha('#ffffff', 0.75)
                  : 'text.secondary',
                fontSize: '0.875rem',
                mt: 0.5,
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  WebkitLineClamp: 'unset',
                  overflow: 'visible',
                  textOverflow: 'unset',
                  display: 'block',
                  color: theme.palette.mode === 'dark'
                    ? alpha('#ffffff', 0.9)
                    : 'text.primary',
                }
              }}
              title={ep.overview}
            >
              {ep.overview}
            </Typography>
          )}
        </Box>
      </Box>
    </motion.div>
  );
};

export default EpisodeCard;