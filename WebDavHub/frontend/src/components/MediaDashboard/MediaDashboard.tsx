import { useEffect, useState, useCallback, useRef } from 'react';
import { Box, CircularProgress, Typography, Fade, Paper, ToggleButtonGroup, ToggleButton, alpha, Collapse, IconButton, TextField, InputAdornment } from '@mui/material';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';
import { FileItem } from '../FileBrowser/types';
import { formatDate, joinPaths } from '../FileBrowser/fileUtils';
import FolderIcon from '@mui/icons-material/Folder';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import StraightenIcon from '@mui/icons-material/Straighten';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import SortRoundedIcon from '@mui/icons-material/SortRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import ListView from '../FileBrowser/ListView';
import VirtualizedLibraryGrid from './VirtualizedLibraryGrid';
import { useLayoutContext } from '../Layout/Layout';
import { useTmdb } from '../../contexts/TmdbContext';
import { TmdbResult } from '../api/tmdbApi';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { libraryApi, LibraryItem, WantedEpisode } from '../../api/libraryApi';
import MediaWantedList from './MediaWantedList';
import { ArrItem } from './types';
import { isTvMediaType, normalizeMediaType } from '../../utils/mediaType';

interface MediaDashboardProps {
  filter?: 'movies' | 'series' | 'wanted';
}

export default function MediaDashboard({ filter = 'movies' }: MediaDashboardProps) {
  const { view } = useLayoutContext();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { tmdbData, updateTmdbData, setImageLoaded } = useTmdb();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [dashSort, setDashSort] = useState<'title' | 'path' | 'size' | 'folder'>('title');
  const [showSort, setShowSort] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<'all' | '1080p' | '4k'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing'>('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [debouncedLibrarySearch, setDebouncedLibrarySearch] = useState('');
  
  // Use filter from props instead of internal state
  const arrFilter = filter;
  
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const itemsLengthRef = useRef(0);
  itemsLengthRef.current = libraryItems.length;
  const [wantedItems, setWantedItems] = useState<ArrItem[]>([]);
  const [wantedFilter, setWantedFilter] = useState<'series' | 'movies'>('series');
  const [wantedResolutionSeries, setWantedResolutionSeries] = useState<'all' | '2160p' | '1080p' | '720p' | '480p'>('all');
  const [wantedResolutionMovies, setWantedResolutionMovies] = useState<'all' | '2160p' | '1080p' | '720p' | '480p'>('all');
  const [wantedPage, setWantedPage] = useState(0);
  const [wantedTotal, setWantedTotal] = useState(0);
  const [wantedInitialized, setWantedInitialized] = useState(false);
  const [filtersInitialized, setFiltersInitialized] = useState(false);

  const PAGE_SIZE = 100;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLibrarySearch(librarySearch), 250);
    return () => clearTimeout(t);
  }, [librarySearch]);

  const loadLibraryItems = useCallback(async (manageLoading = arrFilter === 'wanted', append = false, appendOffset = 0) => {
    try {
      if (manageLoading && !append) setLoading(true);
      if (append) setLoadingMore(true);
      setError('');
      if (arrFilter === 'wanted') {
        const offset = wantedPage * PAGE_SIZE;

        if (wantedFilter === 'series') {
          const res = await libraryApi.getWantedEpisodes(
            PAGE_SIZE,
            offset,
            wantedResolutionSeries === 'all' ? undefined : wantedResolutionSeries,
          );
          const episodes: WantedEpisode[] = res.data || [];
          const seriesRows: ArrItem[] = episodes.map((ep) => ({
            id: ep.id,
            libraryItemId: undefined,
            tmdbId: ep.tmdbId,
            title: ep.title,
            year: ep.year,
            mediaType: ep.mediaType,
            posterPath: undefined,
            overview: '',
            status: 'missing',
            rootFolder: ep.rootFolder,
            qualityProfile: ep.qualityProfile,
            monitorPolicy: 'any',
            tags: [],
            createdAt: '',
            updatedAt: '',
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            episode: ep.episode,
            episodeTitle: ep.episodeTitle,
            airDate: ep.airDate,
          }));

          seriesRows.sort((a, b) => {
            const aTime = a.airDate ? new Date(a.airDate).getTime() : 0;
            const bTime = b.airDate ? new Date(b.airDate).getTime() : 0;
            if (aTime !== bTime) return bTime - aTime;
            return a.title.localeCompare(b.title);
          });

          setLibraryItems([]);
          setTotalCount(seriesRows.length);
          setWantedTotal(res.total_count ?? seriesRows.length);
          setWantedItems(seriesRows);
        } else {
          const res = await libraryApi.getWantedMovies(
            PAGE_SIZE,
            offset,
            wantedResolutionMovies === 'all' ? undefined : wantedResolutionMovies,
          );
          const movies = res.data || [];
          const movieRows: ArrItem[] = movies.map((m) => ({
            id: m.id,
            libraryItemId: undefined,
            tmdbId: m.tmdbId,
            title: m.title,
            year: m.year,
            mediaType: m.mediaType,
            posterPath: undefined,
            overview: '',
            status: 'missing',
            rootFolder: m.rootFolder,
            qualityProfile: m.qualityProfile,
            monitorPolicy: m.monitorPolicy,
            tags: m.tags,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
            seasonNumber: undefined,
            episodeNumber: undefined,
            episode: undefined,
            episodeTitle: undefined,
            airDate: undefined,
          }));

          setLibraryItems([]);
          setTotalCount(movieRows.length);
          setWantedTotal(res.total_count ?? movieRows.length);
          setWantedItems(movieRows);
        }
      } else {
        const queryArg = debouncedLibrarySearch.trim() || undefined;
        const offset = append ? appendOffset : 0;
        let items: LibraryItem[] = [];
        let total = 0;
        if (arrFilter === 'movies') {
          const res = await libraryApi.getLibraryMovies(PAGE_SIZE, offset, queryArg, statusFilter === 'missing');
          items = res.data || [];
          total = res.total_count ?? items.length;
        } else if (arrFilter === 'series') {
          const res = await libraryApi.getLibraryTv(PAGE_SIZE, offset, queryArg);
          items = res.data || [];
          total = res.total_count ?? items.length;
        }
        setLibraryItems((prev) => (append ? [...prev, ...items] : items));
        setTotalCount(total);
        setWantedItems([]);
      }
    } catch (e) {
      console.error('Failed to load library items:', e);
      setError('Failed to load library items');
      if (!append) {
        setLibraryItems([]);
        setTotalCount(0);
      }
      setWantedItems([]);
    } finally {
      if (manageLoading && !append) setLoading(false);
      if (append) setLoadingMore(false);
    }
  }, [arrFilter, wantedFilter, wantedPage, wantedResolutionSeries, wantedResolutionMovies, debouncedLibrarySearch, statusFilter]);

  const loadMoreItems = useCallback(() => {
    if (arrFilter === 'wanted') return;
    loadLibraryItems(false, true, itemsLengthRef.current);
  }, [arrFilter, loadLibraryItems]);

  // Load data when filter changes
  useEffect(() => {
    if (arrFilter !== 'wanted' || wantedInitialized) return;

    const variantParam = (searchParams.get('variant') || '').toLowerCase();
    const initialFilter: 'series' | 'movies' =
      variantParam === 'movies' ? 'movies' : 'series';

    const pageParam = Number.parseInt(searchParams.get('page') || '1', 10);
    const initialPage =
      Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;

    setWantedFilter(initialFilter);
    setWantedPage(initialPage);
    const resParam = (searchParams.get('resolution') || '').toLowerCase();
    const initialResolution: 'all' | '2160p' | '1080p' | '720p' | '480p' =
      resParam === '2160p' || resParam === '1080p' || resParam === '720p' || resParam === '480p'
        ? (resParam as '2160p' | '1080p' | '720p' | '480p')
        : 'all';

    if (initialFilter === 'movies') {
      setWantedResolutionMovies(initialResolution);
    } else {
      setWantedResolutionSeries(initialResolution);
    }
    setWantedInitialized(true);
  }, [arrFilter, searchParams, wantedInitialized]);

  useEffect(() => {
    if (filtersInitialized) return;

    const sortParam = (searchParams.get('sort') || '').toLowerCase();
    const initialSort: typeof dashSort =
      sortParam === 'path' || sortParam === 'size' || sortParam === 'folder' || sortParam === 'title'
        ? (sortParam as typeof dashSort)
        : 'title';

    const qualityParam = (searchParams.get('q') || '').toLowerCase();
    const initialQuality: typeof qualityFilter =
      qualityParam === '1080p' || qualityParam === '4k' ? (qualityParam as typeof qualityFilter) : 'all';

    const missingParam = (searchParams.get('missing') || '').toLowerCase();
    const initialStatus: typeof statusFilter =
      missingParam === '1' || missingParam === 'true' ? 'missing' : 'all';

    setDashSort(initialSort);
    setQualityFilter(initialQuality);
    setStatusFilter(initialStatus);
    setFiltersInitialized(true);
  }, [filtersInitialized, searchParams]);

  useEffect(() => {
    if (!filtersInitialized) return;

    const next = new URLSearchParams(searchParams);

    if (dashSort === 'title') next.delete('sort');
    else next.set('sort', dashSort);

    if (qualityFilter === 'all') next.delete('q');
    else next.set('q', qualityFilter);

    if (statusFilter === 'missing') next.set('missing', '1');
    else next.delete('missing');

    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [filtersInitialized, dashSort, qualityFilter, statusFilter, searchParams, setSearchParams]);

  useEffect(() => {
    if (arrFilter !== 'wanted' || !wantedInitialized) return;

    const next = new URLSearchParams(searchParams);

    if (wantedFilter === 'movies') {
      next.set('variant', 'movies');
    } else {
      next.delete('variant');
    }

    const activeResolution = wantedFilter === 'movies' ? wantedResolutionMovies : wantedResolutionSeries;
    if (activeResolution === 'all') {
      next.delete('resolution');
    } else {
      next.set('resolution', activeResolution);
    }

    const expectedPage = wantedPage + 1;
    if (expectedPage <= 1) {
      next.delete('page');
    } else {
      next.set('page', String(expectedPage));
    }

    if (next.toString() === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
  }, [arrFilter, wantedFilter, wantedPage, wantedResolutionSeries, wantedResolutionMovies, searchParams, setSearchParams, wantedInitialized]);

  // Load data when filter or wanted page changes
  useEffect(() => {
    loadLibraryItems(true);
  }, [arrFilter, wantedFilter, wantedPage, wantedResolutionSeries, wantedResolutionMovies, loadLibraryItems]);

  // Populate tmdbData
  useEffect(() => {
    libraryItems.forEach((item) => {
      if (item.poster_path && item.title) {
        const yearStr = item.year ? `${item.year}-01-01` : undefined;
        updateTmdbData(item.title, {
          id: item.tmdb_id,
          title: item.title,
          name: item.media_type === 'tv' ? item.title : undefined,
          overview: item.overview || '',
          poster_path: item.poster_path,
          backdrop_path: null,
          media_type: item.media_type,
          release_date: yearStr,
          first_air_date: yearStr
        });
      }
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
    if (file.type === 'directory' && !file.isSeasonFolder && file.tmdbId) {
      const mediaType = normalizeMediaType(file.mediaType, file.hasSeasonFolders ? 'tv' : 'movie');
      const destPath = file.path || file.fullPath || joinPaths('/', file.name);
      const pathParts = destPath.split('/').filter(Boolean);
      pathParts.pop();
      const parentPath = '/' + pathParts.join('/') + (pathParts.length > 0 ? '/' : '');
      const tmdb = tmdbData[file.name || ''];
      navigate(`/media/${mediaType}/${encodeURIComponent(file.tmdbId.toString())}`, {
        state: {
          mediaType,
          tmdbId: file.tmdbId,
          hasSeasonFolders: file.hasSeasonFolders,
          currentPath: parentPath,
          folderName: file.name,
          tmdbData: tmdb,
          returnPage: 1,
          returnSearch: ''
        }
      });
    } else if (file.type === 'directory') {
      const targetPath = file.path || file.fullPath || joinPaths('/', file.name);
      navigate(`/files${targetPath}`);
    }
  };

  const handleLibraryItemSearch = (item: any) => {
    const title = (item?.title || '').toString().trim();
    if (!title) return;
    setLibrarySearch(title);
  };


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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.6 }}>
            <Box
              role="button"
              tabIndex={0}
              onClick={() => setShowSort(s => !s)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setShowSort(s => !s); }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
            >
              <Box sx={{
                backgroundColor: (theme) => `${theme.palette.primary.main}15`,
                borderRadius: '10px',
                p: 0.5,
                border: (theme) => `1px solid ${theme.palette.primary.main}30`
              }}>
                <SortRoundedIcon sx={{ color: 'primary.main', fontSize: 18 }} />
              </Box>
              <Typography
                variant="subtitle1"
                sx={{
                  fontWeight: 700,
                  fontSize: { xs: '0.95rem', sm: '1.05rem' }
                }}>
                Sort by
              </Typography>
              <IconButton size="small" sx={{ ml: 0.5 }}>
                <ExpandMoreIcon sx={{ transform: showSort ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 200ms ease' }} />
              </IconButton>
            </Box>

            {(arrFilter === 'movies' || arrFilter === 'series') && (
              <TextField
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                size="small"
                placeholder={`Search ${arrFilter === 'movies' ? 'movies' : 'series'}...`}
                sx={{ minWidth: { xs: 160, sm: 240, md: 320 } }}
                slotProps={{ input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18 }} />
                    </InputAdornment>
                  ),
                } }}
              />
            )}
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
              <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 1, gap: 1 }}>
                <Paper sx={{ p: 0.5, borderRadius: 999, border: '1px solid', borderColor: alpha('#ffffff', 0.08) }}>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={statusFilter}
                    onChange={(_, v) => { if (v) setStatusFilter(v); }}
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
                      },
                    }}
                  >
                    <ToggleButton value="all" aria-label="All statuses">
                      All
                    </ToggleButton>
                    <ToggleButton value="missing" aria-label="Missing only">
                      Missing
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Paper>
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
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="subtitle2" sx={{
                      color: "text.secondary"
                    }}>
                      {wantedFilter === 'series' ? 'Wanted episodes' : 'Wanted movies'}: {wantedTotal || wantedItems.length}
                      {wantedTotal > PAGE_SIZE && `  •  Page ${wantedPage + 1}`}
                    </Typography>
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
                          setWantedPage(0);
                          setWantedItems([]);
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
                        <ToggleButton value="series">Episodes</ToggleButton>
                        <ToggleButton value="movies">Movies</ToggleButton>
                      </ToggleButtonGroup>
                    </Paper>
                  </Box>

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 0.5 }}>
                    <ToggleButton
                      size="small"
                      value="prev"
                      disabled={wantedPage === 0}
                      onClick={() => setWantedPage((p) => Math.max(0, p - 1))}
                    >
                      Prev
                    </ToggleButton>
                    <ToggleButton
                      size="small"
                      value="next"
                      disabled={
                        wantedTotal > 0
                          ? (wantedPage + 1) * PAGE_SIZE >= wantedTotal
                          : wantedItems.length < PAGE_SIZE
                      }
                      onClick={() => setWantedPage((p) => p + 1)}
                    >
                      Next
                    </ToggleButton>
                  </Box>

                  <MediaWantedList
                    items={wantedItems}
                    variant={wantedFilter}
                    onSearch={handleLibraryItemSearch}
                    onDelete={handleLibraryItemDelete}
                    resolution={wantedFilter === 'movies' ? wantedResolutionMovies : wantedResolutionSeries}
                    onResolutionChange={(value) => {
                      setWantedPage(0);
                      if (wantedFilter === 'movies') {
                        setWantedResolutionMovies(value);
                      } else {
                        setWantedResolutionSeries(value);
                      }
                    }}
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

                    const libraryItemsStatusFiltered = statusFilter === 'missing'
                      ? libraryItemsForFilter.filter(item => item.status === 'missing')
                      : libraryItemsForFilter;

                    const libraryItemsQualityFiltered = qualityFilter === 'all'
                      ? libraryItemsStatusFiltered
                      : libraryItemsStatusFiltered.filter(item => {
                          const q = item.quality_profile || item.quality || item.title || '';
                          return matchesQualityFilter(q);
                        });

                    // Convert library items to FileItem format
                    const libraryItemsAsFiles: FileItem[] = libraryItemsQualityFiltered
                      .filter(item => item.tmdb_id)
                      .map(item => {
                        const tmdbKey = item.tmdb_id.toString();
                        const destPath = item.destination_path || item.root_folder;
                        return {
                          name: item.title,
                          path: destPath,
                          fullPath: destPath,
                          type: 'directory' as const,
                          isSeasonFolder: false,
                          hasSeasonFolders: isTvMediaType(item.media_type),
                          size: '--',
                          modified: new Date(item.added_at * 1000).toISOString(),
                          mediaType: item.media_type,
                          tmdbId: tmdbKey,
                          year: item.year,
                          isLibraryItem: true,
                          libraryItemId: item.id,
                          qualityProfile: item.quality_profile || item.quality,
                          monitorPolicy: item.monitor_policy,
                          tags: item.tags ? (typeof item.tags === 'string' ? JSON.parse(item.tags) : item.tags) : [],
                          quality: item.quality,
                          posterPath: item.poster_path,
                          releaseDate: undefined,
                          firstAirDate: undefined,
                          status: item.status as any
                        };
                      });

                    const allItems = libraryItemsAsFiles;

                    if (allItems.length > 0) {
                      return (
                        <Box>
              {view === 'poster' ? (
                <VirtualizedLibraryGrid
                  items={allItems}
                  totalCount={totalCount}
                  loadingMore={loadingMore}
                  onLoadMore={loadMoreItems}
                  tmdbData={tmdbData}
                  onFileClick={handleFileClick}
                  onImageLoad={(key: string) => setImageLoaded(key, true)}
                />
              ) : (
                <ListView
                  files={allItems}
                  currentPath={'/'}
                  formatDate={formatDate}
                  onItemClick={handleListItemClick}
                  onViewDetails={() => {}}
                  onRename={() => loadLibraryItems(true)}
                  onDeleted={() => loadLibraryItems(true)}
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