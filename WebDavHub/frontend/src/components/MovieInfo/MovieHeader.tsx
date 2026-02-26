import React from 'react';
import { Box, Typography, Chip, Paper, useTheme, useMediaQuery, alpha, IconButton, Tooltip, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { motion } from 'framer-motion';
import { MediaDetailsData } from '../../types/MediaTypes';
import MovieFileActions from './MovieFileActions';
import SearchIcon from '@mui/icons-material/Search';

interface MovieHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  fileInfo: any;
  filteredFiles?: any[];
  selectedFileIndex?: number;
  onFileIndexChange?: (index: number) => void;
  folderName: string;
  currentPath: string;
  onNavigateBack?: () => void;
  availableQualities?: string[];
  selectedQuality?: string | null;
  onQualityChange?: (quality: string | null) => void;
  isArrDashboardContext?: boolean;
  isLoadingFiles?: boolean;
  onSearchMissing?: (title: string, type: 'movie' | 'tv') => void;
}






const MovieHeader: React.FC<MovieHeaderProps> = ({ data, getPosterUrl, fileInfo, filteredFiles, selectedFileIndex = 0, onFileIndexChange, folderName, currentPath, onNavigateBack, availableQualities = [], selectedQuality = null, onQualityChange, isArrDashboardContext = false, isLoadingFiles = false, onSearchMissing }) => {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const files = Array.isArray(fileInfo) ? fileInfo : (fileInfo ? [fileInfo] : []);
  const displayFiles = filteredFiles ?? files;
  const selectedFile = displayFiles[selectedFileIndex] ?? displayFiles[0] ?? files[0];
  const hasMultipleSameQuality = displayFiles.length > 1 && !!selectedQuality;
  const canSearch = !isLoadingFiles && files.length === 0 && !!onSearchMissing;



  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
      {/* Poster Section with Version Switcher */}
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: isMobile ? 0.25 : 0.3,
            ease: [0.4, 0, 0.2, 1]
          }}
          style={{
            willChange: 'transform, opacity',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        >
          <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
            <img
              src={getPosterUrl(data.poster_path)}
              alt={data.title}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </Paper>
        </motion.div>


      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <motion.div
          initial={{ opacity: 0, y: isMobile ? 10 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ 
            duration: isMobile ? 0.25 : 0.3,
            ease: [0.4, 0, 0.2, 1],
            delay: 0.1
          }}
          style={{ 
            willChange: 'opacity, transform',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' }, flexWrap: 'wrap' }}>
            <Typography
              variant="h3"
              fontWeight={700}
              sx={{
                textAlign: { xs: 'center', sm: 'center', md: 'left' },
                fontSize: { xs: '1.8rem', sm: '2rem', md: '2.5rem' }
              }}
            >
              {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
            </Typography>
            {canSearch && (
              <Tooltip title="Search">
                <IconButton
                  onClick={() => onSearchMissing?.(data.title, 'movie')}
                  sx={{
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    color: theme.palette.primary.main,
                    '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                  }}
                  size={isMobile ? 'small' : 'medium'}
                >
                  <SearchIcon fontSize={isMobile ? 'small' : 'medium'} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Quality version toggle — only shown when multiple quality tracks are present */}
          {availableQualities.length > 1 && onQualityChange && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 1.5,
              flexWrap: 'wrap',
              justifyContent: { xs: 'center', md: 'flex-start' },
            }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
              >
                Version:
              </Typography>
              <ToggleButtonGroup
                value={selectedQuality}
                exclusive
                size="small"
                onChange={(_e, val) => onQualityChange(val)}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                <ToggleButton
                  value={null as any}
                  sx={{
                    px: 1.5,
                    py: 0.5,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    borderRadius: '6px !important',
                    border: `1px solid ${alpha(theme.palette.divider, 0.4)} !important`,
                    '&.Mui-selected': {
                      bgcolor: alpha(theme.palette.primary.main, 0.15),
                      color: 'primary.main',
                      borderColor: `${alpha(theme.palette.primary.main, 0.5)} !important`,
                    },
                  }}
                >
                  All
                </ToggleButton>
                {availableQualities.map(q => (
                  <ToggleButton
                    key={q}
                    value={q}
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '6px !important',
                      border: `1px solid ${alpha(theme.palette.divider, 0.4)} !important`,
                      '&.Mui-selected': {
                        bgcolor: alpha(theme.palette.info.main, 0.15),
                        color: 'info.main',
                        borderColor: `${alpha(theme.palette.info.main, 0.5)} !important`,
                      },
                    }}
                  >
                    {q}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          )}


          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {genres.map((g: { id: number; name: string }) => (
              <Chip key={g.id} label={g.name} color="primary" variant="outlined" size={isMobile ? "small" : "medium"} />
            ))}
            {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" size={isMobile ? "small" : "medium"} />}
            {data.status && <Chip label={data.status} color="default" variant="outlined" size={isMobile ? "small" : "medium"} />}
            {country && <Chip label={country} color="default" variant="outlined" size={isMobile ? "small" : "medium"} />}
          </Box>
          {data.tagline && (
            <Typography 
              variant="h5" 
              color="text.secondary" 
              fontStyle="italic" 
              gutterBottom 
              sx={{ 
                mb: 1, 
                textAlign: { xs: 'center', sm: 'center', md: 'left' },
                fontSize: { xs: '1rem', sm: '1.1rem', md: '1.25rem' }
              }}
            >
              {data.tagline}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {director && <Typography sx={{ fontSize: { xs: '0.9rem', md: '1rem' } }}><b>Director:</b> {director.name}</Typography>}
            {writers && writers.length > 0 && (
              <Typography sx={{ fontSize: { xs: '0.9rem', md: '1rem' } }}><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>
            )}
          </Box>
          <Typography
            variant="body1"
            sx={{
              mb: 3,
              textAlign: { xs: 'center', sm: 'center', md: 'left' },
              fontSize: { xs: '0.95rem', md: '1rem' },
              lineHeight: { xs: 1.5, md: 1.6 }
            }}
          >
            {data.overview}
          </Typography>

          {/* Mini sub-selector: appears below quality toggle when the selected
              quality contains more than one file (e.g. two 1080p cuts) */}
          {hasMultipleSameQuality && onFileIndexChange && (
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mb: 1.5,
              flexWrap: 'wrap',
              justifyContent: { xs: 'center', md: 'flex-start' },
            }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                File:
              </Typography>
              <ToggleButtonGroup
                value={selectedFileIndex}
                exclusive
                size="small"
                onChange={(_e, val) => { if (val !== null) onFileIndexChange(val); }}
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                {displayFiles.map((_: any, idx: number) => (
                  <ToggleButton
                    key={idx}
                    value={idx}
                    sx={{
                      px: 1.5,
                      py: 0.5,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      borderRadius: '6px !important',
                      border: `1px solid ${alpha(theme.palette.divider, 0.4)} !important`,
                      '&.Mui-selected': {
                        bgcolor: alpha(theme.palette.primary.main, 0.15),
                        color: 'primary.main',
                        borderColor: `${alpha(theme.palette.primary.main, 0.5)} !important`,
                      },
                    }}
                  >
                    v{idx + 1}
                    {displayFiles[idx]?.size ? ` · ${displayFiles[idx].size}` : ''}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          )}

          {/* File Actions for the active file */}
          {selectedFile && (
            <Box sx={{ mt: 2, mb: 3 }}>
              <MovieFileActions
                data={data}
                folderName={folderName}
                currentPath={currentPath}
                placement="belowDescription"
                fileInfo={selectedFile}
                onNavigateBack={onNavigateBack}
              />
            </Box>
          )}

          {/* Overview Section - Only show in ArrDashboard context */}
          {isArrDashboardContext && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
              style={{
                willChange: 'opacity, transform',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden'
              }}
            >
              <Box sx={{ 
                mb: 3, 
                p: 2, 
                bgcolor: alpha(theme.palette.background.paper, 0.8), 
                borderRadius: 2, 
                border: '1px solid', 
                borderColor: alpha(theme.palette.divider, 0.3),
                backdropFilter: 'blur(10px)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)'
              }}>
                <Box sx={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: { xs: 1.5, sm: 2 }, 
                  alignItems: 'center', 
                  justifyContent: { xs: 'center', md: 'flex-start' },
                  '& > *': {
                    flexShrink: 0
                  }
                }}>
                  {/* Status */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ 
                      width: 4, 
                      height: 16, 
                      bgcolor: isLoadingFiles ? 'info.main' : (files.length > 0 ? 'success.main' : 'warning.main'), 
                      borderRadius: 0.5,
                      boxShadow: isLoadingFiles ? '0 0 8px rgba(33, 150, 243, 0.3)' : (files.length > 0 ? '0 0 8px rgba(76, 175, 80, 0.3)' : '0 0 8px rgba(255, 152, 0, 0.3)')
                    }} />
                    <Typography variant="body2" sx={{ 
                      fontWeight: 600, 
                      color: 'text.primary',
                      fontSize: '0.875rem'
                    }}>
                      {isLoadingFiles ? 'Checking...' : (files.length > 0 ? 'Downloaded' : 'Not Available')}
                    </Typography>
                  </Box>

                  {/* Quality — show all available qualities or the selected one */}
                  {files.length > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem', fontWeight: 500 }}>
                        Quality:
                      </Typography>
                      {availableQualities.length > 0
                        ? availableQualities.map(q => (
                            <Chip
                              key={q}
                              label={q}
                              size="small"
                              sx={{
                                fontWeight: 600,
                                fontSize: '0.75rem',
                                bgcolor: selectedQuality === q
                                  ? alpha(theme.palette.info.main, 0.15)
                                  : alpha(theme.palette.primary.main, 0.1),
                                color: selectedQuality === q ? 'info.main' : 'primary.main',
                              }}
                            />
                          ))
                        : <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.875rem' }}>
                            {selectedFile?.quality || 'Unknown'}
                          </Typography>
                      }
                    </Box>
                  )}

                  {/* Size of the currently active file */}
                  {selectedFile?.size && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.875rem', fontWeight: 500 }}>
                        Size:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', fontSize: '0.875rem' }}>
                        {selectedFile.size}
                      </Typography>
                    </Box>
                  )}

                  {/* Original Language */}
                  {data.original_language && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2" sx={{ 
                        color: 'text.secondary',
                        fontSize: '0.875rem',
                        fontWeight: 500
                      }}>
                        Original Language:
                      </Typography>
                      <Typography variant="body2" sx={{ 
                        fontWeight: 600, 
                        color: 'text.primary', 
                        textTransform: 'capitalize',
                        fontSize: '0.875rem'
                      }}>
                        {data.original_language}
                      </Typography>
                    </Box>
                  )}

                {/* Studio */}
                {data.production_countries && data.production_countries.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ 
                      color: 'text.secondary',
                      fontSize: '0.875rem',
                      fontWeight: 500
                    }}>
                      Country:
                    </Typography>
                    <Typography variant="body2" sx={{ 
                      fontWeight: 600, 
                      color: 'text.primary',
                      fontSize: '0.875rem'
                    }}>
                      {data.production_countries[0].name}
                    </Typography>
                  </Box>
                )}
                </Box>
              </Box>
            </motion.div>
            )}

        </motion.div>
      </Box>
    </Box>
  );
};

export default MovieHeader; 