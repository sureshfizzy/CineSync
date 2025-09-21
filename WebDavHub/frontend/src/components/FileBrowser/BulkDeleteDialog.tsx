import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, useTheme, Alert, Chip, List, ListItem, ListItemIcon, ListItemText, IconButton } from '@mui/material';
import { Close as CloseIcon, Delete as DeleteIcon, Warning as WarningIcon, Folder as FolderIcon, InsertDriveFile as FileIcon } from '@mui/icons-material';
import { FileItem } from './types';

interface BulkDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
  selectedItems: FileItem[];
  loading?: boolean;
}

const BulkDeleteDialog: React.FC<BulkDeleteDialogProps> = ({
  open,
  onClose,
  onDelete,
  selectedItems,
  loading = false
}) => {
  const theme = useTheme();

  const filesCount = selectedItems.filter(item => item.type === 'file').length;
  const foldersCount = selectedItems.filter(item => item.type === 'directory').length;

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
        bgcolor: '#FF0000',
        color: '#FFFFFF',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <DeleteIcon />
          <Box>
            <Typography variant="h6">Delete Selected Items</Typography>
            <Typography variant="body2" sx={{ opacity: 0.9 }}>
              This action cannot be undone
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: 'inherit' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 3 }}>
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
              Permanent Deletion
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You are about to permanently delete {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''}. 
              This action cannot be undone and the files will be moved to trash.
            </Typography>
          </Alert>

          <Box sx={{ 
            bgcolor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50], 
            borderRadius: 2, 
            p: 2,
            border: `1px solid ${theme.palette.divider}`,
            mb: 2
          }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Items to be deleted:
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
              {filesCount > 0 && (
                <Chip 
                  icon={<FileIcon />}
                  label={`${filesCount} file${filesCount !== 1 ? 's' : ''}`} 
                  size="small" 
                  color="primary" 
                  variant="outlined"
                />
              )}
              {foldersCount > 0 && (
                <Chip 
                  icon={<FolderIcon />}
                  label={`${foldersCount} folder${foldersCount !== 1 ? 's' : ''}`} 
                  size="small" 
                  color="secondary" 
                  variant="outlined"
                />
              )}
            </Box>

            <Box sx={{ maxHeight: 200, overflow: 'auto' }}>
              <List dense sx={{ py: 0 }}>
                {selectedItems.slice(0, 10).map((item, index) => (
                  <ListItem key={index} sx={{ py: 0.5, px: 0 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {item.type === 'directory' ? <FolderIcon fontSize="small" /> : <FileIcon fontSize="small" />}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {item.name}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {item.type === 'directory' ? 'Folder' : 'File'}
                          {item.size && ` • ${item.size}`}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
                {selectedItems.length > 10 && (
                  <ListItem sx={{ py: 0.5, px: 0 }}>
                    <ListItemText
                      primary={
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          ... and {selectedItems.length - 10} more item{selectedItems.length - 10 !== 1 ? 's' : ''}
                        </Typography>
                      }
                    />
                  </ListItem>
                )}
              </List>
            </Box>
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
          disabled={loading}
          sx={{ minWidth: 80 }}
        >
          Cancel
        </Button>
        
        <Button
          variant="contained"
          onClick={onDelete}
          disabled={loading}
          startIcon={<DeleteIcon />}
          sx={{ 
            minWidth: 120,
            bgcolor: '#FF0000',
            color: '#FFFFFF',
            '&:hover': {
              bgcolor: '#CC0000',
            },
            '&:disabled': {
              bgcolor: '#666666',
              color: '#CCCCCC',
            }
          }}
        >
          {loading ? 'Deleting...' : `Delete ${selectedItems.length} Item${selectedItems.length !== 1 ? 's' : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default BulkDeleteDialog;
