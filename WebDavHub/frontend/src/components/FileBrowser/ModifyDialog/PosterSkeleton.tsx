import React from 'react';
import { Box, Paper } from '@mui/material';
import { styled as muiStyled } from '@mui/material/styles';
import { shimmer } from './StyledComponents';
import { PosterSkeletonProps } from './types';

const StyledPosterSkeleton = muiStyled(Paper)(({ theme }) => ({
  padding: 0,
  borderRadius: 12,
  boxShadow: theme.shadows[1],
  background: theme.palette.mode === 'dark' ? '#18181b' : '#fff',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  maxWidth: '140px',
  width: '100%',
  opacity: 0.7,
  '& .skeleton-poster': {
    width: '100%',
    maxWidth: '140px',
    aspectRatio: '2/3',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
  '& .skeleton-text': {
    width: '80%',
    height: '12px',
    margin: '8px 0 4px 0',
    borderRadius: '6px',
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
  '& .skeleton-text-small': {
    width: '60%',
    height: '10px',
    margin: '0 0 8px 0',
    borderRadius: '5px',
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
}));

const PosterSkeleton: React.FC<PosterSkeletonProps> = ({ sx }) => {
  return (
    <StyledPosterSkeleton sx={sx}>
      <Box className="skeleton-poster" />
      <Box sx={{ width: '100%', py: 1, px: 0.5, textAlign: 'center' }}>
        <Box className="skeleton-text" />
        <Box className="skeleton-text-small" />
      </Box>
    </StyledPosterSkeleton>
  );
};

export default PosterSkeleton;
