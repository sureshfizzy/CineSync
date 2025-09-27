import { useEffect, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography, Fade, Paper, ToggleButtonGroup, ToggleButton, alpha, Collapse, IconButton } from '@mui/material';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';
import { FileItem } from '../FileBrowser/types';
import { fetchFiles as fetchFilesApi } from '../FileBrowser/fileApi';
import { formatDate, joinPaths } from '../FileBrowser/fileUtils';
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
import { TmdbResult, searchTmdb } from '../api/tmdbApi';
import { useNavigate } from 'react-router-dom';
import ArrSearchPage from './ArrSearchPage';
import { libraryApi, LibraryItem } from '../../api/libraryApi';
import ArrWantedList from './ArrWantedList';
import RootFoldersManagement from './RootFoldersManagement';

export default function ArrDashboard() {
  const { view } = useLayoutContext();
  const navigate = useNavigate();

  const { tmdbData, imgLoadedMap, updateTmdbData, setImageLoaded } = useTmdb();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [dashSort, setDashSort] = useState<'title' | 'path' | 'size' | 'folder'>('title');
  const [showSort, setShowSort] = useState(false);
  const getInitialFilter = () => {
    const saved = localStorage.getItem('arrSidebarFilter');
    return saved === 'movies' || saved === 'series' || saved === 'settings' ? saved : 'all';
  };
  const [arrFilter, setArrFilter] = useState<'all' | 'movies' | 'series' | 'settings'>(getInitialFilter);
  
  // New search page state
  const [showSearchPage, setShowSearchPage] = useState(false);
  const [searchMediaType, setSearchMediaType] = useState<'movie' | 'tv'>('movie');
  
  // Settings page state
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('arrSidebarFilter');
    if (saved === 'settings') {
      setShowSettingsPage(true);
      setSettingsSection('mediaManagement');
    }
  }, []);
  
  useEffect(() => {
    const filterHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const val = detail?.filter;
      if (val === 'movies' || val === 'series' || val === 'all') {
        setArrFilter(val);
        setShowSearchPage(false);
        setShowLibrary(false);
        setShowSettingsPage(false);
        loadArrItems();
        loadLibraryItems();
      } else if (val === 'wanted') {
        setShowLibrary(true);
        setShowSearchPage(false);
        setShowSettingsPage(false);
        loadLibraryItems();
      } else if (val === 'settings') {
        setShowLibrary(false);
        setShowSearchPage(false);
        setShowSettingsPage(true);
        setSettingsSection('mediaManagement');
      }
    };
    
    const searchHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const mediaType = detail?.mediaType;
      if (mediaType === 'movie' || mediaType === 'tv') {
        setSearchMediaType(mediaType);
        setShowSearchPage(true);
        setShowSettingsPage(false);
      }
    };

    const settingsHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const section = detail?.section;
      if (section) {
        setSettingsSection(section);
        setShowSettingsPage(true);
        setShowSearchPage(false);
      }
    };
    
    window.addEventListener('arrSidebarFilterChanged', filterHandler as EventListener);
    window.addEventListener('arrSearchRequested', searchHandler as EventListener);
    window.addEventListener('arrSettingsRequested', settingsHandler as EventListener);
    
    return () => {
      window.removeEventListener('arrSidebarFilterChanged', filterHandler as EventListener);
      window.removeEventListener('arrSearchRequested', searchHandler as EventListener);
      window.removeEventListener('arrSettingsRequested', settingsHandler as EventListener);
    };
  }, []);
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  const loadLibraryItems = useCallback(async () => {
    try {
      const mediaType = arrFilter === 'movies' ? 'movie' : arrFilter === 'series' ? 'tv' : undefined;
      const response = await libraryApi.getLibrary(mediaType);
      setLibraryItems(response.data || []);
    } catch (e) {
      console.error('Failed to load library items:', e);
      setLibraryItems([]);
    }
  }, [arrFilter]);

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
            console.error('Error fetching folder:', basePath, e);
          }
        })
      );

      setFiles(results);
    } catch (e) {
      console.error('Failed to load dashboard items:', e);
      setError('Failed to load dashboard items');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [updateTmdbData]);

  useEffect(() => {
    loadArrItems();
    loadLibraryItems();
  }, [loadArrItems, loadLibraryItems]);

  // Enrich library items with TMDB details so posters/overviews populate like FS items
  useEffect(() => {
    libraryItems.forEach((item) => {
      // Key used by PosterView lookup is file.name; for library items we set name = title
      const key = item.title;
      searchTmdb(item.tmdb_id.toString(), undefined, item.media_type).then((result) => {
        if (result) {
          updateTmdbData(key, result);
        }
      });
    });
  }, [libraryItems, updateTmdbData]);

  const handleFileClick = (file: FileItem, tmdb: TmdbResult | null) => {
    if (file.type === 'directory' && !file.isSeasonFolder) {
      const isTvShow = file.mediaType === 'tv' || file.hasSeasonFolders;
      const tmdbId = tmdb?.id || file.tmdbId;

      if (tmdbId) {
        const mediaPath = file.path || file.fullPath || joinPaths('/', file.name);
        const mediaPathParts = mediaPath.split('/').filter(Boolean);
        mediaPathParts.pop();
        const parentPath = '/' + mediaPathParts.join('/') + (mediaPathParts.length > 0 ? '/' : '');

        const typeSegment = isTvShow ? 'tv' : 'movie';
        navigate(`/media/${typeSegment}/${encodeURIComponent(tmdbId.toString())}`, {
          state: {
            mediaType: isTvShow ? 'tv' : 'movie',
            tmdbId,
            hasSeasonFolders: file.hasSeasonFolders,
            currentPath: parentPath,
            folderName: file.name,
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

  const handleLibraryItemSearch = (item: any) => {
    // Navigate to search page for this item
    setSearchMediaType(item.mediaType);
    setShowSearchPage(true);
  };

  const handleLibraryItemDelete = async (item: any) => {
    try {
      await libraryApi.deleteItem(parseInt(item.id));
      loadLibraryItems(); // Reload library items
    } catch (error) {
      console.error('Failed to delete library item:', error);
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

  // Show settings page if active
  if (showSettingsPage) {
    if (settingsSection === 'mediaManagement') {
      return (
        <RootFoldersManagement
          onBack={() => setShowSettingsPage(false)}
        />
      );
    }
    
    // Default settings view - could be expanded with more sections
    return (
      <ConfigurationWrapper>
        <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
          <Typography variant="h5" fontWeight={700} gutterBottom>
            Settings
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Select a settings category from the sidebar to configure your media management.
          </Typography>
        </Box>
      </ConfigurationWrapper>
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
              {showLibrary ? (
                <ArrWantedList
                  items={libraryItems.map(item => ({
                    id: item.id.toString(),
                    tmdbId: item.tmdb_id,
                    title: item.title,
                    year: item.year,
                    mediaType: item.media_type,
                    posterPath: undefined, // Will be fetched from TMDB
                    overview: '',
                    status: item.status as 'wanted' | 'searching' | 'downloading' | 'imported' | 'failed',
                    rootFolder: item.root_folder,
                    qualityProfile: item.quality_profile,
                    monitorPolicy: item.monitor_policy,
                    tags: item.tags ? JSON.parse(item.tags) : [],
                    createdAt: new Date(item.added_at * 1000).toISOString(),
                    updatedAt: new Date(item.updated_at * 1000).toISOString(),
                  }))}
                  onSearch={handleLibraryItemSearch}
                  onDelete={handleLibraryItemDelete}
                />
              ) : (
                <>
                  {/* Combined view: Library Items + File System items */}
                  {(() => {
                    // Filter library items by current filter
                    const libraryItemsForFilter = arrFilter === 'movies' 
                      ? libraryItems.filter(item => item.media_type === 'movie')
                      : arrFilter === 'series' 
                      ? libraryItems.filter(item => item.media_type === 'tv')
                      : libraryItems;

                    // Filter file system items by current filter
                    const fileSystemItems = arrFilter === 'movies' ? files.filter(f => f.mediaType?.toLowerCase() === 'movie')
                      : arrFilter === 'series' ? files.filter(f => f.mediaType?.toLowerCase() === 'tv')
                      : files;

                    console.log('Filter debug:', {
                      arrFilter,
                      totalFiles: files.length,
                      fileSystemItems: fileSystemItems.length,
                      libraryItems: libraryItems.length,
                      libraryItemsForFilter: libraryItemsForFilter.length,
                      sampleFiles: files.slice(0, 3).map(f => ({ name: f.name, mediaType: f.mediaType }))
                    });

                    const fsTmdbSet = new Set(
                      fileSystemItems
                        .map(f => (f.tmdbId ? f.tmdbId.toString() : ''))
                        .filter(Boolean)
                    );

                    // Convert library items to FileItem format for consistent display
                    const libraryItemsAsFiles: FileItem[] = libraryItemsForFilter.map(item => ({
                      name: item.title,
                      path: item.root_folder,
                      fullPath: item.root_folder,
                      // Treat library entries like directories so PosterView renders posters
                      type: 'directory' as const,
                      isSeasonFolder: false,
                      hasSeasonFolders: item.media_type === 'tv' ? true : false,
                      size: '--',
                      modified: new Date(item.added_at * 1000).toISOString(),
                      mediaType: item.media_type,
                      tmdbId: item.tmdb_id.toString(),
                      year: item.year,
                      isLibraryItem: true,
                      libraryItemId: item.id,
                      qualityProfile: item.quality_profile,
                      monitorPolicy: item.monitor_policy,
                      tags: item.tags ? JSON.parse(item.tags) : [],
                      status: fsTmdbSet.has(item.tmdb_id.toString())
                        ? 'available'
                        : (item.status as any)
                    }));

                    // Combine library items and file system items
                    const allItems = [...libraryItemsAsFiles, ...fileSystemItems];

                    if (allItems.length > 0) {
                      return (
                        <Box>
              {view === 'poster' ? (
                <PosterView
                              files={allItems}
                  tmdbData={tmdbData}
                  imgLoadedMap={imgLoadedMap}
                  onFileClick={handleFileClick}
                  onImageLoad={(key: string) => setImageLoaded(key, true)}
                  currentPath={'/'}
                  onViewDetails={() => {}}
                  onRename={() => loadArrItems()}
                  onDeleted={() => loadArrItems()}
                  showArrBadges
                  sizeVariant="compact"
                />
              ) : (
                <ListView
                              files={allItems}
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
                      );
                    }
                    return null;
                  })()}
                </>
              )}
            </Box>
          </Fade>
        )}
      </Box>
    </ConfigurationWrapper>
  );
}