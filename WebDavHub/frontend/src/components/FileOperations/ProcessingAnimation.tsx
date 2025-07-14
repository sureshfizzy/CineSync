import { useState, useEffect } from 'react';
import { Box, Typography, Chip, LinearProgress } from '@mui/material';
import { styled, keyframes } from '@mui/material/styles';
import { motion, AnimatePresence } from 'framer-motion';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import MovieIcon from '@mui/icons-material/Movie';
import TvIcon from '@mui/icons-material/Tv';
import LinkIcon from '@mui/icons-material/Link';

interface ProcessingAnimationProps {
  fileName: string;
  mediaName?: string;
  mediaType?: string;
  onComplete: () => void;
  duration?: number;
}

// Keyframe animations
const shimmer = keyframes`
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
`;

const pulse = keyframes`
  0% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 0.8; }
`;

// Styled components
const ProcessingContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  overflow: 'hidden',
  borderRadius: theme.spacing(2),
  background: `linear-gradient(135deg, 
    ${theme.palette.primary.main}15 0%, 
    ${theme.palette.secondary.main}15 100%)`,
  border: `2px solid ${theme.palette.primary.main}30`,
  '&::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '-200px',
    width: '200px',
    height: '100%',
    background: `linear-gradient(90deg, 
      transparent, 
      ${theme.palette.primary.main}20, 
      transparent)`,
    animation: `${shimmer} 2s infinite`,
  }
}));

const SuccessContainer = styled(Box)(({ theme }) => ({
  borderRadius: theme.spacing(2),
  background: `linear-gradient(135deg, 
    ${theme.palette.success.main}15 0%, 
    ${theme.palette.success.light}15 100%)`,
  border: `2px solid ${theme.palette.success.main}40`,
}));

const IconContainer = styled(Box)(({ theme }) => ({
  animation: `${pulse} 1.5s infinite`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 48,
  height: 48,
  borderRadius: '50%',
  background: theme.palette.primary.main + '20',
}));

export default function ProcessingAnimation({
  fileName,
  mediaName,
  mediaType,
  onComplete,
  duration = 3000
}: ProcessingAnimationProps) {
  const [stage, setStage] = useState<'processing' | 'success' | 'complete'>('processing');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Progress animation
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          setStage('success');
          return 100;
        }
        return prev + (100 / (duration / 100));
      });
    }, 100);

    // Stage transitions
    const successTimer = setTimeout(() => {
      setStage('success');
    }, duration * 0.8);

    const completeTimer = setTimeout(() => {
      setStage('complete');
      setTimeout(onComplete, 500);
    }, duration);

    return () => {
      clearInterval(progressInterval);
      clearTimeout(successTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  const getMediaIcon = () => {
    if (mediaType === 'tvshow') return <TvIcon />;
    if (mediaType === 'movie') return <MovieIcon />;
    return <LinkIcon />;
  };

  const getStatusText = () => {
    switch (stage) {
      case 'processing':
        return 'Processing file...';
      case 'success':
        return 'Successfully processed!';
      case 'complete':
        return 'Complete';
      default:
        return 'Processing...';
    }
  };

  return (
    <AnimatePresence>
      {stage !== 'complete' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ 
            opacity: 0, 
            scale: 0.95, 
            x: 100,
            transition: { duration: 0.5, ease: 'easeInOut' }
          }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {stage === 'processing' ? (
            <ProcessingContainer sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconContainer>
                  {getMediaIcon()}
                </IconContainer>
                
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ 
                    fontWeight: 600,
                    color: 'primary.main',
                    mb: 0.5
                  }}>
                    {getStatusText()}
                  </Typography>
                  
                  <Typography variant="body2" sx={{ 
                    color: 'text.secondary',
                    fontSize: '0.875rem',
                    mb: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {mediaName || fileName}
                  </Typography>
                  
                  <LinearProgress 
                    variant="determinate" 
                    value={progress}
                    sx={{
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: 'primary.main' + '20',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        background: 'linear-gradient(90deg, #4CAF50, #2196F3)',
                      }
                    }}
                  />
                </Box>
                
                <Chip
                  label="Processing"
                  size="small"
                  color="primary"
                  variant="outlined"
                  sx={{ 
                    fontSize: '0.75rem',
                    animation: `${pulse} 2s infinite`
                  }}
                />
              </Box>
            </ProcessingContainer>
          ) : (
            <SuccessContainer sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ 
                    type: 'spring',
                    stiffness: 200,
                    damping: 15
                  }}
                >
                  <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    background: 'success.main' + '20',
                    color: 'success.main'
                  }}>
                    <CheckCircleIcon sx={{ fontSize: 28 }} />
                  </Box>
                </motion.div>
                
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ 
                    fontWeight: 600,
                    color: 'success.main',
                    mb: 0.5
                  }}>
                    {getStatusText()}
                  </Typography>
                  
                  <Typography variant="body2" sx={{ 
                    color: 'text.secondary',
                    fontSize: '0.875rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {mediaName || fileName}
                  </Typography>
                </Box>
                
                <Chip
                  label="Complete"
                  size="small"
                  color="success"
                  sx={{ fontSize: '0.75rem' }}
                />
              </Box>
            </SuccessContainer>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
