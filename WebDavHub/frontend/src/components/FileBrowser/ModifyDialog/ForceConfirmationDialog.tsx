import React from 'react';
import { Refresh as RefreshIcon, DeleteSweep as DeleteSweepIcon, Link as LinkIcon, Warning as WarningIcon } from '@mui/icons-material';
import BaseConfirmationDialog from './BaseConfirmationDialog';

interface ForceConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  filePath?: string;
}

const ForceConfirmationDialog: React.FC<ForceConfirmationDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  filePath
}) => {
  const actions = [
    {
      icon: <DeleteSweepIcon />,
      title: 'Remove existing symlinks',
      description: 'Any current symlinks for this file will be deleted',
      color: 'warning.main'
    },
    {
      icon: <LinkIcon />,
      title: 'Create new symlinks',
      description: 'Fresh symlinks will be created with updated metadata and organization',
      color: 'primary.main'
    },
    {
      icon: <WarningIcon />,
      title: 'Safe operation',
      description: 'Original files remain untouched - only symlinks are recreated',
      color: 'info.main'
    }
  ];

  return (
    <BaseConfirmationDialog
      open={open}
      onConfirm={onConfirm}
      onCancel={onCancel}
      filePath={filePath}
      title="Force Recreate Symlinks"
      titleIcon={<RefreshIcon sx={{ color: 'primary.main', fontSize: '28px' }} />}
      alertSeverity="info"
      alertIcon={<RefreshIcon />}
      alertTitle="This will recreate symlinks for this file"
      alertDescription="Force recreate will remove existing symlinks and create new ones, even if they already exist."
      actions={actions}
      confirmButtonText="Force Recreate Symlinks"
      confirmButtonColor="primary"
    />
  );
};

export default ForceConfirmationDialog;
