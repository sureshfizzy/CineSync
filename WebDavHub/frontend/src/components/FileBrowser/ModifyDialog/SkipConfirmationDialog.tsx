import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Typography, Box, Button, useTheme, IconButton, Alert, AlertTitle } from '@mui/material';
import { Warning as WarningIcon, Close as CloseIcon, Block as BlockIcon, DeleteSweep as DeleteSweepIcon } from '@mui/icons-material';

interface SkipConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  filePath?: string;
}

const SkipConfirmationDialog: React.FC<SkipConfirmationDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  filePath
}) => {
  const theme = useTheme();

  const getFileName = (path?: string) => {
    if (!path) return 'this file';
    return path.split(/[/\\]/).pop() || path;
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundColor: theme.palette.background.paper,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(255, 152, 0, 0.08) 100%)`
            : `linear-gradient(135deg, #ffffff 0%, #fff8e1 100%)`,
          border: theme.palette.mode === 'dark'
            ? `2px solid ${theme.palette.warning.main}40`
            : `2px solid #ffb74d`,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.6)'
            : '0 8px 32px rgba(255, 152, 0, 0.25)',
        }
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: theme.palette.mode === 'dark'
              ? 'rgba(0, 0, 0, 0.7)'
              : 'rgba(0, 0, 0, 0.5)',
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
            ? 'rgba(255, 152, 0, 0.15)'
            : 'rgba(255, 193, 7, 0.12)',
          borderBottom: theme.palette.mode === 'dark'
            ? `2px solid ${theme.palette.warning.main}60`
            : `2px solid #ffb74d`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <WarningIcon 
            sx={{ 
              color: theme.palette.warning.main,
              fontSize: '28px'
            }} 
          />
          <Typography variant="h6" fontWeight={700} color="warning.main">
            Skip Processing Confirmation
          </Typography>
        </Box>
        <IconButton
          onClick={onCancel}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          pt: 3,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(0, 0, 0, 0.2)'
            : 'rgba(255, 255, 255, 0.95)',
        }}
      >
        <Alert 
          severity="warning" 
          icon={<BlockIcon />}
          sx={{ 
            mb: 3,
            '& .MuiAlert-icon': {
              fontSize: '24px'
            }
          }}
        >
          <AlertTitle sx={{ fontWeight: 700 }}>
            This action will permanently skip this file
          </AlertTitle>
          Skip processing will remove any existing symlinks and prevent future automatic processing.
        </Alert>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            File to be skipped:
          </Typography>
          <Typography 
            variant="body2" 
            sx={{
              fontFamily: 'monospace',
              backgroundColor: theme.palette.mode === 'dark'
                ? theme.palette.action.hover
                : '#f5f5f5',
              padding: 1.5,
              borderRadius: 1,
              wordBreak: 'break-all',
              border: theme.palette.mode === 'dark'
                ? `1px solid ${theme.palette.divider}`
                : '1px solid #e0e0e0'
            }}
          >
            {getFileName(filePath)}
          </Typography>
        </Box>

        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 2,
          p: 2,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(244, 67, 54, 0.05)'
            : 'rgba(244, 67, 54, 0.03)',
          borderRadius: 2,
          border: theme.palette.mode === 'dark'
            ? `1px solid ${theme.palette.error.main}20`
            : '1px solid rgba(244, 67, 54, 0.2)'
        }}>
          <Typography variant="subtitle2" fontWeight={600} color="error.main">
            ⚠️ What will happen:
          </Typography>
          
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <DeleteSweepIcon sx={{ color: 'error.main', mt: 0.2, fontSize: '20px' }} />
            <Box>
              <Typography variant="body2" fontWeight={600}>
                Remove existing symlinks and directories
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Any current symlinks will be deleted, including empty parent directories
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <BlockIcon sx={{ color: 'error.main', mt: 0.2, fontSize: '20px' }} />
            <Box>
              <Typography variant="body2" fontWeight={600}>
                Block future automatic processing
              </Typography>
              <Typography variant="caption" color="text.secondary">
                This file will be marked as skipped and won't be processed automatically
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <WarningIcon sx={{ color: 'warning.main', mt: 0.2, fontSize: '20px' }} />
            <Box>
              <Typography variant="body2" fontWeight={600}>
                Force mode required to re-enable
              </Typography>
              <Typography variant="caption" color="text.secondary">
                You'll need to use "Force Recreate Symlinks" to process this file again
              </Typography>
            </Box>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          p: 3,
          pt: 2,
          gap: 1,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(0, 0, 0, 0.3)'
            : 'rgba(255, 255, 255, 0.98)',
          borderTop: theme.palette.mode === 'dark'
            ? `1px solid ${theme.palette.divider}`
            : '1px solid #e0e0e0',
        }}
      >
        <Button
          onClick={onCancel}
          variant="outlined"
          sx={{
            borderRadius: 2,
            px: 3,
            fontWeight: 600
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color="warning"
          startIcon={<BlockIcon />}
          sx={{
            borderRadius: 2,
            px: 3,
            fontWeight: 700,
            background: 'linear-gradient(45deg, #ff9800 30%, #f57c00 90%)',
            '&:hover': {
              background: 'linear-gradient(45deg, #f57c00 30%, #ef6c00 90%)',
            }
          }}
        >
          Skip This File
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SkipConfirmationDialog;
