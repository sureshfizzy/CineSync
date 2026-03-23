import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, CircularProgress,
  Chip, IconButton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip,
  alpha, useTheme, Alert, TableSortLabel,
  Select, MenuItem, FormControl,
} from '@mui/material';
import {
  Close as CloseIcon,
  CloudDownload as GrabIcon,
  CheckCircle as CheckCircleIcon,
  Person as PersonIcon,
  Block as RejectedIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { IndexerApi } from '../../api/indexerApi';
import { Indexer, IndexerSearchResult } from '../../types/indexer';
import { getAuthHeaders } from '../../contexts/AuthContext';

interface QualityProfile {
  id: number;
  name: string;
  qualities: string[];
}

interface IndexerSearchModalProps {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  mediaType: 'movie' | 'tv';
}

type SortField = 'seeders' | 'size' | 'age' | 'title' | 'quality' | 'rejection';
type SortDir = 'asc' | 'desc';

// Quality rank for sorting — lives here only for UI sort order, no rejection logic.
const QUALITY_RANK: Record<string, number> = {
  'Raw-HD': 100, 'BR-DISK': 99,
  'Remux-2160p': 95, 'Bluray-2160p': 93, 'WEB 2160p': 91, 'HDTV-2160p': 89,
  'Remux-1080p': 85, 'Bluray-1080p': 83, 'WEB 1080p': 81, 'HDTV-1080p': 79,
  'Bluray-720p': 75, 'WEB 720p': 73, 'HDTV-720p': 71,
  'Bluray-576p': 60, 'Bluray-480p': 55, 'WEB 480p': 53,
  'DVD-R': 40, 'DVD': 38, 'SDTV': 30,
  'TELECINE': 15, 'TELESYNC': 12, 'CAM': 8, 'WORKPRINT': 5, 'Unknown': 0,
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getAgeDays(dateStr: string): number | null {
  if (!dateStr) return null;
  try { return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000); }
  catch { return null; }
}

function formatAge(dateStr: string): string {
  const days = getAgeDays(dateStr);
  if (days === null) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

function detectLanguage(title: string): string {
  const t = title.toUpperCase();
  if (t.includes('.ITA.') || t.includes(' ITA ') || t.includes('-ITA') || t.includes('ITALIAN')) return 'Italian';
  if (t.includes('.SPA.') || t.includes('SPANISH') || t.includes('.ESP.')) return 'Spanish';
  if (t.includes('.GER.') || t.includes('GERMAN') || t.includes('.DE.')) return 'German';
  if (t.includes('.FRE.') || t.includes('FRENCH') || t.includes('.FR.')) return 'French';
  if (t.includes('.RUS.') || t.includes('RUSSIAN')) return 'Russian';
  if (t.includes('.POR.') || t.includes('PORTUGUESE')) return 'Portuguese';
  if (t.includes('.JPN.') || t.includes('JAPANESE')) return 'Japanese';
  if (t.includes('MULTI') || t.includes('DUAL')) return 'Multi';
  return 'English';
}

function getSourceLabel(category: string): string {
  if (!category) return '?';
  const cat = category.toLowerCase();
  if (cat.includes('nzb') || cat.includes('usenet') || cat.includes('nzbs')) return 'nzb';
  return 'torrent';
}

export default function IndexerSearchModal({ open, onClose, initialQuery, mediaType }: IndexerSearchModalProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const amoledBg = isDark ? '#000000' : theme.palette.background.paper;
  const amoledHeader = isDark ? '#0d0d0d' : alpha(theme.palette.grey[100], 0.95);
  const amoledRowHover = isDark ? '#111111' : alpha(theme.palette.action.hover, 0.5);

  const [indexers, setIndexers] = useState<Indexer[]>([]);
  const [profiles, setProfiles] = useState<QualityProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<QualityProfile | null>(null);
  const [results, setResults] = useState<IndexerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('seeders');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [grabbing, setGrabbing] = useState<string | null>(null);
  const [grabbed, setGrabbed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setResults([]);
    setError(null);
    setGrabbed(new Set());
    IndexerApi.getIndexers()
      .then((all) => setIndexers(all.filter((ix) => ix.enabled)))
      .catch(() => setIndexers([]));
    fetch(`/api/quality-profiles?mediaType=${mediaType}`, { headers: getAuthHeaders() })
      .then((r) => r.ok ? r.json() : [])
      .then((ps: QualityProfile[]) => {
        setProfiles(ps);
        const preferred = ps.find((p) => /1080/i.test(p.name))
          || ps.find((p) => p.name !== 'Any')
          || ps[0] || null;
        setSelectedProfile(preferred);
      })
      .catch(() => { setProfiles([]); setSelectedProfile(null); });
  }, [open, mediaType]);

  const handleSearch = useCallback(async (indexerList: Indexer[]) => {
    if (!initialQuery?.trim() || indexerList.length === 0) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const allResults: IndexerSearchResult[] = [];
    await Promise.allSettled(
      indexerList.map(async (ix) => {
        try {
          const res = await IndexerApi.searchIndexer(ix.id, {
            query: initialQuery.trim(),
            limit: 100,
            mediaType,
          });
          allResults.push(...res);
        } catch { /* ignore per-indexer failures */ }
      })
    );
    setResults(allResults);
    if (allResults.length === 0) setError('No results found for this title.');
    setLoading(false);
  }, [initialQuery, mediaType]);

  useEffect(() => {
    if (open && indexers.length > 0) handleSearch(indexers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, indexers]);

  const handleGrab = async (result: IndexerSearchResult) => {
    const key = result.link || result.magnet || result.title;
    setGrabbing(key);
    const grabTarget = result.magnet || result.link;
    try {
      const token = localStorage.getItem('cineSyncJWT');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (grabTarget) {
        const resp = await fetch('/api/realdebrid/add-magnet', {
          method: 'POST', headers,
          body: JSON.stringify({ magnet: grabTarget, title: result.title }),
        });
        if (!resp.ok) window.open(grabTarget, '_blank');
        setGrabbed((prev) => new Set(prev).add(key));
      }
    } catch {
      if (grabTarget) window.open(grabTarget, '_blank');
      setGrabbed((prev) => new Set(prev).add(key));
    } finally {
      setGrabbing(null);
    }
  };

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'title' ? 'asc' : 'desc');
    }
  };

  const evaluate = (result: IndexerSearchResult) => {
    if (!selectedProfile || !selectedProfile.qualities?.length) {
      return { allowed: result.allowed, rejectionReason: result.rejectionReasons?.[0] ?? '' };
    }
    const allowed = selectedProfile.qualities
      .map((q) => q.toLowerCase())
      .includes((result.quality ?? '').toLowerCase());
    const rejectionReason = allowed
      ? ''
      : `"${result.quality}" not in profile "${selectedProfile.name}"`;
    return { allowed, rejectionReason };
  };

  const sortedResults = [...results].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'seeders') cmp = (a.seeders ?? 0) - (b.seeders ?? 0);
    else if (sortField === 'size') cmp = (a.size ?? 0) - (b.size ?? 0);
    else if (sortField === 'age') cmp = new Date(a.publishDate || 0).getTime() - new Date(b.publishDate || 0).getTime();
    else if (sortField === 'title') cmp = (a.title || '').localeCompare(b.title || '');
    else if (sortField === 'quality') cmp = (QUALITY_RANK[a.quality] ?? 1) - (QUALITY_RANK[b.quality] ?? 1);
    else if (sortField === 'rejection') cmp = (evaluate(a).allowed ? 0 : 1) - (evaluate(b).allowed ? 0 : 1);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const cellSx = {
    fontWeight: 700, fontSize: '0.75rem', color: 'text.secondary',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
    bgcolor: amoledHeader, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
    py: 1.25, whiteSpace: 'nowrap' as const,
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sortLabelSx = { fontSize: 'inherit', color: 'inherit', '& .MuiTableSortLabel-icon': { fontSize: '0.75rem' } };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth
      PaperProps={{ sx: { height: '85vh', maxHeight: '85vh', borderRadius: 2, bgcolor: amoledBg } }}
    >
      <DialogTitle sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        py: 1.5, px: 2.5,
        bgcolor: isDark ? '#0d0d0d' : alpha(theme.palette.primary.main, 0.06),
        borderBottom: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" fontWeight={700}>
            Interactive Search
            {initialQuery && (
              <Typography component="span" variant="subtitle1" fontWeight={400} color="text.secondary">
                {' — '}{initialQuery}
              </Typography>
            )}
          </Typography>
          {!loading && results.length > 0 && (
            <Chip label={`${results.length} result${results.length !== 1 ? 's' : ''}`}
              size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
          )}
          {profiles.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <Select
                value={selectedProfile?.id ?? ''}
                onChange={(e) => setSelectedProfile(profiles.find((p) => p.id === e.target.value) || null)}
                sx={{
                  fontSize: '0.72rem', height: 24, color: 'warning.main',
                  '.MuiOutlinedInput-notchedOutline': { borderColor: alpha(theme.palette.warning.main, 0.4) },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main' },
                  '.MuiSelect-icon': { color: 'warning.main', fontSize: '1rem' },
                  '.MuiSelect-select': { py: '2px', px: 1 },
                }}
              >
                {profiles.map((p) => (
                  <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.8rem' }}>{p.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>
        <IconButton onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 2 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              Searching {indexers.length} indexer{indexers.length !== 1 ? 's' : ''}…
            </Typography>
          </Box>
        )}

        {!loading && indexers.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Alert severity="warning" sx={{ maxWidth: 480, mx: 'auto' }}>
              No enabled indexers found. Go to <strong>Settings → Indexers</strong> to add one.
            </Alert>
          </Box>
        )}

        {!loading && error && results.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Alert severity="info" sx={{ maxWidth: 480, mx: 'auto' }}>{error}</Alert>
          </Box>
        )}

        {!loading && sortedResults.length > 0 && (
          <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ ...cellSx, width: 70 }}>Source</TableCell>
                  <TableCell sx={{ ...cellSx, width: 90 }}>
                    <TableSortLabel active={sortField === 'age'} direction={sortField === 'age' ? sortDir : 'desc'}
                      onClick={() => handleSortClick('age')} sx={sortLabelSx}>Age</TableSortLabel>
                  </TableCell>
                  <TableCell sx={cellSx}>
                    <TableSortLabel active={sortField === 'title'} direction={sortField === 'title' ? sortDir : 'asc'}
                      onClick={() => handleSortClick('title')} sx={sortLabelSx}>Title</TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ ...cellSx, width: 110 }}>Indexer</TableCell>
                  <TableCell align="right" sx={{ ...cellSx, width: 90 }}>
                    <TableSortLabel active={sortField === 'size'} direction={sortField === 'size' ? sortDir : 'desc'}
                      onClick={() => handleSortClick('size')} sx={sortLabelSx}>Size</TableSortLabel>
                  </TableCell>
                  <TableCell align="center" sx={{ ...cellSx, width: 70 }}>
                    <TableSortLabel active={sortField === 'seeders'} direction={sortField === 'seeders' ? sortDir : 'desc'}
                      onClick={() => handleSortClick('seeders')} sx={sortLabelSx}>Peers</TableSortLabel>
                  </TableCell>
                  <TableCell align="center" sx={{ ...cellSx, width: 90 }}>Language</TableCell>
                  <TableCell sx={{ ...cellSx, width: 160, px: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <TableSortLabel active={sortField === 'quality'} direction={sortField === 'quality' ? sortDir : 'desc'}
                        onClick={() => handleSortClick('quality')}
                        sx={{ ...sortLabelSx, '& .MuiTableSortLabel-icon': { display: 'none' }, '&.Mui-active': { color: 'inherit' } }}>
                        Quality{sortField === 'quality' && (sortDir === 'desc' ? ' ↓' : ' ↑')}
                      </TableSortLabel>
                      <Tooltip title="Sort by rejections">
                        <Box component="span" onClick={() => handleSortClick('rejection')} sx={{
                          display: 'inline-flex', alignItems: 'center', cursor: 'pointer', p: 0.25,
                          color: sortField === 'rejection' ? 'error.main' : 'text.disabled',
                          '&:hover': { color: 'error.light' },
                        }}>
                          <RejectedIcon sx={{ fontSize: 13 }} />
                        </Box>
                      </Tooltip>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ ...cellSx, width: 72 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedResults.map((result, idx) => {
                  const key = result.link || result.magnet || `${result.title}-${idx}`;
                  const isGrabbing = grabbing === key;
                  const isGrabbed = grabbed.has(key);
                  const { quality } = result;
                  const { allowed, rejectionReason } = evaluate(result);
                  const language = detectLanguage(result.title);
                  const ageDays = getAgeDays(result.publishDate);
                  const sourceLabel = getSourceLabel(result.category);
                  const hasLink = !!(result.link || result.magnet);

                  return (
                    <TableRow key={key} hover sx={{
                      '&:last-child td': { borderBottom: 0 },
                      bgcolor: isGrabbed ? alpha(theme.palette.success.main, 0.08)
                        : !allowed ? alpha(theme.palette.error.main, 0.04) : amoledBg,
                      '&:hover': {
                        bgcolor: isGrabbed ? alpha(theme.palette.success.main, 0.12)
                          : !allowed ? alpha(theme.palette.error.main, 0.08) : amoledRowHover,
                      },
                      transition: 'background-color 0.15s ease',
                    }}>
                      <TableCell align="center" sx={{ py: 0.75, px: 1 }}>
                        <Chip label={sourceLabel} size="small" sx={{
                          height: 18, fontSize: '0.62rem', fontWeight: 800,
                          letterSpacing: '0.04em', border: 'none', borderRadius: '3px',
                          bgcolor: sourceLabel === 'nzb' ? alpha(theme.palette.info.main, 0.2) : alpha(theme.palette.success.main, 0.15),
                          color: sourceLabel === 'nzb' ? 'info.main' : 'success.main',
                        }} />
                      </TableCell>

                      <TableCell sx={{ py: 0.75, px: 1.5, whiteSpace: 'nowrap' }}>
                        <Typography variant="body2" sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
                          {ageDays !== null ? formatAge(result.publishDate) : '—'}
                        </Typography>
                      </TableCell>

                      <TableCell sx={{ py: 0.75, px: 1.5, maxWidth: 0, width: '100%' }}>
                        <Tooltip title={result.title} placement="top-start" enterDelay={300}>
                          <Typography component={hasLink ? 'a' : 'span'}
                            href={hasLink ? (result.link || result.magnet) : undefined}
                            target="_blank" rel="noopener noreferrer" variant="body2"
                            sx={{
                              display: 'block', overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', fontSize: '0.82rem', fontWeight: 500,
                              color: hasLink ? 'primary.main' : 'text.primary',
                              textDecoration: 'none', cursor: hasLink ? 'pointer' : 'default',
                              '&:hover': hasLink ? { textDecoration: 'underline' } : {},
                            }}>
                            {result.title}
                          </Typography>
                        </Tooltip>
                      </TableCell>

                      <TableCell sx={{ py: 0.75, px: 1.5 }}>
                        <Typography variant="body2" sx={{ fontSize: '0.78rem', color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                          {result.indexer || '—'}
                        </Typography>
                      </TableCell>

                      <TableCell align="right" sx={{ py: 0.75, px: 1.5, whiteSpace: 'nowrap' }}>
                        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                          {formatBytes(result.size)}
                        </Typography>
                      </TableCell>

                      <TableCell align="center" sx={{ py: 0.75, px: 1 }}>
                        {result.seeders != null ? (
                          <Typography variant="body2" sx={{
                            fontSize: '0.8rem', fontWeight: 700,
                            color: result.seeders > 10 ? 'success.main' : result.seeders > 0 ? 'warning.main' : 'error.main',
                          }}>+{result.seeders}</Typography>
                        ) : (
                          <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.78rem' }}>—</Typography>
                        )}
                      </TableCell>

                      <TableCell align="center" sx={{ py: 0.75, px: 1 }}>
                        <Chip label={language} size="small" sx={{
                          height: 18, fontSize: '0.62rem', fontWeight: 600, borderRadius: '3px',
                          bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'text.primary',
                          border: `1px solid ${alpha(theme.palette.divider, 0.4)}`,
                        }} />
                      </TableCell>

                      <TableCell sx={{ py: 0.75, px: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {quality && quality !== 'Unknown' ? (
                            <Tooltip title={!allowed ? rejectionReason : quality} placement="top">
                              <Chip label={quality} size="small" sx={{
                                height: 18, fontSize: '0.62rem', fontWeight: 700, borderRadius: '3px', border: 'none',
                                bgcolor: !allowed ? alpha(theme.palette.error.main, 0.18)
                                  : quality.includes('Remux') || quality.includes('2160') ? alpha(theme.palette.secondary.main, 0.15)
                                  : alpha(theme.palette.primary.main, 0.12),
                                color: !allowed ? 'error.main'
                                  : quality.includes('Remux') || quality.includes('2160') ? 'secondary.main' : 'primary.main',
                              }} />
                            </Tooltip>
                          ) : (
                            <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.75rem' }}>Unknown</Typography>
                          )}
                          <Tooltip title={!allowed ? rejectionReason : 'Release Info'}>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', p: 0.25, color: !allowed ? 'error.main' : 'text.disabled' }}>
                              {!allowed ? <RejectedIcon sx={{ fontSize: 13 }} /> : <InfoIcon sx={{ fontSize: 13 }} />}
                            </Box>
                          </Tooltip>
                        </Box>
                      </TableCell>

                      <TableCell align="right" sx={{ py: 0.75, px: 1, whiteSpace: 'nowrap' }}>
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <Tooltip title="Manual Import">
                            <IconButton size="small" sx={{ color: 'text.disabled', '&:hover': { color: 'warning.main' }, p: 0.5 }}>
                              <PersonIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={isGrabbed ? 'Added to Real-Debrid!' : 'Grab Release'}>
                            <span>
                              <IconButton size="small" onClick={() => handleGrab(result)}
                                disabled={isGrabbing || !hasLink}
                                sx={{ p: 0.5, color: isGrabbed ? 'success.main' : 'text.secondary', '&:hover': { color: isGrabbed ? 'success.main' : 'primary.main' } }}>
                                {isGrabbing ? <CircularProgress size={14} />
                                  : isGrabbed ? <CheckCircleIcon sx={{ fontSize: 15 }} />
                                  : <GrabIcon sx={{ fontSize: 15 }} />}
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5, bgcolor: isDark ? '#0d0d0d' : undefined, borderTop: `1px solid ${alpha(theme.palette.divider, 0.3)}` }}>
        <Button onClick={onClose} variant="outlined" size="small">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
