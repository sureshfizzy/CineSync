import { useState, useEffect } from 'react';
import { Box, Typography, Card, CardContent, List, ListItem, IconButton, Button, Alert, CircularProgress, Avatar, alpha, useTheme, Dialog, DialogTitle, DialogContent, DialogActions, Stack, Tooltip } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Folder as FolderIcon, Warning as WarningIcon } from '@mui/icons-material';
import FolderSelector from '../FileOperations/FolderSelector';
import { getAuthHeaders } from '../../contexts/AuthContext';

interface RootFolder {
  id: number;
  path: string;
  name?: string;
  isSystemManaged?: boolean;
}

export default function RootFoldersManagement() {
  const theme = useTheme();
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [newFolderPath, setNewFolderPath] = useState('');
  const [folderSelectorOpen, setFolderSelectorOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<RootFolder | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch root folders from API
  const fetchRootFolders = async () => {
    try {
      setLoading(true);
      setError('');

      console.log('Fetching root folders from API...');
      const response = await fetch('/api/root-folders', { headers: getAuthHeaders() });

      if (!response.ok) {
        throw new Error(`Failed to fetch root folders: ${response.statusText}`);
      }

      const folders = await response.json();
      console.log('Fetched root folders:', folders);
      const normalizedFolders = Array.isArray(folders)
        ? folders
            .map((folder) => {
              const path = typeof folder.path === 'string' ? folder.path.trim() : '';
              const isSystemManaged = folder.isSystemManaged === true
                || folder.isSystemManaged === 'true'
                || folder.isSystemManaged === 1
                || folder.isSystemManaged === '1';
              return { ...folder, path, isSystemManaged };
            })
            .filter((folder) => folder.path)
        : [];
      setRootFolders(normalizedFolders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch root folders');
      console.error('Error fetching root folders:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRootFolders();
  }, []);

  const systemManagedCount = rootFolders.filter((folder) => folder.isSystemManaged).length;
  const customCount = rootFolders.length - systemManagedCount;

  const handleAddFolder = async (path?: string) => {
    const folderPath = path || newFolderPath;
    if (!folderPath.trim()) {
      setError('Folder path is required');
      return;
    }

    try {
      setError('');

      console.log('Adding root folder:', folderPath.trim());
      const response = await fetch('/api/root-folders', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          path: folderPath.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to add root folder' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const newFolder = await response.json();
      const normalizedNewFolder = {
        ...newFolder,
        path: typeof newFolder.path === 'string' ? newFolder.path.trim() : '',
        isSystemManaged: newFolder.isSystemManaged === true
          || newFolder.isSystemManaged === 'true'
          || newFolder.isSystemManaged === 1
          || newFolder.isSystemManaged === '1'
      };
      if (normalizedNewFolder.path) {
        setRootFolders((prev) => [...prev, normalizedNewFolder]);
      }
      setNewFolderPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add root folder');
    }
  };

  const handleDeleteFolder = (folder: RootFolder) => {
    setFolderToDelete(folder);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;

    try {
      setDeleting(true);
      setError('');

      const response = await fetch(`/api/root-folders?id=${folderToDelete.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to delete root folder' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Remove the folder from the list
      setRootFolders((prev) => prev.filter((folder) => folder.id !== folderToDelete.id));
      setDeleteDialogOpen(false);
      setFolderToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete root folder');
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setFolderToDelete(null);
  };

  const handleAddFolderClick = () => {
    setFolderSelectorOpen(true);
  };

  const handleFolderSelect = (path: string) => {
    setFolderSelectorOpen(false);
    // Automatically add the folder after selection
    handleAddFolder(path);
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 320,
          gap: 1.5
        }}
      >
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          Loading root folders...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ bgcolor: 'background.default', py: { xs: 1.5, sm: 2.5 } }}>
      <Box sx={{ maxWidth: 920, mx: 'auto', px: { xs: 1.5, sm: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ mb: 2, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Root Folders
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Manage the directories used for media storage
              </Typography>
            </Box>
          </Stack>

          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 18 }} />}
            onClick={handleAddFolderClick}
            sx={{ fontWeight: 600, borderRadius: 2, minHeight: 36 }}
          >
            Add Root Folder
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 1.5, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, color: 'text.secondary' }}>
          <Typography variant="caption">{rootFolders.length} total</Typography>
          <Typography variant="caption">•</Typography>
          <Typography variant="caption">{customCount} custom</Typography>
          <Typography variant="caption">•</Typography>
          <Typography variant="caption">{systemManagedCount} system</Typography>
        </Stack>

        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 0.5,
            ml: 0.5,
            fontWeight: 600,
            color: theme.palette.text.secondary
          }}
        >
          Storage Locations
        </Typography>
        <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <CardContent sx={{ p: 0 }}>
            {rootFolders.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Avatar sx={{ width: 48, height: 48, mx: 'auto', mb: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: theme.palette.primary.main }}>
                  <FolderIcon sx={{ fontSize: 24 }} />
                </Avatar>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  No root folders yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 420, mx: 'auto' }}>
                  Add a root folder to define where your media libraries are stored.
                </Typography>
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleAddFolderClick}>
                  Add Root Folder
                </Button>
              </Box>
            ) : (
              <List dense disablePadding>
                {rootFolders.map((folder, index) => (
                  <ListItem
                    key={folder.id}
                    divider={index < rootFolders.length - 1}
                    secondaryAction={
                      !folder.isSystemManaged ? (
                        <Tooltip title="Delete root folder">
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteFolder(folder)}
                            sx={{
                              bgcolor: alpha(theme.palette.error.main, 0.08),
                              color: theme.palette.error.main,
                              '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16) }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null
                    }
                    sx={{
                      py: 1,
                      pr: 6,
                      '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.25) },
                      transition: 'background-color 0.2s ease',
                      alignItems: 'flex-start'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%' }}>
                      <Avatar
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: folder.isSystemManaged ? alpha(theme.palette.info.main, 0.12) : alpha(theme.palette.primary.main, 0.12),
                          color: folder.isSystemManaged ? theme.palette.info.main : theme.palette.primary.main
                        }}
                      >
                        <FolderIcon sx={{ fontSize: 14 }} />
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        {folder.name && (
                          <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
                            {folder.name}
                          </Typography>
                        )}
                        <Typography
                          variant="body2"
                          sx={{
                            fontSize: '0.85rem',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                            wordBreak: 'break-all',
                            fontWeight: 500,
                            color: theme.palette.text.primary
                          }}
                        >
                          {folder.path}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            color: theme.palette.text.secondary,
                            fontWeight: 500
                          }}
                        >
                          {folder.isSystemManaged ? 'System-managed' : 'Custom'}
                        </Typography>
                      </Box>
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <FolderSelector open={folderSelectorOpen} onClose={() => setFolderSelectorOpen(false)} onSelect={handleFolderSelect} />

        <Dialog open={deleteDialogOpen} onClose={cancelDelete} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
            <WarningIcon color="warning" fontSize="small" />
            Delete Root Folder
          </DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This removes the folder from your media configuration.
            </Typography>
            <Box
              sx={{
                p: 1.5,
                bgcolor: theme.palette.mode === 'dark'
                  ? alpha(theme.palette.common.white, 0.08)
                  : alpha(theme.palette.common.black, 0.04),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  wordBreak: 'break-all',
                  fontWeight: 500
                }}
              >
                {folderToDelete?.path}
              </Typography>
            </Box>
            <Alert
              severity="warning"
              variant="outlined"
              sx={{
                mt: 2,
                bgcolor: alpha(theme.palette.warning.main, 0.08),
                borderColor: alpha(theme.palette.warning.main, 0.4),
                color: 'text.primary',
                '& .MuiAlert-icon': { color: theme.palette.warning.main }
              }}
            >
              Deleting this root folder does not remove any files from disk.
            </Alert>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={cancelDelete} disabled={deleting} sx={{ minWidth: 90 }}>
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteFolder}
              variant="contained"
              color="error"
              disabled={deleting}
              startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
              sx={{ minWidth: 130 }}
            >
              {deleting ? 'Deleting...' : 'Delete Folder'}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
}