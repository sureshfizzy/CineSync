import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Box, CircularProgress, Divider, IconButton, Paper, Stack, Tooltip, Typography, alpha } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useNavigate } from 'react-router-dom';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';
import { libraryApi, LibraryItem, WantedEpisode } from '../../api/libraryApi';
import { getMediaCoverPosterUrl } from '../api/tmdbApi';

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseDate(value: string): Date | null {
  if (!value) return null;
  // Use date-only parsing to avoid timezone shifts (e.g. 00:00:00Z -> previous day locally).
  const datePart = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!m) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  return new Date(y, mo - 1, day);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function getCalendarStart(d: Date): Date {
  const first = startOfMonth(d);
  return new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay());
}

function buildCalendarGrid(monthDate: Date): Date[] {
  const firstVisible = getCalendarStart(monthDate);
  const currentMonth = monthDate.getMonth();
  const grid = Array.from({ length: 42 }, (_, idx) => new Date(firstVisible.getFullYear(), firstVisible.getMonth(), firstVisible.getDate() + idx));
  const lastRow = grid.slice(35, 42);
  const lastRowHasCurrentMonth = lastRow.some((d) => d.getMonth() === currentMonth);
  return lastRowHasCurrentMonth ? grid : grid.slice(0, 35);
}

function formatHumanDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function prettyEpisodeCode(season: number, episode: number): string {
  return `${season}x${String(episode).padStart(2, '0')}`;
}

type CalendarStatus = 'imported' | 'completed' | 'downloading' | 'missing' | 'wanted' | 'unknown';

interface CalendarItem {
  id: string;
  tmdbId: number;
  title: string;
  mediaType: 'tv' | 'movie';
  dateKey: string;
  status: CalendarStatus;
  releaseType?: 'theatrical' | 'digital' | 'physical' | 'release';
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
}

function toDateKeyFromISO(value?: string): string | null {
  if (!value) return null;
  const d = parseDate(value);
  return d ? dateKey(d) : null;
}

function statusColor(status: CalendarStatus): string {
  if (status === 'imported' || status === 'completed') return 'success.main';
  if (status === 'missing' || status === 'wanted') return 'warning.main';
  return 'info.main';
}

function statusLabel(status: CalendarStatus): string {
  if (status === 'imported' || status === 'completed') return 'Downloaded';
  if (status === 'missing' || status === 'wanted') return 'Missing';
  if (status === 'downloading') return 'Downloading';
  return 'Unknown';
}

function releaseTypeLabel(kind?: CalendarItem['releaseType']): string {
  const map: Record<NonNullable<CalendarItem['releaseType']>, string> = {
    theatrical: 'Theatrical Release',
    digital: 'Digital Release',
    physical: 'Physical Release',
    release: 'Release',
  };
  return kind ? map[kind] : 'Release';
}

export default function MediaCalendar() {
  const navigate = useNavigate();
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [posterFailed, setPosterFailed] = useState<Record<string, boolean>>({});
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState<string>(dateKey(new Date()));

  const loadCalendar = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [episodesResponse, moviesResponse] = await Promise.all([
        libraryApi.getWantedEpisodes(1000, 0),
        libraryApi.getLibraryMovies(10000, 0),
      ]);
      const allMovies: LibraryItem[] = moviesResponse.data || [];

      const episodeItems: CalendarItem[] = (episodesResponse.data || []).flatMap((ep: WantedEpisode) => {
        const key = toDateKeyFromISO(ep.airDate);
        if (!key) return [];
        return [
          {
            id: ep.id,
            tmdbId: ep.tmdbId,
            title: ep.title,
            mediaType: 'tv' as const,
            dateKey: key,
            status: 'missing' as const,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            episodeTitle: ep.episodeTitle,
          },
        ];
      });

      const movieItems: CalendarItem[] = allMovies
        .flatMap((movie: LibraryItem) => {
          const releaseVariants = [
            { key: toDateKeyFromISO(movie.in_cinemas_release_date), kind: 'theatrical' },
            { key: toDateKeyFromISO(movie.digital_release_date), kind: 'digital' },
            { key: toDateKeyFromISO(movie.physical_release_date), kind: 'physical' },
            { key: toDateKeyFromISO(movie.release_date), kind: 'release' },
          ];

          const uniqueByDate = new Map<string, string>();
          releaseVariants.forEach((v) => {
            if (v.key && !uniqueByDate.has(v.key)) uniqueByDate.set(v.key, v.kind);
          });

          return Array.from(uniqueByDate.entries()).map(([date, kind]) => ({
            id: `movie-${movie.id}-${kind}-${date}`,
            tmdbId: movie.tmdb_id,
            title: movie.title,
            mediaType: 'movie' as const,
            dateKey: date,
            status: (movie.status as CalendarStatus) || 'unknown',
            releaseType: kind as CalendarItem['releaseType'],
          }));
        })
        .filter((it) => it.dateKey);

      const allItems = [...episodeItems, ...movieItems];
      allItems.sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        return (a.episodeNumber || 0) - (b.episodeNumber || 0);
      });

      setItems(allItems);
      setPosterFailed({});
    } catch (e) {
      setError('Failed to load calendar');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCalendar();
  }, [loadCalendar]);

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    items.forEach((item) => {
      const key = item.dateKey;
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    Object.values(map).forEach((dayItems) => {
      dayItems.sort((a, b) => {
        if (a.mediaType !== b.mediaType) return a.mediaType === 'tv' ? -1 : 1;
        if (a.title !== b.title) return a.title.localeCompare(b.title);
        if ((a.seasonNumber || 0) !== (b.seasonNumber || 0)) return (a.seasonNumber || 0) - (b.seasonNumber || 0);
        return (a.episodeNumber || 0) - (b.episodeNumber || 0);
      });
    });
    return map;
  }, [items]);

  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  const currentMonthStart = startOfMonth(viewDate);
  const currentMonthEnd = endOfMonth(viewDate);
  const currentMonthStartKey = useMemo(() => dateKey(currentMonthStart), [currentMonthStart]);
  const currentMonthEndKey = useMemo(() => dateKey(currentMonthEnd), [currentMonthEnd]);
  const monthGrid = useMemo(() => buildCalendarGrid(viewDate), [viewDate]);
  const monthLabel = useMemo(
    () =>
      currentMonthStart.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [currentMonthStart],
  );

  const monthEpisodeCount = useMemo(() => {
    let count = 0;
    for (const item of items) {
      if (item.mediaType !== 'tv') continue;
      if (item.dateKey >= currentMonthStartKey && item.dateKey <= currentMonthEndKey) count++;
    }
    return count;
  }, [items, currentMonthStartKey, currentMonthEndKey]);

  const monthMovieCount = useMemo(() => {
    let count = 0;
    for (const item of items) {
      if (item.mediaType !== 'movie') continue;
      if (item.dateKey >= currentMonthStartKey && item.dateKey <= currentMonthEndKey) count++;
    }
    return count;
  }, [items, currentMonthStartKey, currentMonthEndKey]);

  const selectedEpisodes = eventsByDay[selectedDateKey] || [];
  const selectedDate = useMemo(() => parseDate(selectedDateKey), [selectedDateKey]);
  const openMediaItem = useCallback((item: CalendarItem) => {
    if (!item.tmdbId) return;
    navigate(`/media/${item.mediaType}/${encodeURIComponent(String(item.tmdbId))}`, {
      state: {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      },
    });
  }, [navigate]);

  return (
    <ConfigurationWrapper>
      <Box sx={{ px: { xs: 0, sm: 0.8, md: 0 }, maxWidth: { xs: '100%', md: 980 }, mx: 'auto', width: '100%', boxSizing: 'border-box', overflowX: 'hidden' }}>
        <Box
          sx={{
            mb: 0.55,
            px: 0.7,
            py: 0.35,
            minHeight: 42,
            borderRadius: 2.2,
            border: (t) => (t.palette.mode === 'dark' ? '1.5px solid' : '1px solid'),
            borderColor: (t) =>
              t.palette.mode === 'dark'
                ? alpha(t.palette.success.main, 0.7)
                : alpha(t.palette.primary.main, 0.25),
            boxShadow: (t) =>
              t.palette.mode === 'dark'
                ? `0 0 0 1px ${alpha(t.palette.success.main, 0.25)} inset, 0 0 10px ${alpha(t.palette.success.main, 0.18)}`
                : 'none',
            bgcolor: (t) => alpha(t.palette.background.paper, 0.55),
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <Stack direction="row" spacing={0.5} sx={{ minHeight: 28, flex: '0 0 auto', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.success.main, 0.2) }}>
              <CalendarMonthIcon fontSize="small" color="success" />
            </Box>
            <IconButton size="small" sx={{ p: 0.3, height: 24, width: 24 }} onClick={() => setViewDate((d) => addMonths(d, -1))} aria-label="Previous month">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Box sx={{ px: 0.2, display: 'flex', alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1, fontSize: '0.92rem' }}>
                {monthLabel}
              </Typography>
            </Box>
            <IconButton size="small" sx={{ p: 0.3, height: 24, width: 24 }} onClick={() => setViewDate((d) => addMonths(d, 1))} aria-label="Next month">
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Stack direction="row" spacing={0.7} sx={{ minHeight: 28, flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', height: 24 }}>
              {monthEpisodeCount} episode{monthEpisodeCount === 1 ? '' : 's'}, {monthMovieCount} movie{monthMovieCount === 1 ? '' : 's'}
            </Typography>
            <Divider orientation="vertical" flexItem sx={{ mx: 0.2 }} />
            <IconButton size="small" onClick={loadCalendar} aria-label="Refresh calendar" sx={{ p: 0.35, height: 24, width: 24 }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : monthGrid.length === 0 ? (
          <Alert severity="info">No episodes with air dates found.</Alert>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              overflow: 'hidden',
              width: '100%',
              boxSizing: 'border-box',
              borderRadius: 2.2,
              border: (t) => (t.palette.mode === 'dark' ? '1.5px solid' : '1px solid'),
              borderColor: (t) =>
                t.palette.mode === 'dark'
                  ? alpha(t.palette.success.main, 0.7)
                  : alpha(t.palette.primary.main, 0.25),
              boxShadow: (t) =>
                t.palette.mode === 'dark'
                  ? `0 0 0 1px ${alpha(t.palette.success.main, 0.2)} inset`
                  : 'none',
              bgcolor: (t) => alpha(t.palette.background.paper, 0.45),
            }}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: '1px solid', borderColor: 'divider', bgcolor: (t) => alpha(t.palette.action.hover, 0.08) }}>
              {WEEK_DAYS.map((day) => (
                <Box key={day} sx={{ p: 0.38, borderRight: '1px solid', borderColor: 'divider', '&:last-of-type': { borderRight: 0 } }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: 0.1, fontSize: '0.66rem' }}>
                    {day.slice(0, 3)}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
              {monthGrid.map((cellDate, idx) => {
                const key = dateKey(cellDate);
                const inCurrentMonth = cellDate.getMonth() === currentMonthStart.getMonth();
                const dayItems = eventsByDay[key] || [];
                const isToday = dateKey(cellDate) === dateKey(today);
                const visibleItems = dayItems.slice(0, 2);
                const remaining = dayItems.length - visibleItems.length;
                const isLastRow = idx >= monthGrid.length - 7;

                return (
                  <Box
                    key={`${key}-${idx}`}
                    onClick={() => setSelectedDateKey(key)}
                    sx={{
                      minHeight: 46,
                      p: 0.28,
                      cursor: 'pointer',
                      borderRight: (idx + 1) % 7 === 0 ? 0 : '1px solid',
                      borderBottom: isLastRow ? 0 : '1px solid',
                      borderColor: 'divider',
                      bgcolor: (t) => {
                        if (isToday) {
                          return t.palette.mode === 'dark'
                            ? alpha(t.palette.info.light, 0.34)
                            : alpha(t.palette.info.main, 0.18);
                        }
                        if (!inCurrentMonth) return 'transparent';
                        return t.palette.mode === 'dark' ? alpha(t.palette.info.light, 0.18) : alpha(t.palette.info.main, 0.08);
                      },
                      opacity: inCurrentMonth ? 1 : 0.45,
                      outline: selectedDateKey === key ? '2px solid' : 'none',
                      outlineColor: selectedDateKey === key ? 'primary.main' : 'transparent',
                      outlineOffset: -2,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.1 }}>
                      <Typography variant="caption" sx={{ fontWeight: isToday ? 800 : 600, fontSize: '0.66rem' }}>
                        {cellDate.getDate()}
                      </Typography>
                      {dayItems.length > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.64rem' }}>
                          {dayItems.length}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={0.35} sx={{ flexWrap: 'wrap', rowGap: 0.22 }}>
                      {visibleItems.map((it) => (
                        <Tooltip
                          key={it.id}
                          title={
                            it.mediaType === 'tv'
                              ? `${it.title} • ${prettyEpisodeCode(it.seasonNumber || 0, it.episodeNumber || 0)} • ${it.episodeTitle || 'Untitled episode'}`
                              : `${it.title} • Movie`
                          }
                          arrow
                        >
                          <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: statusColor(it.status) }} />
                        </Tooltip>
                      ))}
                      {remaining > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>
                          +{remaining}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          </Paper>
        )}

        {!loading && !error && (
          <Paper variant="outlined" sx={{ mt: 0.7, p: 0.9, borderRadius: 2.2, borderColor: (t) => alpha(t.palette.primary.main, 0.2), bgcolor: (t) => alpha(t.palette.background.paper, 0.4) }}>
            <Stack direction="row" sx={{ mb: 1, alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Typography variant="body1" sx={{ fontWeight: 800 }}>
                {selectedDate ? formatHumanDate(selectedDate) : selectedDateKey}
              </Typography>
            </Stack>
            <Divider sx={{ mb: 0.8 }} />

            {selectedEpisodes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No episodes on selected day.
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                {selectedEpisodes.map((it, idx) => (
                  <Stack
                    key={it.id}
                    direction="row"
                    spacing={0.9}
                    onClick={() => openMediaItem(it)}
                    sx={{
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      borderRadius: 1,
                      px: 0.3,
                      py: 0.25,
                      '&:hover': { bgcolor: (t) => alpha(t.palette.action.hover, 0.14) },
                    }}
                  >
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.35 }}>
                      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: statusColor(it.status) }} />
                      {idx < selectedEpisodes.length - 1 && (
                        <Box sx={{ width: 2, flex: 1, minHeight: 30, mt: 0.35, bgcolor: (t) => alpha(t.palette.info.main, 0.35) }} />
                      )}
                    </Box>

                    <Box sx={{ width: 34, height: 48, borderRadius: 1, overflow: 'hidden', flexShrink: 0 }}>
                      {!posterFailed[it.id] && it.tmdbId ? (
                        <Box
                          component="img"
                          src={getMediaCoverPosterUrl(it.tmdbId) || ''}
                          alt={it.title}
                          loading="lazy"
                          onError={() => setPosterFailed((prev) => ({ ...prev, [it.id]: true }))}
                          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : null}
                      {posterFailed[it.id] && (
                        <Avatar
                          variant="rounded"
                          sx={{
                            width: '100%',
                            height: '100%',
                            bgcolor: (t) => alpha(t.palette.primary.main, 0.18),
                            border: '1px solid',
                            borderColor: (t) => alpha(t.palette.primary.main, 0.35),
                            fontSize: 14,
                            fontWeight: 700,
                          }}
                        >
                          {it.title.charAt(0).toUpperCase()}
                        </Avatar>
                      )}
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        {it.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.1, display: 'block' }}>
                        <Box component="span" sx={{ color: 'info.main', fontWeight: 700 }}>
                          {it.mediaType === 'movie' ? 'Movie' : 'Episode'}
                        </Box>
                        {'  •  '}
                        {it.mediaType === 'movie'
                          ? releaseTypeLabel(it.releaseType)
                          : prettyEpisodeCode(it.seasonNumber || 0, it.episodeNumber || 0)}
                        {it.mediaType === 'tv' && it.episodeTitle ? `  •  ${it.episodeTitle}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {selectedDate ? formatHumanDate(selectedDate) : selectedDateKey}
                        {'  •  '}
                        <Box component="span" sx={{ color: statusColor(it.status), fontWeight: 700 }}>
                          {statusLabel(it.status)}
                        </Box>
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        )}
      </Box>
    </ConfigurationWrapper>
  );
}