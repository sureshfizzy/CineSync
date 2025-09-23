
import React, { useState, useCallback, memo } from 'react';
import { Box, Paper, Typography, Skeleton, Menu, MenuItem, Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Checkbox, alpha } from '@mui/material';
import { useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import axios from 'axios';
import { moveFile } from './fileApi';
import { useFileActions } from '../../hooks/useFileActions';
import ModifyDialog from './ModifyDialog/ModifyDialog';
import MoveFileDialog from './MoveFileDialog';
import MoveErrorDialog from './MoveErrorDialog';
import { useBulkSelection } from '../../contexts/BulkSelectionContext';
import BulkActionsBar from './BulkActionsBar';
import BulkMoveDialog from './BulkMoveDialog';
import BulkDeleteDialog from './BulkDeleteDialog';
import { FileItem } from './types';
import { TmdbResult } from '../api/tmdbApi';
import { getFileIcon } from './fileUtils';
import CategoryPosterDisplay from './CategoryPosterDisplay';
import PosterImage from './PosterImage';
import './poster-optimizations.css';

interface PosterViewProps {
  files: FileItem[];
  tmdbData: { [key: string]: TmdbResult | null };
  imgLoadedMap: { [key: string]: boolean };
  onFileClick: (file: FileItem, tmdb: TmdbResult | null) => void;
  onImageLoad: (key: string) => void;
  currentPath: string;
  onViewDetails: (file: FileItem, details: any) => void;
  onRename: () => void;
  onDeleted: () => void;
  onNavigateBack?: () => void;
  sizeVariant?: 'default' | 'compact';
}

const PosterView = memo(({
  files,
  tmdbData,
  imgLoadedMap,
  onFileClick,
  onImageLoad,
  currentPath,
  onViewDetails,
  onRename,
  onDeleted,
  onNavigateBack,
  sizeVariant = 'default',
}: PosterViewProps) => {
  const theme = useTheme();
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
    file: FileItem;
  } | null>(null);

  // Use the file actions hook
  const fileActions = useFileActions({
    currentPath,
    onRename,
    onDeleted,
  });

  // Use bulk selection
  const { 
    isSelectionMode, 
    selectedItems, 
    toggleSelection, 
    selectAll, 
    isSelected, 
    getSelectedItems,
    exitSelectionMode
  } = useBulkSelection();

  // Bulk action states
  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const handleContextMenu = useCallback((event: React.MouseEvent, file: FileItem) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      file,
    });
  }, []);

  const joinPaths = (...parts: string[]): string => {
    return parts.join('/').replace(/\/+/g, '/').replace(/\/\//g, '/');
  };

  const handleViewDetails = async (file: FileItem) => {
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
    onViewDetails(file, {
      webdavPath: joinPaths('Home', normalizedPath, file.name),
      fullPath: absPath,
      sourcePath: realPath
    });
  };

  // Bulk action handlers
  const handleBulkMove = useCallback(() => {
    setBulkMoveDialogOpen(true);
  }, []);

  const handleBulkDelete = useCallback(() => {
    setBulkDeleteDialogOpen(true);
  }, []);


  const handleBulkMoveSubmit = useCallback(async (targetPath: string) => {
    setBulkLoading(true);
    try {
      const selected = getSelectedItems(files);
      for (const item of selected) {
        const sourcePath = item.fullPath || item.sourcePath || joinPaths(currentPath, item.name);
        await moveFile(sourcePath, targetPath);
      }
      setBulkMoveDialogOpen(false);
      exitSelectionMode();
      if (onDeleted) onDeleted();
    } catch (error) {
      console.error('Bulk move failed:', error);
    } finally {
      setBulkLoading(false);
    }
  }, [getSelectedItems, files, currentPath, exitSelectionMode, onDeleted]);

  const handleBulkDeleteSubmit = useCallback(async () => {
    setBulkLoading(true);
    try {
      const selected = getSelectedItems(files);
      for (const item of selected) {
        const sourcePath = item.fullPath || item.sourcePath || joinPaths(currentPath, item.name);
        await axios.post('/api/delete', { path: sourcePath });
      }
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
      if (onDeleted) onDeleted();
    } catch (error) {
      console.error('Bulk delete failed:', error);
    } finally {
      setBulkLoading(false);
    }
  }, [getSelectedItems, files, currentPath, exitSelectionMode, onDeleted]);

  if (files.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">
          This folder is empty.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box
        className="poster-grid"
        sx={{
          display: 'grid',
          gridTemplateColumns: sizeVariant === 'compact' ? {
            xs: 'repeat(3, 1fr)',
            sm: 'repeat(4, 1fr)',
            md: 'repeat(6, 1fr)',
            lg: 'repeat(7, 1fr)'
          } : {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
            lg: 'repeat(5, 1fr)'
          },
          gap: sizeVariant === 'compact' ? 1.5 : 3,
          p: 1
        }}>
        {files.map((file) => {
          const tmdb = tmdbData[file.name];
          const loaded = imgLoadedMap[file.name] || false;
          const posterPath = file.posterPath || (tmdb && tmdb.poster_path);
          const tmdbId = file.tmdbId || (tmdb && tmdb.id);
          const hasPosterPath = !!posterPath;

          return (
            <Paper
              key={file.name}
              className="poster-card"
              data-file-name={file.name}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                cursor: isSelectionMode ? 'pointer' : (file.type === 'directory' ? 'pointer' : 'default'),
                transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                transform: 'translateZ(0)', // Force hardware acceleration
                boxShadow: 2,
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
                border: isSelected(file) ? `2px solid ${theme.palette.primary.main}` : '2px solid transparent',
                bgcolor: isSelected(file) ? theme.palette.primary.main + '10' : 'transparent',
                '&:hover': {
                  transform: isSelectionMode ? 'none' : 'translateY(-4px)',
                  boxShadow: isSelectionMode ? 2 : 6,
                  bgcolor: isSelectionMode ? theme.palette.action.hover : 'transparent',
                },
                '&.alphabet-highlight': {
                  backgroundColor: theme.palette.primary.main + '20',
                  animation: 'pulse 2s ease-in-out',
                },
                '@keyframes pulse': {
                  '0%': { backgroundColor: theme.palette.primary.main + '40' },
                  '50%': { backgroundColor: theme.palette.primary.main + '20' },
                  '100%': { backgroundColor: 'transparent' },
                }
              }}
              onClick={() => {
                if (isSelectionMode) {
                  toggleSelection(file);
                } else {
                  onFileClick(file, tmdb);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, file)}
            >
              {/* Category poster overlay */}
              {file.isCategoryFolder && file.type === 'directory' && (
                <CategoryPosterDisplay
                  categoryName={file.name}
                  onLoad={() => onImageLoad(file.name)}
                />
              )}

              <Box
                className="poster-image-container"
                sx={{
                  width: '100%',
                  aspectRatio: '3/4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: theme.palette.background.default,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {isSelectionMode && (
                  <Checkbox
                    checked={isSelected(file)}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleSelection(file);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    sx={{ 
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 10,
                      bgcolor: theme.palette.background.paper,
                      borderRadius: 1,
                      '&:hover': {
                        bgcolor: theme.palette.action.hover
                      }
                    }}
                  />
                )}
                
                {/* Quality Badge */}
                {file.quality && !isSelectionMode && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      zIndex: 5,
                      bgcolor: alpha(theme.palette.success.main, 0.9),
                      color: 'white',
                      px: 1,
                      py: 0.25,
                      borderRadius: 1,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    {file.quality}
                  </Box>
                )}
                {(() => {
                  const title = file.title || (tmdb && tmdb.title) || file.name;

                  if (file.isCategoryFolder && file.type === 'directory') {
                    return null;
                  }

                  const isPosterCandidate = file.type === 'directory' && !file.isSeasonFolder && hasPosterPath;

                  if (isPosterCandidate) {
                    return (
                      <>
                        {!loaded && !hasPosterPath && (
                          <Skeleton
                            variant="rectangular"
                            width="100%"
                            height="100%"
                            animation="wave"
                            sx={{ position: 'absolute', inset: 0 }}
                          />
                        )}

                        {hasPosterPath && !loaded && (
                          <PosterImage
                            tmdbId={tmdbId}
                            posterPath={posterPath}
                            mediaType={tmdb?.media_type || (tmdb?.first_air_date ? 'tv' : 'movie')}
                            size="w92"
                            className="poster-image"
                            alt={`${title} (loading)`}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              position: 'absolute',
                              inset: 0,
                              opacity: 1,
                              filter: 'blur(8px)',
                              transform: 'scale(1.1)',
                            }}
                            loading="lazy"
                          />
                        )}

                        {hasPosterPath ? (
                          <PosterImage
                            tmdbId={tmdbId}
                            posterPath={posterPath}
                            mediaType={tmdb?.media_type || (tmdb?.first_air_date ? 'tv' : 'movie')}
                            className="poster-image"
                            alt={title}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              position: 'absolute',
                              inset: 0,
                              opacity: loaded ? 1 : 0,
                              transition: 'opacity 0.2s ease-out',
                              zIndex: 1,
                              imageRendering: 'auto',
                              backfaceVisibility: 'hidden',
                              transform: 'translateZ(0)',
                            }}
                            onLoad={() => onImageLoad(file.name)}
                            onError={() => onImageLoad(file.name)}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <img
                            className="poster-image"
                            src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
                            alt={title}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              position: 'absolute',
                              inset: 0,
                              opacity: 0,
                              transition: 'opacity 0.2s ease-out',
                              zIndex: 1,
                            }}
                            onLoad={() => onImageLoad(file.name)}
                            onError={() => onImageLoad(file.name)}
                            loading="lazy"
                            decoding="async"
                          />
                        )}

                        {!hasPosterPath && loaded && (
                          <Box sx={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'absolute',
                            inset: 0
                          }}>
                            {getFileIcon(file.name, file.type)}
                          </Box>
                        )}
                      </>
                    );
                  } else {
                    return file.type === 'directory' ? getFileIcon(file.name, file.type) : null;
                  }
                })()}
              </Box>

              {/* Title section */}
              <Box sx={{
                width: '100%',
                p: { xs: '6px 8px', sm: '4px 12px' },
                background: theme.palette.background.paper,
                borderTop: `1px solid ${theme.palette.divider}`
              }}>
                <Typography
                  sx={{
                    fontWeight: 500,
                    textAlign: 'center',
                    fontSize: sizeVariant === 'compact' ? { xs: '0.8rem', sm: '0.9rem' } : { xs: '0.9rem', sm: '1rem' },
                    mb: 0.5,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.type === 'directory' && !file.isSeasonFolder && tmdb && tmdb.title
                    ? ((tmdb.release_date || tmdb.first_air_date) ? tmdb.title.replace(/\s*\(\d{4}\)$/, '') : tmdb.title)
                    : file.name}
                </Typography>
                {tmdb && (tmdb.release_date || tmdb.first_air_date) && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      fontWeight: 500,
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {(() => {
                      const dateStr = tmdb.release_date || tmdb.first_air_date;
                      return dateStr ? new Date(dateStr).getFullYear() : '';
                    })()}
                  </Typography>
                )}
              </Box>
            </Paper>
          );
        })}
      </Box>

      {/* Context Menu */}
      <Menu
        open={contextMenu !== null}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        slotProps={{
          paper: {
            sx: {
              borderRadius: 3,
              boxShadow: 6,
              minWidth: 180,
              mt: 1,
              p: 0.5,
            }
          },
          root: { sx: { p: 0 } }
        }}
      >
        {contextMenu && contextMenu.file.type === 'file' && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            console.log('Play file:', contextMenu.file.name);
          }}>
            <PlayArrowIcon fontSize="small" sx={{ mr: 1 }} />
            Play
          </MenuItem>
        )}
        {contextMenu && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            handleViewDetails(contextMenu.file);
          }}>
            <InfoIcon fontSize="small" sx={{ mr: 1 }} />
            View Details
          </MenuItem>
        )}
        {contextMenu && contextMenu.file.type === 'file' && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            console.log('Download file:', contextMenu.file.name);
          }}>
            <DownloadIcon fontSize="small" sx={{ mr: 1 }} />
            Download
          </MenuItem>
        )}
        {contextMenu && <Divider />}
        {contextMenu && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            fileActions.handleRenameClick(contextMenu.file);
          }}>
            <EditIcon fontSize="small" sx={{ mr: 1 }} />
            Rename
          </MenuItem>
        )}
        {contextMenu && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            fileActions.handleMoveClick(contextMenu.file);
          }}>
            <DriveFileMoveIcon fontSize="small" sx={{ mr: 1 }} />
            Move
          </MenuItem>
        )}
        {contextMenu && !contextMenu.file.isCategoryFolder && (
          <MenuItem onClick={() => {
            setContextMenu(null);
            fileActions.handleModifyClick(contextMenu.file);
          }}>
            <TuneIcon fontSize="small" sx={{ mr: 1 }} />
            Modify
          </MenuItem>
        )}
        {contextMenu && <Divider />}
        {contextMenu && (
          <MenuItem
            onClick={() => {
              setContextMenu(null);
              fileActions.handleDeleteClick(contextMenu.file);
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
            Delete
          </MenuItem>
        )}
      </Menu>

      {/* Dialogs */}
      <Dialog open={fileActions.renameDialogOpen} onClose={fileActions.handleRenameDialogClose} maxWidth="xs" fullWidth>
        <DialogTitle>Rename File</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>Enter a new name for <b>{fileActions.fileBeingRenamed?.name}</b>:</Typography>
          <TextField
            autoFocus
            fullWidth
            variant="outlined"
            value={fileActions.renameValue}
            onChange={(e) => fileActions.setRenameValue(e.target.value)}
            disabled={fileActions.renameLoading}
          />
          {fileActions.renameError && <Typography color="error" sx={{ mt: 1 }}>{fileActions.renameError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={fileActions.handleRenameDialogClose} disabled={fileActions.renameLoading}>Cancel</Button>
          <Button
            onClick={fileActions.handleRenameSubmit}
            variant="contained"
            disabled={fileActions.renameLoading || !fileActions.renameValue.trim()}
          >
            {fileActions.renameLoading ? 'Renaming...' : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={fileActions.deleteDialogOpen} onClose={fileActions.handleDeleteDialogClose} maxWidth="xs" fullWidth>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete <b>{fileActions.fileBeingDeleted?.name}</b>?</Typography>
          {fileActions.deleteError && <Typography color="error" sx={{ mt: 2 }}>{fileActions.deleteError}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={fileActions.handleDeleteDialogClose} disabled={fileActions.deleting}>Cancel</Button>
          <Button onClick={fileActions.handleDelete} color="error" variant="contained" disabled={fileActions.deleting}>
            {fileActions.deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {fileActions.modifyDialogOpen && fileActions.fileBeingModified && (
        <ModifyDialog
          open={fileActions.modifyDialogOpen}
          onClose={fileActions.handleModifyDialogClose}
          onNavigateBack={onNavigateBack}
          currentFilePath={fileActions.fileBeingModified.fullPath || fileActions.fileBeingModified.sourcePath || joinPaths(currentPath, fileActions.fileBeingModified.name)}
        />
      )}

      {/* Move Dialog */}
      <MoveFileDialog
        open={fileActions.moveDialogOpen}
        onClose={fileActions.handleMoveDialogClose}
        onMove={fileActions.handleMoveSubmit}
        fileName={fileActions.fileBeingMoved?.name || ''}
        loading={fileActions.moveLoading}
      />

      {/* Move Error Dialog */}
      <MoveErrorDialog
        open={fileActions.moveErrorDialogOpen}
        onClose={fileActions.handleMoveErrorDialogClose}
        onRetry={() => {
          if (fileActions.lastMoveAttempt) {
            fileActions.handleMoveErrorDialogClose();
            fileActions.handleMoveSubmit(fileActions.lastMoveAttempt.targetPath);
          }
        }}
        fileName={fileActions.fileBeingMoved?.name || ''}
        targetPath={fileActions.lastMoveAttempt?.targetPath || ''}
        errorMessage={fileActions.moveError || ''}
      />

      {/* Bulk Actions */}
      <BulkActionsBar
        selectedItems={getSelectedItems(files)}
        onClose={exitSelectionMode}
        onMove={handleBulkMove}
        onDelete={handleBulkDelete}
        onSelectAll={() => selectAll(files)}
        isVisible={isSelectionMode && selectedItems.size > 0}
      />

      <BulkMoveDialog
        open={bulkMoveDialogOpen}
        onClose={() => setBulkMoveDialogOpen(false)}
        onMove={handleBulkMoveSubmit}
        selectedItems={getSelectedItems(files)}
        loading={bulkLoading}
      />

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onDelete={handleBulkDeleteSubmit}
        selectedItems={getSelectedItems(files)}
        loading={bulkLoading}
      />
    </Box>
  );
});

PosterView.displayName = 'PosterView';

export default PosterView;