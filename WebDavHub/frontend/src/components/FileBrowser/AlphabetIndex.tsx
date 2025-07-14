import { useState, memo, useRef, useEffect } from 'react';
import { Box, Typography, useTheme, useMediaQuery, Fade, Zoom } from '@mui/material';
import { AlphabetIndexProps } from './types';

const ALPHABET = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

const AlphabetIndex = memo(function AlphabetIndex({ selectedLetter, onLetterClick, loading = false }: AlphabetIndexProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));
  const [clickedLetter, setClickedLetter] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const letterRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    if (selectedLetter && scrollContainerRef.current && letterRefs.current[selectedLetter]) {
      const container = scrollContainerRef.current;
      const letterElement = letterRefs.current[selectedLetter];

      if (letterElement) {
        const containerRect = container.getBoundingClientRect();
        const letterRect = letterElement.getBoundingClientRect();
        const containerCenter = containerRect.height / 2;
        const letterCenter = letterRect.height / 2;

        const scrollTop = letterElement.offsetTop - containerCenter + letterCenter;

        container.scrollTo({
          top: Math.max(0, scrollTop),
          behavior: 'smooth'
        });
      }
    }
  }, [selectedLetter]);

  const handleLetterClick = (letter: string) => {
    setClickedLetter(letter);

    setTimeout(() => setClickedLetter(null), 200);
    onLetterClick(selectedLetter === letter ? null : letter);
  };

  return (
    <Box
      ref={scrollContainerRef}
      sx={{
        position: 'fixed',
        right: isMobile ? 4 : isTablet ? 8 : 16,
        top: isMobile ? '45%' : isTablet ? '50%' : '60%',
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
        // iOS smooth scrolling optimizations
        WebkitOverflowScrolling: 'touch',
        scrollBehavior: 'smooth',
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
      {ALPHABET.map((letter, index) => {
        const isSelected = selectedLetter === letter;
        const isClicked = clickedLetter === letter;
        const isLoadingSelected = loading && isSelected;

        return (
          <Fade in={true} timeout={300 + index * 20} key={letter}>
            <Box
              ref={(el) => {
                letterRefs.current[letter] = el as HTMLDivElement | null;
              }}
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: isMobile ? 0.25 : 0.5,
              }}
            >
              <Typography
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
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: isClicked
                    ? 'scale(0.95)'
                    : isSelected
                      ? 'scale(1.05)'
                      : 'scale(1)',
                  boxShadow: isSelected
                    ? `0 2px 8px ${theme.palette.primary.main}40`
                    : 'none',
                  border: isSelected
                    ? `1px solid ${theme.palette.primary.main}`
                    : '1px solid transparent',
                  // Loading animation for selected letter
                  animation: isLoadingSelected
                    ? 'pulse 1.5s ease-in-out infinite'
                    : 'none',
                  '@keyframes pulse': {
                    '0%': {
                      boxShadow: `0 2px 8px ${theme.palette.primary.main}40`,
                      transform: 'scale(1.05)',
                    },
                    '50%': {
                      boxShadow: `0 4px 16px ${theme.palette.primary.main}60`,
                      transform: 'scale(1.1)',
                    },
                    '100%': {
                      boxShadow: `0 2px 8px ${theme.palette.primary.main}40`,
                      transform: 'scale(1.05)',
                    },
                  },
                  '&:hover': {
                    backgroundColor: isSelected
                      ? `${theme.palette.primary.dark} !important`
                      : `${theme.palette.primary.main}20 !important`,
                    color: isSelected
                      ? `${theme.palette.primary.contrastText} !important`
                      : `${theme.palette.primary.main} !important`,
                    transform: 'scale(1.15)',
                    boxShadow: `0 4px 12px ${theme.palette.primary.main}30`,
                    border: `1px solid ${theme.palette.primary.main}60`,
                  },
                  '&:active': {
                    transform: 'scale(0.95)',
                    transition: 'all 0.1s ease',
                  },
                  // Ripple effect
                  '&::before': {
                    content: '""',
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    width: 0,
                    height: 0,
                    borderRadius: '50%',
                    backgroundColor: isSelected
                      ? theme.palette.primary.contrastText
                      : theme.palette.primary.main,
                    opacity: 0,
                    transform: 'translate(-50%, -50%)',
                    transition: 'all 0.3s ease',
                  },
                  '&:active::before': {
                    width: '120%',
                    height: '120%',
                    opacity: 0.3,
                    transition: 'all 0.1s ease',
                  },
                }}
                onClick={() => handleLetterClick(letter)}
              >
                <Zoom in={true} timeout={400 + index * 30}>
                  <span>{letter}</span>
                </Zoom>
              </Typography>
            </Box>
          </Fade>
        );
      })}
    </Box>
  );
});

export default AlphabetIndex;
