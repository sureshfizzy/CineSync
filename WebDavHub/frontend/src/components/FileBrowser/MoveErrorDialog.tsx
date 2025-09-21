import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton, useTheme, Alert, Chip } from '@mui/material';
import { Close as CloseIcon, ErrorOutline as ErrorIcon, DriveFileMove as MoveIcon, Warning as WarningIcon } from '@mui/icons-material';

interface MoveErrorDialogProps {
  open: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onOverwrite?: () => void;
  fileName: string;
  targetPath: string;
  errorMessage: string;
}

const MoveErrorDialog: React.FC<MoveErrorDialogProps> = ({
  open,
  onClose,
  onRetry,
  onOverwrite,
  fileName,
  targetPath,
  errorMessage
}) => {
  const theme = useTheme();

  const isTargetExistsError = errorMessage.toLowerCase().includes('target already exists') || 
                             errorMessage.toLowerCase().includes('already exists');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: theme.palette.background.paper,
            borderRadius: 3,
            boxShadow: theme.palette.mode === 'dark' ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.15)',
          }
        }
      }}
    >
      <DialogTitle sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: `1px solid ${theme.palette.divider}`,
        py: 2,
        bgcolor: '#FF0000', // AMOLED red
        color: '#FFFFFF',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ErrorIcon />
          <Box>
            <Typography variant="h6">Move Failed</Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              Unable to move the selected item
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 3 }}>
          {isTargetExistsError ? (
            <Alert 
              severity="warning" 
              icon={<WarningIcon />}
              sx={{ 
                mb: 3,
                borderRadius: 2,
                '& .MuiAlert-message': {
                  width: '100%'
                }
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                File Already Exists
              </Typography>
              <Typography variant="body2" color="text.secondary">
                A file or folder with the same name already exists in the destination folder.
              </Typography>
            </Alert>
          ) : (
            <Alert 
              severity="error" 
              icon={<ErrorIcon />}
              sx={{ 
                mb: 3,
                borderRadius: 2,
                '& .MuiAlert-message': {
                  width: '100%'
                }
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
                Move Operation Failed
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {errorMessage}
              </Typography>
            </Alert>
          )}

          <Box sx={{ 
            bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50], 
            borderRadius: 2, 
            p: 2,
            border: `1px solid ${theme.palette.divider}`
          }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Item being moved:
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <MoveIcon color="primary" fontSize="small" />
              <Chip 
                label={fileName} 
                size="small" 
                color="primary" 
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            </Box>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Destination:
            </Typography>
            <Typography variant="body2" sx={{ 
              fontFamily: 'monospace',
              bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
              color: theme.palette.mode === 'dark' ? theme.palette.grey[300] : theme.palette.grey[800],
              p: 1,
              borderRadius: 1,
              fontSize: '0.875rem'
            }}>
              {targetPath}
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions sx={{ 
        p: 2, 
        borderTop: `1px solid ${theme.palette.divider}`,
        gap: 1
      }}>
        <Button 
          onClick={onClose} 
          variant="outlined"
          sx={{ minWidth: 80 }}
        >
          Cancel
        </Button>
        
        {isTargetExistsError && onOverwrite && (
          <Button
            variant="contained"
            color="warning"
            onClick={onOverwrite}
            startIcon={<WarningIcon />}
            sx={{ minWidth: 120 }}
          >
            Replace
          </Button>
        )}
        
        {onRetry && (
          <Button
            variant="contained"
            onClick={onRetry}
            startIcon={<MoveIcon />}
            sx={{ minWidth: 100 }}
          >
            Try Again
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default MoveErrorDialog;
