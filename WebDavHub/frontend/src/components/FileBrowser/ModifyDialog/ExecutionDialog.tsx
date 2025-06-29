import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography, useTheme, IconButton, LinearProgress, CircularProgress, Fade, Zoom, Slide } from '@mui/material';
import { Close as CloseIcon, CheckCircle as CheckCircleIcon, PlayArrow as PlayArrowIcon, Search as SearchIcon, Send as SendIcon, HourglassEmpty as WaitingIcon, Refresh as RefreshIcon, Movie as MovieIcon, FindInPage as AnalyzeIcon, Warning as WarningIcon } from '@mui/icons-material';
import { ActionButton, pulse, fadeOut } from './StyledComponents';
import MovieOptionCard from './MovieOptionCard';
import PosterSkeleton from './PosterSkeleton';
import { ExecutionDialogProps } from './types';

const getDialogMaxWidth = (count: number) => {
  if (count <= 2) return 'xs';
  if (count <= 4) return 'md';
  return 'lg';
};

const ExecutionDialog: React.FC<ExecutionDialogProps> = ({
  open, onClose, execInput, onInputChange, onInputSubmit, waitingForInput, movieOptions,
  isLoadingNewOptions, previousOptions, operationSuccess, onOptionClick,
  selectedIds = {}, manualSearchEnabled = false, selectionInProgress = false
}) => {
  const theme = useTheme();
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Check if this is an ID-based operation
  const isIdBasedOperation = Object.values(selectedIds).some(value => value && value.trim() !== '');
  const hasMovieOptions = movieOptions.length > 0 || (isLoadingNewOptions && previousOptions.length > 0);
  const showMovieOptions = hasMovieOptions;

  // Define processing steps
  const steps = [
    { icon: AnalyzeIcon, text: 'Analyzing media file...', color: theme.palette.primary.main },
    {
      icon: SearchIcon,
      text: (showMovieOptions && waitingForInput)
        ? `Found ${movieOptions.length} match${movieOptions.length !== 1 ? 'es' : ''}!`
        : (manualSearchEnabled && !showMovieOptions)
          ? 'Manual search required - automatic search failed'
          : 'Searching for matches...',
      color: (showMovieOptions && waitingForInput)
        ? theme.palette.success.main
        : (manualSearchEnabled && !showMovieOptions)
          ? theme.palette.warning.main
          : theme.palette.info.main
    },
    { icon: MovieIcon, text: 'Processing metadata...', color: theme.palette.warning.main },
    { icon: CheckCircleIcon, text: 'Processing complete!', color: theme.palette.success.main }
  ];

  // Handle progress animation
  useEffect(() => {
    if (!open) {
      setProgress(0);
      setCurrentStep(0);
      setIsComplete(false);
      setShowResults(false);
      return;
    }

    if (operationSuccess) {
      setProgress(100);
      setCurrentStep(3);
      setIsComplete(true);
      return;
    }

    // If we have movie options, complete the search step
    if (showMovieOptions) {
      setProgress(75);
      setCurrentStep(1); // Complete "Searching for matches..."
      setIsComplete(false);
      return;
    }

    // If manual search is enabled and we don't have any options, we're in manual search mode
    if (manualSearchEnabled && !showMovieOptions) {
      setProgress(50);
      setCurrentStep(1);
      setIsComplete(false);
      return;
    }

    let interval: NodeJS.Timeout;

    // Start progress animation after a short delay
    const timer = setTimeout(() => {
      interval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + 1.5;

          // Update current step based on progress
          if (newProgress >= 25 && currentStep === 0) {
            setCurrentStep(1);
          } else if (newProgress >= 75 && currentStep === 1) {
            // Stop at 75% when searching - wait for movie options
            return 75;
          } else if (newProgress >= 100) {
            setIsComplete(true);
            return 100;
          }

          return newProgress;
        });
      }, 100);
    }, 300);

    return () => {
      clearTimeout(timer);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [open, operationSuccess, hasMovieOptions, waitingForInput, currentStep, isLoadingNewOptions, manualSearchEnabled]);

  // Handle smooth transition to results
  useEffect(() => {
    if (showMovieOptions) {
      // Show results immediately when options are available
      const timer = setTimeout(() => {
        setShowResults(true);
      }, 400);
      return () => clearTimeout(timer);
    } else if (manualSearchEnabled && !showMovieOptions) {
      const timer = setTimeout(() => {
        setShowResults(true);
      }, 400);
      return () => clearTimeout(timer);
    } else {
      setShowResults(false);
    }
  }, [showMovieOptions, waitingForInput, manualSearchEnabled]);

  // Handle when user makes a selection - continue to processing metadata
  useEffect(() => {
    if (!waitingForInput && !hasMovieOptions && !operationSuccess) {
      // User made a selection, hide results and continue processing
      setShowResults(false);
      setProgress(90);
      setCurrentStep(2); // Move to "Processing metadata..."

      // Continue to completion
      const timer = setTimeout(() => {
        setProgress(100);
        setCurrentStep(3);
        setIsComplete(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [waitingForInput, hasMovieOptions, operationSuccess]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={getDialogMaxWidth(movieOptions.length)}
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundColor: theme.palette.background.paper,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(25, 118, 210, 0.08) 100%)`
            : `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(25, 118, 210, 0.04) 100%)`,
          border: `2px solid ${operationSuccess ? theme.palette.success.main + '60' : theme.palette.primary.main + '60'}`,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6)'
            : '0 8px 32px rgba(0, 0, 0, 0.15)',
          maxWidth: movieOptions.length > 6 ? '85vw' : undefined,
        }
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
          }
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
            ? (operationSuccess ? 'rgba(76, 175, 80, 0.15)' : 'rgba(25, 118, 210, 0.15)')
            : (operationSuccess ? 'rgba(76, 175, 80, 0.08)' : 'rgba(25, 118, 210, 0.08)'),
          borderBottom: `2px solid ${operationSuccess ? theme.palette.success.main : theme.palette.primary.main}60`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Zoom in={true} timeout={300}>
            {operationSuccess ? (
              <CheckCircleIcon sx={{ color: 'success.main', fontSize: '28px' }} />
            ) : showMovieOptions ? (
              <SearchIcon sx={{ color: 'primary.main', fontSize: '28px' }} />
            ) : manualSearchEnabled ? (
              <WaitingIcon sx={{ color: 'warning.main', fontSize: '28px' }} />
            ) : (
              <PlayArrowIcon sx={{ color: 'primary.main', fontSize: '28px' }} />
            )}
          </Zoom>
          <Box>
            <Typography variant="h6" fontWeight={700} sx={{ lineHeight: 1.2 }}>
              {operationSuccess
                ? 'Operation Complete'
                : hasMovieOptions
                  ? 'Select Media Match'
                  : manualSearchEnabled
                    ? 'Manual Search Required'
                    : 'Processing Media File'
              }
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              {operationSuccess
                ? 'Media processing completed successfully'
                : showMovieOptions
                  ? 'Choose the best match for your media file'
                  : manualSearchEnabled
                    ? 'Automatic search failed - please provide a custom search term'
                    : 'Please wait while we process your media file'
              }
            </Typography>
          </Box>
        </Box>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{
            color: operationSuccess ? 'success.contrastText' : 'text.secondary',
            '&:hover': {
              backgroundColor: operationSuccess ? 'rgba(255,255,255,0.1)' : 'action.hover',
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          pt: 2,
          pb: 1,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(0, 0, 0, 0.2)'
            : 'rgba(248, 249, 250, 0.9)',
        }}
      >
        {/* Processing Steps Animation - Show during initial processing or after selection */}
        {!operationSuccess && !showResults && !isIdBasedOperation && (
          <Fade in={!showResults} timeout={400}>
          <Box>
            {/* Progress Bar */}
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
                      : `linear-gradient(45deg, ${theme.palette.primary.main} 30%, ${theme.palette.primary.light} 90%)`,
                  }
                }}
              />
              <Typography variant="caption" color={theme.palette.text.secondary} sx={{ mt: 1, display: 'block' }}>
                {Math.round(progress)}% complete
              </Typography>
            </Box>

            {/* Animated Steps */}
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

          </Box>
          </Fade>
        )}

        {/* Success State */}
        {operationSuccess && (
          <Fade in={operationSuccess} timeout={500}>
            <Box sx={{
              textAlign: 'center',
              py: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(76, 175, 80, 0.1)'
                : 'rgba(76, 175, 80, 0.05)',
              borderRadius: 2,
              border: `1px solid ${theme.palette.success.main}40`,
            }}>
              <CheckCircleIcon
                sx={{
                  fontSize: 56,
                  color: 'success.main',
                  animation: `${pulse} 1.5s ease-in-out infinite`
                }}
              />
              <Typography variant="h6" color="success.main" fontWeight={700}>
                File processing completed successfully!
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This dialog will close automatically in a few seconds...
              </Typography>
            </Box>
          </Fade>
        )}

        {/* Loading state for posters */}
        {!operationSuccess && waitingForInput && isLoadingNewOptions && (
          <Fade in={isLoadingNewOptions} timeout={300}>
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              p: 4,
              mt: 2,
            }}>
              <CircularProgress size={40} />
              <Typography variant="body2" color="text.secondary">
                Loading movie options...
              </Typography>
            </Box>
          </Fade>
        )}

        {/* Selection confirmation message */}
        {!operationSuccess && !waitingForInput && !hasMovieOptions && !showResults && currentStep >= 2 && (
          <Fade in={true} timeout={500}>
            <Box sx={{
              textAlign: 'center',
              py: 3,
              px: 3,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(25, 118, 210, 0.1)'
                : 'rgba(25, 118, 210, 0.05)',
              borderRadius: 2,
              border: `1px solid ${theme.palette.primary.main}40`,
              mb: 2,
            }}>
              <Typography variant="subtitle1" color="primary.main" fontWeight={600} sx={{ mb: 1 }}>
                🎯 Selection Confirmed
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Processing your selection and finalizing metadata...
              </Typography>
            </Box>
          </Fade>
        )}

        {/* Transition from processing to results OR manual search */}
        {!operationSuccess && showResults && (
          <Fade in={showResults} timeout={600}>
            <Box>
              {showMovieOptions ? (
                <>
                  {/* Results header */}
                  <Slide direction="up" in={showResults} timeout={400}>
                    <Box sx={{
                      mb: 2,
                      p: 1.5,
                      backgroundColor: theme.palette.mode === 'dark'
                        ? 'rgba(76, 175, 80, 0.1)'
                        : 'rgba(76, 175, 80, 0.05)',
                      borderRadius: 2,
                      border: `1px solid ${theme.palette.success.main}40`,
                      textAlign: 'center'
                    }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mb: 1 }}>
                      <CheckCircleIcon sx={{ color: 'success.main', fontSize: '20px' }} />
                      <Typography variant="subtitle1" color="success.main" fontWeight={600}>
                        ✨ Found {movieOptions.length} TMDB Match{movieOptions.length !== 1 ? 'es' : ''}
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      Select the best match for your media file
                    </Typography>
                  </Box>
                  </Slide>

                  {/* Movie Options Grid */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: 'repeat(auto-fit, minmax(120px, 1fr))',
                        sm: 'repeat(auto-fit, minmax(140px, 1fr))',
                        md: 'repeat(auto-fit, minmax(140px, 1fr))',
                      },
                      gap: { xs: 0.5, sm: 0.75 }, // Reduced gap from 1/1.5 to 0.5/0.75
                      p: { xs: 0.25, sm: 0.25 }, // Reduced padding from 0.5 to 0.25
                      mb: 1,
                      border: 'none',
                      backgroundColor: 'transparent',
                      justifyItems: 'center',
                      alignItems: 'start',
                      maxHeight: '55vh',
                      overflowY: 'auto',
                      // Custom scrollbar styling
                      '&::-webkit-scrollbar': {
                        width: '8px',
                      },
                      '&::-webkit-scrollbar-track': {
                        background: 'transparent',
                      },
                      '&::-webkit-scrollbar-thumb': {
                        background: theme.palette.mode === 'dark'
                          ? 'rgba(255, 255, 255, 0.2)'
                          : 'rgba(0, 0, 0, 0.2)',
                        borderRadius: '4px',
                      },
                    }}
                  >
                    {/* Show loading skeletons when transitioning - show 6 consistent skeletons */}
                    {isLoadingNewOptions && Array.from({ length: 6 }, (_, index) => (
                      <PosterSkeleton
                        key={`loading-skeleton-${index}`}
                        sx={{
                          animation: `${fadeOut} 0.3s ease-out forwards`,
                        }}
                      />
                    ))}

                    {/* Show actual movie options with staggered animation */}
                    {!isLoadingNewOptions && movieOptions.map((option, index) => (
                      <Zoom
                        key={option.number}
                        in={!isLoadingNewOptions}
                        timeout={300 + index * 100}
                        style={{ transitionDelay: `${index * 50}ms` }}
                      >
                        <Box>
                          <MovieOptionCard
                            option={option}
                            onClick={onOptionClick}
                          />
                        </Box>
                      </Zoom>
                    ))}
                  </Box>
                </>
              ) : (
                /* Manual Search Interface - Show in TMDB results area when manual search is enabled */
                <Slide direction="up" in={!showMovieOptions && manualSearchEnabled} timeout={400}>
                  <Box sx={{
                    textAlign: 'center',
                    py: 4,
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, justifyContent: 'center' }}>
                      <WarningIcon sx={{ color: 'warning.main', fontSize: 28 }} />
                      <Typography variant="h6" fontWeight={600} color="warning.main">
                        Manual Search Required
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                      Automatic search failed - please provide a custom search term
                    </Typography>

                    <Box sx={{
                      p: { xs: 3, md: 4 },
                      backgroundColor: theme.palette.mode === 'dark'
                        ? 'rgba(255, 152, 0, 0.1)'
                        : 'rgba(255, 152, 0, 0.05)',
                      borderRadius: 3,
                      border: `2px solid ${theme.palette.warning.main}40`,
                      maxWidth: '500px',
                      mx: 'auto',
                    }}>
                      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2, color: 'warning.main' }}>
                        🔍 Enter your search term:
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        Automatic search failed - please provide a simpler title
                      </Typography>

                      <Box sx={{
                        display: 'flex',
                        gap: 2,
                        flexDirection: { xs: 'column', sm: 'row' },
                        justifyContent: 'center',
                      }}>
                        <TextField
                          fullWidth
                          size="medium"
                          variant="outlined"
                          placeholder="Enter a simpler title (e.g., 'Argo' instead of 'vedett-argo-1080p')"
                          value={execInput}
                          onChange={(e) => onInputChange(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              onInputSubmit();
                            }
                          }}
                          disabled={isLoadingNewOptions}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              borderRadius: '12px',
                              backgroundColor: theme.palette.background.paper,
                              transition: 'all 0.3s ease-in-out',
                              fontSize: { xs: '0.95rem', sm: '1rem' },
                              '&:hover fieldset': {
                                borderColor: theme.palette.warning.main,
                              },
                              '&.Mui-focused fieldset': {
                                borderColor: theme.palette.warning.main,
                                borderWidth: '2px',
                              },
                            }
                          }}
                        />
                        <Button
                          variant="contained"
                          onClick={onInputSubmit}
                          disabled={!execInput.trim() || isLoadingNewOptions}
                          startIcon={isLoadingNewOptions ? <RefreshIcon sx={{ animation: 'spin 1s linear infinite' }} /> : <SendIcon />}
                          sx={{
                            minWidth: { xs: 'auto', sm: '120px' },
                            width: { xs: '100%', sm: 'auto' },
                            borderRadius: '12px',
                            transition: 'all 0.3s ease-in-out',
                            fontSize: { xs: '0.95rem', sm: '1rem' },
                            py: { xs: 1.5, sm: 1.2 },
                            background: `linear-gradient(135deg, ${theme.palette.warning.main} 0%, ${theme.palette.warning.dark} 100%)`,
                            '&:hover': {
                              background: `linear-gradient(135deg, ${theme.palette.warning.dark} 0%, ${theme.palette.warning.main} 100%)`,
                              transform: 'translateY(-1px)',
                              boxShadow: theme.shadows[4],
                            },
                            '&:disabled': {
                              background: theme.palette.action.disabledBackground,
                              color: theme.palette.action.disabled,
                            },
                          }}
                        >
                          {isLoadingNewOptions ? 'Searching...' : 'Search'}
                        </Button>
                      </Box>
                    </Box>
                  </Box>
                </Slide>
              )}
            </Box>
          </Fade>
        )}





        {/* Input Section - Show when waiting for input with movie options */}
        {!operationSuccess && !isIdBasedOperation && waitingForInput && showMovieOptions && showResults && !selectionInProgress && (
          <Fade in={waitingForInput && showMovieOptions && !selectionInProgress} timeout={200}>
            <Box sx={{
              mt: 2,
              p: { xs: 2, md: 3 },
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(255, 255, 255, 0.03)'
                : 'rgba(0, 0, 0, 0.02)',
              borderRadius: 3,
              border: `2px solid ${theme.palette.primary.main}40`,
              [theme.breakpoints.up('md')]: {
                mx: 2,
              },
            }}>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
                💬 Your input is required:
              </Typography>

              <Box sx={{
                display: 'flex',
                gap: 2,
                flexDirection: { xs: 'column', sm: 'row' },
              }}>
                <TextField
                  fullWidth
                  size="medium"
                  variant="outlined"
                  placeholder={
                    isLoadingNewOptions
                      ? "Loading new options..."
                      : "Type your response or selection number..."
                  }
                  value={execInput}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onInputSubmit();
                    }
                  }}
                  disabled={isLoadingNewOptions}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      backgroundColor: theme.palette.background.paper,
                      transition: 'all 0.3s ease-in-out',
                      fontSize: { xs: '0.95rem', sm: '1rem' },
                      '&:hover fieldset': {
                        borderColor: theme.palette.primary.main,
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: theme.palette.primary.main,
                        borderWidth: '2px',
                      },
                    }
                  }}
                />
                <Button
                  variant="contained"
                  onClick={onInputSubmit}
                  disabled={!execInput.trim() || isLoadingNewOptions}
                  startIcon={isLoadingNewOptions ? <RefreshIcon sx={{ animation: 'spin 1s linear infinite' }} /> : <SendIcon />}
                  sx={{
                    minWidth: { xs: 'auto', sm: '120px' },
                    width: { xs: '100%', sm: 'auto' },
                    borderRadius: '12px',
                    transition: 'all 0.3s ease-in-out',
                    fontSize: { xs: '0.95rem', sm: '1rem' },
                    py: { xs: 1.5, sm: 1.2 },
                    background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)',
                    '&:hover': {
                      background: 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
                      transform: 'translateY(-1px)',
                      boxShadow: theme.shadows[4],
                    },
                    '&:disabled': {
                      background: theme.palette.action.disabledBackground,
                      color: theme.palette.action.disabled,
                    },
                  }}
                >
                  {isLoadingNewOptions ? 'Loading...' : 'Submit'}
                </Button>
              </Box>
            </Box>
          </Fade>
        )}

        {/* ID-Based Operation Display */}
        {!operationSuccess && isIdBasedOperation && !hasMovieOptions && (
          <Fade in={true} timeout={500}>
            <Box sx={{
              textAlign: 'center',
              py: 4,
              px: 3,
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(25, 118, 210, 0.1)'
                : 'rgba(25, 118, 210, 0.05)',
              borderRadius: 3,
              border: `2px solid ${theme.palette.primary.main}40`,
            }}>
              <Box sx={{ mb: 2 }}>
                <RefreshIcon sx={{
                  fontSize: 40,
                  color: 'primary.main',
                  animation: 'spin 2s linear infinite',
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' }
                  }
                }} />
              </Box>
              <Typography variant="h6" color="primary" sx={{ fontWeight: 700, mb: 1 }}>
                🆔 Processing with Direct ID Lookup
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No user input required - using provided metadata IDs
              </Typography>
              <Box sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 1,
                justifyContent: 'center',
                mt: 2
              }}>
                {Object.entries(selectedIds).filter(([_, value]) => value && value.trim() !== '').map(([key, value]) => (
                  <Box
                    key={key}
                    sx={{
                      px: 2,
                      py: 0.5,
                      backgroundColor: theme.palette.primary.main + '20',
                      borderRadius: 2,
                      border: `1px solid ${theme.palette.primary.main}40`,
                    }}
                  >
                    <Typography variant="caption" color="primary.main" fontWeight={600}>
                      {key.toUpperCase()}: {value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Fade>
        )}
      </DialogContent>
      <DialogActions
        sx={{
          p: 2,
          pt: 1.5,
          gap: 1,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(0, 0, 0, 0.3)'
            : 'rgba(255, 255, 255, 0.98)',
          borderTop: theme.palette.mode === 'dark'
            ? `1px solid ${theme.palette.divider}`
            : '1px solid #e0e0e0',
        }}
      >
        <ActionButton
          onClick={onClose}
          variant="outlined"
          sx={{
            borderRadius: 2,
            px: 3,
            fontWeight: 600
          }}
        >
          Close
        </ActionButton>
      </DialogActions>
    </Dialog>
  );
};

export default ExecutionDialog;
