import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, Typography, Box, useTheme, LinearProgress, Fade, Zoom, Slide } from '@mui/material';
import { CheckCircle as CheckCircleIcon, Block as BlockIcon, DeleteSweep as DeleteSweepIcon, Refresh as RefreshIcon } from '@mui/icons-material';

interface SkipResultDialogProps {
  open: boolean;
  onClose: () => void;
  filePath?: string;
  onRefresh?: () => void;
  onNavigateBack?: () => void;
}

const SkipResultDialog: React.FC<SkipResultDialogProps> = ({
  open,
  onClose,
  filePath,
  onRefresh,
  onNavigateBack
}) => {
  const theme = useTheme();
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  const steps = [
    { icon: DeleteSweepIcon, text: 'Removing existing symlinks...', color: theme.palette.error.main },
    { icon: BlockIcon, text: 'Marking file as skipped...', color: theme.palette.warning.main },
    { icon: CheckCircleIcon, text: 'Skip processing complete!', color: theme.palette.success.main }
  ];

  const getFileName = (path?: string) => {
    if (!path) return 'file';
    return path.split(/[/\\]/).pop() || path;
  };

  useEffect(() => {
    if (!open) {
      setProgress(0);
      setCurrentStep(0);
      setIsComplete(false);
      return;
    }

    let interval: NodeJS.Timeout;

    // Simulate the skip processing steps
    const timer = setTimeout(() => {
      interval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + 2;

          // Update current step based on progress
          if (newProgress >= 33 && currentStep === 0) {
            setCurrentStep(1);
          } else if (newProgress >= 66 && currentStep === 1) {
            setCurrentStep(2);
          } else if (newProgress >= 100) {
            setIsComplete(true);
            return 100;
          }

          return newProgress;
        });
      }, 50);
    }, 500);

    return () => {
      clearTimeout(timer);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [open, currentStep]);

  // Additional effect to clear interval when complete and handle auto-navigation
  useEffect(() => {
    if (isComplete) {
      setProgress(100);

      const navigationTimer = setTimeout(() => {
        if (onNavigateBack) {
          onNavigateBack();
        }
        if (onRefresh) {
          onRefresh();
        }
        onClose();
      }, 2500);

      return () => clearTimeout(navigationTimer);
    }
  }, [isComplete, onNavigateBack, onRefresh, onClose]);

  const handleClose = () => {
    if (!isComplete) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundColor: theme.palette.background.paper,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(255, 152, 0, 0.08) 100%)`
            : `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(255, 152, 0, 0.04) 100%)`,
          border: `2px solid ${isComplete ? theme.palette.success.main + '60' : theme.palette.warning.main + '60'}`,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6)'
            : '0 8px 32px rgba(0, 0, 0, 0.15)',
          minHeight: '400px',
        }
      }}
      BackdropProps={{
        sx: {
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
        }
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          backgroundColor: theme.palette.mode === 'dark'
            ? (isComplete ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 152, 0, 0.15)')
            : (isComplete ? 'rgba(76, 175, 80, 0.08)' : 'rgba(255, 152, 0, 0.08)'),
          borderBottom: `2px solid ${isComplete ? theme.palette.success.main : theme.palette.warning.main}60`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Zoom in={isComplete} timeout={500}>
            <CheckCircleIcon 
              sx={{ 
                color: theme.palette.success.main,
                fontSize: '28px',
                display: isComplete ? 'block' : 'none'
              }} 
            />
          </Zoom>
          <Fade in={!isComplete}>
            <BlockIcon 
              sx={{ 
                color: theme.palette.warning.main,
                fontSize: '28px',
                display: !isComplete ? 'block' : 'none'
              }} 
            />
          </Fade>
          <Typography variant="h6" fontWeight={700} color={isComplete ? theme.palette.success.main : theme.palette.warning.main}>
            {isComplete ? 'Skip Processing Complete' : 'Processing Skip Request'}
          </Typography>
        </Box>

      </DialogTitle>

      <DialogContent
        sx={{
          pt: 3,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(0, 0, 0, 0.2)'
            : 'rgba(255, 255, 255, 0.8)',
        }}
      >
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            File being skipped:
          </Typography>
          <Typography 
            variant="body2" 
            sx={{ 
              fontFamily: 'monospace',
              backgroundColor: theme.palette.action.hover,
              padding: 1.5,
              borderRadius: 1,
              wordBreak: 'break-all',
              border: `1px solid ${theme.palette.divider}`
            }}
          >
            {getFileName(filePath)}
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <LinearProgress 
            variant="determinate" 
            value={progress} 
            sx={{
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.palette.action.hover,
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
                background: isComplete 
                  ? `linear-gradient(45deg, ${theme.palette.success.main} 30%, ${theme.palette.success.light} 90%)`
                  : `linear-gradient(45deg, ${theme.palette.warning.main} 30%, ${theme.palette.warning.light} 90%)`,
              }
            }}
          />
          <Typography variant="caption" color={theme.palette.text.secondary} sx={{ mt: 1, display: 'block' }}>
            {Math.round(progress)}% complete
          </Typography>
        </Box>

        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 2,
        }}>
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            const isActive = index === currentStep;
            const isCompleted = index < currentStep || isComplete;
            
            return (
              <Slide
                key={index}
                direction="right"
                in={index <= currentStep}
                timeout={300 + index * 100}
              >
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 2,
                    p: 2,
                    borderRadius: 2,
                    backgroundColor: isActive || isCompleted
                      ? theme.palette.mode === 'dark' 
                        ? 'rgba(255, 255, 255, 0.05)' 
                        : 'rgba(0, 0, 0, 0.02)'
                      : 'transparent',
                    border: isActive
                      ? `1px solid ${step.color}40`
                      : '1px solid transparent',
                    opacity: index <= currentStep ? 1 : 0.3,
                    transition: 'all 0.3s ease-in-out'
                  }}
                >
                  <StepIcon
                    sx={{
                      color: isCompleted ? theme.palette.success.main : step.color,
                      fontSize: '24px',
                      transition: 'color 0.3s ease-in-out'
                    }}
                  />
                  <Typography 
                    variant="body2" 
                    fontWeight={isActive ? 600 : 400}
                    color={isCompleted ? theme.palette.success.main : theme.palette.text.primary}
                    sx={{ transition: 'all 0.3s ease-in-out' }}
                  >
                    {step.text}
                  </Typography>
                  {isActive && !isComplete && (
                    <Box sx={{ ml: 'auto' }}>
                      <RefreshIcon 
                        sx={{ 
                          color: step.color,
                          fontSize: '20px',
                          animation: 'spin 1s linear infinite',
                          '@keyframes spin': {
                            '0%': { transform: 'rotate(0deg)' },
                            '100%': { transform: 'rotate(360deg)' }
                          }
                        }} 
                      />
                    </Box>
                  )}
                </Box>
              </Slide>
            );
          })}
        </Box>

        {isComplete && (
          <Fade in={isComplete} timeout={500}>
            <Box sx={{
              mt: 3,
              p: 2,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(76, 175, 80, 0.1)'
                : 'rgba(76, 175, 80, 0.05)',
              borderRadius: 2,
              border: `1px solid ${theme.palette.success.main}40`,
              textAlign: 'center'
            }}>
              <Typography variant="body2" color={theme.palette.success.main} fontWeight={600}>
                ✅ File has been successfully skipped
              </Typography>
              <Typography variant="caption" color={theme.palette.text.secondary} sx={{ mt: 0.5, display: 'block' }}>
                This file will not be processed automatically until force mode is used
              </Typography>
              <Typography variant="caption" color={theme.palette.primary.main} sx={{ mt: 1, display: 'block', fontWeight: 600 }}>
                🔄 Navigating back automatically...
              </Typography>
            </Box>
          </Fade>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SkipResultDialog;
