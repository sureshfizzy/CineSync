import React from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { styled as muiStyled, keyframes } from '@mui/material/styles';

interface IDBasedAnimationProps {
  selectedIds: Record<string, string>;
  isActive: boolean;
}

// Simple, clean animations
const gentlePulse = keyframes`
  0% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
  100% { opacity: 0.7; transform: scale(1); }
`;

const slideInFromLeft = keyframes`
  0% { transform: translateX(-20px); opacity: 0; }
  100% { transform: translateX(0); opacity: 1; }
`;

const floatingDots = keyframes`
  0% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
  100% { transform: translateY(0px); }
`;

const AnimationContainer = muiStyled(Box)(({ theme }) => ({
  position: 'relative',
  width: '100%',
  height: '200px',
  background: theme.palette.mode === 'dark'
    ? 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)'
    : 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
  borderRadius: '12px',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: `1px solid ${theme.palette.divider}`,
  flexDirection: 'column',
  gap: 2,
  padding: 3,
}));

const IDChip = muiStyled(Chip)(({ theme }) => ({
  animation: `${slideInFromLeft} 0.5s ease-out`,
  margin: '4px',
  fontFamily: 'monospace',
  fontSize: '0.9rem',
  '&.tmdb': {
    backgroundColor: theme.palette.mode === 'dark' ? '#1976d2' : '#2196f3',
    color: 'white',
  },
  '&.imdb': {
    backgroundColor: theme.palette.mode === 'dark' ? '#f57c00' : '#ff9800',
    color: 'white',
  },
  '&.tvdb': {
    backgroundColor: theme.palette.mode === 'dark' ? '#388e3c' : '#4caf50',
    color: 'white',
  },
  '&.season-episode': {
    backgroundColor: theme.palette.mode === 'dark' ? '#7b1fa2' : '#9c27b0',
    color: 'white',
  },
}));

const ProcessingText = muiStyled(Typography)(({ theme }) => ({
  animation: `${gentlePulse} 2s ease-in-out infinite`,
  color: theme.palette.primary.main,
  fontWeight: 600,
  textAlign: 'center',
}));

const FloatingDot = muiStyled(Box)(({ theme }) => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  backgroundColor: theme.palette.primary.main,
  animation: `${floatingDots} 2s ease-in-out infinite`,
  margin: '0 4px',
  '&:nth-of-type(2)': {
    animationDelay: '0.3s',
  },
  '&:nth-of-type(3)': {
    animationDelay: '0.6s',
  },
}));

const IDBasedAnimation: React.FC<IDBasedAnimationProps> = ({ selectedIds, isActive }) => {

  const getActiveIds = () => {
    return Object.entries(selectedIds).filter(([_, value]) => value && value.trim() !== '');
  };

  const getIdIcon = (key: string) => {
    switch (key) {
      case 'tmdb': return '🎬';
      case 'imdb': return '🎭';
      case 'tvdb': return '📺';
      case 'season-episode': return '📅';
      default: return '🆔';
    }
  };

  const getIdLabel = (key: string) => {
    switch (key) {
      case 'tmdb': return 'TMDb';
      case 'imdb': return 'IMDb';
      case 'tvdb': return 'TVDb';
      case 'season-episode': return 'Season/Episode';
      default: return key.toUpperCase();
    }
  };

  if (!isActive) {
    return (
      <AnimationContainer>
        <Typography variant="h6" color="text.secondary">
          🆔 ID-Based Processing Ready
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Enter IDs in the form above to begin processing
        </Typography>
      </AnimationContainer>
    );
  }

  const activeIds = getActiveIds();

  return (
    <AnimationContainer>
      <ProcessingText variant="h6">
        Processing with ID-based metadata
      </ProcessingText>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', mb: 2 }}>
        {activeIds.map(([key, value], index) => (
          <IDChip
            key={key}
            className={key}
            icon={<span>{getIdIcon(key)}</span>}
            label={`${getIdLabel(key)}: ${value}`}
            sx={{ animationDelay: `${index * 0.2}s` }}
          />
        ))}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Processing
        </Typography>
        <FloatingDot />
        <FloatingDot />
        <FloatingDot />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
        No poster search needed - using direct ID lookup
      </Typography>
    </AnimationContainer>
  );
};

export default IDBasedAnimation;
