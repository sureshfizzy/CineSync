import { Box, Typography, Chip, Paper, Avatar, CircularProgress, Tooltip, IconButton, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, TextField, Snackbar, Alert } from '@mui/material';
import { MediaDetailsData } from '../types/MediaTypes';
import axios from 'axios';
import { useEffect, useState } from 'react';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileActionMenu from './FileActionMenu';
import VideoPlayerDialog from './VideoPlayerDialog';

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
  console.warn('Could not extract episode number from filename:', filename, 'for season', seasonNumber);
  return undefined;
}

export default function TVShowInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: TVShowInfoProps) {
  const firstAirYear = data.first_air_date?.slice(0, 4);
  const episodeRuntime = data.episode_run_time && data.episode_run_time[0];
  const creators = data.credits?.crew.filter((c: { job: string }) => c.job === 'Creator');
  const cast = (data.credits?.cast || []).slice(0, 8);
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

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

      // Map TMDB season_number to folder
      const seasonFolderMap: { [seasonNum: number]: string } = {};
      files.forEach(file => {
        if (file.type === 'directory' && file.isSeasonFolder) {
          const match = file.name.match(/(season[ _-]?|s)(\d{1,2})/i);
          if (match) {
            const num = parseInt(match[2], 10);
            if (!isNaN(num)) {
              seasonFolderMap[num] = file.name;
            }
          } else {
            const digits = file.name.match(/(\d{1,2})/);
            if (digits) {
              const num = parseInt(digits[1], 10);
              if (!isNaN(num)) {
                seasonFolderMap[num] = file.name;
              }
            }
          }
        }
      });

      // For each TMDB season, fetch episode files and their metadata
      const seasonFoldersData: SeasonFolderInfo[] = [];
      const tmdbSeasons = (data.seasons || []).filter(s => s.season_number > 0);

      for (const tmdbSeason of tmdbSeasons) {
        const folder = seasonFolderMap[tmdbSeason.season_number];
        if (!folder) continue;

        const seasonPath = `${showFolderPath}/${folder}`;
        const seasonResponse = await axios.get(`/api/files${seasonPath}`);
        const episodeFiles = seasonResponse.data.filter((file: FileItem) =>
          file.type === 'file' &&
          ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'].some(ext =>
            file.name.toLowerCase().endsWith(ext)
          )
        );

        // Process episode files and extract episode numbers
        const episodes: EpisodeFileInfo[] = [];
        for (const episode of episodeFiles) {
          const relPath = `${seasonPath}/${episode.name}`;
          const pathInfo = await axios.post('/api/readlink', { path: relPath });
          
          // Extract episode number from filename
          const episodeNumber = extractEpisodeNumber(episode.name, tmdbSeason.season_number);
          if (episodeNumber === undefined) {
            console.warn('No episode number extracted for file:', episode.name, 'in season', tmdbSeason.season_number);
          }
          
          episodes.push({
            name: episode.name,
            size: episode.size || '--',
            modified: episode.modified || '--',
            path: pathInfo.data.realPath || pathInfo.data.absPath || relPath,
            episodeNumber
          });
        }

        if (episodes.length > 0) {
          // Only fetch metadata for episodes that exist
          const episodeNumbers = episodes.map(ep => ep.episodeNumber).filter(num => num !== undefined);
          if (episodeNumbers.length > 0) {
            try {
              const seasonDetailsResponse = await axios.get(
                `/api/tmdb/details?id=${data.id}&mediaType=tv&season=${tmdbSeason.season_number}&episodes=${episodeNumbers.join(',')}`
              );
              
              if (seasonDetailsResponse.data && seasonDetailsResponse.data.seasons) {
                const seasonData = seasonDetailsResponse.data.seasons.find(
                  (s: any) => s.season_number === tmdbSeason.season_number
                );
                if (seasonData && seasonData.episodes) {
                  // Match metadata with files
                  episodes.forEach(episode => {
                    if (episode.episodeNumber) {
                      const metadata = seasonData.episodes.find(
                        (e: any) => e.episode_number === episode.episodeNumber
                      );
                      if (metadata) {
                        episode.metadata = metadata;
                      } else {
                        console.warn('No metadata found for file:', episode.name, 'with episode number:', episode.episodeNumber);
                      }
                    }
                  });
                }
              }
            } catch (err) {
              console.error('Error fetching episode metadata:', err);
            }
          }

          seasonFoldersData.push({
            folderName: folder,
            seasonNumber: tmdbSeason.season_number,
            episodes
          });
        }
      }

      setSeasonFolders(seasonFoldersData);
    } catch (err) {
      setErrorFiles('Failed to fetch episode file information');
      console.error('Error fetching episode files:', err);
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
  const handleViewDetails = (file: any, details: any) => {
    setSelectedFile(file);
    setDetailsData(details);
    setDetailsDialogOpen(true);
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
                              const relPath = `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}/${selectedSeasonFolder.folderName}/${file.name}`.replace(/\/+/g, '/').replace(/\/$/, '');
                              const encodedPath = encodeURIComponent(relPath.replace(/^\/+/,''));
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
                              file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path }}
                              currentPath={selectedSeasonFolder ? `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}/${selectedSeasonFolder.folderName}` : ''}
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
                            file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path }}
                            currentPath={selectedSeasonFolder ? `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}/${selectedSeasonFolder.folderName}` : ''}
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
      <Dialog open={detailsDialogOpen} onClose={() => setDetailsDialogOpen(false)}>
        <DialogTitle>File Details</DialogTitle>
        <DialogContent>
          <Typography variant="body2"><b>Name:</b> {selectedFile?.name}</Typography>
          <Typography variant="body2"><b>Path:</b> {detailsData?.fullPath || selectedFile?.path}</Typography>
          <Typography variant="body2"><b>WebDAV Path:</b> {detailsData?.webdavPath}</Typography>
          <Typography variant="body2"><b>Source Path:</b> {detailsData?.sourcePath}</Typography>
          <Typography variant="body2"><b>Size:</b> {selectedFile?.size}</Typography>
          <Typography variant="body2"><b>Modified:</b> {selectedFile?.modified}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailsDialogOpen(false)}>Close</Button>
        </DialogActions>
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