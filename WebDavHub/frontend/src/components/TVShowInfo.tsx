import { Box, Typography, Chip, Paper, Avatar, CircularProgress, Tooltip, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, TextField, Snackbar, Alert, Divider, useTheme } from '@mui/material';
import { MediaDetailsData } from '../types/MediaTypes';
import axios from 'axios';
import { useEffect, useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileActionMenu from './FileActionMenu';
import VideoPlayerDialog from './VideoPlayerDialog';
import { FolderOpen as FolderOpenIcon, InsertDriveFile as FileIcon, Image as ImageIcon, Movie as MovieIcon, Description as DescriptionIcon } from '@mui/icons-material';

interface TVShowInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  isSeasonFolder?: boolean;
  path?: string;
}

interface EpisodeFileInfo {
  name: string;
  size: string;
  modified: string;
  path: string;
  episodeNumber?: number;
  metadata?: {
    still_path?: string;
    name?: string;
    runtime?: number;
    vote_average?: number;
    air_date?: string;
    overview?: string;
    episode_number?: number;
  };
}

interface SeasonFolderInfo {
  folderName: string;
  seasonNumber: number;
  episodes: EpisodeFileInfo[];
}

// Helper: Extract episode number from filename using various patterns
function extractEpisodeNumber(filename: string, seasonNumber: number): number | undefined {
  // Try SxxExx (but ignore the Sxx part, use folder's seasonNumber)
  let match = filename.match(/S(\d{1,2})E(\d{1,2})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  // Try sXXeYY (ignore sXX, use folder's seasonNumber)
  match = filename.match(/s(\d{2})e(\d{2})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  // Try 1x02 (ignore 1x, use folder's seasonNumber)
  match = filename.match(/(\d{1,2})x(\d{2})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  // Try E02 or Ep02 (use folder's seasonNumber)
  match = filename.match(/E(?:p)?(\d{1,2})/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  // Try .02. or _02_ or -02-
  match = filename.match(/[ ._-](\d{2})[ ._-]/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  // Fallback: log for debugging
  return undefined;
}

export default function TVShowInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: TVShowInfoProps) {
  const theme = useTheme();
  const firstAirYear = data.first_air_date?.slice(0, 4);
  const episodeRuntime = data.episode_run_time && data.episode_run_time[0];
  const creators = data.credits?.crew.filter((c: { job: string }) => c.job === 'Creator');
  const cast = (data.credits?.cast || []).slice(0, 8);
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

  // Helper function to get appropriate icon for file type
  function getFileIcon(name: string, type: string) {
    if (type === 'directory') return <FolderOpenIcon color="primary" />;
    const ext = name.split('.').pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext || "")) return <ImageIcon color="secondary" />;
    if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"].includes(ext || "")) return <MovieIcon color="action" />;
    if (["pdf", "doc", "docx", "txt", "md", "rtf"].includes(ext || "")) return <DescriptionIcon color="success" />;
    return <FileIcon color="disabled" />;
  }

  const [seasonFolders, setSeasonFolders] = useState<SeasonFolderInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [errorFiles, setErrorFiles] = useState<string | null>(null);

  // Dialog and action state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [videoPlayerOpen, setVideoPlayerOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [detailsData, setDetailsData] = useState<any>(null);
  const [renameValue, setRenameValue] = useState('');
  const [snackbar, setSnackbar] = useState<{ open: boolean, message: string, severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  // Add state for dialog
  const [seasonDialogOpen, setSeasonDialogOpen] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<any>(null);
  const [selectedSeasonFolder, setSelectedSeasonFolder] = useState<SeasonFolderInfo | null>(null);

  // Move fetchSeasonFolders to component scope
  async function fetchSeasonFolders() {
    setLoadingFiles(true);
    setErrorFiles(null);
    try {
      const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
      const showFolderPath = `${normalizedPath}/${folderName}`;
      const folderResponse = await axios.get(`/api/files${showFolderPath}`);
      const files: FileItem[] = folderResponse.data;

      // Recursively collect all video files in all subfolders
      async function collectVideoFiles(path: string): Promise<{ file: FileItem; relPath: string }[]> {
        const res = await axios.get(`/api/files${path}`);
        const items: FileItem[] = res.data;
        let result: { file: FileItem; relPath: string }[] = [];
        for (const item of items) {
          if (item.type === 'directory') {
            result = result.concat(await collectVideoFiles(`${path}/${item.name}`));
          } else if (item.type === 'file' && ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'].some(ext => item.name.toLowerCase().endsWith(ext))) {
            result.push({ file: item, relPath: `${path}/${item.name}` });
          }
        }
        return result;
      }

      const allVideoFiles = await collectVideoFiles(showFolderPath);
          
      // Group by season number from filename
      const seasonMap: { [seasonNum: number]: EpisodeFileInfo[] } = {};
      for (const { file, relPath } of allVideoFiles) {
        // Extract season and episode from filename
        let match = file.name.match(/S(\d{1,2})E(\d{1,2})/i) || file.name.match(/s(\d{2})e(\d{2})/i);
        let seasonNum: number | undefined = undefined;
        let episodeNum: number | undefined = undefined;
        if (match) {
          seasonNum = parseInt(match[1], 10);
          episodeNum = parseInt(match[2], 10);
        } else {
          // Try 1x02
          match = file.name.match(/(\d{1,2})x(\d{2})/i);
          if (match) {
            seasonNum = parseInt(match[1], 10);
            episodeNum = parseInt(match[2], 10);
          }
        }
        if (seasonNum === undefined) {
          // fallback: skip file or put in season 0
          seasonNum = 0;
        }
        if (!seasonMap[seasonNum]) seasonMap[seasonNum] = [];
        // Do NOT call /api/readlink here. Just store the file info as-is.
        seasonMap[seasonNum].push({
          name: file.name,
          size: file.size || '--',
          modified: file.modified || '--',
          path: (file.path as string) || '',
          episodeNumber: episodeNum
        });
      }

      // Convert to SeasonFolderInfo[]
      const seasonFoldersData: SeasonFolderInfo[] = Object.entries(seasonMap)
        .filter(([seasonNum, episodes]) => parseInt(seasonNum) > 0 && episodes.length > 0)
        .map(([seasonNum, episodes]) => ({
          folderName: `Season ${seasonNum}`,
          seasonNumber: parseInt(seasonNum),
          episodes: episodes.sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
        }));

      setSeasonFolders(seasonFoldersData);
    } catch (err) {
      setErrorFiles('Failed to fetch episode file information');
    } finally {
      setLoadingFiles(false);
    }
  }

  useEffect(() => {
    if (mediaType === 'tv' && folderName) {
      fetchSeasonFolders();
    }
  }, [folderName, currentPath, mediaType, data.seasons, data.id]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Handlers for FileActionMenu
  const handleViewDetails = async (file: any, details: any) => {
    setSelectedFile(file);
    setDetailsDialogOpen(true);
    // Show loading state in detailsData
    setDetailsData({ loading: true });
    try {
      // Always use the actual file.path
      const res = await axios.post('/api/readlink', { path: file.path });
      const webdavPath = details?.webdavPath || `Home${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}/${file.name}`;
      setDetailsData({
        ...details,
        webdavPath,
        sourcePath: res.data.realPath || res.data.absPath || file.path,
        fullPath: res.data.absPath || file.path
      });
    } catch (err) {
      setDetailsData({ ...details, error: 'Failed to resolve file path' });
    }
  };
  const handleRename = (file: any) => {
    setSelectedFile(file);
    setRenameValue(file.name);
    setRenameDialogOpen(true);
  };
  const handleDeleted = () => {
    setSelectedFile(null);
    setSnackbar({ open: true, message: 'File deleted', severity: 'success' });
    // Optionally, refresh file list here
    fetchSeasonFolders();
  };
  const handleError = (msg: string) => {
    setSnackbar({ open: true, message: msg, severity: 'error' });
  };
  // Rename logic
  const handleRenameConfirm = async () => {
    if (!selectedFile || !renameValue) return;
    try {
      await axios.post('/api/rename', {
        oldPath: selectedFile.path,
        newName: renameValue
      });
      setRenameDialogOpen(false);
      setSnackbar({ open: true, message: 'File renamed', severity: 'success' });
      fetchSeasonFolders();
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.response?.data || 'Rename failed', severity: 'error' });
    }
  };
  // Delete logic
  const handleDeleteConfirm = async () => {
    if (!selectedFile) return;
    try {
      await axios.post('/api/delete', { path: selectedFile.path });
      setDeleteDialogOpen(false);
      setSnackbar({ open: true, message: 'File deleted', severity: 'success' });
      fetchSeasonFolders();
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.response?.data || 'Delete failed', severity: 'error' });
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      {/* TV Show Details */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
        <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
          <img
            src={getPosterUrl(data.poster_path)}
            alt={data.title}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Paper>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" fontWeight={700} gutterBottom sx={{ mb: 1 }}>
            {data.title} {firstAirYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({firstAirYear})</span>}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
            {genres.map((g: { id: number; name: string }) => (
              <Chip key={g.id} label={g.name} color="primary" variant="outlined" />
            ))}
            {episodeRuntime && <Chip label={`${episodeRuntime} min/ep`} color="secondary" variant="outlined" />}
            {data.status && <Chip label={data.status} color="default" variant="outlined" />}
            {country && <Chip label={country} color="default" variant="outlined" />}
          </Box>
          {data.tagline && (
            <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1 }}>
              {data.tagline}
            </Typography>
          )}
          {creators && creators.length > 0 && (
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
              <Typography><b>Created by:</b> {creators.map((c: { name: string }) => c.name).join(', ')}</Typography>
            </Box>
          )}
          <Typography variant="body1" sx={{ mb: 2 }}>{data.overview}</Typography>
        </Box>
      </Box>

      {/* Seasons Section */}
      {data.seasons && data.seasons.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Seasons</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {data.seasons.filter(s => s.season_number > 0).map((season: any) => {
              const folder = seasonFolders.find(f => f.seasonNumber === season.season_number);
              // Reconstruct seasonPath for this season
              const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
              const showFolderPath = `${normalizedPath}/${folderName}`;
              const seasonPath = folder ? `${showFolderPath}/${folder.folderName}` : '';
              const availableCount = folder ? folder.episodes.length : 0;
              const totalCount = season.episode_count || (season.episodes ? season.episodes.length : 0);
              return (
                <Paper key={season.id} elevation={2} sx={{ p: 2, borderRadius: 2, cursor: folder ? 'pointer' : 'default', transition: 'box-shadow 0.2s', '&:hover': { boxShadow: 6, bgcolor: 'action.hover' } }}
                  onClick={() => {
                    if (folder) {
                      setSelectedSeason(season);
                      setSelectedSeasonFolder(folder);
                      setSeasonDialogOpen(true);
                    }
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    {season.poster_path && (
                      <Box sx={{ width: 100, flexShrink: 0 }}>
                        <img
                          src={getPosterUrl(season.poster_path, 'w185')}
                          alt={season.name}
                          style={{ width: '100%', height: 'auto', borderRadius: 8 }}
                        />
                      </Box>
                    )}
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="h6" sx={{ mb: 1 }}>{season.name}</Typography>
                      <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          <span style={{ color: availableCount > 0 ? '#22c55e' : undefined, fontWeight: 700 }}>{availableCount}</span>
                          <span style={{ color: 'inherit', fontWeight: 400 }}>/</span>
                          <span style={{ color: 'inherit', fontWeight: 400 }}>{totalCount}</span> Episodes
                        </Typography>
                        {season.air_date && (
                          <Typography variant="body2" color="text.secondary">
                            Air Date: {new Date(season.air_date).toLocaleDateString()}
                          </Typography>
                        )}
                      </Box>
                      {season.overview && (
                        <Typography variant="body2">{season.overview}</Typography>
                      )}
                    </Box>
                  </Box>
                </Paper>
              );
            })}
          </Box>
          {/* Season Episodes Dialog */}
          <Dialog open={seasonDialogOpen} onClose={() => setSeasonDialogOpen(false)} maxWidth="lg" fullWidth
            PaperProps={{ sx: { maxWidth: { xs: '95vw', md: 900 }, width: { xs: '95vw', md: 'auto' }, m: 0 } }}>
            <DialogTitle>
              {selectedSeason?.name || 'Episodes'}
              <IconButton
                aria-label="close"
                onClick={() => setSeasonDialogOpen(false)}
                sx={{ position: 'absolute', right: 12, top: 12, color: 'grey.500' }}
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ bgcolor: 'background.default', minHeight: 300 }}>
              {loadingFiles ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 2 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2">Loading episode files...</Typography>
                </Box>
              ) : errorFiles ? (
                <Typography color="error" variant="body2" sx={{ mt: 2 }}>{errorFiles}</Typography>
              ) : selectedSeason && selectedSeasonFolder ? (
                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {selectedSeason.episodes && selectedSeason.episodes.length > 0 && selectedSeasonFolder.episodes.map(file => {
                    const ep = selectedSeason.episodes.find((ep: any) => ep.episode_number === file.episodeNumber);
                    return ep ? (
                      <Paper key={file.name} elevation={2} sx={{ p: 0, borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, bgcolor: 'background.paper', boxShadow: theme => theme.palette.mode === 'light' ? '0 4px 24px rgba(0,0,0,0.10)' : 3, maxWidth: { xs: 340, md: 'none' }, mx: { xs: 'auto', md: 0 }, width: { xs: '100%', md: 'auto' } }}>
                        {ep.still_path && (
                          <Box
                            sx={{ width: { xs: '100%', md: 180 }, minWidth: { xs: '100%', md: 120 }, flexShrink: 0, bgcolor: 'grey.900', position: 'relative', display: 'flex', alignItems: 'stretch', aspectRatio: { xs: '16/9', md: 'auto' }, maxHeight: { xs: 140, md: 'none' }, overflow: 'hidden', borderTopLeftRadius: { xs: 12, md: 20 }, borderTopRightRadius: { xs: 12, md: 0 }, borderBottomLeftRadius: { xs: 0, md: 20 }, cursor: 'pointer' }}
                            onClick={() => {
                              // Use the actual file path for streaming, but always send a path relative to rootDir
                              let relPath = file.path;
                              // Remove Windows drive letter or rootDir prefix if present
                              // Example: E:\Testing\Shows\Stranger Things\Season 2\04x01.mp4
                              // rootDir is not available in frontend, so strip up to /Shows or /Movies
                              const match = relPath.match(/([\\/](Shows|Movies)[\\/].*)$/i);
                              if (match) {
                                relPath = match[1].replace(/^\\+|^\/+/,'');
                              } else if (relPath.startsWith('/')) {
                                relPath = relPath.replace(/^\/+/, '');
                              }
                              const encodedPath = encodeURIComponent(relPath);
                              const streamUrl = `/api/stream/${encodedPath}`;
                              setSelectedFile({ ...file, videoUrl: streamUrl });
                              setVideoPlayerOpen(true);
                            }}
                          >
                            <img
                              src={`https://image.tmdb.org/t/p/w300${ep.still_path}`}
                              alt={ep.name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 0 }}
                            />
                            <IconButton
                              aria-label="play"
                              sx={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                bgcolor: 'rgba(0,0,0,0.6)',
                                color: 'white',
                                '&:hover': { bgcolor: 'primary.main' },
                                width: 40,
                                height: 40,
                                zIndex: 2,
                                pointerEvents: 'none',
                              }}
                            >
                              <PlayArrowIcon sx={{ fontSize: 28 }} />
                            </IconButton>
                          </Box>
                        )}
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: { xs: 1.2, md: 3 }, justifyContent: 'center', minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: { xs: 'center', md: 'center' }, gap: 1, mb: 0.5, justifyContent: 'space-between', flexDirection: 'row', width: '100%' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: { xs: '0.98rem', md: '1.1rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ep.episode_number}. {ep.name}
                              </Typography>
                              {ep.runtime && <Typography variant="caption" color="text.secondary">{ep.runtime}m</Typography>}
                              {ep.vote_average > 0 && (
                                <Typography variant="caption" color="text.secondary">★ {ep.vote_average.toFixed(1)}</Typography>
                              )}
                              {ep.air_date && (
                                <Typography variant="caption" color="text.secondary">{new Date(ep.air_date).toLocaleDateString()}</Typography>
                              )}
                            </Box>
                            <FileActionMenu
                              file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path, sourcePath: file.path }}
                              currentPath={selectedSeasonFolder ? `${folderName}/${selectedSeasonFolder.folderName}`.replace(/^\/+/,'') : folderName.replace(/^\/+/,'')}
                              onViewDetails={handleViewDetails}
                              onRename={() => fetchSeasonFolders()}
                              onDeleted={handleDeleted}
                              onError={handleError}
                            />
                          </Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1, minHeight: 30, maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', fontSize: { xs: '0.92rem', md: '1rem' } }}>{ep.overview}</Typography>
                        </Box>
                      </Paper>
                    ) : null;
                  })}
                  {/* Show files with no metadata at the end */}
                  {selectedSeasonFolder.episodes.filter(f => !selectedSeason.episodes.some((ep: any) => ep.episode_number === f.episodeNumber)).map(file => (
                    <Paper key={file.name} elevation={2} sx={{ p: 2, borderRadius: 3, bgcolor: 'background.paper', boxShadow: 2, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>{file.name}</Typography>
                        <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary', fontSize: '0.95em' }}>
                          <Typography variant="body2">{file.size}</Typography>
                          <Typography variant="body2">•</Typography>
                          <Typography variant="body2">{formatDate(file.modified)}</Typography>
                        </Box>
                        <Tooltip title={file.path} placement="top">
                          <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 0.5, fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path}</Typography>
                        </Tooltip>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No metadata found for this file.</Typography>
                        <Box sx={{ mt: 0.5 }}>
                          <FileActionMenu
                            file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path, sourcePath: file.path }}
                            currentPath={selectedSeasonFolder ? `${folderName}/${selectedSeasonFolder.folderName}`.replace(/^\/+/,'') : folderName.replace(/^\/+/,'')}
                            onViewDetails={handleViewDetails}
                            onRename={() => fetchSeasonFolders()}
                            onDeleted={handleDeleted}
                            onError={handleError}
                          />
                        </Box>
                      </Box>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>No episode files found.</Typography>
              )}
            </DialogContent>
          </Dialog>
        </Box>
      )}

      {/* Cast Section */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Cast</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', overflowX: 'auto', pb: 1 }}>
          {cast.map((actor: { id: number; name: string; character: string; profile_path: string | null }) => (
            <Box key={actor.id} sx={{ textAlign: 'center', width: 100 }}>
              <Avatar
                src={getPosterUrl(actor.profile_path, 'w185')}
                alt={actor.name}
                sx={{ width: 80, height: 80, mx: 'auto', mb: 1 }}
              />
              <Typography variant="body2" fontWeight={600}>{actor.name}</Typography>
              <Typography variant="caption" color="text.secondary">{actor.character}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Dialogs for actions */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)}>
        <DialogTitle>Rename File</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="New Name"
            fullWidth
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRenameConfirm} variant="contained">Rename</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete File</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete <b>{selectedFile?.name}</b>?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={detailsDialogOpen} onClose={() => setDetailsDialogOpen(false)} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3, boxShadow: theme => theme.palette.mode === 'light' ? '0 8px 32px 0 rgba(60,60,60,0.18), 0 1.5px 6px 0 rgba(0,0,0,0.10)' : theme.shadows[6] } }}>
        <DialogTitle
          sx={{
            fontWeight: 700,
            fontSize: '1.3rem',
            background: theme.palette.background.paper,
            borderBottom: `1px solid ${theme.palette.divider}`,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            p: 2.5,
            pr: 5
          }}
        >
          Details
          <IconButton
            aria-label="close"
            onClick={() => setDetailsDialogOpen(false)}
            sx={{
              position: 'absolute',
              right: 12,
              top: 12,
              color: theme.palette.grey[500],
            }}
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers={true}
          sx={{
            background: theme.palette.background.default,
            p: 3,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            minWidth: 350,
            maxWidth: 600,
          }}
        >
          {detailsData && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                {getFileIcon(selectedFile?.name || '', 'file')}
                <Typography sx={{ ml: 2, fontWeight: 700, fontSize: '1.15rem', wordBreak: 'break-all', whiteSpace: 'normal' }}>{selectedFile?.name}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                <Typography variant="body2"><b>Type:</b> {selectedFile?.name ? (selectedFile.name.split('.').pop()?.toUpperCase() || 'File') : 'File'}</Typography>
                <Typography variant="body2"><b>Size:</b> {selectedFile?.size || '--'}</Typography>
                <Typography variant="body2"><b>Modified:</b> {formatDate(selectedFile?.modified)}</Typography>
                
                {/* WebDAV path - The path used for WebDAV access, including Home prefix */}
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>WebDAV Path:</b> <span style={{ fontFamily: 'monospace' }}>
                    {detailsData?.webdavPath || (selectedFile?.path ? `Home${currentPath}/${folderName}/${selectedFile.path.split('/').pop()}` : '--')}
                  </span>
                </Typography>
                
                {/* Source Path - The actual path on disk where the file is located (from readlink) */}
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>Source Path:</b> <span style={{ fontFamily: 'monospace' }}>
                    {detailsData?.sourcePath || selectedFile?.path || '--'}
                  </span>
                </Typography>
                
                {/* Full path - The actual path on the server */}
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>Full Path:</b> <span style={{ fontFamily: 'monospace' }}>
                    {detailsData?.fullPath || '--'}
                  </span>
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
      <VideoPlayerDialog
        open={videoPlayerOpen}
        onClose={() => setVideoPlayerOpen(false)}
        url={selectedFile?.videoUrl}
        title={selectedFile?.name}
        mimeType={selectedFile?.videoMimeType}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
} 