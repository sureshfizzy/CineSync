import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, List, ListItem, ListItemIcon, ListItemText, IconButton, useTheme, CircularProgress, Chip, Divider } from '@mui/material';
import { Close as CloseIcon, Folder as FolderIcon, DriveFileMove as MoveIcon } from '@mui/icons-material';

interface AvailableFolder {
  path: string;
  displayName: string;
  fileCount: number;
}

interface MoveFileDialogProps {
  open: boolean;
  onClose: () => void;
  onMove: (targetPath: string) => void;
  fileName: string;
  loading?: boolean;
}

const MoveFileDialog: React.FC<MoveFileDialogProps> = ({
  open,
  onClose,
  onMove,
  fileName,
  loading = false
}) => {
  const theme = useTheme();
  const [selectedPath, setSelectedPath] = useState('');
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [fetchLoading, setFetchLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchAvailableFolders();
      setSelectedPath('');
    }
  }, [open]);

  const fetchAvailableFolders = async () => {
    setFetchLoading(true);
    try {
      const response = await fetch('/api/spoofing/folders/available');
      if (response.ok) {
        const folders = await response.json();
        setAvailableFolders(folders || []);
      } else {
        console.error('Failed to fetch available folders');
        setAvailableFolders([]);
      }
    } catch (error) {
      console.error('Error fetching available folders:', error);
      setAvailableFolders([]);
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSelectFolder = (folder: AvailableFolder) => {
    setSelectedPath(folder.path);
  };

  const handleMove = () => {
    if (selectedPath) {
      onMove(selectedPath);
    }
  };

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
        py: 2
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <MoveIcon color="primary" />
          <Box>
            <Typography variant="h6">Move File</Typography>
            <Typography variant="body2" color="text.secondary">
              Moving: <Chip label={fileName} size="small" color="primary" />
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select destination base folder:
          </Typography>
        </Box>

        <Box sx={{ height: 300, overflow: 'auto' }}>
          {fetchLoading ? (
            <Box sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              flexDirection: 'column',
              gap: 2
            }}>
              <CircularProgress />
              <Typography variant="body2" color="text.secondary">
                Loading available folders...
              </Typography>
            </Box>
          ) : (
            <List sx={{ py: 0 }}>
              {availableFolders.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    No destination folders found
                  </Typography>
                </Box>
              ) : (
                availableFolders.map((folder, index) => (
                  <React.Fragment key={folder.path}>
                    <ListItem
                      sx={{
                        cursor: 'pointer',
                        bgcolor: selectedPath === folder.path ? theme.palette.action.selected : 'transparent',
                        '&:hover': {
                          bgcolor: theme.palette.action.hover
                        }
                      }}
                      onClick={() => handleSelectFolder(folder)}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <FolderIcon color={selectedPath === folder.path ? 'primary' : 'inherit'} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {folder.displayName}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {folder.path} • {folder.fileCount} files
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItem>
                    {index < availableFolders.length - 1 && <Divider />}
                  </React.Fragment>
                ))
              )}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleMove}
          disabled={!selectedPath || loading}
          startIcon={<MoveIcon />}
        >
          {loading ? 'Moving...' : 'Move File'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MoveFileDialog;
