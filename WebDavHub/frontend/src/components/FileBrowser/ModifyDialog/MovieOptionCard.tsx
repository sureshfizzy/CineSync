import React from 'react';
import { Box, Paper, Typography, useTheme } from '@mui/material';
import { fadeIn } from './StyledComponents';
import { MovieOptionCardProps } from './types';

const MovieOptionCard: React.FC<MovieOptionCardProps> = ({ option, onClick }) => {
  const theme = useTheme();

  return (
    <Paper
      key={option.number}
      onClick={() => onClick(option.number)}
      sx={{
        p: 0,
        cursor: 'pointer',
        transition: 'box-shadow 0.2s, transform 0.2s, opacity 0.3s ease-in-out',
        borderRadius: 3,
        boxShadow: 1,
        background: theme.palette.mode === 'dark' ? '#18181b' : '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: { xs: '120px', sm: '140px' },
        width: '100%',
        minHeight: { xs: '200px', sm: '220px' },
        animation: `${fadeIn} 0.4s ease-out forwards`,
        '&:hover': {
          boxShadow: 6,
          transform: 'translateY(-4px) scale(1.03)',
        },
      }}
      elevation={2}
    >
      {option.posterUrl ? (
        <Box
          component="img"
          src={option.posterUrl}
          alt={option.title}
          sx={{
            width: '100%',
            maxWidth: { xs: '120px', sm: '140px' },
            aspectRatio: '2/3',
            objectFit: 'cover',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            background: theme.palette.grey[300],
            display: 'block',
            transition: 'opacity 0.3s ease-in-out',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <Box
          sx={{
            width: '100%',
            maxWidth: { xs: '120px', sm: '140px' },
            aspectRatio: '2/3',
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.palette.mode === 'dark' ? 'grey.700' : 'grey.200',
          }}
        >
          <Typography variant="body2" color="text.secondary">
            No Image
          </Typography>
        </Box>
      )}
      <Box sx={{
        width: '100%',
        py: 1,
        px: 0.5,
        textAlign: 'center',
      }}>
        <Typography
          variant="subtitle2"
          fontWeight={700}
          sx={{
            mb: 0.5,
            color: theme.palette.text.primary,
            fontSize: { xs: '0.8rem', sm: '0.875rem' },
            lineHeight: 1.2,
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {option.title}
        </Typography>
        {option.year && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}
          >
            {option.year}
          </Typography>
        )}
        {option.tmdbData?.id && (
          <Typography
            variant="caption"
            color="primary.main"
            sx={{
              fontSize: { xs: '0.65rem', sm: '0.7rem' },
              fontWeight: 500
            }}
          >
            TMDb: {option.tmdbData.id}
          </Typography>
        )}
      </Box>
    </Paper>
  );
};

export default MovieOptionCard;
