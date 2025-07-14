import { Box, Typography, Chip, Paper, useTheme, useMediaQuery, alpha, Stack } from '@mui/material';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { MediaDetailsData } from '../../types/MediaTypes';
import MovieFileActions from './MovieFileActions';

interface MovieHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  fileInfo: any;
  folderName: string;
  currentPath: string;
  onNavigateBack?: () => void;
  selectedVersionIndex: number;
  onVersionChange: (index: number) => void;
}



// Helper function to format file size
const formatFileSize = (bytes: number) => {
  if (!bytes) return 'Unknown size';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};



const MovieHeader: React.FC<MovieHeaderProps> = ({ data, getPosterUrl, fileInfo, folderName, currentPath, onNavigateBack, selectedVersionIndex, onVersionChange }) => {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Handle both single file (legacy) and multiple files (new)
  const files = Array.isArray(fileInfo) ? fileInfo : (fileInfo ? [fileInfo] : []);
  const hasMultipleVersions = files.length > 1;
  const selectedFile = files[selectedVersionIndex] || files[0];

  // Keyboard navigation for version switching
  useEffect(() => {
    if (!hasMultipleVersions) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        onVersionChange(selectedVersionIndex > 0 ? selectedVersionIndex - 1 : files.length - 1);
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        onVersionChange(selectedVersionIndex < files.length - 1 ? selectedVersionIndex + 1 : 0);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [hasMultipleVersions, files.length, selectedVersionIndex, onVersionChange]);



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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: hasMultipleVersions ? 2 : 1, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
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
            {hasMultipleVersions && (
              <Chip
                label={`${files.length} versions`}
                size="small"
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: 'primary.main',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  '& .MuiChip-label': {
                    px: 1.5
                  }
                }}
              />
            )}
          </Box>

          {/* Version Tab Switcher - Only show if multiple versions */}
          {hasMultipleVersions && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
            >
              <Box sx={{ mb: 3, display: 'flex', justifyContent: { xs: 'center', md: 'flex-start' } }}>
                <Box
                  sx={{
                    display: 'flex',
                    gap: 1,
                    overflowX: 'auto',
                    scrollBehavior: 'smooth',
                    pb: { xs: 1, md: 0 },
                    scrollbarWidth: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }}
                >
                  {files.map((file: any, index: number) => {
                    const isSelected = selectedVersionIndex === index;
                    const versionNumber = index + 1;

                    return (
                      <Box
                        key={index}
                        onClick={() => onVersionChange(index)}
                        sx={{
                          cursor: 'pointer',
                          px: { xs: 2, sm: 3 },
                          py: { xs: 1.5, sm: 2 },
                          borderRadius: { xs: 3, sm: 2 },
                          border: '1px solid',
                          borderColor: isSelected ? 'primary.main' : 'divider',
                          bgcolor: isSelected ? 'primary.main' : 'background.paper',
                          color: isSelected ? 'primary.contrastText' : 'text.primary',
                          transition: 'all 0.2s ease-in-out',
                          minWidth: 'fit-content',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          '&:hover': {
                            borderColor: 'primary.main',
                            bgcolor: isSelected ? 'primary.main' : 'action.hover',
                            transform: 'translateY(-1px)',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                          },
                          '&:active': {
                            transform: 'translateY(0px)',
                          },
                        }}
                      >
                        <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 1.5 }} sx={{ minWidth: 0, justifyContent: 'center' }}>
                          <Box
                            sx={{
                              width: { xs: 18, sm: 20 },
                              height: { xs: 18, sm: 20 },
                              borderRadius: 1,
                              bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : alpha(theme.palette.primary.main, 0.15),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: isSelected ? 'primary.contrastText' : 'primary.main',
                              transition: 'all 0.3s ease',
                              flexShrink: 0,
                              fontWeight: 600,
                              fontSize: { xs: '0.7rem', sm: '0.75rem' },
                            }}
                          >
                            {versionNumber}
                          </Box>
                          <Box sx={{ textAlign: 'center' }}>
                            <Typography
                              variant="body2"
                              fontWeight="600"
                              sx={{
                                fontSize: { xs: '0.8rem', sm: '0.9rem' },
                                letterSpacing: '0.02em',
                                lineHeight: 1.2,
                              }}
                            >
                              Version {versionNumber}
                            </Typography>
                            {file.size && !isNaN(file.size) && (
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize: { xs: '0.65rem', sm: '0.7rem' },
                                  opacity: 0.7,
                                  lineHeight: 1,
                                }}
                              >
                                {formatFileSize(file.size)}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </motion.div>
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

          {/* File Actions - Simple Button Layout */}
          {selectedFile && (
            <Box sx={{ mt: 2, mb: 1 }}>
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

        </motion.div>
      </Box>
    </Box>
  );
};

export default MovieHeader; 