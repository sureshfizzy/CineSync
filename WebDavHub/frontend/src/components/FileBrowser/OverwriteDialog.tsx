import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, IconButton, useTheme, Alert, Chip } from '@mui/material';
import { Close as CloseIcon, Warning as WarningIcon, DriveFileMove as MoveIcon, DeleteOutline as DeleteIcon } from '@mui/icons-material';

interface OverwriteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (applyToAll?: boolean) => void;
  fileName: string;
  targetPath: string;
  errorMessage?: string;
  hideFileName?: boolean;
}

const OverwriteDialog: React.FC<OverwriteDialogProps> = ({
  open,
  onClose,
  onConfirm,
  fileName,
  targetPath,
  errorMessage,
  hideFileName = false
}) => {
  const theme = useTheme();

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
        bgcolor: theme.palette.warning.main,
        color: '#FFFFFF',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <WarningIcon />
          <Box>
            <Typography variant="h6">Confirm Overwrite</Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              This action cannot be undone
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        <Alert 
          severity="warning" 
          icon={<WarningIcon />}
          sx={{ 
            mb: 3,
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
            Warning: Overwriting Existing Directory
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {hideFileName ? (
              <>
                The destination already contains items with the same names. Overwriting will delete the
                existing items and replace them with the selected ones.
              </>
            ) : (
              <>
                The destination folder already contains a directory named <strong>{fileName}</strong>. 
                Overwriting will permanently delete the existing directory and replace it with the source directory.
              </>
            )}
          </Typography>
        </Alert>

        {errorMessage && (
          <Alert 
            severity="error"
            sx={{ mb: 3, borderRadius: 2 }}
          >
            {errorMessage}
          </Alert>
        )}


        <Box sx={{ 
          bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50], 
          borderRadius: 2, 
          p: 2,
          border: `1px solid ${theme.palette.divider}`
        }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Source (will be moved):
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <MoveIcon color="primary" fontSize="small" />
            {hideFileName ? (
              <Chip 
                label="Selected items"
                size="small"
                color="primary"
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            ) : (
              <Chip 
                label={fileName} 
                size="small" 
                color="primary" 
                variant="outlined"
                sx={{ fontWeight: 500 }}
              />
            )}
          </Box>
          
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Destination (will be replaced):
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DeleteIcon color="error" fontSize="small" />
            <Typography variant="body2" sx={{ 
              fontFamily: 'monospace',
              bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[100],
              color: theme.palette.mode === 'dark' ? theme.palette.grey[300] : theme.palette.grey[800],
              p: 1,
              borderRadius: 1,
              fontSize: '0.875rem',
              flex: 1
            }}>
              {hideFileName ? `${targetPath}/(multiple items)` : `${targetPath}/${fileName}`}
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
        <Button
          variant="contained"
          color="warning"
          onClick={() => onConfirm()}
          startIcon={<DeleteIcon />}
          sx={{ minWidth: 140 }}
        >
          Overwrite & Move
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OverwriteDialog;