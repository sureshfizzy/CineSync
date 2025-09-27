import React, { useState, useEffect } from 'react';
import { Box, Typography, Card, CardContent, List, ListItem, ListItemText, ListItemSecondaryAction, IconButton, Button, Alert, CircularProgress, Divider, Avatar, alpha, useTheme, Dialog, DialogTitle, DialogContent, DialogActions, Fade } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Folder as FolderIcon, ArrowBack as ArrowBackIcon, Storage as StorageIcon, Warning as WarningIcon } from '@mui/icons-material';
import FolderSelector from '../FileOperations/FolderSelector';

interface RootFolder {
  id: number;
  path: string;
  name?: string;
  isSystemManaged?: boolean;
}

interface RootFoldersManagementProps {
  onBack?: () => void;
}

export default function RootFoldersManagement({ onBack }: RootFoldersManagementProps) {
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
      const response = await fetch('/api/root-folders');
      
      if (!response.ok) {
        throw new Error(`Failed to fetch root folders: ${response.statusText}`);
      }
      
      const folders = await response.json();
      console.log('Fetched root folders:', folders);
      setRootFolders(folders || []);
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

  const handleAddFolder = async () => {
    if (!newFolderPath.trim()) {
      setError('Folder path is required');
      return;
    }

    try {
      setError('');

      console.log('Adding root folder:', newFolderPath.trim());
      const response = await fetch('/api/root-folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: newFolderPath.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to add root folder' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const newFolder = await response.json();
      setRootFolders(prev => [...prev, newFolder]);
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

      const response = await fetch(`/api/root-folders/${folderToDelete.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Failed to delete root folder' }));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Remove the folder from the list
      setRootFolders(prev => prev.filter(folder => folder.id !== folderToDelete.id));
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
    setNewFolderPath(path);
    setFolderSelectorOpen(false);
    // Automatically add the folder after selection
    handleAddFolder();
  };

  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: 400,
        gap: 2
      }}>
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          Loading root folders...
        </Typography>
      </Box>
    );
  }

  return (
           <Box sx={{
             minHeight: '100vh',
             background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
             p: { xs: 2, sm: 2, md: 3 }
           }}>
             <Box sx={{ maxWidth: 1000, mx: 'auto' }}>
        {/* Header Section */}
        <Box sx={{ 
          mb: { xs: 2, sm: 3 },
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 2, sm: 2 }
        }}>
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: { xs: 1.5, sm: 2 },
            width: { xs: '100%', sm: 'auto' }
          }}>
            {onBack && (
              <IconButton 
                onClick={onBack} 
                sx={{ 
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.2)
                  },
                  minWidth: { xs: 40, sm: 44 },
                  minHeight: { xs: 40, sm: 44 }
                }}
              >
                <ArrowBackIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />
              </IconButton>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h5" fontWeight={600} sx={{ 
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mb: 0.5,
                fontSize: { xs: '1.25rem', sm: '1.5rem' }
              }}>
                Media Management
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{
                fontSize: { xs: '0.75rem', sm: '0.875rem' }
              }}>
                Configure your media storage locations
              </Typography>
            </Box>
          </Box>
          
          <Button
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />}
            onClick={handleAddFolderClick}
            sx={{ 
              borderRadius: 3,
              px: { xs: 2, sm: 3 },
              py: { xs: 1, sm: 1.5 },
              fontSize: { xs: '0.875rem', sm: '0.95rem' },
              fontWeight: 600,
              boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
              '&:hover': {
                boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.4)}`,
                transform: 'translateY(-2px)'
              },
              transition: 'all 0.3s ease',
              width: { xs: '100%', sm: 'auto' },
              minHeight: { xs: 44, sm: 48 }
            }}
          >
            Add Root Folder
          </Button>
        </Box>

        {/* Error Alert */}
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 3,
              borderRadius: 2,
              '& .MuiAlert-message': {
                width: '100%'
              }
            }} 
            onClose={() => setError('')}
          >
            {error}
          </Alert>
        )}

               {/* Stats Card */}
               <Card sx={{
                 mb: { xs: 2, sm: 3 },
                 background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
                 border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                 borderRadius: 2
               }}>
                 <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
                   <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
                     <Avatar sx={{
                       width: { xs: 28, sm: 32 },
                       height: { xs: 28, sm: 32 },
                       bgcolor: alpha(theme.palette.primary.main, 0.2),
                       color: theme.palette.primary.main
                     }}>
                       <StorageIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                     </Avatar>
                     <Box>
                       <Typography variant="h5" fontWeight={600} color="primary" sx={{
                         fontSize: { xs: '1.25rem', sm: '1.5rem' }
                       }}>
                         {rootFolders.length}
                       </Typography>
                       <Typography variant="body2" color="text.secondary" sx={{
                         fontSize: { xs: '0.75rem', sm: '0.875rem' }
                       }}>
                         Root Folders
                       </Typography>
                     </Box>
                   </Box>
                 </CardContent>
               </Card>

        {/* Root Folders List */}
        <Card sx={{ 
          borderRadius: 3,
          boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`
        }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ 
              p: 3, 
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ 
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main
                }}>
                  <FolderIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    Storage Locations
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Manage your media storage directories
                  </Typography>
                </Box>
              </Box>
            </Box>

            {rootFolders.length === 0 ? (
              <Box sx={{ 
                p: 6, 
                textAlign: 'center',
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(135deg, ${alpha(theme.palette.grey[800], 0.3)} 0%, ${alpha(theme.palette.grey[700], 0.2)} 100%)`
                  : `linear-gradient(135deg, ${alpha(theme.palette.grey[50], 0.5)} 0%, ${alpha(theme.palette.grey[100], 0.3)} 100%)`
              }}>
                <Avatar sx={{ 
                  width: 80, 
                  height: 80, 
                  mx: 'auto', 
                  mb: 3,
                  bgcolor: theme.palette.mode === 'dark'
                    ? alpha(theme.palette.grey[600], 0.3)
                    : alpha(theme.palette.grey[400], 0.2),
                  color: theme.palette.mode === 'dark'
                    ? theme.palette.grey[300]
                    : theme.palette.grey[600]
                }}>
                  <FolderIcon sx={{ fontSize: 40 }} />
                </Avatar>
                <Typography variant="h5" fontWeight={600} color="text.primary" gutterBottom>
                  No Root Folders Configured
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
                  Root folders define where your media files are stored. Add your first root folder to start organizing your media library.
                </Typography>
                       <Button
                         variant="contained"
                         size="large"
                         startIcon={<AddIcon />}
                         onClick={handleAddFolderClick}
                         sx={{
                           borderRadius: 3,
                           px: 4,
                           py: 1.5,
                           fontSize: '1rem',
                           fontWeight: 600,
                           boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                           '&:hover': {
                             boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.4)}`,
                             transform: 'translateY(-2px)'
                           },
                           transition: 'all 0.3s ease'
                         }}
                       >
                         Add Your First Root Folder
                       </Button>
              </Box>
            ) : (
              <List sx={{ p: 0 }}>
                {rootFolders.map((folder, index) => (
                  <React.Fragment key={folder.id}>
                           <ListItem
                             sx={{
                               p: { xs: 1.5, sm: 2 },
                               '&:hover': {
                                 bgcolor: alpha(theme.palette.primary.main, 0.02),
                                 '& .folder-actions': {
                                   opacity: 1
                                 }
                               },
                               transition: 'all 0.2s ease'
                             }}
                           >
                             <Avatar sx={{
                               mr: { xs: 1.5, sm: 2 },
                               width: { xs: 28, sm: 32 },
                               height: { xs: 28, sm: 32 },
                               bgcolor: folder.isSystemManaged 
                                 ? alpha(theme.palette.info.main, 0.1)
                                 : alpha(theme.palette.primary.main, 0.1),
                               color: folder.isSystemManaged 
                                 ? theme.palette.info.main
                                 : theme.palette.primary.main
                             }}>
                               <FolderIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                             </Avatar>
                             <ListItemText
                               primary={
                                 <Typography variant="body1" fontWeight={500} sx={{ 
                                   mb: 0.5,
                                   fontSize: { xs: '0.875rem', sm: '1rem' },
                                   wordBreak: 'break-word'
                                 }}>
                                   {folder.path}
                                 </Typography>
                               }
                               secondary={
                                 <Typography variant="caption" color="text.secondary" display="block" sx={{
                                   fontSize: { xs: '0.7rem', sm: '0.75rem' }
                                 }}>
                                   {folder.isSystemManaged 
                                     ? 'System-managed root folder' 
                                     : 'Manually added root folder'}
                                 </Typography>
                               }
                             />
                             <ListItemSecondaryAction>
                               {!folder.isSystemManaged && (
                                 <IconButton
                                   onClick={() => handleDeleteFolder(folder)}
                                   sx={{
                                     bgcolor: alpha(theme.palette.error.main, 0.1),
                                     color: theme.palette.error.main,
                                     '&:hover': {
                                       bgcolor: alpha(theme.palette.error.main, 0.2)
                                     },
                                     minWidth: { xs: 36, sm: 40 },
                                     minHeight: { xs: 36, sm: 40 }
                                   }}
                                 >
                                   <DeleteIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />
                                 </IconButton>
                               )}
                             </ListItemSecondaryAction>
                    </ListItem>
                    {index < rootFolders.length - 1 && (
                      <Divider sx={{ 
                        mx: { xs: 2, sm: 3 },
                        borderColor: alpha(theme.palette.divider, 0.1)
                      }} />
                    )}
                  </React.Fragment>
                ))}
              </List>
            )}
          </CardContent>
        </Card>


        {/* Folder Selector Dialog */}
        <FolderSelector
          open={folderSelectorOpen}
          onClose={() => setFolderSelectorOpen(false)}
          onSelect={handleFolderSelect}
        />

        {/* Cool Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialogOpen}
          onClose={cancelDelete}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              borderRadius: 3,
              boxShadow: theme.palette.mode === 'dark' 
                ? `0 20px 60px ${alpha(theme.palette.common.black, 0.4)}`
                : `0 20px 60px ${alpha(theme.palette.common.black, 0.25)}`,
              background: theme.palette.mode === 'dark'
                ? `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.15)} 0%, ${theme.palette.background.paper} 100%)`
                : theme.palette.background.paper,
              border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
              overflow: 'hidden',
              backdropFilter: 'blur(10px)'
            }
          }}
        >
          <Fade in={deleteDialogOpen} timeout={300}>
            <Box>
              <DialogTitle sx={{ 
                pb: 2,
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(90deg, ${alpha(theme.palette.error.main, 0.2)} 0%, ${alpha(theme.palette.error.main, 0.05)} 100%)`
                  : alpha(theme.palette.error.main, 0.1),
                borderBottom: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                p: 3
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ 
                    bgcolor: theme.palette.mode === 'dark' 
                      ? alpha(theme.palette.error.main, 0.25)
                      : alpha(theme.palette.error.main, 0.2),
                    color: theme.palette.error.main,
                    width: 48,
                    height: 48,
                    border: theme.palette.mode === 'light' ? `1px solid ${alpha(theme.palette.error.main, 0.2)}` : 'none'
                  }}>
                    <WarningIcon sx={{ fontSize: 24 }} />
                  </Avatar>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="error">
                      Delete Root Folder
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      This action cannot be undone
                    </Typography>
                  </Box>
                </Box>
              </DialogTitle>
              
              <DialogContent sx={{ p: 3 }}>
                <Box sx={{ 
                  p: 2, 
                  bgcolor: theme.palette.mode === 'dark' 
                    ? alpha(theme.palette.error.main, 0.12)
                    : alpha(theme.palette.error.main, 0.15),
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                  mb: 2
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <FolderIcon sx={{ color: theme.palette.error.main, fontSize: 20 }} />
                    <Typography variant="body2" fontWeight={500} color="error">
                      Folder to be deleted:
                    </Typography>
                  </Box>
                  <Typography variant="body1" sx={{ 
                    fontFamily: 'monospace',
                    bgcolor: theme.palette.mode === 'dark' 
                      ? theme.palette.background.paper 
                      : theme.palette.grey[50],
                    p: 1,
                    borderRadius: 1,
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    wordBreak: 'break-all',
                    color: theme.palette.text.primary,
                    fontWeight: 500
                  }}>
                    {folderToDelete?.path}
                  </Typography>
                </Box>
                
                <Alert 
                  severity="warning" 
                  sx={{ 
                    borderRadius: 2,
                    '& .MuiAlert-icon': {
                      fontSize: 20
                    }
                  }}
                >
                  <Typography variant="body2">
                    <strong>Warning:</strong> Deleting this root folder will remove it from your media management configuration. 
                    Any library items associated with this folder may need to be reconfigured.
                  </Typography>
                </Alert>
              </DialogContent>
              
              <DialogActions sx={{ 
                p: 3, 
                gap: 2,
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(90deg, ${alpha(theme.palette.error.main, 0.05)} 0%, ${alpha(theme.palette.error.main, 0.1)} 100%)`
                  : alpha(theme.palette.error.main, 0.05),
                borderTop: `1px solid ${alpha(theme.palette.error.main, 0.3)}`
              }}>
                <Button 
                  onClick={cancelDelete}
                  disabled={deleting}
                  sx={{ 
                    borderRadius: 2,
                    px: 3,
                    py: 1,
                    fontWeight: 500,
                    minWidth: 100
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDeleteFolder}
                  variant="contained"
                  color="error"
                  disabled={deleting}
                  startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
                  sx={{
                    borderRadius: 2,
                    px: 3,
                    py: 1,
                    fontWeight: 600,
                    minWidth: 120,
                    boxShadow: `0 4px 20px ${alpha(theme.palette.error.main, 0.3)}`,
                    '&:hover': {
                      boxShadow: `0 6px 25px ${alpha(theme.palette.error.main, 0.4)}`,
                      transform: 'translateY(-1px)'
                    },
                    transition: 'all 0.2s ease'
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete Folder'}
                </Button>
              </DialogActions>
            </Box>
          </Fade>
        </Dialog>

      </Box>
    </Box>
  );
}
