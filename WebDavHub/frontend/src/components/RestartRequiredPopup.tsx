import React, { useState, useEffect, forwardRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Fade,
  Slide,
  IconButton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  RestartAlt,
  Warning,
  Close,
  CheckCircle,
} from '@mui/icons-material';
import { TransitionProps } from '@mui/material/transitions';

const SlideUpTransition = forwardRef<
  unknown,
  TransitionProps & {
    children: React.ReactElement;
  }
>((props, ref) => <Slide direction="up" ref={ref} {...props} />);

interface RestartRequiredPopupProps {
  open: boolean;
  onClose: () => void;
  onRestart: () => void;
  newApiPort?: string;
}

const RestartRequiredPopup: React.FC<RestartRequiredPopupProps> = ({
  open,
  onClose,
  onRestart,
  newApiPort,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [isRestarting, setIsRestarting] = useState(false);
  const [restartComplete, setRestartComplete] = useState(false);

  // Reset state when popup opens
  useEffect(() => {
    if (open) {
      setIsRestarting(false);
      setRestartComplete(false);
    }
  }, [open]);


  const handleRestart = async () => {
    setIsRestarting(true);
    
    try {
      await onRestart();
      
      // Simulate restart process
      setTimeout(() => {
        setRestartComplete(true);
        setTimeout(() => {
          localStorage.removeItem('cineSyncJWT');
          window.location.reload();
        }, 2000);
      }, 3000);
      
    } catch (error) {
      console.error('Restart failed:', error);
      setIsRestarting(false);
    }
  };

  const handleClose = () => {
    if (!isRestarting) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={isMobile ? "xs" : "sm"}
      fullWidth={!isMobile}
      PaperProps={{
        sx: {
          borderRadius: { xs: 3, sm: 3 },
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, #1e293b 0%, #334155 100%)'
            : 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: theme.palette.mode === 'dark'
            ? '1px solid rgba(59, 130, 246, 0.3)'
            : '1px solid rgba(59, 130, 246, 0.2)',
          boxShadow: theme.palette.mode === 'dark'
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            : '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
          margin: { xs: 2, sm: 3 },
          width: isMobile ? 'calc(100vw - 32px)' : 'auto',
          maxWidth: isMobile ? 'calc(100vw - 32px)' : '600px',
          minWidth: isMobile ? '320px' : '500px',
          overflow: 'visible',
        },
      }}
      TransitionComponent={SlideUpTransition}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1.5, sm: 2 },
          pb: 1,
          px: { xs: 2, sm: 3 },
          pt: { xs: 2, sm: 3 },
          color: theme.palette.mode === 'dark' ? '#f1f5f9' : '#1e293b',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: { xs: 40, sm: 48 },
            height: { xs: 40, sm: 48 },
            borderRadius: '50%',
            background: isRestarting
              ? 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)'
              : restartComplete
              ? 'linear-gradient(135deg, #4CAF50 0%, #059669 100%)'
              : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            boxShadow: '0 8px 25px -8px rgba(59, 130, 246, 0.4)',
          }}
        >
          {isRestarting ? (
            <CircularProgress
              size={24}
              sx={{
                color: 'white',
                width: { xs: 20, sm: 24 },
                height: { xs: 20, sm: 24 }
              }}
            />
          ) : restartComplete ? (
            <CheckCircle sx={{ color: 'white', fontSize: { xs: 24, sm: 28 } }} />
          ) : (
            <Warning sx={{ color: 'white', fontSize: { xs: 24, sm: 28 } }} />
          )}
        </Box>
        
        <Box sx={{ flex: 1 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              mb: 0.5,
              fontSize: { xs: '1.1rem', sm: '1.25rem' }
            }}
          >
            {isRestarting
              ? 'Restarting Server...'
              : restartComplete
              ? 'Restart Complete!'
              : 'Server Restart Required'}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: theme.palette.mode === 'dark' ? '#94a3b8' : '#64748b',
              fontSize: { xs: '0.8rem', sm: '0.875rem' },
              lineHeight: 1.4
            }}
          >
            {isRestarting
              ? 'Please wait while the server restarts'
              : restartComplete
              ? 'Redirecting to updated server...'
              : 'Configuration changes require a server restart'}
          </Typography>
        </Box>

        {!isRestarting && !restartComplete && (
          <IconButton
            onClick={handleClose}
            sx={{
              color: theme.palette.mode === 'dark' ? '#94a3b8' : '#64748b',
              '&:hover': {
                color: theme.palette.mode === 'dark' ? '#f1f5f9' : '#1e293b',
                backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)'
              },
            }}
          >
            <Close />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent sx={{
        pt: { xs: 1, sm: 2 },
        pb: { xs: 2, sm: 3 },
        px: { xs: 3, sm: 4 },
        overflow: 'visible'
      }}>
        <Fade in={!isRestarting && !restartComplete}>
          <Box>
            <Typography
              variant="body1"
              sx={{
                color: theme.palette.mode === 'dark' ? '#e2e8f0' : '#374151',
                mb: 2,
                lineHeight: 1.6,
                fontSize: { xs: '0.9rem', sm: '1rem' }
              }}
            >
              You've updated server settings that require a restart to take effect:
            </Typography>
            
            <Box
              sx={{
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(59, 130, 246, 0.1)'
                  : 'rgba(59, 130, 246, 0.05)',
                border: theme.palette.mode === 'dark'
                  ? '1px solid rgba(59, 130, 246, 0.3)'
                  : '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 2,
                p: { xs: 1.5, sm: 2 },
                mb: 2,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.mode === 'dark' ? '#93c5fd' : '#2563eb',
                  fontWeight: 500,
                  fontSize: { xs: '0.8rem', sm: '0.875rem' },
                  mb: 0.5
                }}
              >
                • Server IP address changes
              </Typography>
              {newApiPort && newApiPort !== '8082' && (
                <Typography
                  variant="body2"
                  sx={{
                    color: theme.palette.mode === 'dark' ? '#93c5fd' : '#2563eb',
                    fontWeight: 500,
                    fontSize: { xs: '0.8rem', sm: '0.875rem' },
                    mb: 0.5
                  }}
                >
                  • API port changes (new: {newApiPort})
                </Typography>
              )}
            </Box>

            <Typography
              variant="body2"
              sx={{
                color: theme.palette.mode === 'dark' ? '#94a3b8' : '#6b7280',
                fontStyle: 'italic',
                fontSize: { xs: '0.8rem', sm: '0.875rem' },
                lineHeight: 1.5
              }}
            >
              The restart process will take a few seconds. You'll be automatically redirected once complete.
              {newApiPort && newApiPort !== '8082' && (
                <><br /><br />Note: You'll need to log in again after the restart due to port changes.</>
              )}
            </Typography>

            {newApiPort && newApiPort !== '8082' && (
              <Box
                sx={{
                  backgroundColor: theme.palette.mode === 'dark'
                    ? 'rgba(245, 158, 11, 0.1)'
                    : 'rgba(245, 158, 11, 0.05)',
                  border: theme.palette.mode === 'dark'
                    ? '1px solid rgba(245, 158, 11, 0.3)'
                    : '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: 2,
                  p: { xs: 1.5, sm: 2 },
                  mt: 2,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: theme.palette.mode === 'dark' ? '#fbbf24' : '#d97706',
                    fontWeight: 500,
                    mb: 1,
                    fontSize: { xs: '0.8rem', sm: '0.875rem' }
                  }}
                >
                  ⚠️ Manual Restart Required
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: theme.palette.mode === 'dark' ? '#fcd34d' : '#b45309',
                    fontSize: { xs: '0.75rem', sm: '0.8rem' },
                    lineHeight: 1.4
                  }}
                >
                  Server configuration has changed. Please restart your CineSync services to apply the new configuration.
                  <br /><br />
                  This may require restarting containers, services, or development servers depending on your setup.
                </Typography>
              </Box>
            )}
          </Box>
        </Fade>

        <Fade in={isRestarting}>
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="body1" sx={{
              color: theme.palette.mode === 'dark' ? '#e2e8f0' : '#374151',
              mb: 2
            }}>
              Applying configuration changes...
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
              {[0, 1, 2].map((i) => (
                <Box
                  key={i}
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#3b82f6',
                    animation: `pulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                    '@keyframes pulse': {
                      '0%, 80%, 100%': { opacity: 0.3, transform: 'scale(1)' },
                      '40%': { opacity: 1, transform: 'scale(1.2)' },
                    },
                  }}
                />
              ))}
            </Box>
          </Box>
        </Fade>

        <Fade in={restartComplete}>
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="body1" sx={{
              color: theme.palette.mode === 'dark' ? '#4CAF50' : '#059669',
              mb: 1,
              fontWeight: 500
            }}>
              Server restart completed successfully!
            </Typography>
            <Typography variant="body2" sx={{
              color: theme.palette.mode === 'dark' ? '#94a3b8' : '#6b7280'
            }}>
              Redirecting to the updated server...
            </Typography>
          </Box>
        </Fade>


      </DialogContent>

      {!isRestarting && !restartComplete && (
        <DialogActions sx={{
          px: { xs: 3, sm: 4 },
          pb: { xs: 3, sm: 4 },
          pt: { xs: 1, sm: 2 },
          gap: { xs: 2, sm: 3 },
          flexDirection: { xs: 'column', sm: 'row' }
        }}>
          <Button
            onClick={handleClose}
            variant="outlined"
            sx={{
              borderColor: theme.palette.mode === 'dark' ? '#475569' : '#d1d5db',
              color: theme.palette.mode === 'dark' ? '#94a3b8' : '#6b7280',
              order: { xs: 2, sm: 1 },
              width: { xs: '100%', sm: 'auto' },
              '&:hover': {
                borderColor: theme.palette.mode === 'dark' ? '#64748b' : '#9ca3af',
                backgroundColor: theme.palette.mode === 'dark'
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(0, 0, 0, 0.02)',
              },
            }}
          >
            Later
          </Button>
          <Button
            onClick={handleRestart}
            variant="contained"
            startIcon={<RestartAlt />}
            sx={{
              order: { xs: 1, sm: 2 },
              width: { xs: '100%', sm: 'auto' },
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              boxShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.4)',
              '&:hover': {
                background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                boxShadow: '0 6px 20px 0 rgba(59, 130, 246, 0.6)',
              },
            }}
          >
            Restart Now
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export default RestartRequiredPopup;
