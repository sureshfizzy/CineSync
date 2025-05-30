import React, { useEffect, useState, useRef, useMemo } from 'react';
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
import { setPosterInCache } from './tmdbCache';
import { useTmdb } from '../../contexts/TmdbContext';
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
  const { tmdbData, imgLoadedMap, updateTmdbData, setImageLoaded, getTmdbDataFromCache } = useTmdb();

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

  // Refs for tracking requests
  const folderFetchRef = useRef<{ [key: string]: boolean }>({});
  const tmdbQueue = useRef<{ name: string; title: string; year?: string; mediaType?: 'movie' | 'tv' }[]>([]);
  const tmdbActive = useRef(0);
  const [tmdbQueueVersion, setTmdbQueueVersion] = useState(0);

  // TMDB related states
  const [folderHasAllowed] = useState<{ [folder: string]: boolean }>({});

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



  useEffect(() => {
    if (tmdbActive.current >= TMDB_CONCURRENCY_LIMIT) return;
    if (tmdbQueue.current.length === 0) return;

    while (tmdbActive.current < TMDB_CONCURRENCY_LIMIT && tmdbQueue.current.length > 0) {
      const { name, title, year, mediaType } = tmdbQueue.current.shift()!;
      tmdbActive.current++;

      const cached = getTmdbDataFromCache(name, mediaType);
      if (cached?.poster_path) {
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
            setPosterInCache(name, mediaType || '', finalData);
            updateTmdbData(name, finalData);
          } else {
            updateTmdbData(name, finalData);
          }
        } else if (cached) {
          updateTmdbData(name, cached);
        } else {
          updateTmdbData(name, null);
        }
      }).finally(() => {
        tmdbActive.current--;
        setTmdbQueueVersion(v => v + 1);
      });
    }
  }, [tmdbQueueVersion, getTmdbDataFromCache, updateTmdbData]);

  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchFilesApi(path, true);

      if (!Array.isArray(response.data)) {
        // Silent error handling for unexpected response format
        setError('Unexpected response format from server');
        setFiles([]);
        return;
      }

      // Add TMDB info to files based on response headers
      const filesWithTmdb = response.data.map(file => {
        if (file.type === 'directory') {
          // If the file already has a tmdbId from the backend, use that
          if (!file.tmdbId && response.tmdbId) {
            return {
              ...file,
              tmdbId: response.tmdbId,
              hasSeasonFolders: response.hasSeasonFolders || response.mediaType === 'tv'
            };
          }
        }
        return file;
      });

      setFiles(filesWithTmdb);

      // If we have TMDB info, fetch the poster
      if (response.tmdbId && response.mediaType) {
        searchTmdb(response.tmdbId, undefined, response.mediaType).then(result => {
          if (result) {
            updateTmdbData(path, result);
          }
        });
      }
    } catch (err) {
      setError('Failed to fetch files');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  // Listen for page refresh events from symlink cleanup
  useEffect(() => {
    const handlePageRefresh = () => {
      // Refresh the current directory
      fetchFiles(currentPath);
    };

    window.addEventListener('symlink-page-refresh', handlePageRefresh);

    return () => {
      window.removeEventListener('symlink-page-refresh', handlePageRefresh);
    };
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
        const isTvShow = file.mediaType === 'tv' || file.hasSeasonFolders;
        const tmdbId = tmdb?.id;
        const fullPath = currentPath.endsWith('/') ? currentPath : `${currentPath}/`;
        const mediaPath = joinPaths(currentPath, file.name);
        navigate(`/media${mediaPath}`, {
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
        file.tmdbId && // Only check directories with TMDB IDs
        !tmdbData[file.name] && // Only if we don't already have the data
        !folderFetchRef.current[file.name]
      ) {
        folderFetchRef.current[file.name] = true;
        const mediaType = file.mediaType || (file.hasSeasonFolders ? 'tv' : 'movie');
        searchTmdb(file.tmdbId, undefined, mediaType).then(result => {
          if (result) {
            updateTmdbData(file.name, result);
          }
        });
      }
    });
  }, [filteredFiles, view, tmdbData, updateTmdbData]);

  useEffect(() => {
    if (view !== 'poster') return;
    if (!filteredFiles.length) return;

    filteredFiles.forEach(file => {
      if (file.type === 'directory' && !tmdbData[file.name]) {
        const mediaType = file.mediaType || (file.hasSeasonFolders ? 'tv' : 'movie');
        const cached = getTmdbDataFromCache(file.name, mediaType);

        if (!cached) {
          const { title: parsedTitle, year: parsedYear } = parseTitleYearFromFolder(file.name);
          if (parsedTitle) {
            updateTmdbData(file.name, {
              id: 0,
              title: parsedTitle,
              overview: '',
              poster_path: null,
              release_date: parsedYear ? `${parsedYear}-01-01` : undefined,
              media_type: mediaType,
            });
          }
        }
      }
    });
  }, [filteredFiles, view, tmdbData, getTmdbDataFromCache, updateTmdbData]);

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
            onImageLoad={(key: string) => setImageLoaded(key, true)}
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