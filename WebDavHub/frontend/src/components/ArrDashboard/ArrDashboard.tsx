import { useEffect, useMemo, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography, Fade, Paper, ToggleButtonGroup, ToggleButton, alpha, Collapse, IconButton } from '@mui/material';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';
import { FileItem, SortOption } from '../FileBrowser/types';
import { fetchFiles as fetchFilesApi } from '../FileBrowser/fileApi';
import { formatDate, joinPaths, sortFiles } from '../FileBrowser/fileUtils';
import FolderIcon from '@mui/icons-material/Folder';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import StraightenIcon from '@mui/icons-material/Straighten';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import SortRoundedIcon from '@mui/icons-material/SortRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PosterView from '../FileBrowser/PosterView';
import ListView from '../FileBrowser/ListView';
import { useLayoutContext } from '../Layout/Layout';
import { useTmdb } from '../../contexts/TmdbContext';
import { setPosterInCache } from '../FileBrowser/tmdbCache';
import { TmdbResult } from '../api/tmdbApi';
import { useNavigate } from 'react-router-dom';
import ArrSearchPage from './ArrSearchPage';

export default function ArrDashboard() {
  const { view } = useLayoutContext();
  const navigate = useNavigate();

  const { tmdbData, imgLoadedMap, updateTmdbData, setImageLoaded } = useTmdb();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [sortOption] = useState<SortOption>('name-asc');
  const [dashSort, setDashSort] = useState<'title' | 'path' | 'size' | 'folder'>('title');
  const [showSort, setShowSort] = useState(false);
  const getInitialFilter = () => {
    const saved = localStorage.getItem('arrSidebarFilter');
    return saved === 'movies' || saved === 'series' ? saved : 'all';
  };
  const [arrFilter, setArrFilter] = useState<'all' | 'movies' | 'series'>(getInitialFilter);
  
  // New search page state
  const [showSearchPage, setShowSearchPage] = useState(false);
  const [searchMediaType, setSearchMediaType] = useState<'movie' | 'tv'>('movie');
  
  useEffect(() => {
    const filterHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const val = detail?.filter;
      if (val === 'movies' || val === 'series' || val === 'all') {
        setArrFilter(val);
        setShowSearchPage(false);
        loadArrItems();
      }
    };
    
    const searchHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const mediaType = detail?.mediaType;
      if (mediaType === 'movie' || mediaType === 'tv') {
        setSearchMediaType(mediaType);
        setShowSearchPage(true);
      }
    };
    
    window.addEventListener('arrSidebarFilterChanged', filterHandler as EventListener);
    window.addEventListener('arrSearchRequested', searchHandler as EventListener);
    
    return () => {
      window.removeEventListener('arrSidebarFilterChanged', filterHandler as EventListener);
      window.removeEventListener('arrSearchRequested', searchHandler as EventListener);
    };
  }, []);
  
  const [files, setFiles] = useState<FileItem[]>([]);


  // Fetch root to get base_path folders
  const loadArrItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const root = await fetchFilesApi('/', true, 1, 100);
      const baseFolders = (root.data || []).filter(f => f.type === 'directory');

      const results: FileItem[] = [];

      await Promise.all(
        baseFolders.map(async (folder) => {
          const basePath = folder.path || folder.fullPath || joinPaths('/', folder.name);
          try {
            const resp = await fetchFilesApi(basePath, true, 1, 200);
            const inner = (resp.data || [])
              .filter(item => {
                if (item.isCategoryFolder) return false;
                if (item.name === folder.name && item.type === 'directory') return false;
                return true;
              })
              .map(item => {
                const fullOrPath = item.path || item.fullPath || joinPaths(basePath, item.name);
                return {
                  ...item,
                  path: fullOrPath,
                  fullPath: fullOrPath,
                } as FileItem;
              });

            inner.forEach((it) => {
              if (it.type === 'directory' && it.tmdbId && it.posterPath && it.mediaType) {
                const normalizedMediaType = it.mediaType.toLowerCase() as 'movie' | 'tv';
                const dbData = {
                  id: parseInt(it.tmdbId),
                  title: it.title || it.name,
                  poster_path: it.posterPath,
                  backdrop_path: null,
                  media_type: normalizedMediaType,
                  release_date: it.releaseDate || '',
                  first_air_date: it.firstAirDate || '',
                  overview: ''
                };
                updateTmdbData(it.name, dbData);
                setPosterInCache(it.name, normalizedMediaType, dbData);
              }
            });

            results.push(...inner);
          } catch (e) {
          }
        })
      );

      setFiles(results);
    } catch (e) {
      setError('Failed to load dashboard items');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [updateTmdbData]);

  useEffect(() => {
    loadArrItems();
  }, [loadArrItems]);

  const filteredSorted = useMemo(() => {
    const base = arrFilter === 'movies' ? files.filter(f => f.mediaType === 'movie')
      : arrFilter === 'series' ? files.filter(f => f.mediaType === 'tv')
      : files;
    if (dashSort === 'title') {
      return sortFiles(base, sortOption);
    }

    const parseSizeToBytes = (sizeStr?: string): number => {
      if (!sizeStr || sizeStr === '--') return 0;
      const units: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
      const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/i);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2].toUpperCase();
      return value * (units[unit] || 1);
    };

    const getParentFolder = (p?: string): string => {
      const s = (p || '').replace(/\\/g, '/');
      const parts = s.split('/').filter(Boolean);
      parts.pop();
      return parts.join('/') || '';
    };

    const getFullPath = (f: FileItem): string => (f.fullPath || f.path || '/' + f.name).replace(/\\/g, '/');

    const byPath = (a: FileItem, b: FileItem) => getFullPath(a).localeCompare(getFullPath(b), undefined, { sensitivity: 'base' });
    const bySizeDesc = (a: FileItem, b: FileItem) => parseSizeToBytes(b.size) - parseSizeToBytes(a.size);
    const byFolder = (a: FileItem, b: FileItem) => getParentFolder(getFullPath(a)).localeCompare(getParentFolder(getFullPath(b)), undefined, { sensitivity: 'base' });
    const comparator = dashSort === 'path' ? byPath
      : dashSort === 'size' ? bySizeDesc
      : byFolder;

    return [...base].sort(comparator);
  }, [files, sortOption, dashSort, arrFilter]);

  const handleFileClick = (file: FileItem, tmdb: TmdbResult | null) => {
    if (file.type === 'directory' && !file.isSeasonFolder) {
      const isTvShow = file.mediaType === 'tv' || file.hasSeasonFolders;
      const tmdbId = tmdb?.id || file.tmdbId;

      if (tmdbId) {
        const mediaPath = file.path || file.fullPath || joinPaths('/', file.name);
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
            returnPage: 1,
            returnSearch: ''
          }
        });
      } else {
        const targetPath = file.path || file.fullPath || joinPaths('/', file.name);
        navigate(`/files${targetPath}`);
      }
    } else if (file.type === 'directory' && file.isSeasonFolder) {
      const targetPath = file.path || file.fullPath || joinPaths('/', file.name);
      navigate(`/files${targetPath}`);
    }
  };

  const handleListItemClick = (file: FileItem) => {
    if (file.type === 'directory') {
      const targetPath = file.path || file.fullPath || joinPaths('/', file.name);
      navigate(`/files${targetPath}`);
    }
  };

  // Show search page if active
  if (showSearchPage) {
    return (
      <ArrSearchPage
        mediaType={searchMediaType}
        onBack={() => setShowSearchPage(false)}
      />
    );
  }

  return (
    <ConfigurationWrapper>
      <Box sx={{ px: { xs: 0.8, sm: 1, md: 0 }, maxWidth: 1600, mx: 'auto' }}>

        {/* Sort controls */}
        <Box sx={{ mb: 1 }}>
          {/* Collapsible header */}
          <Box
            role="button"
            tabIndex={0}
            onClick={() => setShowSort(s => !s)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowSort(s => !s); }}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.6, cursor: 'pointer' }}
          >
            <Box sx={{
              backgroundColor: (theme) => `${theme.palette.primary.main}15`,
              borderRadius: '10px',
              p: 0.5,
              border: (theme) => `1px solid ${theme.palette.primary.main}30`
            }}>
              <SortRoundedIcon sx={{ color: 'primary.main', fontSize: 18 }} />
            </Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ fontSize: { xs: '0.95rem', sm: '1.05rem' } }}>
              Sort by
            </Typography>
            <IconButton size="small" sx={{ ml: 0.5 }}>
              <ExpandMoreIcon sx={{ transform: showSort ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }} />
            </IconButton>
          </Box>

          <Collapse in={showSort} timeout={200} unmountOnExit>
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Paper sx={{ p: 0.5, borderRadius: 999, border: '1px solid', borderColor: alpha('#ffffff', 0.08) }}>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={dashSort}
                    onChange={(_, v) => { if (v) setDashSort(v); }}
                    sx={{
                      '& .MuiToggleButtonGroup-grouped': {
                        border: 0,
                        textTransform: 'none',
                        fontWeight: 700,
                        px: 1.25,
                        borderRadius: 999,
                        '&:not(:first-of-type)': { ml: 0.5 },
                      },
                      '& .MuiToggleButton-root.Mui-selected': {
                        bgcolor: alpha('#4ECDC4', 0.16),
                        color: '#4ECDC4',
                      }
                    }}
                  >
                    <ToggleButton value="title" aria-label="Sort by title">
                      <DashboardCustomizeIcon sx={{ fontSize: 16, mr: 0.5 }} /> Title
                    </ToggleButton>
                    <ToggleButton value="path" aria-label="Sort by path">
                      <AltRouteIcon sx={{ fontSize: 16, mr: 0.5 }} /> Path
                    </ToggleButton>
                    <ToggleButton value="size" aria-label="Sort by size">
                      <StraightenIcon sx={{ fontSize: 16, mr: 0.5 }} /> Size
                    </ToggleButton>
                    <ToggleButton value="folder" aria-label="Sort by folder">
                      <FolderIcon sx={{ fontSize: 16, mr: 0.5 }} /> Folder
                    </ToggleButton>
                
                  </ToggleButtonGroup>
                </Paper>
              </Box>
              <Typography variant="caption" sx={{ mt: 0.5, color: 'text.secondary', display: 'block' }}>
                {dashSort === 'title' && 'Sorting by title'}
                {dashSort === 'path' && 'Sorting by full path'}
                {dashSort === 'size' && 'Sorting by size (largest first)'}
                {dashSort === 'folder' && 'Sorting by parent folder'}
              </Typography>
            </Box>
          </Collapse>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Typography color="error" sx={{ mt: 2 }}>{error}</Typography>
        ) : (
          <Fade in timeout={250}>
            <Box>
              {view === 'poster' ? (
                <PosterView
                  files={filteredSorted}
                  tmdbData={tmdbData}
                  imgLoadedMap={imgLoadedMap}
                  onFileClick={handleFileClick}
                  onImageLoad={(key: string) => setImageLoaded(key, true)}
                  currentPath={'/'}
                  onViewDetails={() => {}}
                  onRename={() => loadArrItems()}
                  onDeleted={() => loadArrItems()}
                  sizeVariant="compact"
                />
              ) : (
                <ListView
                  files={filteredSorted}
                  currentPath={'/'}
                  formatDate={formatDate}
                  onItemClick={handleListItemClick}
                  onViewDetails={() => {}}
                  onRename={() => loadArrItems()}
                  onDeleted={() => loadArrItems()}
                  onError={setError}
                />
              )}
            </Box>
          </Fade>
        )}
      </Box>
    </ConfigurationWrapper>
  );
}