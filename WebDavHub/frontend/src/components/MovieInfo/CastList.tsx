import { Box, Typography, Avatar } from '@mui/material';
import { MediaDetailsData } from '../../types/MediaTypes';

interface CastListProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
}

const CastList: React.FC<CastListProps> = ({ data, getPosterUrl }) => {
  const cast = (data.credits?.cast || []).slice(0, 8);
  return (
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
  );
};

export default CastList; 