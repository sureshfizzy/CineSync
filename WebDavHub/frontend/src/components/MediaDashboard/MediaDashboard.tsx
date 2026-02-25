import { useEffect, useState, useCallback } from 'react';
import { Box, CircularProgress, Typography, Fade, Paper, ToggleButtonGroup, ToggleButton, alpha, Collapse, IconButton } from '@mui/material';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';
import { FileItem } from '../FileBrowser/types';
import { fetchFiles as fetchFilesApi } from '../FileBrowser/fileApi';
import { formatDate, joinPaths, inferQualityFromName } from '../FileBrowser/fileUtils';
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
import { TmdbResult, searchTmdb, fetchSeriesEpisodesFromTmdb } from '../api/tmdbApi';
import { useNavigate } from 'react-router-dom';
import { libraryApi, LibraryItem } from '../../api/libraryApi';
import { fetchMediaFiles } from '../../api/mediaFilesApi';
import MediaWantedList from './MediaWantedList';
import { ArrItem } from './types';
import { isTvMediaType, normalizeMediaType, inferMediaTypeFromText } from '../../utils/mediaType';

const MAX_SCAN_DEPTH = 3;

interface MediaDashboardProps {
  filter?: 'all' | 'movies' | 'series' | 'wanted';
}

export default function MediaDashboard({ filter = 'all' }: MediaDashboardProps) {
  const { view } = useLayoutContext();
  const navigate = useNavigate();

  const { tmdbData, imgLoadedMap, updateTmdbData, setImageLoaded } = useTmdb();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [dashSort, setDashSort] = useState<'title' | 'path' | 'size' | 'folder'>('title');
  const [showSort, setShowSort] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<'all' | '1080p' | '4k'>('all');
  
  // Use filter from props instead of internal state
  const arrFilter = filter;
  
  const [files, setFiles] = useState<FileItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [wantedItems, setWantedItems] = useState<ArrItem[]>([]);
  const [wantedSeriesItems, setWantedSeriesItems] = useState<ArrItem[]>([]);
  const [wantedMovieItems, setWantedMovieItems] = useState<ArrItem[]>([]);
  const [wantedFilter, setWantedFilter] = useState<'series' | 'movies'>('series');

  const formatEpisodeCode = useCallback((seasonNumber?: number, episodeNumber?: number) => {
    if (!seasonNumber || !episodeNumber) return '--';
    const episode = episodeNumber.toString().padStart(2, '0');
    return `${seasonNumber}x${episode}`;
  }, []);

  const isEpisodeAired = useCallback((airDate?: string) => {
    if (!airDate) return true;
    const date = new Date(airDate);
    if (Number.isNaN(date.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date <= today;
  }, []);

  const buildWantedRows = useCallback(async (items: LibraryItem[]): Promise<{ seriesRows: ArrItem[]; movieRows: ArrItem[] }> => {
    const seriesRows: ArrItem[] = [];
    const movieRows: ArrItem[] = [];
    const missingItems = (items || []).filter((item) => item.status === 'missing');

    for (const item of missingItems) {
      const base: ArrItem = {
        id: item.id.toString(),
        libraryItemId: item.id,
        tmdbId: item.tmdb_id,
        title: item.title,
        year: item.year,
        mediaType: item.media_type,
        posterPath: undefined,
        overview: '',
        status: (item.status as ArrItem['status']) || 'missing',
        rootFolder: item.root_folder,
        qualityProfile: item.quality_profile,
        monitorPolicy: item.monitor_policy,
        tags: item.tags ? JSON.parse(item.tags) : [],
        createdAt: new Date(item.added_at * 1000).toISOString(),
        updatedAt: new Date(item.updated_at * 1000).toISOString(),
      };

      if (item.media_type !== 'tv') {
        movieRows.push({
          ...base,
          episode: '--',
          episodeTitle: '--',
        });
        continue;
      }

      try {
        const [mediaFiles, tmdbEpisodes] = await Promise.all([
          fetchMediaFiles(item.tmdb_id, 'tv'),
          fetchSeriesEpisodesFromTmdb(item.tmdb_id.toString())
        ]);

        const existing = new Set(
          (mediaFiles || [])
            .filter((file) => file.seasonNumber && file.episodeNumber)
            .map((file) => `${file.seasonNumber}-${file.episodeNumber}`)
        );

        const missingEpisodes = (tmdbEpisodes || []).filter((episode) => {
          const key = `${episode.seasonNumber}-${episode.episodeNumber}`;
          if (existing.has(key)) return false;
          return isEpisodeAired(episode.airDate);
        });

        for (const episode of missingEpisodes) {
          seriesRows.push({
            ...base,
            id: `${item.id}-${episode.seasonNumber}-${episode.episodeNumber}`,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            episode: formatEpisodeCode(episode.seasonNumber, episode.episodeNumber),
            episodeTitle: episode.name,
            airDate: episode.airDate,
            status: 'missing',
          });
        }
      } catch (err) {
        console.error('Failed to load missing episodes for', item.title, err);
        seriesRows.push({
          ...base,
          episode: '--',
          episodeTitle: 'Missing episodes',
          status: 'missing',
        });
      }
    }

    seriesRows.sort((a, b) => {
      const aTime = a.airDate ? new Date(a.airDate).getTime() : 0;
      const bTime = b.airDate ? new Date(b.airDate).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.title.localeCompare(b.title);
    });

    movieRows.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.title.localeCompare(b.title);
    });

    return { seriesRows, movieRows };
  }, [formatEpisodeCode, isEpisodeAired]);

  const loadLibraryItems = useCallback(async (manageLoading = arrFilter === 'wanted') => {
    try {
      if (manageLoading) setLoading(true);
      const mediaType = arrFilter === 'movies' ? 'movie' : arrFilter === 'series' ? 'tv' : undefined;
      const response = await libraryApi.getLibrary(mediaType);
      const items = response.data || [];
      setLibraryItems(items);

      if (arrFilter === 'wanted') {
        const { seriesRows, movieRows } = await buildWantedRows(items);
        setWantedSeriesItems(seriesRows);
        setWantedMovieItems(movieRows);
        setWantedItems(wantedFilter === 'series' ? seriesRows : movieRows);
        if (wantedFilter === 'series' && seriesRows.length === 0 && movieRows.length > 0) {
          setWantedFilter('movies');
          setWantedItems(movieRows);
        }
      } else {
        setWantedItems([]);
        setWantedSeriesItems([]);
        setWantedMovieItems([]);
      }
    } catch (e) {
      console.error('Failed to load library items:', e);
      setLibraryItems([]);
      setWantedItems([]);
      setWantedSeriesItems([]);
      setWantedMovieItems([]);
    } finally {
      if (manageLoading) setLoading(false);
    }
  }, [arrFilter, buildWantedRows, wantedFilter]);

  // Fetch root to get base_path folders
  const loadArrItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const root = await fetchFilesApi('/', true, 1, 100);
      const baseFolders = (root.data || []).filter(f => f.type === 'directory');

      const results: FileItem[] = [];
      const visited = new Set<string>();
      const queue: Array<{ path: string; depth: number }> = [];

      const enqueue = (p: string, depth: number) => {
        if (!p || visited.has(p) || depth > MAX_SCAN_DEPTH) return;
        visited.add(p);
        queue.push({ path: p, depth });
      };

      baseFolders.forEach(folder => {
        const basePath = folder.path || folder.fullPath || joinPaths('/', folder.name);
        enqueue(basePath, 0);
      });

      while (queue.length > 0) {
        const { path: currentPath, depth } = queue.shift()!;
        try {
          const resp = await fetchFilesApi(currentPath, true, 1, 200);
          const mapped = (resp.data || []).map(item => {
            const fullOrPath = item.path || item.fullPath || joinPaths(currentPath, item.name);
            return {
              ...item,
              path: fullOrPath,
              fullPath: fullOrPath,
            } as FileItem;
          });

          const inner = mapped.filter(item => !item.isCategoryFolder);

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

          // Recurse into subfolders (skip season folders)
          if (depth < MAX_SCAN_DEPTH) {
            mapped
              .filter(it => it.type === 'directory' && !it.isSeasonFolder)
              .forEach(it => enqueue(it.path || it.fullPath || '', depth + 1));
          }
        } catch (e) {
          console.error('Error fetching folder:', currentPath, e);
        }
      }

      setFiles(results);
    } catch (e) {
      console.error('Failed to load dashboard items:', e);
      setError('Failed to load dashboard items');
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [updateTmdbData]);

  // Load data when filter changes
  useEffect(() => {
    if (arrFilter === 'wanted') {
      loadLibraryItems(true);
    } else {
      loadArrItems();
      loadLibraryItems(false);
    }
  }, [arrFilter, loadArrItems, loadLibraryItems]);

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
      const mediaType = normalizeMediaType(file.mediaType, file.hasSeasonFolders ? 'tv' : 'movie');
      const tmdbId = tmdb?.id || file.tmdbId;

      if (tmdbId) {
        const mediaPath = file.path || file.fullPath || joinPaths('/', file.name);
        const mediaPathParts = mediaPath.split('/').filter(Boolean);
        mediaPathParts.pop();
        const parentPath = '/' + mediaPathParts.join('/') + (mediaPathParts.length > 0 ? '/' : '');

        const typeSegment = mediaType;
        navigate(`/media/${typeSegment}/${encodeURIComponent(tmdbId.toString())}`, {
          state: {
            mediaType,
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
    const mediaType = item.mediaType === 'movie' ? 'movie' : 'tv';
    navigate(`/Mediadashboard/search/${mediaType}`);
  };


  const inferFileMediaType = useCallback((file: FileItem): 'movie' | 'tv' => {
    if (file.mediaType) {
      return normalizeMediaType(file.mediaType, file.hasSeasonFolders ? 'tv' : 'movie');
    }
    if (file.hasSeasonFolders) return 'tv';

    const rawPath = (file.path || file.fullPath || '').toLowerCase().replace(/\\/g, '/');
    if (rawPath.includes('/shows') || rawPath.includes('/series') || rawPath.includes('/tv')) return 'tv';
    if (rawPath.includes('/movies') || rawPath.includes('/movie')) return 'movie';

    return inferMediaTypeFromText(file.name || file.path || file.fullPath);
  }, []);

  const matchesQualityFilter = useCallback((quality?: string | null) => {
    if (qualityFilter === 'all') return true;
    const q = (quality || '').toString().toLowerCase();
    if (!q) return false;
    if (qualityFilter === '4k') return q.includes('4k') || q.includes('2160') || q.includes('uhd');
    if (qualityFilter === '1080p') return q.includes('1080');
    return true;
  }, [qualityFilter]);

  const handleLibraryItemDelete = async (item: any) => {
    try {
      const itemId = item.libraryItemId ?? parseInt(item.id, 10);
      await libraryApi.deleteItem(itemId);
      loadLibraryItems(); // Reload library items
    } catch (error) {
      console.error('Failed to delete library item:', error);
    }
  };


  return (
    <ConfigurationWrapper>
      <Box sx={{ px: { xs: 0.8, sm: 1, md: 0 }, maxWidth: 1600, mx: 'auto' }}>

        {/* Sort controls */}
        {arrFilter !== 'wanted' && (
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
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 1 }}>
                <Paper sx={{ p: 0.5, borderRadius: 999, border: '1px solid', borderColor: alpha('#ffffff', 0.08) }}>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={qualityFilter}
                    onChange={(_, v) => { if (v) setQualityFilter(v); }}
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
                    <ToggleButton value="all" aria-label="All qualities">
                      All
                    </ToggleButton>
                    <ToggleButton value="1080p" aria-label="1080p">
                      1080p
                    </ToggleButton>
                    <ToggleButton value="4k" aria-label="4K">
                      4K
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
        )}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Typography color="error" sx={{ mt: 2 }}>{error}</Typography>
        ) : (
          <Fade in timeout={250}>
            <Box>
              {arrFilter === 'wanted' ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        borderRadius: 999,
                        px: 0.5,
                        py: 0.35,
                        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.6)
                      }}
                    >
                      <ToggleButtonGroup
                        size="small"
                        exclusive
                        value={wantedFilter}
                        onChange={(_, value) => {
                          if (!value) return;
                          setWantedFilter(value);
                          setWantedItems(value === 'series' ? wantedSeriesItems : wantedMovieItems);
                        }}
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
                        <ToggleButton value="series">Series</ToggleButton>
                        <ToggleButton value="movies">Movies</ToggleButton>
                      </ToggleButtonGroup>
                    </Paper>
                  </Box>

                  <MediaWantedList
                    items={wantedItems}
                    variant={wantedFilter}
                    onSearch={handleLibraryItemSearch}
                    onDelete={handleLibraryItemDelete}
                  />
                </Box>
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

                    const libraryItemsQualityFiltered = qualityFilter === 'all'
                      ? libraryItemsForFilter
                      : libraryItemsForFilter.filter(item => {
                          const q = item.quality_profile || item.title || '';
                          return matchesQualityFilter(q);
                        });

                    // Filter file system items by current filter
                    const fileSystemItems = arrFilter === 'movies'
                      ? files.filter(f => inferFileMediaType(f) === 'movie')
                      : arrFilter === 'series'
                      ? files.filter(f => inferFileMediaType(f) === 'tv')
                      : files;

                    const directoryItems = fileSystemItems.filter(f => f.type === 'directory');

                    const filteredFileSystemItems = (qualityFilter === 'all'
                      ? directoryItems
                      : directoryItems.filter(f => {
                          const q = f.quality || inferQualityFromName(f.name || '') || '';
                          return matchesQualityFilter(q);
                        }))
                      .filter(f => Boolean(f.tmdbId));

                    const fsByTmdbId = new Map(
                      filteredFileSystemItems
                        .filter(f => f.tmdbId)
                        .map(f => [f.tmdbId!.toString(), f])
                    );

                    // Convert library items to FileItem format for consistent display
                    const libraryItemsAsFiles: FileItem[] = libraryItemsQualityFiltered
                      .filter(item => item.tmdb_id)
                      .map(item => {
                        const tmdbKey = item.tmdb_id.toString();
                        const fsMatch = fsByTmdbId.get(tmdbKey);
                        return {
                          name: item.title,
                          path: fsMatch?.path || item.root_folder,
                          fullPath: fsMatch?.fullPath || item.root_folder,
                          // Treat library entries like directories so PosterView renders posters
                          type: 'directory' as const,
                          isSeasonFolder: false,
                          hasSeasonFolders: isTvMediaType(item.media_type),
                          size: fsMatch?.size || '--',
                          modified: fsMatch?.modified || new Date(item.added_at * 1000).toISOString(),
                          mediaType: item.media_type,
                          tmdbId: tmdbKey,
                          year: item.year,
                          isLibraryItem: true,
                          libraryItemId: item.id,
                          qualityProfile: item.quality_profile,
                          monitorPolicy: item.monitor_policy,
                          tags: item.tags ? JSON.parse(item.tags) : [],
                          quality: fsMatch?.quality || undefined,
                          posterPath: fsMatch?.posterPath,
                          releaseDate: fsMatch?.releaseDate,
                          firstAirDate: fsMatch?.firstAirDate,
                          status: fsMatch ? 'available' : (item.status as any)
                        };
                      });

                    // Include filesystem-only items that have tmdbId but are not in library
                    const libraryTmdbSet = new Set(libraryItemsAsFiles.map(i => i.tmdbId?.toString() || '').filter(Boolean));
                    const fsOnlyItems = filteredFileSystemItems.filter(f => {
                      if (!f.tmdbId) return false;
                      return !libraryTmdbSet.has(f.tmdbId.toString());
                    });

                    // Combine library items and filesystem items (tmdbId-based)
                    const allItems = [...libraryItemsAsFiles, ...fsOnlyItems];

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