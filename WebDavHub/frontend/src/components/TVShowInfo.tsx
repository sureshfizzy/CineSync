import { Box, Typography, Chip, Paper, Avatar } from '@mui/material';
import { MediaDetailsData } from '../types/MediaTypes';
import MediaPathInfo from './MediaPathInfo';

interface TVShowInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

export default function TVShowInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: TVShowInfoProps) {
  const firstAirYear = data.first_air_date?.slice(0, 4);
  const episodeRuntime = data.episode_run_time && data.episode_run_time[0];
  const creators = data.credits?.crew.filter((c: { job: string }) => c.job === 'Creator');
  const cast = (data.credits?.cast || []).slice(0, 8);
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

  return (
    <Box sx={{ width: '100%' }}>
      {/* TV Show Details */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
        <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
          <img
            src={getPosterUrl(data.poster_path)}
            alt={data.title}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Paper>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" fontWeight={700} gutterBottom sx={{ mb: 1 }}>
            {data.title} {firstAirYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({firstAirYear})</span>}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
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
        </Box>
      </Box>

      {/* Seasons Section */}
      {data.seasons && data.seasons.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Seasons</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.seasons.map((season: {
              id: number;
              name: string;
              poster_path: string;
              episode_count: number;
              air_date: string;
              overview: string;
            }) => (
              <Paper key={season.id} elevation={2} sx={{ p: 2, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  {season.poster_path && (
                    <Box sx={{ width: 100, flexShrink: 0 }}>
                      <img
                        src={getPosterUrl(season.poster_path, 'w185')}
                        alt={season.name}
                        style={{ width: '100%', height: 'auto', borderRadius: 8 }}
                      />
                    </Box>
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>{season.name}</Typography>
                    <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
                      <Typography variant="body2" color="text.secondary">
                        {season.episode_count} Episodes
                      </Typography>
                      {season.air_date && (
                        <Typography variant="body2" color="text.secondary">
                          Air Date: {new Date(season.air_date).toLocaleDateString()}
                        </Typography>
                      )}
                    </Box>
                    {season.overview && (
                      <Typography variant="body2">{season.overview}</Typography>
                    )}
                  </Box>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* Media File Information Section */}
      <MediaPathInfo 
        folderName={folderName}
        currentPath={currentPath}
        mediaType={mediaType}
      />

      {/* Cast Section */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Cast</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', overflowX: 'auto', pb: 1 }}>
          {cast.map((actor: { id: number; name: string; character: string; profile_path: string | null }) => (
            <Box key={actor.id} sx={{ textAlign: 'center', width: 100 }}>
              <Avatar
                src={getPosterUrl(actor.profile_path, 'w185')}
                alt={actor.name}
                sx={{ width: 80, height: 80, mx: 'auto', mb: 1 }}
              />
              <Typography variant="body2" fontWeight={600}>{actor.name}</Typography>
              <Typography variant="caption" color="text.secondary">{actor.character}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
} 