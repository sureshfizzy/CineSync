import React from 'react';
import { Refresh as RefreshIcon, DeleteSweep as DeleteSweepIcon, Link as LinkIcon, Warning as WarningIcon } from '@mui/icons-material';
import BaseConfirmationDialog from './BaseConfirmationDialog';

interface ForceConfirmationDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  filePath?: string;
  bulkFilePaths?: string[];
  isBulkMode?: boolean;
}

const ForceConfirmationDialog: React.FC<ForceConfirmationDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  filePath,
  bulkFilePaths,
  isBulkMode = false
}) => {
  const fileCount = isBulkMode && bulkFilePaths ? bulkFilePaths.length : 1;
  const isPlural = fileCount > 1;

  const actions = [
    {
      icon: <DeleteSweepIcon />,
      title: 'Remove existing symlinks',
      description: isPlural
        ? `Any current symlinks for all ${fileCount} files will be deleted`
        : 'Any current symlinks for this file will be deleted',
      color: 'warning.main'
    },
    {
      icon: <LinkIcon />,
      title: 'Create new symlinks',
      description: isPlural
        ? `Fresh symlinks will be created for all ${fileCount} files with updated metadata and organization`
        : 'Fresh symlinks will be created with updated metadata and organization',
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
      title={isBulkMode ? `Force Recreate Symlinks for ${fileCount} Files` : "Force Recreate Symlinks"}
      titleIcon={<RefreshIcon sx={{ color: 'primary.main', fontSize: '28px' }} />}
      alertSeverity="info"
      alertIcon={<RefreshIcon />}
      alertTitle={isBulkMode
        ? `This will recreate symlinks for ${fileCount} files`
        : "This will recreate symlinks for this file"
      }
      alertDescription={isBulkMode
        ? `Force recreate will remove existing symlinks and create new ones for all ${fileCount} files, even if they already exist.`
        : "Force recreate will remove existing symlinks and create new ones, even if they already exist."
      }
      actions={actions}
      confirmButtonText={isBulkMode ? `Force Recreate Symlinks for ${fileCount} Files` : "Force Recreate Symlinks"}
      confirmButtonColor="primary"
    />
  );
};

export default ForceConfirmationDialog;
