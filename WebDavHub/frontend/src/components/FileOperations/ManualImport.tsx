import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, TextField, InputAdornment, IconButton, useTheme, CircularProgress } from '@mui/material';
import { Close as CloseIcon, Folder as FolderIcon, Person as PersonIcon } from '@mui/icons-material';
import FolderSelector from './FolderSelector';
import InteractiveImportDialog from './InteractiveImportDialog';

interface ManualImportProps {
  open: boolean;
  onClose: () => void;
}

const ManualImport: React.FC<ManualImportProps> = ({ open, onClose }) => {
  const theme = useTheme();
  const [selectedPath, setSelectedPath] = useState('');
  const [folderSelectorOpen, setFolderSelectorOpen] = useState(false);
  const [recentFolders, setRecentFolders] = useState<Array<{ path: string, timestamp: string }>>([]);
  const [processing] = useState(false);
  const [interactiveImportOpen, setInteractiveImportOpen] = useState(false);

  // Load recent folders from localStorage on component mount
  React.useEffect(() => {
    const stored = localStorage.getItem('manualImportRecentFolders');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setRecentFolders(parsed);
      } catch (error) {
      }
    }
  }, []);

  const saveRecentFolder = (path: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newEntry = { path, timestamp };

    setRecentFolders(prev => {
      const filtered = prev.filter(item => item.path !== path);
      const updated = [newEntry, ...filtered].slice(0, 5);
      localStorage.setItem('manualImportRecentFolders', JSON.stringify(updated));

      return updated;
    });
  };

  const handleFolderSelect = (path: string) => {
    setSelectedPath(path);
    setFolderSelectorOpen(false);
    saveRecentFolder(path);
  };

  const handleBrowseClick = () => {
    setFolderSelectorOpen(true);
  };

  const handleInteractiveImport = () => {
    if (!selectedPath) return;

    // Save to recent folders when starting import
    saveRecentFolder(selectedPath);

    // Open the interactive import dialog
    setInteractiveImportOpen(true);
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
            backgroundImage: 'none',
            boxShadow: theme.palette.mode === 'light'
              ? '0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.06)'
              : theme.shadows[24],
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
        pr: 1
      }}>
        <Typography
          variant="h6"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            mr: 1
          }}
        >
          Manual Import - Select Folder
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ flexShrink: 0 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{
        p: 3,
        bgcolor: theme.palette.background.paper,
        backgroundImage: 'none'
      }}>
        <Box sx={{ mb: 3 }}>
          <TextField
            fullWidth
            placeholder="Select a folder path..."
            value={selectedPath}
            onChange={(e) => setSelectedPath(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={handleBrowseClick} edge="end">
                      <FolderIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              }
            }}
          />
        </Box>

        {/* Action button - show when path is selected */}
        {selectedPath && (
          <Box sx={{ textAlign: 'center' }}>
            <Button
              variant="contained"
              startIcon={processing ? <CircularProgress size={16} /> : <PersonIcon />}
              size="large"
              sx={{ py: 1.5, px: 4 }}
              onClick={handleInteractiveImport}
              disabled={processing}
            >
              {processing ? 'Scanning...' : 'Start Interactive Import'}
            </Button>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              Review and manually select matches for each file
            </Typography>
          </Box>
        )}

        {/* Recent folders section */}
        {recentFolders.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
              Recent Folders
            </Typography>

            {recentFolders.map((folder, index) => (
              <Box
                key={index}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  p: 2,
                  mb: 1,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: theme.palette.action.hover }
                }}
                onClick={() => setSelectedPath(folder.path)}
              >
                <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, mr: 2 }}>
                  {folder.path}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {folder.timestamp}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{
        p: 2,
        borderTop: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.paper,
        backgroundImage: 'none'
      }}>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>

      <FolderSelector
        open={folderSelectorOpen}
        onClose={() => setFolderSelectorOpen(false)}
        onSelect={handleFolderSelect}
      />

      <InteractiveImportDialog
        open={interactiveImportOpen}
        onClose={() => setInteractiveImportOpen(false)}
        folderPath={selectedPath}
      />
    </Dialog>
  );
};

export default ManualImport;