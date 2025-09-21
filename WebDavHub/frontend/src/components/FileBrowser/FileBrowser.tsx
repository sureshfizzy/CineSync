import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, CircularProgress, Typography, Dialog, DialogTitle, DialogContent, IconButton, Divider, useTheme, useMediaQuery, Pagination, Fade } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { debounce } from '@mui/material/utils';
import { useLayoutContext } from '../Layout/Layout';
import { searchTmdb } from '../api/tmdbApi';
import { TmdbResult } from '../api/tmdbApi';
import { FileItem, SortOption } from './types';
import { getFileIcon, joinPaths, formatDate, sortFiles } from './fileUtils';
import { fetchFiles as fetchFilesApi } from './fileApi';
import { setPosterInCache } from './tmdbCache';
import { useTmdb } from '../../contexts/TmdbContext';
import { useSSEEventListener } from '../../hooks/useCentralizedSSE';
import { BulkSelectionProvider } from '../../contexts/BulkSelectionContext';
import { useBulkSelectionSafe } from '../../hooks/useBulkSelectionSafe';
import Header from './Header';
import PosterView from './PosterView';
import ListView from './ListView';
import AlphabetIndex from './AlphabetIndex';
import ConfigurationPlaceholder from './ConfigurationPlaceholder';
import axios from 'axios';

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

// FileBrowserContent component that uses the bulk selection context
const FileBrowserContent: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { view, setView, handleRefresh } = useLayoutContext();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { tmdbData, imgLoadedMap, updateTmdbData, setImageLoaded, getTmdbDataFromCache } = useTmdb();
  
  // Use bulk selection
  const { isSelectionMode, toggleSelectionMode, exitSelectionMode } = useBulkSelectionSafe();

  const urlPath = params['*'] || '';
  const currentPath = '/' + urlPath;

  // Exit selection mode when navigating to a different path
  useEffect(() => {
    exitSelectionMode();
  }, [currentPath, exitSelectionMode]);

  const pageFromUrl = parseInt(searchParams.get('page') || '1', 10);
  const searchFromUrl = searchParams.get('search') || '';
  const letterFromUrl = searchParams.get('letter') || null;
  const [page, setPageState] = useState(pageFromUrl);


  const setPage = useCallback((newPage: number) => {
    setPageState(newPage);
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('page', newPage.toString());

    // Preserve the letter filter when changing pages
    const currentLetter = searchParams.get('letter');
    if (currentLetter) {
      newSearchParams.set('letter', currentLetter);
    }

    setSearchParams(newSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(searchFromUrl);
  const [isSearching, setIsSearching] = useState(false);
  const [isLetterFiltering, setIsLetterFiltering] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>('name-asc');
  const [selectedLetter, setSelectedLetter] = useState<string | null>(letterFromUrl);
  const [configStatus, setConfigStatus] = useState<{
    isPlaceholder: boolean;
    destinationDir: string;
    effectiveRootDir: string;
    needsConfiguration: boolean;
  } | null>(null);

  // Dialog states
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<FileItem | null>(null);

  // Refs for tracking requests
  const folderFetchRef = useRef<{ [key: string]: boolean }>({});
  const tmdbProcessingRef = useRef<{ [key: string]: boolean }>({});
  const batchProcessingRef = useRef<boolean>(false);
  const isInitialMount = useRef(true);

  const filteredFiles = useMemo(() => {
    return sortFiles(files, sortOption);
  }, [files, sortOption]);

  const [totalPages, setTotalPages] = useState(1);
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<{current: number, total: number} | null>(null);

  useEffect(() => {
    const urlPage = parseInt(searchParams.get('page') || '1', 10);
    const urlSearch = searchParams.get('search') || '';

    if (urlPage !== page) {
      setPageState(urlPage);
    }

    if (urlSearch !== search) {
      setSearch(urlSearch);
    }
  }, [searchParams.get('page'), searchParams.get('search')]);

  useEffect(() => {
    if (hasLoadedData && page > totalPages && totalPages > 0) {
      setPage(1);
    }
  }, [totalPages, page, setPage, hasLoadedData]);

  useEffect(() => {
    folderFetchRef.current = {};
  }, [page]);

  useEffect(() => {
    folderFetchRef.current = {};
    tmdbProcessingRef.current = {};
    batchProcessingRef.current = false;
    setSelectedLetter(null);
    setProcessingProgress(null);
  }, [currentPath]);

  useEffect(() => {
    if (search.trim()) {
      setSelectedLetter(null);
    }
  }, [search]);

  useEffect(() => {
    const checkConfigStatus = async () => {
      try {
        const response = await axios.get('/api/config-status');
        setConfigStatus(response.data);
      } catch (err) {
        console.error('Failed to check config status:', err);
      }
    };

    checkConfigStatus();

    const handleConfigStatusRefresh = () => {
      checkConfigStatus();
    };

    window.addEventListener('config-status-refresh', handleConfigStatusRefresh);

    return () => {
      window.removeEventListener('config-status-refresh', handleConfigStatusRefresh);
    };
  }, []);

  const fetchFiles = async (path: string, pageNum: number = page, searchQuery?: string, isSearchOperation: boolean = false, letterFilter?: string) => {
    if (!isSearchOperation) {
      setLoading(true);
    }
    setError('');
    try {
      const response = await fetchFilesApi(path, true, pageNum, ITEMS_PER_PAGE, searchQuery, letterFilter);

      if (response.headers && response.headers['x-needs-configuration'] === 'true') {
        setFiles([]);
        if (!isSearchOperation) {
          setLoading(false);
        }
        return;
      }

      if (!Array.isArray(response.data)) {

        setError('Unexpected response format from server');
        setFiles([]);
        return;
      }

      const filesWithTmdb = response.data.map(file => {
        if (file.type === 'directory') {
          if (file.tmdbId) {
            if (file.posterPath && file.mediaType) {
              const normalizedMediaType = file.mediaType.toLowerCase();
              const tmdbData = {
                id: parseInt(file.tmdbId),
                title: file.title || file.name,
                poster_path: file.posterPath,
                backdrop_path: null,
                media_type: normalizedMediaType,
                release_date: file.releaseDate || '',
                first_air_date: file.firstAirDate || '',
                overview: ''
              };
              updateTmdbData(file.name, tmdbData);
              setPosterInCache(file.name, normalizedMediaType, tmdbData);
            }
          }

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
      setTotalPages(response.totalPages);
      setHasLoadedData(true);

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
      setHasLoadedData(true);
    } finally {
      if (!isSearchOperation) {
        setLoading(false);
      }
    }
  };

  // Create a debounced refresh function for cases where full refresh is needed
  const debouncedRefresh = useCallback(
    debounce((path: string) => {
      fetchFiles(path, page, search);
    }, 1000),
    [page, search]
  );

  useEffect(() => {
    const currentUrlPage = parseInt(searchParams.get('page') || '1', 10);
    const currentUrlLetter = searchParams.get('letter') || undefined;
    fetchFiles(currentPath, currentUrlPage, search, false, currentUrlLetter);
  }, [currentPath]);

  useEffect(() => {
    const currentUrlPage = parseInt(searchParams.get('page') || '1', 10);
    const currentUrlLetter = searchParams.get('letter') || undefined;
    if (currentUrlPage !== page) {
      fetchFiles(currentPath, currentUrlPage, search, false, currentUrlLetter);
    }
  }, [searchParams.get('page')]);

  useEffect(() => {
    const letterFromUrl = searchParams.get('letter') || null;
    if (letterFromUrl !== selectedLetter) {
      setSelectedLetter(letterFromUrl);
    }
  }, [searchParams.get('letter')]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const loadingTimeoutId = setTimeout(() => {
      setIsSearching(true);
    }, 400);

    const timeoutId = setTimeout(() => {
      const newSearchParams = new URLSearchParams(searchParams);
      if (search.trim()) {
        newSearchParams.set('search', search.trim());
        if (page !== 1) {
          setPage(1);
          newSearchParams.set('page', '1');
        }
      } else {
        newSearchParams.delete('search');
        if (page !== 1) {
          setPage(1);
          newSearchParams.set('page', '1');
        }
      }
      setSearchParams(newSearchParams);

      const currentUrlLetter = searchParams.get('letter') || undefined;
      fetchFiles(currentPath, search.trim() ? 1 : page, search.trim() || undefined, true, currentUrlLetter);
      setIsSearching(false);
    }, 800);

    return () => {
      clearTimeout(loadingTimeoutId);
      clearTimeout(timeoutId);
      setIsSearching(false);
    };
  }, [search]);

  // Helper function to check if a symlink affects the current directory
  const symlinkAffectsCurrentDirectory = useCallback((data: any) => {
    if (!data.destination_file) return false;

    // Normalize paths for comparison
    const normalizePathForComparison = (path: string) => {
      return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    };

    const normalizedDestination = normalizePathForComparison(data.destination_file);
    const normalizedCurrentPath = normalizePathForComparison(currentPath);

    // Extract the directory from the destination file path
    const destinationDir = normalizedDestination.substring(0, normalizedDestination.lastIndexOf('/'));
    const finalDestinationDir = destinationDir === '' ? '/' : destinationDir;
    const finalCurrentPath = normalizedCurrentPath === '' ? '/' : normalizedCurrentPath;

    // Check if the destination directory matches the current path
    return finalDestinationDir === finalCurrentPath;
  }, [currentPath]);

  // Listen for symlink creation events through centralized SSE (similar to FileOperations)
  useSSEEventListener(
    ['symlink_created'],
    (event: any) => {
      const data = event.data;

      // Only update if the symlink affects the current directory
      if (symlinkAffectsCurrentDirectory(data)) {
        debouncedRefresh(currentPath);
      }
    },
    {
      source: 'mediahub',
      dependencies: [symlinkAffectsCurrentDirectory, debouncedRefresh, currentPath]
    }
  );

  useEffect(() => {
    const handlePageRefresh = () => {
      // Use debounced refresh for page refresh events as well
      debouncedRefresh(currentPath);
    };

    window.addEventListener('symlink-page-refresh', handlePageRefresh);

    return () => {
      window.removeEventListener('symlink-page-refresh', handlePageRefresh);
    };
  }, [currentPath, debouncedRefresh]);

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedRefresh.clear();
    };
  }, [debouncedRefresh]);

  const handlePathClick = (path: string) => {
    const normalizedPath = joinPaths(path);
    const urlPath = normalizedPath.replace(/\/$/, '');
    navigate(`/files${urlPath}`);
  };

  const handleNavigateBack = () => {
    const pathParts = currentPath.split('/').filter(Boolean);
    if (pathParts.length > 0) {
      pathParts.pop();
      const parentPath = pathParts.length > 0 ? `/${pathParts.join('/')}` : '/';
      navigate(`/files${parentPath === '/' ? '' : parentPath}`);
    } else {
      navigate('/files');
    }
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
    fetchFiles(currentPath, value, search, search.trim().length > 0, selectedLetter || undefined);
  };

  const handleLetterClick = (letter: string | null) => {
    const newLetter = selectedLetter === letter ? null : letter;

    if (newLetter !== selectedLetter) {
      setIsLetterFiltering(true);
      setSelectedLetter(newLetter);

      const newSearchParams = new URLSearchParams(searchParams);
      if (newLetter) {
        newSearchParams.set('letter', newLetter);
      } else {
        newSearchParams.delete('letter');
      }

      if (page !== 1) {
        setPage(1);
        newSearchParams.set('page', '1');
      }

      setSearchParams(newSearchParams, { replace: true });

      fetchFiles(currentPath, 1, search, search.trim().length > 0, newLetter || undefined)
        .then(() => {
          setIsLetterFiltering(false);
        })
        .catch(() => {
          setIsLetterFiltering(false);
        });
    }
  };

  const handleFileClick = (file: FileItem, tmdb: TmdbResult | null) => {
    if (file.type === 'directory' && !file.isSeasonFolder) {
      if (tmdb || file.tmdbId) {
        const isTvShow = file.mediaType === 'tv' || file.hasSeasonFolders;
        const tmdbId = tmdb?.id || file.tmdbId;

        // Use the correct path from search results (with base_path)
        const mediaPath = file.path || file.fullPath || joinPaths(currentPath, file.name);

        // Calculate the correct parent path for the media item
        const mediaPathParts = mediaPath.split('/').filter(Boolean);
        mediaPathParts.pop();
        const parentPath = '/' + mediaPathParts.join('/') + (mediaPathParts.length > 0 ? '/' : '');

        navigate(`/media${mediaPath}`, {
          state: {
            mediaType: isTvShow ? 'tv' : 'movie',
            tmdbId,
            hasSeasonFolders: file.hasSeasonFolders,
            currentPath: parentPath,
            tmdbData: tmdb,
            returnPage: page, // Preserve current page for navigation back
            returnSearch: search // Preserve current search for navigation back
          }
        });
      } else {
        const targetPath = file.path || file.fullPath || joinPaths(currentPath, file.name);
        handlePathClick(targetPath);
      }
    } else if (file.type === 'directory' && file.isSeasonFolder) {
      const targetPath = file.path || file.fullPath || joinPaths(currentPath, file.name);
      handlePathClick(targetPath);
    }
  };

  const handleListViewFileClick = (file: FileItem) => {
    if (file.type === 'directory') {
      // Use the correct path from search results (with base_path) or construct from current path
      const targetPath = file.path || file.fullPath || joinPaths(currentPath, file.name);
      handlePathClick(targetPath);
    }
  };

  useEffect(() => {
    if (view !== 'poster') return;

    // First, process files that already have poster data from the backend
    const filesWithPosterData = filteredFiles.filter((file: any) =>
      file.type === 'directory' &&
      file.posterPath && // Backend already provided poster data
      !tmdbData[file.name] // Only if we don't already have the data in state
    );

    // Immediately update state with backend-provided data
    if (filesWithPosterData.length > 0) {
      console.log(`🎬 Using backend poster data for ${filesWithPosterData.length} items`);
    }

    filesWithPosterData.forEach((file: any) => {
      const dbData = {
        id: parseInt(file.tmdbId || '0'),
        title: file.title || file.name,
        poster_path: file.posterPath,
        backdrop_path: null,
        media_type: file.mediaType?.toLowerCase() || 'movie',
        release_date: file.releaseDate || '',
        first_air_date: file.firstAirDate || '',
        overview: ''
      };
      updateTmdbData(file.name, dbData);
      setPosterInCache(file.name, dbData.media_type, dbData);
    });

    // Only process items that need TMDB API calls (no poster data from backend)
    const itemsToProcess = filteredFiles.filter((file: any) =>
      file.type === 'directory' &&
      file.tmdbId && // Only check directories with TMDB IDs
      !file.posterPath && // Backend didn't provide poster data
      !tmdbData[file.name] && // Only if we don't already have the data
      !folderFetchRef.current[file.name] &&
      !tmdbProcessingRef.current[file.name]
    );

    if (itemsToProcess.length === 0) return;

    // Prevent multiple batch processing sessions
    if (batchProcessingRef.current) {
      console.log(`🎬 Batch processing already in progress, skipping`);
      return;
    }

    console.log(`🎬 Need to fetch TMDB data for ${itemsToProcess.length} items without backend poster data`);

    // Set initial processing progress
    if (itemsToProcess.length > 0) {
      setProcessingProgress({ current: 0, total: itemsToProcess.length });
    }

    batchProcessingRef.current = true;

    const processInParallel = async () => {
      // Optimized settings for faster loading while maintaining UI responsiveness
      const CONCURRENT_LIMIT = 8; // Increased for faster loading
      const BATCH_SIZE = 12; // Larger batches for efficiency

      const processBatch = async (batch: any[]) => {
        const promises = batch.map(async (file) => {
          if (folderFetchRef.current[file.name] || tmdbProcessingRef.current[file.name] || tmdbData[file.name]) {
            return;
          }

          folderFetchRef.current[file.name] = true;
          tmdbProcessingRef.current[file.name] = true;
          const mediaType = (file.mediaType || (file.hasSeasonFolders ? 'tv' : 'movie')).toLowerCase();

          try {
            if (file.posterPath && file.tmdbId && file.mediaType) {
              const normalizedMediaType = file.mediaType.toLowerCase();
              const dbData = {
                id: parseInt(file.tmdbId),
                title: file.title || file.name,
                poster_path: file.posterPath,
                backdrop_path: null,
                media_type: normalizedMediaType,
                release_date: file.releaseDate || '',
                overview: ''
              };
              updateTmdbData(file.name, dbData);
              setPosterInCache(file.name, normalizedMediaType, dbData);
              return;
            }

            const cached = getTmdbDataFromCache(file.name, mediaType);
            if (cached?.poster_path) {
              updateTmdbData(file.name, cached);
              return;
            }

            if (file.tmdbId && file.mediaType) {
              const normalizedFileMediaType = file.mediaType.toLowerCase() as 'movie' | 'tv';
              const apiResult = await searchTmdb(file.tmdbId, undefined, normalizedFileMediaType, 3);
              if (apiResult) {
                let finalPosterPath = apiResult.poster_path;
                if (file.posterPath) {
                  finalPosterPath = file.posterPath;
                }

                let finalData = {
                  ...apiResult,
                  poster_path: finalPosterPath,
                  id: parseInt(file.tmdbId),
                  media_type: file.mediaType
                };

                if (cached) {
                  finalData = { ...cached, ...finalData };
                }

                if (finalData.media_type === 'movie' || finalData.media_type === 'tv') {
                  setPosterInCache(file.name, finalData.media_type, finalData);
                  updateTmdbData(file.name, finalData);
                } else {
                  updateTmdbData(file.name, finalData);
                }
                return;
              }
            }

            const apiResult = await searchTmdb(file.name, undefined, mediaType, 3);
            if (apiResult) {
              let finalData = { ...apiResult };
              if (cached) {
                finalData = { ...cached, ...apiResult, poster_path: apiResult.poster_path || cached.poster_path || null };
              }

              if (finalData.media_type === 'movie' || finalData.media_type === 'tv') {
                setPosterInCache(file.name, finalData.media_type, finalData);
                updateTmdbData(file.name, finalData);
              } else {
                updateTmdbData(file.name, finalData);
              }
            } else if (cached) {
              updateTmdbData(file.name, cached);
            } else {
              updateTmdbData(file.name, null);
            }
          } catch (error: any) {
            console.error(`Failed to fetch TMDB data for ${file.name}:`, error);
            const cached = getTmdbDataFromCache(file.name, mediaType);
            updateTmdbData(file.name, cached || null);
          } finally {
            tmdbProcessingRef.current[file.name] = false;
          }
        });

        await Promise.allSettled(promises);
      };

      // Process ALL items in controlled batches
      for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
        console.log(`🎬 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(itemsToProcess.length / BATCH_SIZE)}: ${batch.length} items`);

        // Process items in this batch with concurrency control
        for (let j = 0; j < batch.length; j += CONCURRENT_LIMIT) {
          const concurrentBatch = batch.slice(j, j + CONCURRENT_LIMIT);
          await processBatch(concurrentBatch);
        }

        // Update progress
        const processed = Math.min(i + BATCH_SIZE, itemsToProcess.length);
        setProcessingProgress({ current: processed, total: itemsToProcess.length });

        // Yield control to browser for UI updates with minimal delay
        if (i + BATCH_SIZE < itemsToProcess.length) {
          await new Promise(resolve => {
            requestAnimationFrame(() => {
              setTimeout(resolve, 50); // Further reduced delay for faster loading
            });
          });
        }
      }

      // Clear processing progress when done
      setProcessingProgress(null);
      batchProcessingRef.current = false;
    };

    processInParallel().catch((error) => {
      console.error('Batch processing failed:', error);
      setProcessingProgress(null);
      batchProcessingRef.current = false;
    });
  }, [filteredFiles, view, page]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  // Show configuration placeholder if needed
  if (configStatus?.needsConfiguration) {
    return (
      <ConfigurationPlaceholder
        destinationDir={configStatus.destinationDir}
        effectiveRootDir={configStatus.effectiveRootDir}
      />
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
    <Box sx={{ flexGrow: 1, position: 'relative' }}>
      <Header
        currentPath={currentPath}
        search={search}
        view={view}
        sortOption={sortOption}
        isSearching={isSearching}
        isSelectionMode={isSelectionMode}
        onPathClick={handlePathClick}
        onUpClick={handleUpClick}
        onSearchChange={setSearch}
        onViewChange={setView}
        onSortChange={setSortOption}
        onRefresh={handleRefresh}
        onToggleSelectionMode={toggleSelectionMode}
      />

      {/* Processing Progress Indicator */}
      {processingProgress && (
        <Box sx={{
          position: 'fixed',
          top: 70,
          right: 16,
          zIndex: 1000,
          bgcolor: 'background.paper',
          borderRadius: 2,
          p: 2,
          boxShadow: 2,
          minWidth: 200
        }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Loading posters... {processingProgress.current}/{processingProgress.total}
          </Typography>
          <Box sx={{ width: '100%', bgcolor: 'grey.300', borderRadius: 1, height: 4 }}>
            <Box
              sx={{
                width: `${(processingProgress.current / processingProgress.total) * 100}%`,
                bgcolor: 'primary.main',
                height: '100%',
                borderRadius: 1,
                transition: 'width 0.3s ease'
              }}
            />
          </Box>
        </Box>
      )}

      {/* Alphabet Index */}
      <AlphabetIndex
        selectedLetter={selectedLetter}
        onLetterClick={handleLetterClick}
        loading={isLetterFiltering}
      />

      <Fade in={!isLetterFiltering} timeout={300}>
        <Box>
          {view === 'poster' ? (
            <>
              <PosterView
                files={filteredFiles}
                tmdbData={tmdbData}
                imgLoadedMap={imgLoadedMap}
                onFileClick={handleFileClick}
                onImageLoad={(key: string) => setImageLoaded(key, true)}
                currentPath={currentPath}
                onViewDetails={handleViewDetails}
                onRename={() => debouncedRefresh(currentPath)}
                onDeleted={() => debouncedRefresh(currentPath)}
                onNavigateBack={handleNavigateBack}
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
                files={filteredFiles}
                currentPath={currentPath}
                formatDate={formatDate}
                onItemClick={handleListViewFileClick}
                onViewDetails={handleViewDetails}
                onRename={() => debouncedRefresh(currentPath)}
                onDeleted={() => debouncedRefresh(currentPath)}
                onError={setError}
                onNavigateBack={handleNavigateBack}
              />
              <PaginationComponent
                totalPages={totalPages}
                page={page}
                onPageChange={handlePageChange}
                isMobile={isMobile}
              />
            </>
          )}
        </Box>
      </Fade>

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
};

export default function FileBrowser() {
  return (
    <BulkSelectionProvider>
      <FileBrowserContent />
    </BulkSelectionProvider>
  );
}