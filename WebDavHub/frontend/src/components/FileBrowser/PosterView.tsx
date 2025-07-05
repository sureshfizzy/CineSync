
import React, { useState, useCallback, memo } from 'react';
import { Box, Paper, Typography, Skeleton, Menu, MenuItem, Divider, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';
import { useTheme } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import DeleteIcon from '@mui/icons-material/Delete';
import axios from 'axios';
import { useFileActions } from '../../hooks/useFileActions';
import ModifyDialog from './ModifyDialog/ModifyDialog';
import { FileItem } from './types';
import { TmdbResult } from '../api/tmdbApi';
import { getFileIcon } from './fileUtils';
import { getTmdbPosterUrl } from '../api/tmdbApi';
import CategoryPosterDisplay from './CategoryPosterDisplay';
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
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
            lg: 'repeat(5, 1fr)'
          },
          gap: 3,
          p: 1
        }}>
        {files.map((file) => {
          const tmdb = tmdbData[file.name];
          const loaded = imgLoadedMap[file.name] || false;
          const posterPath = file.posterPath || (tmdb && tmdb.poster_path);
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
                cursor: file.type === 'directory' ? 'pointer' : 'default',
                transition: 'transform 0.15s ease-out, box-shadow 0.15s ease-out',
                willChange: 'transform',
                backfaceVisibility: 'hidden',
                transform: 'translateZ(0)', // Force hardware acceleration
                boxShadow: 2,
                borderRadius: 3,
                overflow: 'hidden',
                position: 'relative',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: 6,
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
              onClick={() => onFileClick(file, tmdb)}
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
                          <img
                            className="poster-image"
                            src={getTmdbPosterUrl(posterPath, 'w92') || ''}
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

                        <img
                          className="poster-image"
                          src={hasPosterPath ? getTmdbPosterUrl(posterPath) || '' : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='}
                          alt={title}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            position: 'absolute',
                            inset: 0,
                            opacity: loaded && hasPosterPath ? 1 : 0,
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
                    fontSize: { xs: '0.9rem', sm: '1rem' },
                    mb: 0.5,
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.type === 'directory' && !file.isSeasonFolder && tmdb && tmdb.title
                    ? (tmdb.release_date ? tmdb.title.replace(/\s*\(\d{4}\)$/, '') : tmdb.title)
                    : file.name}
                </Typography>
                {tmdb && tmdb.release_date && (
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
                    {new Date(tmdb.release_date).getFullYear()}
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
        {contextMenu && (
          <>
            {contextMenu.file.type === 'file' && (
              <MenuItem onClick={() => {
                setContextMenu(null);
                console.log('Play file:', contextMenu.file.name);
              }}>
                <PlayArrowIcon fontSize="small" sx={{ mr: 1 }} />
                Play
              </MenuItem>
            )}
            <MenuItem onClick={() => {
              setContextMenu(null);
              handleViewDetails(contextMenu.file);
            }}>
              <InfoIcon fontSize="small" sx={{ mr: 1 }} />
              View Details
            </MenuItem>
            {contextMenu.file.type === 'file' && (
              <MenuItem onClick={() => {
                setContextMenu(null);
                console.log('Download file:', contextMenu.file.name);
              }}>
                <DownloadIcon fontSize="small" sx={{ mr: 1 }} />
                Download
              </MenuItem>
            )}
            <Divider />
            <MenuItem onClick={() => {
              setContextMenu(null);
              fileActions.handleRenameClick(contextMenu.file);
            }}>
              <EditIcon fontSize="small" sx={{ mr: 1 }} />
              Rename
            </MenuItem>
            {!contextMenu.file.isCategoryFolder && (
              <MenuItem onClick={() => {
                setContextMenu(null);
                fileActions.handleModifyClick(contextMenu.file);
              }}>
                <TuneIcon fontSize="small" sx={{ mr: 1 }} />
                Modify
              </MenuItem>
            )}
            <Divider />
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
          </>
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
    </Box>
  );
});

PosterView.displayName = 'PosterView';

export default PosterView;