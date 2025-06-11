import { useMemo } from 'react';
import { Box, Typography, useTheme, useMediaQuery } from '@mui/material';
import { AlphabetIndexProps } from './types';

const ALPHABET = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

export default function AlphabetIndex({ files, selectedLetter, onLetterClick }: AlphabetIndexProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();

    files.forEach(file => {
      const firstChar = file.name.charAt(0).toUpperCase();
      if (/[A-Z]/.test(firstChar)) {
        letters.add(firstChar);
      } else if (/[0-9]/.test(firstChar)) {
        letters.add('#');
      } else {
        letters.add('#');
      }
    });

    return letters;
  }, [files]);

  const handleLetterClick = (letter: string) => {
    onLetterClick(selectedLetter === letter ? null : letter);
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        right: isMobile ? 4 : isTablet ? 8 : 16,
        top: isMobile ? '45%' : '50%',
        transform: 'translateY(-50%)',
        zIndex: 999,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(0, 0, 0, 0.85)'
          : 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(12px)',
        borderRadius: isMobile ? 1 : 2,
        boxShadow: theme.palette.mode === 'dark'
          ? '0 8px 32px rgba(0, 0, 0, 0.4)'
          : '0 8px 32px rgba(0, 0, 0, 0.15)',
        padding: isMobile ? 0.5 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: isMobile ? 24 : isTablet ? 28 : 32,
        maxHeight: isMobile ? '60vh' : '70vh',
        overflowY: 'auto',
        border: `1px solid ${theme.palette.divider}`,
        '&::-webkit-scrollbar': {
          width: isMobile ? 2 : 4,
        },
        '&::-webkit-scrollbar-track': {
          background: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          background: theme.palette.divider,
          borderRadius: 2,
        },
      }}
    >
      {ALPHABET.map((letter) => {
        const isAvailable = availableLetters.has(letter);
        const isSelected = selectedLetter === letter;

        if (!isAvailable) return null;

        return (
          <Typography
            key={`${letter}-${isSelected}`}
            variant="caption"
            sx={{
              cursor: 'pointer',
              color: isSelected
                ? `${theme.palette.primary.contrastText} !important`
                : theme.palette.primary.main,
              backgroundColor: isSelected
                ? `${theme.palette.primary.main} !important`
                : 'transparent !important',
              fontWeight: isSelected ? 700 : 600,
              fontSize: isMobile ? '0.65rem' : isTablet ? '0.7rem' : '0.75rem',
              lineHeight: 1.2,
              padding: isMobile ? '2px 3px' : '3px 5px',
              borderRadius: 1,
              minHeight: isMobile ? 14 : isTablet ? 16 : 18,
              minWidth: isMobile ? 14 : isTablet ? 16 : 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s ease',
              mb: isMobile ? 0.25 : 0.5,
              transform: 'scale(1)',
              '&:hover': {
                backgroundColor: isSelected
                  ? `${theme.palette.primary.dark} !important`
                  : `${theme.palette.primary.main} !important`,
                color: `${theme.palette.primary.contrastText} !important`,
                transform: isMobile ? 'scale(1.05)' : 'scale(1.1)',
              },
              '&:not(:hover)': {
                transform: 'scale(1)',
              },
            }}
            onClick={() => handleLetterClick(letter)}
          >
            {letter}
          </Typography>
        );
      })}
    </Box>
  );
}
