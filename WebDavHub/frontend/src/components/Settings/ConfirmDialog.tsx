import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Box,
  IconButton,
  useTheme,
} from '@mui/material';
import { Close, Warning, Info, Error, CheckCircle } from '@mui/icons-material';
import LoadingButton from './LoadingButton';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'warning' | 'error' | 'info' | 'success';
  loading?: boolean;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}

const iconMap = {
  warning: Warning,
  error: Error,
  info: Info,
  success: CheckCircle,
};

const colorMap = {
  warning: 'warning.main',
  error: 'error.main',
  info: 'info.main',
  success: 'success.main',
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  type = 'warning',
  loading = false,
  maxWidth = 'sm',
}) => {
  const IconComponent = iconMap[type];
  const theme = useTheme();

  const handleConfirm = async () => {
    try {
      await onConfirm();
    } catch (error) {
      console.error('Error in confirm action:', error);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: theme.palette.mode === 'dark'
            ? '0 8px 32px rgba(0, 0, 0, 0.8)'
            : '0 8px 32px rgba(0, 0, 0, 0.12)',
          bgcolor: theme.palette.mode === 'dark'
            ? '#000000'
            : 'background.paper',
          border: theme.palette.mode === 'dark'
            ? '1px solid rgba(255, 255, 255, 0.12)'
            : 'none',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconComponent sx={{ color: colorMap[type], fontSize: 24 }} />
            <Typography variant="h6" component="div">
              {title}
            </Typography>
          </Box>
          <IconButton
            onClick={onClose}
            size="small"
            disabled={loading}
            sx={{ color: 'text.secondary' }}
          >
            <Close />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body1" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <LoadingButton
          onClick={onClose}
          variant="outlined"
          disabled={loading}
          color="inherit"
        >
          {cancelText}
        </LoadingButton>
        <LoadingButton
          onClick={handleConfirm}
          variant="contained"
          loading={loading}
          color={type === 'error' ? 'error' : 'primary'}
          loadingText="Processing..."
        >
          {confirmText}
        </LoadingButton>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
