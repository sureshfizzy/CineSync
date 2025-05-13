import { Box, Typography, Chip, Paper, Avatar } from '@mui/material';
import { MediaDetailsData } from '../types/MediaTypes';
import MediaPathInfo from './MediaPathInfo';

interface MovieInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

export default function MovieInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: MovieInfoProps) {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
  const cast = (data.credits?.cast || []).slice(0, 8);
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Movie Details */}
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
            {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            {genres.map((g: { id: number; name: string }) => (
              <Chip key={g.id} label={g.name} color="primary" variant="outlined" />
            ))}
            {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" />}
            {data.status && <Chip label={data.status} color="default" variant="outlined" />}
            {country && <Chip label={country} color="default" variant="outlined" />}
          </Box>
          {data.tagline && (
            <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1 }}>
              {data.tagline}
            </Typography>
          )}
          
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
            {director && <Typography><b>Director:</b> {director.name}</Typography>}
            {writers && writers.length > 0 && (
              <Typography><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>
            )}
          </Box>

          <Typography variant="body1" sx={{ mb: 2 }}>{data.overview}</Typography>
        </Box>
      </Box>

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