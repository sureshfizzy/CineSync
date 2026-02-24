import React from 'react';
import { Box, Typography, Chip, Paper, alpha, useTheme, IconButton, Tooltip } from '@mui/material';
import { motion } from 'framer-motion';
import { MediaDetailsData } from './types';
import ShowFileActions from './ShowFileActions';
import SearchIcon from '@mui/icons-material/Search';

interface ShowHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  onRename?: (file: any) => void;
  onError?: (error: string) => void;
  refreshTrigger?: number;
  onNavigateBack?: () => void;
  isArrDashboardContext?: boolean;
  isLoadingFiles?: boolean;
  seasonFolders?: any[];
  onSearchMissing?: (title: string, type: 'movie' | 'tv') => void;
}

const ShowHeader: React.FC<ShowHeaderProps> = ({ data, getPosterUrl, folderName, currentPath, onRename, onError, refreshTrigger, onNavigateBack, isArrDashboardContext = false, isLoadingFiles = false, seasonFolders = [], onSearchMissing }) => {
  const firstAirYear = data.first_air_date?.slice(0, 4);
  const episodeRuntime = data.episode_run_time && data.episode_run_time[0];
  const creators = data.credits?.crew.filter((c: { job: string }) => c.job === 'Creator');
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;
  const theme = useTheme();
  const canSearch = !isLoadingFiles && seasonFolders.length === 0 && !!onSearchMissing;


  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
      <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
        <img
          src={getPosterUrl(data.poster_path)}
          alt={data.title}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </Paper>
      <Box sx={{ flex: 1, minWidth: 0, textAlign: { xs: 'center', md: 'left' } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', md: 'flex-start' } }}>
          <Typography variant="h3" fontWeight={700} gutterBottom sx={{ mb: 0, textAlign: { xs: 'center', md: 'left' } }}>
            {(data.name || data.title)} {firstAirYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({firstAirYear})</span>}
          </Typography>
          {canSearch && (
            <Tooltip title="Search">
              <IconButton
                onClick={() => onSearchMissing?.(data.name || data.title || folderName, 'tv')}
                sx={{
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: theme.palette.primary.main,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                }}
                size="small"
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <ShowFileActions
          data={data}
          folderName={folderName}
          currentPath={currentPath}
          placement="belowTitle"
          onRename={onRename}
          onError={onError}
          refreshTrigger={refreshTrigger}
          onNavigateBack={onNavigateBack}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', md: 'flex-start' }, textAlign: { xs: 'center', md: 'left' } }}>
          {genres.map((g: { id: number; name: string }) => (
            <Chip key={g.id} label={g.name} color="primary" variant="outlined" />
          ))}
          {episodeRuntime && <Chip label={`${episodeRuntime} min/ep`} color="secondary" variant="outlined" />}
          {data.status && <Chip label={data.status} color="default" variant="outlined" />}
          {country && <Chip label={country} color="default" variant="outlined" />}
        </Box>
        {data.tagline && (
          <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1 }}>
            {data.tagline}
          </Typography>
        )}
        {creators && creators.length > 0 && (
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
            <Typography><b>Created by:</b> {creators.map((c: { name: string }) => c.name).join(', ')}</Typography>
          </Box>
        )}
        <Typography variant="body1" sx={{ mb: 2 }}>{data.overview}</Typography>

        <ShowFileActions
          data={data}
          folderName={folderName}
          currentPath={currentPath}
          placement="belowDescription"
          onRename={onRename}
          onError={onError}
          refreshTrigger={refreshTrigger}
          onNavigateBack={onNavigateBack}
        />

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
                    bgcolor: isLoadingFiles ? 'info.main' : (seasonFolders.length > 0 ? 'success.main' : 'warning.main'), 
                    borderRadius: 0.5,
                    boxShadow: isLoadingFiles ? '0 0 8px rgba(33, 150, 243, 0.3)' : (seasonFolders.length > 0 ? '0 0 8px rgba(76, 175, 80, 0.3)' : '0 0 8px rgba(255, 152, 0, 0.3)')
                  }} />
                  <Typography variant="body2" sx={{ 
                    fontWeight: 600, 
                    color: 'text.primary',
                    fontSize: '0.875rem'
                  }}>
                    {isLoadingFiles ? 'Checking...' : (seasonFolders.length > 0 ? 'Available' : 'Not Available')}
                  </Typography>
                </Box>

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

                {/* Country */}
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

      </Box>
    </Box>
  );
};

export default ShowHeader;