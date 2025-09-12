import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, List, ListItem, ListItemIcon, ListItemText, IconButton, useTheme, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Folder as FolderIcon } from '@mui/icons-material';
import axios from 'axios';

interface FolderItem {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface FolderSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({
  open,
  onClose,
  onSelect
}) => {
  const theme = useTheme();
  const [currentPath, setCurrentPath] = useState('');
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchFolders('');
    }
  }, [open]);

  const fetchFolders = async (path: string) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/browse', {
        params: path ? { path } : {}
      });

      const responseData = response.data;

      // Handle drives (Windows root level) - only when no path is specified
      if (!path && responseData.drives && responseData.drives.length > 0) {
        const driveItems: FolderItem[] = responseData.drives.map((drive: string) => ({
          name: `${drive}\\`,
          path: `${drive}\\`,
          isDirectory: true
        }));
        setFolders(driveItems);
        setCurrentPath('');
      } else {
        const folderData: FolderItem[] = (responseData.items || [])
          .filter((item: any) => item.isDirectory)
          .map((item: any) => ({
            name: item.name,
            path: item.path,
            isDirectory: item.isDirectory
          }));

        setFolders(folderData);
        setCurrentPath(responseData.currentPath || path);
      }
    } catch (error) {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFolderClick = (folder: FolderItem) => {
    fetchFolders(folder.path);
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: '70vh',
            bgcolor: theme.palette.background.paper,
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
        <Typography variant="h6">File Browser</Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="body2" color="text.secondary">
            Current Path: {currentPath || 'Root'}
          </Typography>
          {currentPath && (
            <Button
              size="small"
              onClick={() => fetchFolders('')}
              sx={{ mt: 1 }}
            >
              ← Back to Root
            </Button>
          )}
        </Box>

        <Box sx={{ height: 400, overflow: 'auto' }}>
          {loading ? (
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
                Loading...
              </Typography>
            </Box>
          ) : (
            <List sx={{ py: 0 }}>
              <ListItem sx={{ borderBottom: `1px solid ${theme.palette.divider}`, py: 1 }}>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 60 }}>
                        Type
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Name
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>

              {/* Parent directory navigation */}
              {currentPath && (
                <ListItem
                  sx={{
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    py: 1,
                    cursor: 'pointer',
                    bgcolor: theme.palette.action.selected,
                    '&:hover': {
                      bgcolor: theme.palette.action.hover
                    }
                  }}
                  onClick={() => {
                    // Handle Windows path navigation
                    const pathParts = currentPath.split(/[/\\]/).filter(Boolean);
                    if (pathParts.length <= 1) {
                      // Go back to drives view
                      fetchFolders('');
                    } else {
                      // Go to parent directory
                      const parentPath = pathParts.slice(0, -1).join('\\') + '\\';
                      fetchFolders(parentPath);
                    }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <FolderIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary=".. (Parent Directory)"
                    slotProps={{
                      primary: {
                        variant: 'body2',
                        fontStyle: 'italic'
                      }
                    }}
                  />
                </ListItem>
              )}

              {folders.map((folder) => (
                <ListItem
                  key={folder.path}
                  sx={{
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    py: 1,
                    cursor: 'pointer',
                    '&:hover': {
                      bgcolor: theme.palette.action.hover
                    }
                  }}
                  onClick={() => handleFolderClick(folder)}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <FolderIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={folder.name}
                    slotProps={{
                      primary: {
                        variant: 'body2'
                      }
                    }}
                  />
                </ListItem>
              ))}

              {folders.length === 0 && !loading && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    No folders found
                  </Typography>
                </Box>
              )}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSelect}
          disabled={!currentPath || currentPath === ''}
        >
          Select Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderSelector;