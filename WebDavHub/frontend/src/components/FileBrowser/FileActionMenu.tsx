import React, { useState, lazy, Suspense } from 'react';
import { Menu, MenuItem, IconButton, Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, Box, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import axios from 'axios';
import { upsertFileDetail, deleteFileDetail } from './fileApi';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  path?: string;
  webdavPath?: string;
  sourcePath?: string;
  fullPath?: string;
}

interface FileActionMenuProps {
  file: FileItem;
  currentPath: string;
  onViewDetails: (file: FileItem, details: any) => void;
  onRename: (file: FileItem) => void;
  onError: (msg: string) => void;
  onDeleted?: () => void;
  variant?: 'menu' | 'buttons';
}

function joinPaths(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
}

const getMimeType = (ext: string): string => {
  const mimeTypes: { [key: string]: string } = {
    'mp4': 'video/mp4',
    'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'webm': 'video/webm',
  };
  return mimeTypes[ext] || '';
};

function getRelativePath(absPath: string): string {
  if (!absPath) return '';
  const norm = absPath.replace(/\\/g, '/');
  const homeMatch = norm.match(/([/\\]Home[/\\].*)$/i);
  if (homeMatch) {
    return homeMatch[1].replace(/^[/\\]+/, '');
  }
  return norm.replace(/^([A-Za-z]:)?[/\\]+/, '');
}

const VideoPlayerDialog = lazy(() => import('../VideoPlayer/VideoPlayerDialog'));

const FileActionMenu: React.FC<FileActionMenuProps> = ({ file, currentPath, onViewDetails, onRename, onError, onDeleted, variant = 'menu' }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const [videoPlayerOpen, setVideoPlayerOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoMimeType, setVideoMimeType] = useState<string | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleViewDetails = async () => {
    const normalizedPath = joinPaths(currentPath);
    const relPath = joinPaths(normalizedPath, file.name);
    let realPath = '';
    let absPath = '';
    try {
      const res = await axios.post('/api/readlink', { path: relPath });
      realPath = res.data.realPath || '';
      absPath = res.data.absPath || '';
    } catch (e) {
      realPath = '';
      absPath = '';
    }
    onViewDetails(file, { webdavPath: joinPaths('Home', normalizedPath, file.name), fullPath: absPath, sourcePath: realPath });
    handleMenuClose();
  };

  const handleOpen = async () => {
    if (file.type === 'directory') {
      handleMenuClose();
      return;
    }
    const relPath = joinPaths(currentPath, file.name).replace(/\/$/, '');
    const encodedPath = encodeURIComponent(relPath.replace(/^\/+/,''));
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext);
    try {
      if (isVideo) {
        const streamUrl = `/api/stream/${encodedPath}`;
        setVideoUrl(streamUrl);
        setVideoTitle(file.name);
        setVideoMimeType(getMimeType(ext));
        setVideoPlayerOpen(true);
      } else {
        // fallback: download
        const url = `/api/files${relPath}`;
        const response = await axios.get(url, { responseType: 'blob' });
        const blob = response.data;
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', file.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      onError('Failed to open file');
    }
    handleMenuClose();
  };

  const handleDownload = async () => {
    if (file.type === 'directory') {
      handleMenuClose();
      return;
    }
    // Prefer sourcePath if available, otherwise use relPath
    let relPath = joinPaths(currentPath, file.name).replace(/\/$/, '');
    let downloadPath = file.sourcePath || relPath;
    const url = `/api/download?path=${encodeURIComponent(downloadPath)}`;
    // Use a direct link for GET download
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', file.name);
    document.body.appendChild(link);
    link.click();
    link.remove();
    handleMenuClose();
  };

  const handleRenameClick = () => {
    setRenameError(null);
    setRenameValue(file.name);
    setRenameDialogOpen(true);
    handleMenuClose();
  };

  const handleRenameDialogClose = () => {
    setRenameDialogOpen(false);
    setRenameError(null);
    setRenameValue('');
  };

  const handleRenameSubmit = async () => {
    if (!renameValue.trim() || renameValue === file.name) return;
    setRenameLoading(true);
    setRenameError(null);
    // Use file.fullPath or file.sourcePath or fallback to relPath
    let absPath = file.fullPath || file.sourcePath || '';
    let relPath = absPath ? getRelativePath(absPath) : joinPaths(currentPath, file.name).replace(/\/$/, '');
    try {
      await axios.post('/api/rename', {
        oldPath: relPath,
        newName: renameValue.trim(),
      });
      // Update persistent file details DB
      await upsertFileDetail({
        path: joinPaths(currentPath, renameValue.trim()),
        name: renameValue.trim(),
        type: file.type,
        size: file.size,
        modified: file.modified,
        icon: (file as any).icon || '',
        extra: '',
      });
      setRenameDialogOpen(false);
      setRenameLoading(false);
      if (onRename) onRename(file);
    } catch (error: any) {
      setRenameError(error.response?.data || error.message || 'Failed to rename file');
      setRenameLoading(false);
    }
  };

  const handleDeleteClick = () => {
    setDeleteError(null);
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  const handleDeleteConfirmClose = () => {
    setDeleteDialogOpen(false);
    setDeleteError(null);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    // Use file.fullPath or file.sourcePath or fallback to relPath
    let absPath = file.fullPath || file.sourcePath || '';
    let relPath = absPath ? getRelativePath(absPath) : joinPaths(currentPath, file.name).replace(/\/$/, '');
    if (!relPath) {
      setDeleteError('Could not determine file path');
      setDeleting(false);
      return;
    }
    try {
      await axios.post('/api/delete', { path: relPath });
      await deleteFileDetail(relPath);
      setDeleteDialogOpen(false);
      setDeleting(false);
      if (onDeleted) onDeleted();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setDeleteError(error.response?.data || error.message);
      } else {
        setDeleteError('Failed to delete file');
      }
      setDeleting(false);
    }
  };

  if (variant === 'buttons') {
    return (
      <Box sx={{ 
        display: 'flex', 
        gap: 1, 
        flexWrap: 'wrap', 
        justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' },
        width: '100%',
        mt: 1, mb: 0
      }}>
        {file.type === 'file' && (
          <Button size="small" variant="contained" color="primary" startIcon={<PlayArrowIcon />} onClick={handleOpen} sx={{ flex: '1 1 120px', maxWidth: 180, fontWeight: 600 }}>Play</Button>
        )}
        {file.type === 'file' && (
          <Button size="small" variant="outlined" color="primary" startIcon={<DownloadIcon />} onClick={handleDownload} sx={{ flex: '1 1 120px', maxWidth: 180, fontWeight: 600 }}>Download</Button>
        )}
        <Button size="small" variant="outlined" color="secondary" startIcon={<EditIcon />} onClick={handleRenameClick} sx={{ flex: '1 1 120px', maxWidth: 180, fontWeight: 600 }}>Rename</Button>
        <Tooltip title="Delete file">
          <span>
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={handleDeleteClick} sx={{ flex: '1 1 120px', maxWidth: 180, fontWeight: 600 }}>Delete</Button>
          </span>
        </Tooltip>
        {videoPlayerOpen && (
          <Suspense fallback={null}>
            <VideoPlayerDialog
              open={videoPlayerOpen}
              onClose={() => setVideoPlayerOpen(false)}
              url={videoUrl}
              title={videoTitle}
              mimeType={videoMimeType}
            />
          </Suspense>
        )}
        <Dialog open={renameDialogOpen} onClose={handleRenameDialogClose}>
          <DialogTitle>Rename File</DialogTitle>
          <DialogContent>
            <TextField autoFocus margin="dense" label="New Name" fullWidth value={renameValue} onChange={e => setRenameValue(e.target.value)} />
            {renameError && <Typography color="error" variant="body2">{renameError}</Typography>}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleRenameDialogClose}>Cancel</Button>
            <Button onClick={handleRenameSubmit} variant="contained" disabled={renameLoading}>Rename</Button>
          </DialogActions>
        </Dialog>
        <Dialog open={deleteDialogOpen} onClose={handleDeleteConfirmClose}>
          <DialogTitle>Delete File</DialogTitle>
          <DialogContent>
            <Typography>Are you sure you want to delete <b>{file.name}</b>?</Typography>
            {deleteError && <Typography color="error" variant="body2">{deleteError}</Typography>}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleDeleteConfirmClose}>Cancel</Button>
            <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>Delete</Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  return (
    <>
      <IconButton onClick={handleMenuOpen} size="small">
        <MoreVertIcon />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleMenuClose}
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: 6,
            minWidth: 180,
            mt: 1,
            p: 0.5,
          }
        }}
        MenuListProps={{ sx: { p: 0 } }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {file.type === 'file' && (
          <MenuItem onClick={handleOpen}><PlayArrowIcon fontSize="small" sx={{ mr: 1 }} />Play</MenuItem>
        )}
        <MenuItem onClick={handleViewDetails}><InfoIcon fontSize="small" sx={{ mr: 1 }} />View Details</MenuItem>
        {file.type === 'file' && (
          <MenuItem onClick={handleDownload}><DownloadIcon fontSize="small" sx={{ mr: 1 }} />Download</MenuItem>
        )}
        <MenuItem onClick={handleRenameClick}><EditIcon fontSize="small" sx={{ mr: 1 }} />Rename</MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={handleDeleteClick} sx={{ color: 'error.main' }}><DeleteIcon fontSize="small" sx={{ mr: 1 }} />Delete</MenuItem>
      </Menu>
      {videoPlayerOpen && (
        <Suspense fallback={null}>
          <VideoPlayerDialog
            open={videoPlayerOpen}
            onClose={() => setVideoPlayerOpen(false)}
            url={videoUrl}
            title={videoTitle}
            mimeType={videoMimeType}
          />
        </Suspense>
      )}
      <Dialog open={deleteDialogOpen} onClose={handleDeleteConfirmClose} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete <b>{file.name}</b>? This action cannot be undone.</Typography>
          {deleteError && <Typography color="error" sx={{ mt: 2 }}>{deleteError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteConfirmClose} disabled={deleting}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={renameDialogOpen} onClose={handleRenameDialogClose} maxWidth="xs" fullWidth>
        <DialogTitle>Rename File</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>Enter a new name for <b>{file.name}</b>:</Typography>
          <TextField
            autoFocus
            fullWidth
            variant="outlined"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            disabled={renameLoading}
            inputProps={{ maxLength: 255, style: { fontSize: '1.1rem' } }}
            sx={{ mb: 2, background: 'background.paper', borderRadius: 2 }}
            color="primary"
          />
          {renameError && <Typography color="error" sx={{ mb: 1 }}>{renameError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleRenameDialogClose} disabled={renameLoading} color="inherit">Cancel</Button>
          <Button
            onClick={handleRenameSubmit}
            variant="contained"
            color="primary"
            disabled={renameLoading || !renameValue.trim() || renameValue === file.name}
          >
            {renameLoading ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default FileActionMenu; 