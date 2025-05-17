import { Box, Card, CardContent, CardMedia, Typography, Chip, Stack } from '@mui/material';
import { TMDbDetails } from '../types/tmdb';
import MediaPathInfo from './MediaPathInfo';

interface PosterViewProps {
  tmdbDetails: TMDbDetails;
  currentPath: string;
  folderName: string;
}

export default function PosterView({ tmdbDetails, currentPath, folderName }: PosterViewProps) {
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CardMedia
        component="img"
        sx={{ width: '100%', aspectRatio: '2/3' }}
        image={`https://image.tmdb.org/t/p/w500${tmdbDetails.poster_path}`}
        alt={tmdbDetails.title || tmdbDetails.name}
      />
      <CardContent sx={{ flexGrow: 1 }}>
        <Typography variant="h5" component="div" gutterBottom>
          {tmdbDetails.title || tmdbDetails.name} ({new Date(tmdbDetails.release_date || tmdbDetails.first_air_date).getFullYear()})
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          {tmdbDetails.genres?.map((genre) => (
            <Chip key={genre.id} label={genre.name} size="small" />
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" paragraph>
          {tmdbDetails.overview}
        </Typography>
        <MediaPathInfo folderName={folderName} currentPath={currentPath} />
      </CardContent>
    </Card>
  );
} 