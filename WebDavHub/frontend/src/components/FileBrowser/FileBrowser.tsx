import React from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  IconButton,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
  useMediaQuery,
  useTheme,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  Divider,
  TextField,
} from '@mui/material';
import {
  NavigateBefore as UpIcon,
  Refresh as RefreshIcon,
  ViewList as ViewListIcon,
  GridView as GridViewIcon,
  Close as CloseIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { useLayoutContext } from '../Layout/Layout';
import { searchTmdb, getTmdbPosterUrl, TmdbResult } from '../api/tmdbApi';
import Skeleton from '@mui/material/Skeleton';
import FileActionMenu from './FileActionMenu';
import { getFileIcon, joinPaths, formatDate, parseTitleYearFromFolder } from './fileUtils.tsx';
import { FileItem } from './types';
import MobileListItem from './MobileListItem';
import MobileBreadcrumbs from './MobileBreadcrumbs';
import { fetchFiles as fetchFilesApi } from './fileApi';

const TMDB_CONCURRENCY_LIMIT = 4;

export default function FileBrowser() {
  const navigate = useNavigate();
  const params = useParams();
  const { view, setView, handleRefresh } = useLayoutContext();
  // Get the wildcard path from the URL (e.g., /files/path/to/folder)
  const urlPath = params['*'] || '';
  const currentPath = '/' + urlPath;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<FileItem | null>(null);
  const [search, setSearch] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [tmdbData, setTmdbData] = useState<{ [key: string]: TmdbResult | null }>({});
  const tmdbFetchRef = useRef<{ [key: string]: boolean }>({});
  const allowedExtensions = (import.meta.env.VITE_ALLOWED_EXTENSIONS as string | undefined)?.split(',').map(ext => ext.trim().toLowerCase()).filter(Boolean) || [];
  const [folderHasAllowed, setFolderHasAllowed] = useState<{ [folder: string]: boolean }>({});
  const folderFetchRef = useRef<{ [folder: string]: boolean }>({});
  const [tvShowHasAllowed, setTvShowHasAllowed] = useState<{ [folder: string]: boolean }>({});
  const tvShowFetchRef = useRef<{ [folder: string]: boolean }>({});
  const [imgLoadedMap, setImgLoadedMap] = useState<{ [key: string]: boolean }>({});
  // TMDb lookup queue state
  const tmdbQueue = useRef<{ name: string; title: string; year?: string; mediaType?: 'movie' | 'tv' }[]>([]);
  const tmdbActive = useRef(0);
  const [tmdbQueueVersion, setTmdbQueueVersion] = useState(0); // force rerender/queue check

  // Helper to enqueue a TMDb lookup
  const enqueueTmdbLookup = useCallback((name: string, title: string, year: string | undefined, mediaType: 'movie' | 'tv' | undefined) => {
    tmdbQueue.current.push({ name, title, year, mediaType });
    setTmdbQueueVersion(v => v + 1); // trigger queue processing
  }, []);

  // TMDb queue processor
  useEffect(() => {
    if (tmdbActive.current >= TMDB_CONCURRENCY_LIMIT) return;
    if (tmdbQueue.current.length === 0) return;

    while (tmdbActive.current < TMDB_CONCURRENCY_LIMIT && tmdbQueue.current.length > 0) {
      const { name, title, year, mediaType } = tmdbQueue.current.shift()!;
      tmdbActive.current++;
      searchTmdb(title, year, mediaType).then(result => {
        setTmdbData(prev => ({ ...prev, [name]: result }));
      }).finally(() => {
        tmdbActive.current--;
        setTmdbQueueVersion(v => v + 1); // trigger next in queue
      });
    }
  }, [tmdbQueueVersion]);

  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFilesApi(path);
      setFiles(data);
    } catch (err) {
      setError('Failed to fetch files');
      console.error('Error fetching files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  const handlePathClick = (path: string) => {
    // Normalize the path and remove trailing slash for the URL
    const normalizedPath = joinPaths(path);
    const urlPath = normalizedPath.replace(/\/$/, '');
    navigate(`/files${urlPath}`);
  };

  const handleUpClick = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const parentPath = joinPaths(...parts.slice(0, -1));
    handlePathClick(parentPath);
  };

  const handleViewDetails = (file: FileItem, details: any) => {
    setDetailsData({ ...file, ...details });
    setDetailsOpen(true);
  };

  const handleDetailsClose = () => setDetailsOpen(false);

  const pathParts = currentPath.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, index) => {
    const path = '/' + pathParts.slice(0, index + 1).join('/') + '/';
    return (
      <Link
        key={path}
        component="button"
        variant="body1"
        onClick={() => handlePathClick(path)}
        sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
      >
        {part}
      </Link>
    );
  });

  const filteredFiles = search.trim()
    ? files.filter(f => f.name.toLowerCase().includes(search.trim().toLowerCase()))
    : files;

  // For each folder in poster view, fetch its contents and check for allowed files
  useEffect(() => {
    if (view !== 'poster') return;
    filteredFiles.forEach(file => {
      if (
        file.type === 'directory' &&
        folderHasAllowed[file.name] === undefined &&
        !folderFetchRef.current[file.name]
      ) {
        folderFetchRef.current[file.name] = true;
        const folderApiPath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
        console.log(`[TMDB] Fetching contents for folder: ${folderApiPath}`);
        fetchFilesApi(folderApiPath)
          .then(res => {
            const hasAllowed = (res || []).some((f: any) =>
              f.type === 'file' && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
            );
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: hasAllowed }));
            if (hasAllowed) {
              console.log(`[TMDB] Folder '${file.name}' contains allowed files, will trigger TMDb search.`);
            } else {
              console.log(`[TMDB] Folder '${file.name}' does not contain allowed files.`);
            }
          })
          .catch(err => {
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: false }));
            console.error(`[TMDB] Error fetching folder contents for '${file.name}':`, err);
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, view, currentPath, allowedExtensions]);

  // Instead of calling searchTmdb directly, enqueue lookups
  useEffect(() => {
    if (view !== 'poster') return;
    filteredFiles.forEach(file => {
      const isTvShow = file.hasSeasonFolders;
      const isSeasonFolder = file.isSeasonFolder;
      if (
        file.type === 'directory' &&
        !isSeasonFolder &&
        (
          (isTvShow && !tmdbData[file.name] && !tmdbFetchRef.current[file.name]) ||
          (!isTvShow && folderHasAllowed[file.name] && !tmdbData[file.name] && !tmdbFetchRef.current[file.name])
        )
      ) {
        const { title, year } = parseTitleYearFromFolder(file.name);
        tmdbFetchRef.current[file.name] = true;
        enqueueTmdbLookup(file.name, title, year, isTvShow ? 'tv' : undefined);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, view, folderHasAllowed, tmdbData, currentPath]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ mt: 2 }}>
        {error}
      </Typography>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {isMobile ? (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center',
            width: '100%',
            minWidth: 0,
            px: 1
          }}>
            <MobileBreadcrumbs currentPath={currentPath} onPathClick={handlePathClick} />
          </Box>
        ) : (
          <>
            <Tooltip title="Up">
              <span>
                <IconButton onClick={handleUpClick} disabled={currentPath === '/'}>
                  <UpIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Breadcrumbs sx={{ flexGrow: 1 }} separator=" / ">
              <Link
                component="button"
                variant="body1"
                onClick={() => handlePathClick('/')}
                sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
              >
                Home
              </Link>
              {breadcrumbs}
            </Breadcrumbs>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ minWidth: 220, maxWidth: 320 }}>
                <TextField
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search files and folders..."
                  size="small"
                  variant="outlined"
                  fullWidth
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
                    endAdornment: search && (
                      <IconButton size="small" onClick={() => setSearch('')}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    ),
                    sx: { borderRadius: 2, background: theme.palette.background.paper }
                  }}
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="Poster view">
                  <IconButton 
                    onClick={() => setView('poster')} 
                    color={view === 'poster' ? 'primary' : 'default'}
                  >
                    <GridViewIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="List view">
                  <IconButton 
                    onClick={() => setView('list')} 
                    color={view === 'list' ? 'primary' : 'default'}
                  >
                    <ViewListIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Refresh">
                  <IconButton onClick={handleRefresh} color="primary">
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </>
        )}
      </Box>

      {isMobile && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, maxWidth: 400 }}>
          <TextField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files and folders..."
            size="small"
            variant="outlined"
            fullWidth
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
              endAdornment: search && (
                <IconButton size="small" onClick={() => setSearch('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              ),
              sx: { borderRadius: 2, background: theme.palette.background.paper }
            }}
          />
        </Box>
      )}

      {view === 'poster' ? (
        <Box sx={{ 
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
          {filteredFiles.length === 0 ? (
            <Box sx={{ gridColumn: '1/-1', textAlign: 'center', py: 6 }}>
              <Typography color="text.secondary">
                {search ? 'No files or folders match your search.' : 'This folder is empty.'}
              </Typography>
            </Box>
          ) : (
            filteredFiles.map((file) => {
              const tmdb = tmdbData[file.name];
              const isTvShow = file.hasSeasonFolders;
              const isSeasonFolder = file.isSeasonFolder;
              const showPoster = file.type === 'directory' && !isSeasonFolder && (
                (isTvShow && tmdb && tmdb.poster_path) ||
                (!isTvShow && folderHasAllowed[file.name] && tmdb && tmdb.poster_path)
              );
              const isLoadingPoster = file.type === 'directory' && !isSeasonFolder && (
                (isTvShow && !tmdb) ||
                (!isTvShow && folderHasAllowed[file.name] && !tmdb)
              );
              const loaded = imgLoadedMap[file.name] || false;
              return (
              <Paper 
                key={file.name} 
                sx={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center',
                  cursor: file.type === 'directory' ? 'pointer' : 'default',
                  transition: 'all 0.2s ease-in-out',
                  boxShadow: 2,
                  borderRadius: 3,
                  overflow: 'hidden',
                  position: 'relative',
                  '&:hover': { 
                    transform: 'translateY(-4px)',
                    boxShadow: 6,
                    background: theme.palette.action.selected 
                  }
                }}
                onClick={() => {
                  if (file.type === 'directory' && !isSeasonFolder) {
                    if (showPoster) {
                      const isTvShow = file.hasSeasonFolders;
                      const tmdbId = tmdb?.id;
                      const fullPath = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
                      navigate(`/media/${encodeURIComponent(file.name)}`, { 
                        state: { 
                          mediaType: isTvShow ? 'tv' : 'movie', 
                          tmdbId,
                          hasSeasonFolders: file.hasSeasonFolders,
                          currentPath: fullPath,
                          tmdbData: tmdb
                        } 
                      });
                    } else {
                      handlePathClick(joinPaths(currentPath, file.name));
                    }
                  } else if (file.type === 'directory' && isSeasonFolder) {
                    handlePathClick(joinPaths(currentPath, file.name));
                  }
                }}
              >
                <Box sx={{ 
                  width: '100%', 
                  aspectRatio: '3/4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: theme.palette.background.default,
                  p: 0,
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                    {isLoadingPoster ? (
                      <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" />
                    ) : showPoster ? (
                      <img
                        src={getTmdbPosterUrl(tmdb.poster_path) || ''}
                        alt={tmdb.title || file.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          opacity: loaded ? 1 : 0,
                          transition: 'opacity 0.5s ease',
                          display: 'block',
                        }}
                        onLoad={() => setImgLoadedMap(prev => ({ ...prev, [file.name]: true }))}
                      />
                    ) : (
                      getFileIcon(file.name, file.type)
                    )}
                </Box>
                <Box sx={{ 
                  width: '100%', 
                  p: 2, 
                  background: theme.palette.background.paper,
                  borderTop: `1px solid ${theme.palette.divider}`
                }}>
                  <Typography 
                    sx={{ 
                      fontWeight: 500, 
                      textAlign: 'center', 
                      fontSize: { xs: '0.9rem', sm: '1rem' }, 
                      wordBreak: 'break-all',
                      mb: 0.5,
                      lineHeight: 1.2,
                      maxHeight: '1.4em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'block',
                    }}
                  >
                      {file.type === 'directory' && tmdb && tmdb.title && (isTvShow || folderHasAllowed[file.name]) ? tmdb.title : file.name}
                  </Typography>
                </Box>
              </Paper>
              );
            })
          )}
        </Box>
      ) : (
        <>
          {isMobile ? (
            <Paper 
              elevation={2}
              sx={{ 
                width: '100%',
                overflow: 'hidden',
                borderRadius: 2,
                bgcolor: 'background.default'
              }}
            >
              {filteredFiles.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    {search ? 'No files or folders match your search.' : 'This folder is empty.'}
                  </Typography>
                </Box>
              ) : (
                filteredFiles.map((file) => (
                  <MobileListItem
                    key={file.name}
                    file={file}
                    formatDate={formatDate}
                    onItemClick={() => {
                      if (file.type === 'directory') {
                        handlePathClick(joinPaths(currentPath, file.name));
                      }
                    }}
                    menu={
                      <FileActionMenu
                        file={file}
                        currentPath={currentPath}
                        onViewDetails={handleViewDetails}
                        onRename={() => fetchFiles(currentPath)}
                        onDeleted={() => fetchFiles(currentPath)}
                        onError={setError}
                      />
                    }
                  />
                ))
              )}
            </Paper>
          ) : (
            <TableContainer component={Paper} sx={{
              width: '100%',
              maxWidth: '100vw',
              overflowX: 'auto',
              boxShadow: 3,
              borderRadius: 3,
            }}>
              <Table sx={{
                tableLayout: 'fixed',
                '& td, & th': {
                  px: 2,
                  py: 1.5,
                  '&:first-of-type': { width: '50%' },
                  '&:nth-of-type(2)': { width: '15%' },
                  '&:nth-of-type(3)': { width: '25%' },
                  '&:last-child': { width: '10%' },
                },
              }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Modified</TableCell>
                    <TableCell align="right"></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        <Typography color="text.secondary" sx={{ py: 4 }}>
                          {search ? 'No files or folders match your search.' : 'This folder is empty.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFiles.map((file) => (
                      <TableRow
                        key={file.name}
                        hover
                        onClick={() => {
                          if (file.type === 'directory') {
                            handlePathClick(joinPaths(currentPath, file.name));
                          }
                        }}
                        sx={{ 
                          cursor: file.type === 'directory' ? 'pointer' : 'default',
                          transition: 'background-color 0.2s',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            <Box sx={{ mr: 2, display: 'flex' }}>
                              {getFileIcon(file.name, file.type)}
                            </Box>
                            <Typography
                              sx={{
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {file.name}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>{file.type === 'directory' ? '--' : file.size}</TableCell>
                        <TableCell>{formatDate(file.modified)}</TableCell>
                        <TableCell align="right" onClick={e => e.stopPropagation()}>
                          <FileActionMenu
                            file={file}
                            currentPath={currentPath}
                            onViewDetails={handleViewDetails}
                            onRename={() => fetchFiles(currentPath)}
                            onDeleted={() => fetchFiles(currentPath)}
                            onError={setError}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <Dialog open={detailsOpen} onClose={handleDetailsClose} maxWidth="sm" fullWidth
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
            onClick={handleDetailsClose}
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
                {getFileIcon(detailsData.name, detailsData.type)}
                <Typography sx={{ ml: 2, fontWeight: 700, fontSize: '1.15rem', wordBreak: 'break-all', whiteSpace: 'normal' }}>{detailsData.name}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                <Typography variant="body2"><b>Type:</b> {detailsData.type === 'directory' ? 'Directory' : 'File'}</Typography>
                <Typography variant="body2"><b>Size:</b> {detailsData.type === 'directory' ? '--' : detailsData.size || '--'}</Typography>
                <Typography variant="body2"><b>Modified:</b> {formatDate(detailsData.modified)}</Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>WebDAV Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.webdavPath || '--'}</span></Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>Full Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.fullPath || '--'}</span></Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>Source Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.sourcePath || '--'}</span></Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
} 