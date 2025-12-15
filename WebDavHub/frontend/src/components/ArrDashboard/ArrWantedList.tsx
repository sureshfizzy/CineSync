import { Box, Typography, Card, CardContent, Chip, Avatar, IconButton } from '@mui/material';
import { Movie as MovieIcon, Tv as TvIcon, Search as SearchIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { ArrItem } from './types';

interface ArrWantedListProps {
  items: ArrItem[];
  onSearch?: (item: ArrItem) => void;
  onDelete?: (item: ArrItem) => void;
}

export default function ArrWantedList({ items, onSearch, onDelete }: ArrWantedListProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'wanted': return 'default';
      case 'searching': return 'info';
      case 'downloading': return 'warning';
      case 'imported': return 'success';
      case 'failed': return 'error';
      default: return 'default';
    }
  };

  const getImageUrl = (path?: string) => {
    if (!path) return '';
    return `https://image.tmdb.org/t/p/w200${path}`;
  };

  if (items.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          No items in your library
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Use the search functionality to add movies and TV series
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
      {items.map((item) => (
        <Card key={item.id} sx={{ display: 'flex', height: 140 }}>
          <Avatar
            src={getImageUrl(item.posterPath)}
            sx={{ width: 90, height: 135, borderRadius: 1, m: 0.5 }}
          >
            {item.mediaType === 'movie' ? <MovieIcon /> : <TvIcon />}
          </Avatar>
          <CardContent sx={{ flex: 1, p: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ lineHeight: 1.2 }}>
                {item.title}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton size="small" onClick={() => onSearch?.(item)}>
                  <SearchIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" onClick={() => onDelete?.(item)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
              {item.year && (
                <Chip label={item.year} size="small" variant="outlined" />
              )}
              <Chip
                label={item.status}
                size="small"
                color={getStatusColor(item.status)}
                variant="filled"
              />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Quality: {item.qualityProfile}
            </Typography>
            
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Monitor: {item.monitorPolicy}
            </Typography>

            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                fontSize: '0.75rem',
                lineHeight: 1.2
              }}
            >
              {item.overview || 'No overview available'}
            </Typography>
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}
