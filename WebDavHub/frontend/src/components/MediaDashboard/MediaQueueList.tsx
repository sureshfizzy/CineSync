import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, alpha, Box, Button, Chip, CircularProgress, Divider, IconButton, MenuItem, Paper, Select, Stack, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete'; import RefreshIcon from '@mui/icons-material/Refresh'; import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'; import CloudDownloadIcon from '@mui/icons-material/CloudDownload'; import CheckCircleIcon from '@mui/icons-material/CheckCircle'; import ErrorIcon from '@mui/icons-material/Error'; import PauseCircleIcon from '@mui/icons-material/PauseCircle'; import ImportExportIcon from '@mui/icons-material/ImportExport'; import HistoryIcon from '@mui/icons-material/History';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'; import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { libraryApi, DownloadQueueItem } from '../../api/libraryApi';
import { useLocation, useNavigate } from 'react-router-dom';

type ActiveStatus = 'all' | 'queued' | 'downloading' | 'importing' | 'failed' | 'paused';

const STATUS_META: Record<DownloadQueueItem['status'], { label: string; color: string; icon: React.ReactNode }> = {
  queued:      { label: 'Queued',      color: 'text.secondary', icon: <HourglassEmptyIcon fontSize="small" /> },
  downloading: { label: 'Downloading', color: 'info.main',      icon: <CloudDownloadIcon fontSize="small" /> },
  importing:   { label: 'Importing',   color: 'warning.main',   icon: <ImportExportIcon fontSize="small" /> },
  completed:   { label: 'Completed',   color: 'success.main',   icon: <CheckCircleIcon fontSize="small" /> },
  failed:      { label: 'Failed',      color: 'error.main',     icon: <ErrorIcon fontSize="small" /> },
  paused:      { label: 'Paused',      color: 'text.secondary', icon: <PauseCircleIcon fontSize="small" /> },
};

const EVENT_LABEL: Record<string, string> = {
  grabbed:                 'Grabbed',
  downloadFolderImported:  'Imported',
  downloadFailed:          'Failed',
  downloadIgnored:         'Ignored',
};

const TRACKED_STATE_LABEL: Record<string, string> = {
  downloading:   'Downloading',
  importPending: 'Import Pending',
  importing:     'Importing',
  downloaded:    'Downloaded',
  ignored:       'Ignored',
};

function formatBytes(b: number) {
  if (!b) return '—';
  const u = ['B','KB','MB','GB','TB'], i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}
function formatDate(ts?: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const actionCell = { width: 56, px: 0.5 } as const;

function QueueTable({ items, onDelete, isHistory }: { items: DownloadQueueItem[]; onDelete: (id: number, removeFromClient: boolean) => void; isHistory?: boolean }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <TableContainer>
      <Table size="small" sx={{ tableLayout: 'auto' }}>
        <TableHead>
          <TableRow sx={{ bgcolor: theme.palette.mode === 'light' ? alpha(theme.palette.primary.main, 0.08) : alpha(theme.palette.primary.main, 0.2) }}>
            <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
            {!isMobile && <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Type</TableCell>}
            <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Quality</TableCell>
            {!isMobile && <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Size</TableCell>}
            <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{isHistory ? 'Event' : 'Status'}</TableCell>
            {!isMobile && <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Added</TableCell>}
            <TableCell align="right" sx={{ fontWeight: 600, ...actionCell }}>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => {
            const meta = STATUS_META[item.status] ?? STATUS_META.queued;
            const ep = item.mediaType === 'tv' && item.seasonNumber != null && item.episodeNumber != null
              ? `S${String(item.seasonNumber).padStart(2,'0')}E${String(item.episodeNumber).padStart(2,'0')}` : null;
            const trackedLabel = item.trackedDownloadState ? TRACKED_STATE_LABEL[item.trackedDownloadState] : null;
            const eventLabel = item.eventType ? EVENT_LABEL[item.eventType] : null;
            const titleBase = item.title.toLowerCase();
            const showRelease = item.releaseTitle && !item.releaseTitle.toLowerCase().startsWith(titleBase);
            return (
              <TableRow key={item.id} hover sx={{ '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.35) }, ...(item.status === 'failed' ? { bgcolor: alpha(theme.palette.error.main, 0.04) } : {}) }}>
                <TableCell sx={{ overflow: 'hidden', maxWidth: isMobile ? 180 : 'none' }}>
                  <Stack spacing={0.25}>
                    <Typography
                      variant="body2"
                      fontWeight={600}
                      noWrap
                      sx={{ textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: '100%' }}
                    >
                      {item.title}{item.year ? ` (${item.year})` : ''}{ep ? <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>{ep}</Typography> : null}
                    </Typography>
                    {!isMobile && showRelease && <Typography variant="caption" color="text.secondary" noWrap>{item.releaseTitle}</Typography>}
                    {item.errorMessage && <Typography variant="caption" color="error.main" noWrap>{item.errorMessage}</Typography>}
                    {item.statusMessages?.length > 0 && <Typography variant="caption" color="warning.main" noWrap>{item.statusMessages[0]}</Typography>}
                  </Stack>
                </TableCell>
                {!isMobile && (
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">{item.mediaType === 'movie' ? 'Movie' : 'Show'}</Typography>
                  </TableCell>
                )}
                <TableCell>
                  {item.quality ? <Chip label={item.quality} size="small" variant="outlined" /> : <Typography variant="body2" color="text.secondary">—</Typography>}
                </TableCell>
                {!isMobile && <TableCell><Typography variant="body2" color="text.secondary" noWrap>{formatBytes(item.size)}</Typography></TableCell>}
                <TableCell>
                  <Stack spacing={0.25}>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: meta.color }}>
                      {meta.icon}
                      <Typography variant="caption" sx={{ color: meta.color, fontWeight: 600 }}>
                        {isHistory ? (eventLabel ?? meta.label) : meta.label}
                      </Typography>
                    </Stack>
                    {trackedLabel && item.eventType !== 'downloadFolderImported' && (
                      <Typography variant="caption" color="text.disabled">{trackedLabel}</Typography>
                    )}
                  </Stack>
                </TableCell>
                {!isMobile && (
                  <TableCell sx={{ whiteSpace: 'nowrap', pr: 0.5 }}>
                    <Stack spacing={0.1}>
                      <Typography variant="caption" color="text.secondary" noWrap>{formatDate(item.addedAt)}</Typography>
                      {item.completedAt && item.completedAt - item.addedAt > 60 && (
                        <Typography variant="caption" color="success.main" noWrap>✓ {formatDate(item.completedAt)}</Typography>
                      )}
                    </Stack>
                  </TableCell>
                )}
                <TableCell align="right" sx={actionCell}>
                  <Tooltip title={isHistory ? 'Remove from history' : 'Remove & cancel download'}>
                    <IconButton size="small" onClick={() => onDelete(item.id, !isHistory)}><DeleteIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const PAGE_SIZE = 25;

export default function MediaQueueList() {
  const navigate = useNavigate();
  const location = useLocation();
  const routeTab: 'queue' | 'history' = location.pathname.endsWith('/history') ? 'history' : 'queue';
  const [tab, setTab] = useState<'queue' | 'history'>(routeTab);
  const [activeItems, setActiveItems] = useState<DownloadQueueItem[]>([]);
  const [historyItems, setHistoryItems] = useState<DownloadQueueItem[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [historyCount, setHistoryCount] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [tabAnimTick, setTabAnimTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ActiveStatus>('all');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const historyPageRef = useRef(historyPage);
  historyPageRef.current = historyPage;

  const fetchActive = useCallback(async (isBackground = false, page?: number) => {
    if (!isBackground) setInitialLoading(true);
    else setPolling(true);
    setError(null);
    try {
      const p = page ?? activePageRef.current;
      const status = statusFilterRef.current === 'all' ? undefined : statusFilterRef.current;
      const res = await libraryApi.getDownloadQueue(PAGE_SIZE, p * PAGE_SIZE, status);
      const active = (res.data ?? []).filter(i => i.status !== 'completed');
      setActiveItems(active);
      setActiveCount(res.total_count ?? res.count ?? active.length);
    } catch { setError('Failed to load queue.'); }
    finally { setInitialLoading(false); setPolling(false); }
  }, []);

  const fetchHistory = useCallback(async (isBackground = false, page?: number) => {
    if (!isBackground) setInitialLoading(true);
    else setPolling(true);
    setError(null);
    try {
      const p = page ?? historyPageRef.current;
      const res = await libraryApi.getDownloadHistory(PAGE_SIZE, p * PAGE_SIZE);
      setHistoryItems(res.data ?? []);
      setHistoryCount(res.total_count ?? res.count ?? 0);
    } catch { setError('Failed to load history.'); }
    finally { setInitialLoading(false); setPolling(false); }
  }, []);

  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => { setTab(routeTab); }, [routeTab]);

  const refresh = useCallback(() => {
    if (tabRef.current === 'queue') fetchActive(false);
    else fetchHistory(false);
  }, [fetchActive, fetchHistory]);

  useEffect(() => {
    if (tab === 'queue') fetchActive(false);
  }, [tab, statusFilter, fetchActive]);

  useEffect(() => {
    if (tab === 'queue') fetchActive(false);
    else fetchHistory(false);
    const ms = tab === 'queue' ? 3000 : 15000;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (tabRef.current === 'queue') fetchActive(true);
      else fetchHistory(true);
    }, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [tab, fetchActive, fetchHistory]);

  const handleDelete = async (id: number, removeFromClient = true) => {
    try {
      await libraryApi.deleteQueueItem(id, removeFromClient);
      if (tab === 'queue') setActiveItems(p => p.filter(i => i.id !== id));
      else setHistoryItems(p => p.filter(i => i.id !== id));
    } catch {}
  };

  const handleClearCurrent = async () => {
    try {
      await libraryApi.clearQueue(tab === 'queue' ? 'queue' : 'history');
      if (tab === 'queue') { setActiveItems([]); setActiveCount(0); setActivePage(0); }
      else { setHistoryItems([]); setHistoryCount(0); setHistoryPage(0); }
    } catch { setError(`Failed to clear ${tab}.`); }
  };

  const page = tab === 'queue' ? activePage : historyPage;
  const setPage = tab === 'queue' ? setActivePage : setHistoryPage;
  const totalCount = tab === 'queue' ? activeCount : historyCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const items = tab === 'queue' ? activeItems : historyItems;

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 1.5, sm: 2.5 }, pt: 2.5, pb: 1 }}>
      <CloudDownloadIcon sx={{ color: 'primary.main', fontSize: 28 }} />
      <Box>
        <Typography variant="h6" fontWeight={700} lineHeight={1.2}>Downloads</Typography>
        <Typography variant="caption" color="text.secondary">Queue &amp; history of grabbed releases</Typography>
      </Box>
    </Box>
  );

  if (initialLoading) {
    return <Box>{header}<Divider /><Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress /></Box></Box>;
  }
  if (error) {
    return <Box>{header}<Divider /><Box sx={{ p: 3 }}><Alert severity="error">{error}</Alert></Box></Box>;
  }

  return (
    <Box>
      {header}

      {/* Queue / History tabs */}
      <Box sx={{ px: { xs: 1.5, sm: 2.5 } }}>
        <Tabs
          value={tab}
          onChange={(_, v: 'queue' | 'history') => {
            setTab(v);
            setTabAnimTick((t) => t + 1);
            navigate(v === 'history' ? '/Mediadashboard/history' : '/Mediadashboard/queue');
          }}
          sx={{
            mb: 1,
            minHeight: 40,
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: 2,
              transition: 'all 260ms cubic-bezier(0.2, 0, 0, 1)',
            },
            '& .MuiTab-root': {
              minHeight: 40,
              textTransform: 'none',
              fontWeight: 600,
              transition: 'color 220ms ease, opacity 220ms ease, transform 220ms ease',
            },
            '& .MuiTab-root:hover': {
              opacity: 1,
              transform: 'translateY(-1px)',
            },
            '& .Mui-selected': {
              fontWeight: 700,
            },
          }}
        >
          <Tab
            disableRipple
            value="queue"
            label={<Stack direction="row" spacing={0.75} alignItems="center"><CloudDownloadIcon fontSize="small" /><span>Queue {activeCount > 0 ? `(${activeCount})` : ''}</span></Stack>}
          />
          <Tab
            disableRipple
            value="history"
            label={<Stack direction="row" spacing={0.75} alignItems="center"><HistoryIcon fontSize="small" /><span>History {historyCount > 0 ? `(${historyCount})` : ''}</span></Stack>}
          />
        </Tabs>
      </Box>

      <Divider sx={{ mb: 2 }} />

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mx: { xs: 1.5, sm: 2.5 }, mb: 2.5 }}>
        {/* Toolbar */}
        <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="body2" fontWeight={600}>{totalCount} item{totalCount !== 1 ? 's' : ''}</Typography>
            {polling && <CircularProgress size={14} thickness={5} />}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            {tab === 'queue' && (
              <>
                <Typography variant="caption" color="text.secondary">Status</Typography>
                <Select size="small" value={statusFilter} onChange={e => { setStatusFilter(e.target.value as ActiveStatus); setActivePage(0); }} sx={{ minWidth: 130 }}>
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="queued">Queued</MenuItem>
                  <MenuItem value="downloading">Downloading</MenuItem>
                  <MenuItem value="importing">Importing</MenuItem>
                  <MenuItem value="failed">Failed</MenuItem>
                  <MenuItem value="paused">Paused</MenuItem>
                </Select>
              </>
            )}
            <Button size="small" color="error" variant="text" onClick={handleClearCurrent} disabled={totalCount === 0}>
              {tab === 'queue' ? 'Clear Queue' : 'Clear History'}
            </Button>
            <Tooltip title="Refresh"><IconButton size="small" onClick={refresh}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>
        </Box>

        <Box
          key={`${tab}-${tabAnimTick}`}
          sx={{
            animation: 'queueTabEnter 180ms ease',
            '@keyframes queueTabEnter': {
              from: { opacity: 0.9, transform: 'translateY(3px)' },
              to: { opacity: 1, transform: 'translateY(0)' },
            },
          }}
        >
          {items.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 8 }}>
              {tab === 'queue'
                ? <><CloudDownloadIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} /><Typography variant="h6" color="text.secondary">Queue is empty</Typography><Typography variant="body2" color="text.secondary">Grab a release to start downloading.</Typography></>
                : <><HistoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} /><Typography variant="h6" color="text.secondary">No history yet</Typography><Typography variant="body2" color="text.secondary">Completed downloads will appear here.</Typography></>
              }
            </Box>
          ) : (
            <>
              <QueueTable items={items} onDelete={handleDelete} isHistory={tab === 'history'} />
              {totalPages > 1 && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Page {page + 1} of {totalPages}
                  </Typography>
                  <IconButton size="small" disabled={page === 0} onClick={() => {
                    const next = page - 1;
                    setPage(next);
                    if (tab === 'queue') fetchActive(false, next);
                    else fetchHistory(false, next);
                  }}><NavigateBeforeIcon fontSize="small" /></IconButton>
                  <IconButton size="small" disabled={page >= totalPages - 1} onClick={() => {
                    const next = page + 1;
                    setPage(next);
                    if (tab === 'queue') fetchActive(false, next);
                    else fetchHistory(false, next);
                  }}><NavigateNextIcon fontSize="small" /></IconButton>
                </Box>
              )}
            </>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
