import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  CircularProgress,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Divider,
  useTheme,
  useMediaQuery,
  Pagination,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { useLayoutContext } from '../Layout/Layout';
import { searchTmdb } from '../api/tmdbApi';
import { TmdbResult } from '../api/tmdbApi';
import { FileItem } from './types';
import { getFileIcon, joinPaths, formatDate, parseTitleYearFromFolder } from './fileUtils';
import { fetchFiles as fetchFilesApi } from './fileApi';
import { getPosterFromCache, setPosterInCache, invalidateCache } from './tmdbCache';
import Header from './Header';
import PosterView from './PosterView';
import ListView from './ListView';

const TMDB_CONCURRENCY_LIMIT = 4;
const ITEMS_PER_PAGE = 100;

// Reusable pagination component
const PaginationComponent = ({ totalPages, page, onPageChange, isMobile }: { 
  totalPages: number;
  page: number;
  onPageChange: (event: React.ChangeEvent<unknown>, value: number) => void;
  isMobile: boolean;
}) => {
  if (totalPages <= 1) return null;
  
  return (
    <Box sx={{ 
      display: 'flex', 
      justifyContent: 'center', 
      mt: 4, 
      mb: 2,
      '& .MuiPagination-ul': {
        gap: { xs: 0.5, sm: 1 }
      }
    }}>
      <Pagination 
        count={totalPages} 
        page={page} 
        onChange={onPageChange}
        color="primary"
        size={isMobile ? "small" : "medium"}
        showFirstButton 
        showLastButton
      />
    </Box>
  );
};

export default function FileBrowser() {
  const navigate = useNavigate();
  const params = useParams();
  const { view, setView, handleRefresh } = useLayoutContext();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const urlPath = params['*'] || '';
  const currentPath = '/' + urlPath;
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  
  // Dialog states
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<FileItem | null>(null);
  
  // TMDB related states
  const [tmdbData, setTmdbData] = useState<{ [key: string]: TmdbResult | null }>({});
  const [folderHasAllowed, setFolderHasAllowed] = useState<{ [folder: string]: boolean }>({});
  const [imgLoadedMap, setImgLoadedMap] = useState<{ [key: string]: boolean }>({});
  
  // Refs for tracking requests
  const tmdbFetchRef = useRef<{ [key: string]: boolean }>({});
  const folderFetchRef = useRef<{ [key: string]: boolean }>({});
  const tmdbQueue = useRef<{ name: string; title: string; year?: string; mediaType?: 'movie' | 'tv' }[]>([]);
  const tmdbActive = useRef(0);
  const [tmdbQueueVersion, setTmdbQueueVersion] = useState(0);

  // Memoized filtered and sorted files
  const filteredFiles = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return searchTerm
      ? files.filter(f => f.name.toLowerCase().includes(searchTerm))
      : files;
  }, [files, search]);

  const sortedFiles = useMemo(() => {
    return [...filteredFiles].sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [filteredFiles]);

  const paginatedFiles = useMemo(() => {
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    return sortedFiles.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedFiles, page]);

  const totalPages = useMemo(() => 
    Math.max(1, Math.ceil(sortedFiles.length / ITEMS_PER_PAGE))
  , [sortedFiles.length]);

  // Reset to page 1 when files change
  useEffect(() => {
    if (page > totalPages) {
      setPage(1);
    }
  }, [totalPages, page]);

  const enqueueTmdbLookup = useCallback((name: string, title: string, year: string | undefined, mediaType: 'movie' | 'tv' | undefined) => {
    tmdbQueue.current.push({ name, title, year, mediaType });
    setTmdbQueueVersion(v => v + 1);
  }, []);

  useEffect(() => {
    if (tmdbActive.current >= TMDB_CONCURRENCY_LIMIT) return;
    if (tmdbQueue.current.length === 0) return;

    while (tmdbActive.current < TMDB_CONCURRENCY_LIMIT && tmdbQueue.current.length > 0) {
      const { name, title, year, mediaType } = tmdbQueue.current.shift()!;
      tmdbActive.current++;

      const cacheKeyTitle = title || '';
      const cacheKeyMediaType = mediaType || '';
      const cached = getPosterFromCache(cacheKeyTitle, cacheKeyMediaType);

      if (cached && cached.poster_path) {
        setTmdbData(prev => ({ ...prev, [name]: cached }));
        tmdbActive.current--;
        setTmdbQueueVersion(v => v + 1);
        continue;
      }

      searchTmdb(title, year, mediaType).then(apiResult => {
        if (apiResult) {
          let finalData = { ...apiResult };
          if (cached) {
            finalData = { ...cached, ...apiResult, poster_path: apiResult.poster_path || cached.poster_path || null };
          }

          if (apiResult.media_type && (apiResult.media_type === 'movie' || apiResult.media_type === 'tv')) {
            if (finalData.media_type !== 'movie' && finalData.media_type !== 'tv') {
              finalData.media_type = apiResult.media_type;
            }
          }

          if (finalData.media_type === 'movie' || finalData.media_type === 'tv') {
            setPosterInCache(cacheKeyTitle, cacheKeyMediaType, finalData);
            setTmdbData(prev => ({ ...prev, [name]: finalData }));
          } else {
            setTmdbData(prev => ({ ...prev, [name]: finalData }));
          }
        } else if (cached) {
          setTmdbData(prev => ({ ...prev, [name]: cached }));
        } else {
          setTmdbData(prev => ({ ...prev, [name]: null }));
        }
      }).finally(() => {
        tmdbActive.current--;
        setTmdbQueueVersion(v => v + 1);
      });
    }
  }, [tmdbQueueVersion]);

  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const { data: files } = await fetchFilesApi(path, true);
      setFiles(files);
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

  const handlePageChange = (_: React.ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleFileClick = (file: FileItem, tmdb: TmdbResult | null) => {
    if (file.type === 'directory' && !file.isSeasonFolder) {
      if (tmdb?.poster_path) {
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
    } else if (file.type === 'directory' && file.isSeasonFolder) {
      handlePathClick(joinPaths(currentPath, file.name));
    }
  };

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
        fetchFilesApi(folderApiPath, true)
          .then(({ hasAllowed }) => {
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: hasAllowed }));
          })
          .catch(() => {
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: false }));
          });
      }
    });
  }, [filteredFiles, view, currentPath]);

  useEffect(() => {
    if (view !== 'poster') return;

    filteredFiles.forEach(file => {
      if (file.type !== 'directory' || file.isSeasonFolder) return;

      const existingTmdbInfo = tmdbData[file.name];
      const hasPoster = !!(existingTmdbInfo && existingTmdbInfo.poster_path);
      const fetchAttempted = tmdbFetchRef.current[file.name];

      if (hasPoster || fetchAttempted) return;

      const isMovie = !file.hasSeasonFolders;
      if (isMovie && !folderHasAllowed[file.name]) return;

      tmdbFetchRef.current[file.name] = true;

      if (file.tmdbId) {
        const mediaTypeFromFile = isMovie ? 'movie' : 'tv';
        const tmdbId = file.tmdbId;
        
        // Check if TMDB ID has changed
        if (existingTmdbInfo && existingTmdbInfo.id !== parseInt(tmdbId)) {
          invalidateCache(existingTmdbInfo.id, mediaTypeFromFile);
        }
        
        const cached = getPosterFromCache(tmdbId, mediaTypeFromFile);

        if (cached && cached.poster_path) {
          setTmdbData(prev => ({ ...prev, [file.name]: cached }));
          return;
        }

        searchTmdb(tmdbId, undefined, mediaTypeFromFile).then(apiResult => {
          if (apiResult) {
            let finalData = { ...apiResult };
            if (cached) {
              finalData = { ...cached, ...apiResult, poster_path: apiResult.poster_path || cached.poster_path || null };
            }

            if (apiResult.media_type && (apiResult.media_type === 'movie' || apiResult.media_type === 'tv')) {
              if (finalData.media_type !== 'movie' && finalData.media_type !== 'tv') {
                finalData.media_type = apiResult.media_type;
              }
            }
            if (finalData.media_type !== 'movie' && finalData.media_type !== 'tv') {
              finalData.media_type = mediaTypeFromFile;
            }

            if (finalData.media_type === 'movie' || finalData.media_type === 'tv') {
              setPosterInCache(tmdbId, finalData.media_type, finalData);
              setTmdbData(prev => ({ ...prev, [file.name]: finalData }));
            } else {
              setTmdbData(prev => ({ ...prev, [file.name]: finalData }));
            }
          } else if (cached) {
            setTmdbData(prev => ({ ...prev, [file.name]: cached }));
          } else {
            setTmdbData(prev => ({ ...prev, [file.name]: null }));
          }
        });
      } else {
        const { title, year } = parseTitleYearFromFolder(file.name);
        const mediaTypeForQueue = isMovie ? undefined : 'tv';
        enqueueTmdbLookup(file.name, title, year, mediaTypeForQueue);
      }
    });
  }, [filteredFiles, view, folderHasAllowed, tmdbData, currentPath, enqueueTmdbLookup]);

  useEffect(() => {
    if (view !== 'poster') return;
    if (!filteredFiles.length) return;
    setTmdbData(prev => {
      const newData = { ...prev };
      const newImgLoaded: { [key: string]: boolean } = {};
      filteredFiles.forEach(file => {
        if (file.type === 'directory' && !newData[file.name]) {
          const mediaType = file.hasSeasonFolders ? 'tv' : 'movie';
          const cacheKey = file.tmdbId ? file.tmdbId : file.name;
          const cached = getPosterFromCache(cacheKey, file.tmdbId ? mediaType : '');
          if (cached) {
            newData[file.name] = { ...cached, release_date: newData[file.name]?.release_date || cached.release_date };
            if (cached.poster_path) {
              newImgLoaded[file.name] = true;
            }
          }
          if (!newData[file.name]) {
            const { title: parsedTitle, year: parsedYear } = parseTitleYearFromFolder(file.name);
            if (parsedTitle) {
              newData[file.name] = {
                id: 0,
                title: parsedTitle,
                overview: '',
                poster_path: null,
                release_date: parsedYear ? `${parsedYear}-01-01` : undefined,
                media_type: mediaType,
              };
            }
          }
        }
      });
      setImgLoadedMap(prevImg => ({ ...prevImg, ...newImgLoaded }));
      return newData;
    });
  }, [filteredFiles, view]);

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
      <Header
        currentPath={currentPath}
        search={search}
        view={view}
        onPathClick={handlePathClick}
        onUpClick={handleUpClick}
        onSearchChange={setSearch}
        onViewChange={setView}
        onRefresh={handleRefresh}
      />

      {view === 'poster' ? (
        <>
          <PosterView
            files={paginatedFiles}
            tmdbData={tmdbData}
            folderHasAllowed={folderHasAllowed}
            imgLoadedMap={imgLoadedMap}
            onFileClick={handleFileClick}
            setImgLoadedMap={setImgLoadedMap}
          />
          <PaginationComponent 
            totalPages={totalPages}
            page={page}
            onPageChange={handlePageChange}
            isMobile={isMobile}
          />
        </>
      ) : (
        <>
          <ListView
            files={paginatedFiles}
            currentPath={currentPath}
            formatDate={formatDate}
            onItemClick={(file) => handleFileClick(file, null)}
            onViewDetails={handleViewDetails}
            onRename={() => fetchFiles(currentPath)}
            onDeleted={() => fetchFiles(currentPath)}
            onError={setError}
          />
          <PaginationComponent 
            totalPages={totalPages}
            page={page}
            onPageChange={handlePageChange}
            isMobile={isMobile}
          />
        </>
      )}

      <Dialog 
        open={detailsOpen} 
        onClose={handleDetailsClose} 
        maxWidth="sm" 
        fullWidth
        PaperProps={{ 
          sx: { 
            borderRadius: 3,
            boxShadow: theme => theme.palette.mode === 'light' 
              ? '0 8px 32px 0 rgba(60,60,60,0.18), 0 1.5px 6px 0 rgba(0,0,0,0.10)' 
              : theme.shadows[6] 
          } 
        }}
      >
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
                <Typography sx={{ ml: 2, fontWeight: 700, fontSize: '1.15rem', wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  {detailsData.name}
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                <Typography variant="body2"><b>Type:</b> {detailsData.type === 'directory' ? 'Directory' : 'File'}</Typography>
                <Typography variant="body2"><b>Size:</b> {detailsData.type === 'directory' ? '--' : detailsData.size || '--'}</Typography>
                <Typography variant="body2"><b>Modified:</b> {formatDate(detailsData.modified)}</Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>WebDAV Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.webdavPath || '--'}</span>
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>Full Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.fullPath || '--'}</span>
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                  <b>Source Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.sourcePath || '--'}</span>
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
} 