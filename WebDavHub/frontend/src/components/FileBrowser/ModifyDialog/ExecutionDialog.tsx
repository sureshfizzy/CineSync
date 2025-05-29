import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  useTheme,
  IconButton
} from '@mui/material';
import { styled as muiStyled } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { ActionButton, pulse, fadeIn, fadeOut } from './StyledComponents';
import MovieOptionCard from './MovieOptionCard';
import PosterSkeleton from './PosterSkeleton';
import IDBasedAnimation from './IDBasedAnimation';
import { ExecutionDialogProps } from './types';

const getDialogMaxWidth = (count: number) => {
  if (count <= 2) return 'xs';
  if (count <= 4) return 'md';
  return 'lg';
};

const getDialogPaperMaxWidth = (count: number) => {
  if (count <= 2) return 400;
  if (count <= 4) return 800;
  return 1100;
};

const StyledExecutionDialog = muiStyled(Dialog, {
  shouldForwardProp: (prop) => prop !== 'posterCount',
})<{ posterCount?: number }>(({ theme, posterCount = 1 }) => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    background: theme.palette.mode === 'dark'
      ? '#121212'
      : '#fff',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 8px 32px 0 rgba(0, 0, 0, 0.7)'
      : '0 8px 32px 0 rgba(31, 38, 135, 0.3)',
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.15)'
      : 'rgba(0, 0, 0, 0.15)',
    maxWidth: getDialogPaperMaxWidth(posterCount),
    width: '100%',
    margin: '16px',
    display: 'flex',
    flexDirection: 'column',
    [theme.breakpoints.down('sm')]: {
      margin: '16px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: '80vh',
    },
  },
  '& .MuiDialogTitle-root': {
    padding: '16px 24px',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    [theme.breakpoints.down('sm')]: {
      padding: '12px 16px',
      fontSize: '1.1rem',
    },
  },
  '& .MuiDialogContent-root': {
    padding: '16px 24px',
    flexGrow: 1,
    overflowY: 'auto',
    [theme.breakpoints.down('sm')]: {
      padding: '12px 16px',
    },
  },
  '& .MuiDialogActions-root': {
    padding: '16px 24px',
    borderTop: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    justifyContent: 'flex-end',
    [theme.breakpoints.down('sm')]: {
      padding: '12px 16px',
    },
  },
}));

const ExecutionDialog: React.FC<ExecutionDialogProps> = ({
  open,
  onClose,
  execOutput,
  execInput,
  onInputChange,
  onInputSubmit,
  onInputKeyPress,
  waitingForInput,
  movieOptions,
  isLoadingNewOptions,
  previousOptions,
  operationComplete,
  operationSuccess,
  isClosing,
  onOptionClick,
  selectedIds = {}
}) => {
  const theme = useTheme();

  // Check if this is an ID-based operation
  const isIdBasedOperation = Object.values(selectedIds).some(value => value && value.trim() !== '');
  const hasMovieOptions = movieOptions.length > 0 || (isLoadingNewOptions && previousOptions.length > 0);

  return (
    <StyledExecutionDialog
      open={open}
      onClose={onClose}
      maxWidth={getDialogMaxWidth(movieOptions.length)}
      posterCount={movieOptions.length}
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.95)' : 'scale(1)',
          transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
        }
      }}
    >
      <DialogTitle sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: operationSuccess ? 'success.main' : 'background.paper',
        color: operationSuccess ? 'success.contrastText' : 'text.primary',
        transition: 'background-color 0.3s ease-in-out, color 0.3s ease-in-out',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {operationSuccess ? (
            <>
              <CheckCircleOutlineIcon />
              <Typography variant="h6">Operation Completed Successfully</Typography>
            </>
          ) : (
            <Typography variant="h6">Choose an Option or Provide Input</Typography>
          )}
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
      <DialogContent dividers>
        {operationSuccess && (
          <Box sx={{
            textAlign: 'center',
            py: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2
          }}>
            <CheckCircleOutlineIcon
              sx={{
                fontSize: 48,
                color: 'success.main',
                animation: `${pulse} 1.5s ease-in-out infinite`
              }}
            />
            <Typography variant="h6" color="success.main">
              File processing completed successfully!
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This dialog will close automatically in a few seconds...
            </Typography>
          </Box>
        )}

        {/* Show ID-based animation when using IDs but no movie options */}
        {!operationSuccess && isIdBasedOperation && !hasMovieOptions && (
          <IDBasedAnimation
            selectedIds={selectedIds}
            isActive={!operationComplete}
          />
        )}

        {!operationSuccess && hasMovieOptions && (
          <Box
            sx={movieOptions.length <= 4
              ? {
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  gap: 2,
                  p: 0.5,
                  mb: 2,
                  border: 'none',
                  backgroundColor: 'transparent',
                  flexWrap: 'wrap',
                }
              : {
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(auto-fit, minmax(140px, 1fr))',
                    md: 'repeat(auto-fit, minmax(140px, 1fr))',
                  },
                  gap: 2,
                  p: 0.5,
                  mb: 2,
                  border: 'none',
                  backgroundColor: 'transparent',
                  justifyItems: 'center',
                  alignItems: 'start',
                  maxHeight: '60vh',
                  overflowY: 'auto',
                }
            }
          >
            {/* Show loading skeletons when transitioning */}
            {isLoadingNewOptions && previousOptions.map((option) => (
              <PosterSkeleton
                key={`loading-${option.number}`}
                sx={{
                  animation: `${fadeOut} 0.3s ease-out forwards`,
                }}
              />
            ))}

            {/* Show actual movie options */}
            {!isLoadingNewOptions && movieOptions.map((option) => (
              <MovieOptionCard
                key={option.number}
                option={option}
                onClick={onOptionClick}
              />
            ))}
          </Box>
        )}

        {!operationSuccess && !isIdBasedOperation && (
          <Box sx={{
            display: 'flex',
            gap: 1,
            mt: hasMovieOptions ? 0 : 2,
            flexDirection: { xs: 'column', sm: 'row' },
          }}>
            <TextField
              fullWidth
              size="small"
              variant="outlined"
              placeholder={
                isLoadingNewOptions
                  ? "Loading new options..."
                  : waitingForInput
                    ? "Type your response..."
                    : "Waiting for command..."
              }
              value={execInput}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyPress={onInputKeyPress}
              disabled={!waitingForInput || isLoadingNewOptions}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: (waitingForInput && !isLoadingNewOptions) ? 'background.paper' : 'action.disabledBackground',
                  opacity: isLoadingNewOptions ? 0.7 : 1,
                  transition: 'opacity 0.3s ease-in-out, background-color 0.3s ease-in-out',
                  fontSize: { xs: '0.9rem', sm: '1rem' },
                }
              }}
            />
            <Button
              variant="contained"
              onClick={onInputSubmit}
              disabled={!waitingForInput || !execInput.trim() || isLoadingNewOptions}
              sx={{
                minWidth: { xs: 'auto', sm: '80px' },
                width: { xs: '100%', sm: 'auto' },
                opacity: isLoadingNewOptions ? 0.7 : 1,
                transition: 'opacity 0.3s ease-in-out',
                fontSize: { xs: '0.9rem', sm: '1rem' },
                py: { xs: 1.5, sm: 1 },
              }}
            >
              {isLoadingNewOptions ? 'Loading...' : 'Send'}
            </Button>
          </Box>
        )}

        {!operationSuccess && isIdBasedOperation && !hasMovieOptions && (
          <Box sx={{
            textAlign: 'center',
            mt: 2,
            py: 2,
            px: 3,
            backgroundColor: theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.1)' : 'rgba(25, 118, 210, 0.05)',
            borderRadius: 2,
            border: `1px solid ${theme.palette.primary.main}`,
          }}>
            <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
              🆔 Processing with direct ID lookup
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              No user input required - using provided metadata IDs
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <ActionButton
          onClick={onClose}
          variant="outlined"
        >
          Close
        </ActionButton>
      </DialogActions>
    </StyledExecutionDialog>
  );
};

export default ExecutionDialog;
