import { Box, Typography, Chip, Paper } from '@mui/material';
import { MediaDetailsData } from '../../types/MediaTypes';
import MovieFileActions from './MovieFileActions';

interface MovieHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  fileInfo: any;
  folderName: string;
  currentPath: string;
}

const MovieHeader: React.FC<MovieHeaderProps> = ({ data, getPosterUrl, fileInfo, folderName, currentPath }) => {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
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
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="h3"
          fontWeight={700}
          gutterBottom
          sx={{ mb: 1, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}
        >
          {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
        </Typography>
        <MovieFileActions data={data} folderName={folderName} currentPath={currentPath} placement="belowTitle" fileInfo={fileInfo} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
          {genres.map((g: { id: number; name: string }) => (
            <Chip key={g.id} label={g.name} color="primary" variant="outlined" />
          ))}
          {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" />}
          {data.status && <Chip label={data.status} color="default" variant="outlined" />}
          {country && <Chip label={country} color="default" variant="outlined" />}
        </Box>
        {data.tagline && (
          <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}>
            {data.tagline}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
          {director && <Typography><b>Director:</b> {director.name}</Typography>}
          {writers && writers.length > 0 && (
            <Typography><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>
          )}
        </Box>
        <Typography variant="body1" sx={{ mb: 2, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}>{data.overview}</Typography>
        <MovieFileActions data={data} folderName={folderName} currentPath={currentPath} placement="belowDescription" fileInfo={fileInfo} />
      </Box>
    </Box>
  );
};

export default MovieHeader; 