import React from 'react';
import { DialogTitle, DialogContent, DialogActions, Typography, Box, Alert, AlertTitle, useTheme, IconButton, Divider } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { ConfirmationDialog, ConfirmationActionButton } from './StyledComponents';

interface ActionItem {
  icon: React.ReactNode;
  title: string;
  description: string;
  color?: string;
}

interface BaseConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  filePath?: string;
  title: string;
  titleIcon: React.ReactNode;
  alertSeverity: 'info' | 'warning' | 'error' | 'success';
  alertIcon: React.ReactNode;
  alertTitle: string;
  alertDescription: string;
  actions: ActionItem[];
  confirmButtonText: string;
  confirmButtonColor?: 'primary' | 'warning' | 'error';
  confirmButtonGradient?: string;
  titleGradient?: string;
  contentBackground?: string;
}

const BaseConfirmationDialog: React.FC<BaseConfirmationDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  filePath,
  title,
  titleIcon,
  alertSeverity,
  alertIcon,
  alertTitle,
  alertDescription,
  actions,
  confirmButtonText,
  confirmButtonColor = 'primary',
  confirmButtonGradient,
  titleGradient,
  contentBackground
}) => {
  const theme = useTheme();

  const getFileName = (path?: string) => {
    if (!path) return 'file';
    return path.split(/[/\\]/).pop() || path;
  };

  const defaultTitleGradient = theme.palette.mode === 'dark'
    ? 'linear-gradient(135deg, rgba(100, 181, 246, 0.1) 0%, rgba(63, 81, 181, 0.1) 100%)'
    : 'linear-gradient(135deg, rgba(100, 181, 246, 0.05) 0%, rgba(63, 81, 181, 0.05) 100%)';

  const defaultContentBackground = theme.palette.mode === 'dark'
    ? 'rgba(0, 0, 0, 0.2)'
    : 'rgba(255, 255, 255, 0.95)';

  const defaultConfirmGradient = confirmButtonColor === 'warning'
    ? 'linear-gradient(45deg, #ff9800 30%, #f57c00 90%)'
    : 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)';

  return (
    <ConfirmationDialog
      open={open}
      onClose={onCancel}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 2,
          background: titleGradient || defaultTitleGradient,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {titleIcon}
          <Typography variant="h6" fontWeight={700}>
            {title}
          </Typography>
        </Box>
        <IconButton
          onClick={onCancel}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent
        sx={{
          pt: 3,
          backgroundColor: contentBackground || defaultContentBackground,
        }}
      >
        <Alert
          severity={alertSeverity}
          icon={alertIcon}
          sx={{
            mb: 3,
            '& .MuiAlert-icon': {
              fontSize: '24px'
            }
          }}
        >
          <AlertTitle sx={{ fontWeight: 700 }}>
            {alertTitle}
          </AlertTitle>
          {alertDescription}
        </Alert>

        <Box sx={{
          p: 2,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(255, 255, 255, 0.02)'
            : 'rgba(0, 0, 0, 0.02)',
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`,
          mb: 3
        }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            📁 Target File:
          </Typography>
          <Typography
            variant="body2"
            sx={{
              fontFamily: 'monospace',
              backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '8px 12px',
              borderRadius: '8px',
              wordBreak: 'break-all',
              border: `1px solid ${theme.palette.divider}`,
            }}
          >
            {getFileName(filePath)}
          </Typography>
        </Box>

        <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 2 }}>
          What will happen:
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {actions.map((action, index) => (
            <React.Fragment key={index}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Box sx={{ color: action.color || 'primary.main', mt: 0.2, fontSize: '20px' }}>
                  {action.icon}
                </Box>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {action.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {action.description}
                  </Typography>
                </Box>
              </Box>
              {index < actions.length - 1 && index === Math.floor(actions.length / 2) && (
                <Divider sx={{ my: 1 }} />
              )}
            </React.Fragment>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, gap: 2 }}>
        <ConfirmationActionButton
          onClick={onCancel}
          variant="outlined"
          sx={{
            borderColor: 'divider',
            color: 'text.secondary',
            '&:hover': {
              borderColor: 'text.secondary',
              backgroundColor: 'action.hover',
            },
          }}
        >
          Cancel
        </ConfirmationActionButton>
        <ConfirmationActionButton
          onClick={onConfirm}
          variant="contained"
          sx={{
            background: confirmButtonGradient || defaultConfirmGradient,
            color: 'white',
            '&:hover': {
              background: confirmButtonColor === 'warning'
                ? 'linear-gradient(45deg, #f57c00 30%, #ef6c00 90%)'
                : 'linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)',
            },
          }}
        >
          {confirmButtonText}
        </ConfirmationActionButton>
      </DialogActions>
    </ConfirmationDialog>
  );
};

export default BaseConfirmationDialog;
