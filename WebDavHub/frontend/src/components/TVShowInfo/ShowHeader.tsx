import React from 'react';
import { Box, Typography, Chip, Paper } from '@mui/material';
import { MediaDetailsData } from './types';
import ShowFileActions from './ShowFileActions';

interface ShowHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
  onRename?: (file: any) => void;
  onError?: (error: string) => void;
  refreshTrigger?: number;
  onNavigateBack?: () => void;
}

const ShowHeader: React.FC<ShowHeaderProps> = ({ data, getPosterUrl, folderName, currentPath, mediaType, onRename, onError, refreshTrigger, onNavigateBack }) => {
  const firstAirYear = data.first_air_date?.slice(0, 4);
  const episodeRuntime = data.episode_run_time && data.episode_run_time[0];
  const creators = data.credits?.crew.filter((c: { job: string }) => c.job === 'Creator');
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

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
        <Typography variant="h3" fontWeight={700} gutterBottom sx={{ mb: 1, textAlign: { xs: 'center', md: 'left' } }}>
          {(data.name || data.title)} {firstAirYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({firstAirYear})</span>}
        </Typography>
        <ShowFileActions
          data={data}
          folderName={folderName}
          currentPath={currentPath}
          mediaType={mediaType}
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
          mediaType={mediaType}
          placement="belowDescription"
          onRename={onRename}
          onError={onError}
          refreshTrigger={refreshTrigger}
          onNavigateBack={onNavigateBack}
        />
      </Box>
    </Box>
  );
};

export default ShowHeader;