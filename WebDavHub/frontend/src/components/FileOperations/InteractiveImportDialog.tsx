import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, IconButton, useTheme, Paper, Chip, CircularProgress, FormControl, Select, MenuItem, TextField } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import axios from 'axios';
import { fetchEpisodesFromTmdb } from '../api/tmdbApi';
import SeriesSelectionDialog from './SeriesSelectionDialog';
import SeasonSelectionDialog from './SeasonSelectionDialog';
import EpisodeSelectionDialog from './EpisodeSelectionDialog';
import MovieSelectionDialog from './MovieSelectionDialog';

interface MediaFile {
  id: string;
  fileName: string;
  filePath: string;
  mediaType?: 'movie' | 'tv';
  series?: string;
  seriesId?: number;
  season?: number;
  episode?: number;
  movieTitle?: string;
  movieId?: number;
  year?: number;
  title?: string;
  releaseGroup?: string;
  quality?: string;
  language?: string;
  size?: string;
  releaseType?: string;
  selected: boolean;
}

interface SeriesOption {
  id: number;
  name: string;
  year?: number;
  tvdb_id?: number;
  imdb_id?: string;
  tmdb_id?: number;
  source: 'local' | 'tmdb';
}

interface SeasonOption {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  overview?: string;
}

interface EpisodeOption {
  episodeNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  runtime?: number;
  rating?: number;
}

interface MovieOption {
  id: number;
  title: string;
  year?: number;
  tmdb_id?: number;
  source: 'tmdb';
}

interface EditingCell {
  fileId: string;
  field: string;
}

interface InteractiveImportDialogProps {
  open: boolean;
  onClose: () => void;
  folderPath: string;
}

const InteractiveImportDialog: React.FC<InteractiveImportDialogProps> = ({
  open,
  onClose,
  folderPath
}) => {
  const theme = useTheme();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [seriesDialogOpen, setSeriesDialogOpen] = useState(false);
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [episodeDialogOpen, setEpisodeDialogOpen] = useState(false);
  const [movieDialogOpen, setMovieDialogOpen] = useState(false);
  const [currentEditingFileId, setCurrentEditingFileId] = useState<string | null>(null);

  useEffect(() => {
    if (open && folderPath) {
      scanFolder();
    }
  }, [open, folderPath]);

  const scanFolder = async () => {
    setLoading(true);
    try {
      const scanResponse = await axios.get('/api/scan-for-import', {
        params: { path: folderPath }
      });

      if (scanResponse.data && scanResponse.data.files && Array.isArray(scanResponse.data.files)) {
        const videoFiles = scanResponse.data.files;

        if (videoFiles.length > 0) {
          const mediaFiles: MediaFile[] = videoFiles.map((file: any, index: number) => {
            const mediaType = file.mediaType || (file.season || file.episode ? 'tv' : 'movie');

            const baseFile = {
              id: `file-${index}`,
              fileName: file.name,
              filePath: file.path,
              mediaType: mediaType as 'movie' | 'tv',
              releaseGroup: file.releaseGroup || 'Unknown',
              quality: file.quality || 'Unknown',
              language: file.language || 'English',
              size: file.size || 'Unknown',
              selected: true
            };

            if (mediaType === 'tv') {
              return {
                ...baseFile,
                series: file.series || 'Unknown Series',
                seriesId: file.seriesId || file.tmdbId,
                season: file.season || 1,
                episode: file.episode || (index + 1),
                title: file.episodeTitle || `Episode ${file.episode || (index + 1)}`,
                releaseType: file.releaseType || 'Single Episode',
              };
            } else {
              return {
                ...baseFile,
                movieTitle: file.title || file.movieTitle || 'Unknown Movie',
                movieId: file.movieId || file.tmdbId,
                year: file.year || new Date().getFullYear(),
                title: file.title || file.movieTitle || 'Unknown Movie',
                releaseType: 'Movie',
              };
            }
          });

          setFiles(mediaFiles);
        } else {
          // No video files found
          setFiles([]);
        }
      } else {
        // API didn't return expected format
        setFiles([]);
      }
    } catch (error) {
      // Error occurred during scanning
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setFiles(prev => prev.map(file => ({ ...file, selected: checked })));
  };

  const handleFileSelect = (fileId: string, checked: boolean) => {
    setFiles(prev => prev.map(file =>
      file.id === fileId ? { ...file, selected: checked } : file
    ));
  };

  const handleImport = async () => {
    const selectedFiles = files.filter(file => file.selected);
    if (selectedFiles.length === 0) return;

    setProcessing(true);
    try {
      for (const file of selectedFiles) {
        try {
          let selectedOption = 'manual';

          if (file.mediaType === 'movie') {
            selectedOption = 'force-movie';
          } else if (file.mediaType === 'tv') {
            selectedOption = 'force-show';
          }

          // Build the request payload
          const requestPayload: any = {
            sourcePath: file.filePath,
            disableMonitor: true,
            selectedOption: selectedOption,
            bulkAutoProcess: false
          };

          // Add selected IDs if available
          const selectedIds: any = {};
          if (file.seriesId) {
            selectedIds.tmdb = file.seriesId.toString();
          }
          if (file.movieId) {
            selectedIds.tmdb = file.movieId.toString();
          }
          if (file.season && file.episode) {
            selectedIds['season-episode'] = `S${file.season.toString().padStart(2, '0')}E${file.episode.toString().padStart(2, '0')}`;
          }

          if (Object.keys(selectedIds).length > 0) {
            requestPayload.selectedIds = selectedIds;
          }

          await axios.post('/api/python-bridge', requestPayload);

        } catch (fileError) {
        }
      }

      // Close dialog after processing
      onClose();
    } catch (error) {
      // Failed to import files
    } finally {
      setProcessing(false);
    }
  };

  const selectedCount = files.filter(file => file.selected).length;

  // Handle field updates
  const updateFileField = (fileId: string, field: string, value: any) => {
    setFiles(prev => prev.map(file =>
      file.id === fileId ? { ...file, [field]: value } : file
    ));
  };

  // Handle cell editing
  const startEditing = (fileId: string, field: string) => {
    setEditingCell({ fileId, field });
  };

  const stopEditing = () => {
    setEditingCell(null);
  };

  const handleSeriesSelect = async (series: SeriesOption) => {
    if (currentEditingFileId) {
      const currentFile = files.find(f => f.id === currentEditingFileId);

      updateFileField(currentEditingFileId, 'series', series.name);
      updateFileField(currentEditingFileId, 'seriesId', series.tmdb_id || series.id);

      // If we have season and episode info, try to fetch the episode title from the new series
      if (currentFile && currentFile.season && currentFile.episode && (series.tmdb_id || series.id)) {
        try {
          const episodes = await fetchEpisodesFromTmdb((series.tmdb_id || series.id).toString(), currentFile.season);

          if (episodes && episodes.length > 0) {
            const matchingEpisode = episodes.find(ep => ep.episode_number === currentFile.episode);
            if (matchingEpisode && matchingEpisode.name) {
              updateFileField(currentEditingFileId, 'title', matchingEpisode.name);
            }
          }
        } catch (error) {
          console.warn('Failed to fetch episode title for new series:', error);
        }
      }

      setCurrentEditingFileId(null);
    }
    setSeriesDialogOpen(false);
  };

  const handleMovieSelect = (movie: MovieOption) => {
    if (currentEditingFileId) {
      updateFileField(currentEditingFileId, 'movieTitle', movie.title);
      updateFileField(currentEditingFileId, 'movieId', movie.tmdb_id || movie.id);
      updateFileField(currentEditingFileId, 'title', movie.title);
      updateFileField(currentEditingFileId, 'year', movie.year);
      setCurrentEditingFileId(null);
    }
    setMovieDialogOpen(false);
  };

  const handleSeasonSelect = (season: SeasonOption) => {
    if (currentEditingFileId) {
      updateFileField(currentEditingFileId, 'season', season.seasonNumber);
      setCurrentEditingFileId(null);
    }
    setSeasonDialogOpen(false);
  };

  const handleEpisodeSelect = (episode: EpisodeOption) => {
    if (currentEditingFileId) {
      updateFileField(currentEditingFileId, 'episode', episode.episodeNumber);
      updateFileField(currentEditingFileId, 'title', episode.name);
      setCurrentEditingFileId(null);
    }
    setEpisodeDialogOpen(false);
  };

  const openSeriesDialog = (fileId: string) => {
    setCurrentEditingFileId(fileId);
    setSeriesDialogOpen(true);
  };

  const openSeasonDialog = (fileId: string) => {
    setCurrentEditingFileId(fileId);
    setSeasonDialogOpen(true);
  };

  const openEpisodeDialog = (fileId: string) => {
    setCurrentEditingFileId(fileId);
    setEpisodeDialogOpen(true);
  };

  const openMovieDialog = (fileId: string) => {
    setCurrentEditingFileId(fileId);
    setMovieDialogOpen(true);
  };

  // Render editable cell
  const renderEditableCell = (file: MediaFile, field: string, value: any) => {
    const isEditing = editingCell?.fileId === file.id && editingCell?.field === field;

    if (isEditing) {
      if (field === 'season' || field === 'episode' || field === 'year') {
        return (
          <TextField
            size="small"
            type="number"
            autoFocus
            defaultValue={value}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateFileField(file.id, field, parseInt((e.target as HTMLInputElement).value) || (field === 'year' ? new Date().getFullYear() : 1));
                stopEditing();
              } else if (e.key === 'Escape') {
                stopEditing();
              }
            }}
            sx={{ width: 80 }}
          />
        );
      } else if (field === 'title' || field === 'movieTitle') {
        return (
          <TextField
            size="small"
            autoFocus
            defaultValue={value}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateFileField(file.id, 'title', (e.target as HTMLInputElement).value);
                stopEditing();
              } else if (e.key === 'Escape') {
                stopEditing();
              }
            }}
            sx={{ width: 150 }}
          />
        );
      } else if (field === 'releaseGroup') {
        return (
          <TextField
            size="small"
            autoFocus
            defaultValue={value}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateFileField(file.id, 'releaseGroup', (e.target as HTMLInputElement).value);
                stopEditing();
              } else if (e.key === 'Escape') {
                stopEditing();
              }
            }}
            sx={{ width: 100 }}
          />
        );
      } else if (field === 'quality') {
        return (
          <FormControl size="small" sx={{ width: 120 }}>
            <Select
              value={value}
              onChange={(e) => {
                updateFileField(file.id, 'quality', e.target.value);
                stopEditing();
              }}
              onClose={stopEditing}
              autoFocus
            >
              <MenuItem value="4K 2160p">4K 2160p</MenuItem>
              <MenuItem value="1080p">1080p</MenuItem>
              <MenuItem value="720p">720p</MenuItem>
              <MenuItem value="480p">480p</MenuItem>
              <MenuItem value="WEBDL 2160p">WEBDL 2160p</MenuItem>
              <MenuItem value="WEBDL 1080p">WEBDL 1080p</MenuItem>
              <MenuItem value="BluRay 2160p">BluRay 2160p</MenuItem>
              <MenuItem value="BluRay 1080p">BluRay 1080p</MenuItem>
            </Select>
          </FormControl>
        );
      } else if (field === 'language') {
        return (
          <FormControl size="small" sx={{ width: 100 }}>
            <Select
              value={value}
              onChange={(e) => {
                updateFileField(file.id, 'language', e.target.value);
                stopEditing();
              }}
              onClose={stopEditing}
              autoFocus
            >
              <MenuItem value="English">English</MenuItem>
              <MenuItem value="Spanish">Spanish</MenuItem>
              <MenuItem value="French">French</MenuItem>
              <MenuItem value="German">German</MenuItem>
              <MenuItem value="Italian">Italian</MenuItem>
              <MenuItem value="Japanese">Japanese</MenuItem>
              <MenuItem value="Korean">Korean</MenuItem>
              <MenuItem value="Chinese">Chinese</MenuItem>
            </Select>
          </FormControl>
        );
      } else if (field === 'releaseType') {
        return (
          <FormControl size="small" sx={{ width: 120 }}>
            <Select
              value={value}
              onChange={(e) => {
                updateFileField(file.id, 'releaseType', e.target.value);
                stopEditing();
              }}
              onClose={stopEditing}
              autoFocus
            >
              <MenuItem value="Single Episode">Single Episode</MenuItem>
              <MenuItem value="Multi Episode">Multi Episode</MenuItem>
              <MenuItem value="Season Pack">Season Pack</MenuItem>
              <MenuItem value="Complete Series">Complete Series</MenuItem>
            </Select>
          </FormControl>
        );
      }
    }

    // Non-editing display
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          cursor: 'pointer',
          '&:hover': { bgcolor: 'action.hover' },
          p: 0.5,
          borderRadius: 1
        }}
        onClick={() => {
          if (field === 'series') {
            openSeriesDialog(file.id);
          } else if (field === 'movieTitle') {
            openMovieDialog(file.id);
          } else if (field === 'season') {
            openSeasonDialog(file.id);
          } else if (field === 'episode') {
            openEpisodeDialog(file.id);
          } else {
            startEditing(file.id, field);
          }
        }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {value}
        </Typography>
      </Box>
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            height: '80vh',
            bgcolor: theme.palette.background.paper,
            backgroundImage: 'none',
            boxShadow: theme.palette.mode === 'light'
              ? '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)'
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
          Manual Import - {folderPath}
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ flexShrink: 0 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0 }}>
        {loading ? (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 400,
            flexDirection: 'column',
            gap: 2,
            bgcolor: theme.palette.background.paper,
            backgroundImage: 'none'
          }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Scanning and parsing media files...
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              This may take a moment as we parse filenames and lookup TMDB data
            </Typography>
          </Box>
        ) : files.length === 0 ? (
          <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 400,
            flexDirection: 'column',
            gap: 2,
            bgcolor: theme.palette.background.paper,
            backgroundImage: 'none'
          }}>
            <Typography variant="h6" color="text.secondary">
              No Media Files Found
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: 400 }}>
              No video files were found in the selected folder. Please ensure the folder contains supported video files (.mkv, .mp4, .avi, etc.).
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
              Folder: {folderPath}
            </Typography>
          </Box>
        ) : (
          <TableContainer
            component={Paper}
            sx={{
              height: 'calc(80vh - 200px)',
              bgcolor: theme.palette.background.paper,
              backgroundImage: 'none',
              boxShadow: 'none',
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 0,
              '& .MuiTableHead-root': {
                bgcolor: theme.palette.mode === 'light' ? theme.palette.grey[50] : theme.palette.grey[900],
              },
              '& .MuiTableCell-head': {
                bgcolor: theme.palette.mode === 'light' ? theme.palette.grey[50] : theme.palette.grey[900],
                borderBottom: `2px solid ${theme.palette.divider}`,
                fontWeight: 600,
              },
              '& .MuiTableRow-hover:hover': {
                bgcolor: theme.palette.mode === 'light' ? theme.palette.grey[50] : theme.palette.action.hover,
              }
            }}
          >
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={files.length > 0 && selectedCount === files.length}
                      indeterminate={selectedCount > 0 && selectedCount < files.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </TableCell>
                  <TableCell>Relative Path</TableCell>
                  <TableCell>Media Type</TableCell>
                  <TableCell>Title/Series</TableCell>
                  <TableCell>Season/Year</TableCell>
                  <TableCell>Episodes</TableCell>
                  <TableCell>Release Group</TableCell>
                  <TableCell>Quality</TableCell>
                  <TableCell>Languages</TableCell>
                  <TableCell>Size</TableCell>
                  <TableCell>Release Type</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id} hover>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={file.selected}
                        onChange={(e) => handleFileSelect(file.id, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {file.fileName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {editingCell?.fileId === file.id && editingCell?.field === 'mediaType' ? (
                        <FormControl size="small" sx={{ width: 80 }}>
                          <Select
                            value={file.mediaType || 'tv'}
                            onChange={(e) => {
                              updateFileField(file.id, 'mediaType', e.target.value);
                              stopEditing();
                            }}
                            onClose={stopEditing}
                            autoFocus
                          >
                            <MenuItem value="tv">TV</MenuItem>
                            <MenuItem value="movie">MOVIE</MenuItem>
                          </Select>
                        </FormControl>
                      ) : (
                        <Chip
                          label={file.mediaType?.toUpperCase() || 'TV'}
                          size="small"
                          color={file.mediaType === 'movie' ? 'secondary' : 'primary'}
                          sx={{ fontSize: '0.7rem', height: 20, cursor: 'pointer' }}
                          onClick={() => startEditing(file.id, 'mediaType')}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {file.mediaType === 'movie'
                        ? renderEditableCell(file, 'movieTitle', file.movieTitle || file.title)
                        : renderEditableCell(file, 'series', file.series)
                      }
                    </TableCell>
                    <TableCell>
                      {file.mediaType === 'movie'
                        ? renderEditableCell(file, 'year', file.year)
                        : renderEditableCell(file, 'season', file.season)
                      }
                    </TableCell>
                    <TableCell>
                      {file.mediaType === 'tv' ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {renderEditableCell(file, 'episode', file.episode)}
                          <Typography variant="body2">-</Typography>
                          <Typography variant="body2" sx={{ flex: 1, color: 'text.secondary' }}>
                            {file.title}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="body2" color="text.secondary">-</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingCell?.fileId === file.id && editingCell?.field === 'releaseGroup' ? (
                        renderEditableCell(file, 'releaseGroup', file.releaseGroup)
                      ) : (
                        <Chip
                          label={file.releaseGroup}
                          size="small"
                          sx={{ fontSize: '0.7rem', height: 20, cursor: 'pointer' }}
                          onClick={() => startEditing(file.id, 'releaseGroup')}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {editingCell?.fileId === file.id && editingCell?.field === 'quality' ? (
                        renderEditableCell(file, 'quality', file.quality)
                      ) : (
                        <Chip
                          label={file.quality}
                          size="small"
                          color="primary"
                          sx={{ fontSize: '0.7rem', height: 20, cursor: 'pointer' }}
                          onClick={() => startEditing(file.id, 'quality')}
                        />
                      )}
                    </TableCell>
                    <TableCell>{renderEditableCell(file, 'language', file.language)}</TableCell>
                    <TableCell>
                      <Typography variant="body2">{file.size}</Typography>
                    </TableCell>
                    <TableCell>{renderEditableCell(file, 'releaseType', file.releaseType)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{
        p: 2,
        borderTop: `1px solid ${theme.palette.divider}`,
        justifyContent: 'flex-end',
        bgcolor: theme.palette.background.paper,
        backgroundImage: 'none'
      }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleImport}
            disabled={selectedCount === 0 || processing}
            startIcon={processing ? <CircularProgress size={16} /> : undefined}
          >
            {processing ? 'Importing...' : `Import (${selectedCount})`}
          </Button>
        </Box>
      </DialogActions>

      <SeriesSelectionDialog
        open={seriesDialogOpen}
        onClose={() => {
          setSeriesDialogOpen(false);
          setCurrentEditingFileId(null);
        }}
        onSelect={handleSeriesSelect}
        currentValue={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.series : undefined}
      />

      <SeasonSelectionDialog
        open={seasonDialogOpen}
        onClose={() => {
          setSeasonDialogOpen(false);
          setCurrentEditingFileId(null);
        }}
        onSelect={handleSeasonSelect}
        seriesId={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.seriesId : undefined}
        seriesName={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.series : undefined}
        currentValue={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.season : undefined}
      />

      <EpisodeSelectionDialog
        open={episodeDialogOpen}
        onClose={() => {
          setEpisodeDialogOpen(false);
          setCurrentEditingFileId(null);
        }}
        onSelect={handleEpisodeSelect}
        seriesId={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.seriesId : undefined}
        seriesName={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.series : undefined}
        seasonNumber={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.season : undefined}
        currentValue={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.episode : undefined}
      />

      <MovieSelectionDialog
        open={movieDialogOpen}
        onClose={() => {
          setMovieDialogOpen(false);
          setCurrentEditingFileId(null);
        }}
        onSelect={handleMovieSelect}
        currentValue={currentEditingFileId ? files.find(f => f.id === currentEditingFileId)?.movieTitle || files.find(f => f.id === currentEditingFileId)?.title : undefined}
      />
    </Dialog>
  );
};

export default InteractiveImportDialog;