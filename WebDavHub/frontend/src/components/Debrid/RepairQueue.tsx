import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box, Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, CircularProgress, Alert, Tooltip, alpha, useTheme, Stack, Button, Checkbox, IconButton, TablePagination, Snackbar, Backdrop, Slide, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { Build as BuildIcon, Error as ErrorIcon, Warning as WarningIcon, Info as InfoIcon, PlayArrow as PlayIcon, Stop as StopIcon, Delete as DeleteIcon, ListAlt as ListAltIcon } from '@mui/icons-material';
import { motion } from 'framer-motion'; import axios from 'axios'; import { formatDate } from '../FileBrowser/fileUtils';

interface RepairEntry {
  torrent_id: string;
  filename: string;
  hash: string;
  status: string;
  progress: number;
  reason: string;
  updated_at: number;
}

interface RepairStats {
  total: number;
  repairs: RepairEntry[];
  reasonCounts: Record<string, number>;
  lastUpdated: string;
}

interface RepairStatus {
  is_running: boolean;
  current_torrent_id: string;
  total_torrents: number;
  processed_torrents: number;
  broken_found: number;
  validated: number;
  queue_size: number;
  last_run_time: number;
  next_run_time: number;
  progress_percentage: number;
}

interface RepairQueueEntry extends RepairEntry {
  position: number;
}

interface ConfirmConfig {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryConfirmLabel?: string;
  onConfirm?: () => Promise<void> | void;
  onSecondaryConfirm?: () => Promise<void> | void;
}

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  secondaryConfirmLabel?: string;
  onConfirm?: () => Promise<void> | void;
  onSecondaryConfirm?: () => Promise<void> | void;
}

const getReasonColor = (reason: string): 'error' | 'warning' | 'info' => {
  if (reason.includes('error') || reason.includes('dead') || reason.includes('virus')) {
    return 'error';
  }
  if (reason.includes('missing') || reason.includes('no_links') || reason.includes('mismatch') || reason.includes('complete_but') || reason.startsWith('reinsert_failed')) {
    return 'warning';
  }
  return 'info';
};

const getReasonIcon = (reason: string) => {
  const color = getReasonColor(reason);
  switch (color) {
    case 'error':
      return <ErrorIcon sx={{ fontSize: 16 }} />;
    case 'warning':
      return <WarningIcon sx={{ fontSize: 16 }} />;
    default:
      return <InfoIcon sx={{ fontSize: 16 }} />;
  }
};

const getReasonLabel = (reason: string): string => {
  const labels: Record<string, string> = {
    'no_links': 'No Links',
    'no_links_downloaded': 'No Links (Downloaded)',
    'error_status': 'Error Status',
    'virus_detected': 'Virus Detected',
    'dead_torrent': 'Dead Torrent',
    'complete_but_no_links': 'Complete But No Links',
    'no_selected_files_but_has_links': 'Invalid File Selection',
  };
  
  if (reason.startsWith('link_mismatch_')) {
    const parts = reason.match(/link_mismatch_expected_(\d+)_got_(\d+)/);
    if (parts) {
      return `Link Mismatch (Expected ${parts[1]}, Got ${parts[2]})`;
    }
    return 'Link Mismatch';
  }

  if (reason.startsWith('reinsert_failed_')) {
    const countMatch = reason.match(/reinsert_failed_(\d+)_files/);
    if (countMatch) {
      return `Reinsert Failed (${countMatch[1]} File${countMatch[1] === '1' ? '' : 's'})`;
    }
    return 'Reinsert Failed';
  }
  
  return labels[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

const RepairTableRow = React.memo(({ 
  repair, 
  isQueueView, 
  isSelected, 
  allowSelection, 
  deleting,
  onSelect, 
  onDelete,
  theme
}: { 
  repair: RepairEntry & { position?: number };
  isQueueView: boolean;
  isSelected: boolean;
  allowSelection: boolean;
  deleting: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string, filename: string) => void;
  theme: any;
}) => {
  const repairQueueEntry = repair as RepairQueueEntry;
  
  return (
    <TableRow
      sx={{
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.05),
        },
        bgcolor: allowSelection && isSelected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
      }}
    >
      {allowSelection && (
        <TableCell padding="checkbox">
          <Checkbox
            checked={isSelected}
            onChange={() => onSelect(repair.torrent_id)}
          />
        </TableCell>
      )}
      {isQueueView && (
        <TableCell sx={{ width: { sm: 90 } }}>
          <Typography variant="body2" fontWeight={600}>
            {repairQueueEntry.position}
          </Typography>
        </TableCell>
      )}
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {repair.torrent_id}
        </Typography>
      </TableCell>
      <TableCell>
        <Tooltip title={repair.filename}>
          <Typography
            variant="body2"
            sx={{ 
              maxWidth: { xs: 150, sm: 200, md: 300 }, 
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap',
              fontWeight: { xs: 600, sm: 400 }
            }}
          >
            {repair.filename}
          </Typography>
        </Tooltip>
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
          <Chip label={repair.status} size="small" variant="outlined" sx={{ height: 20 }} />
          <Chip 
            icon={getReasonIcon(repair.reason)} 
            label={getReasonLabel(repair.reason)} 
            size="small" 
            color={getReasonColor(repair.reason)} 
            sx={{ fontWeight: 600, height: 20, fontSize: '0.7rem' }} 
          />
        </Box>
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
        <Typography
          variant="body2"
          sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
        >
          {repair.hash ? repair.hash.substring(0, 12) + '...' : 'N/A'}
        </Typography>
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
        <Chip label={repair.status} size="small" variant="outlined" />
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <Typography variant="body2" fontWeight="600">
          {repair.progress}%
        </Typography>
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
        <Chip
          icon={getReasonIcon(repair.reason)}
          label={getReasonLabel(repair.reason)}
          size="small"
          color={getReasonColor(repair.reason)}
          sx={{ fontWeight: 600 }}
        />
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}>
        <Typography variant="body2" color="text.secondary">
          {repair.updated_at ? formatDate(new Date(repair.updated_at * 1000).toISOString()) : '—'}
        </Typography>
      </TableCell>
      {allowSelection && (
        <TableCell padding="checkbox">
          <IconButton
            size="small"
            color="error"
            onClick={() => onDelete(repair.torrent_id, repair.filename)}
            disabled={deleting}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </TableCell>
      )}
    </TableRow>
  );
});

export default function RepairQueue() {
  const [stats, setStats] = useState<RepairStats | null>(null);
  const [status, setStatus] = useState<RepairStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());
  const [repairing, setRepairing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(0); // 0-based for MUI
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [selectedReasons, setSelectedReasons] = useState<Set<string>>(new Set());
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState<'success' | 'error' | 'info' | 'warning'>('success');
  const [queueEntries, setQueueEntries] = useState<RepairQueueEntry[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [isQueueView, setIsQueueView] = useState(false);
  const [queuePage, setQueuePage] = useState(0);
  const [queueRowsPerPage, setQueueRowsPerPage] = useState(50);
  const [queueTotal, setQueueTotal] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
  });
  const theme = useTheme();
  
  const isFetchingStats = useRef(false);
  const isFetchingQueue = useRef(false);

  const fetchRepairStatus = useCallback(async () => {
    try {
      const response = await axios.get('/api/realdebrid/repair-status');
      setStatus(response.data);
    } catch (err: any) {
      // Silently fail for status updates
      console.error('Failed to fetch repair status:', err);
      console.error('Error details:', err.response?.data);
    }
  }, []);

  const fetchRepairStats = useCallback(async (isInitial = false) => {
    if (isFetchingStats.current && !isInitial) {
      return;
    }
    
    isFetchingStats.current = true;
    
    if (isInitial) {
      setLoading(true);
    }
    setError('');

    try {
      const params: any = {
        page: page + 1,
        page_size: rowsPerPage,
      };
      if (selectedReasons.size > 0) {
        params.reason = Array.from(selectedReasons).join(',');
      }
      const response = await axios.get('/api/realdebrid/repair-stats', { params });
      setStats(response.data);
    } catch (err: any) {
      if (isInitial) {
        const errorMsg = err.response?.data?.error || 
                        err.response?.data || 
                        err.message || 
                        'Failed to fetch repair statistics';
        setError(errorMsg);
        console.error('Failed to fetch repair stats:', err);
      } else {
        console.warn('Background repair stats fetch failed:', err.response?.data || err.message);
      }
    } finally {
      if (isInitial) {
        setLoading(false);
      }
      isFetchingStats.current = false;
    }
  }, [page, rowsPerPage, selectedReasons]);

  const fetchRepairQueue = useCallback(async (showSpinner = false) => {
    if (isFetchingQueue.current && !showSpinner) {
      return;
    }
    
    isFetchingQueue.current = true;
    
    if (showSpinner) {
      setQueueLoading(true);
    }

    try {
      const response = await axios.get('/api/realdebrid/repair-queue', {
        params: {
          page: queuePage + 1,
          page_size: queueRowsPerPage,
        },
      });
      const nextEntries: RepairQueueEntry[] = response.data.queue || [];
      const totalCount: number = response.data.count || 0;

      if (queuePage > 0 && nextEntries.length === 0 && totalCount > 0) {
        setQueuePage(prev => Math.max(prev - 1, 0));
        isFetchingQueue.current = false;
        return;
      }

      setQueueEntries(nextEntries);
      setQueueTotal(totalCount);
    } catch (err: any) {
      console.error('Failed to fetch repair queue:', err);
      if (showSpinner) {
        setToastSeverity('error');
        setToastMsg(err.response?.data?.error || 'Failed to fetch repair queue');
        setToastOpen(true);
      }
    } finally {
      if (showSpinner) {
        setQueueLoading(false);
      }
      isFetchingQueue.current = false;
    }
  }, [queuePage, queueRowsPerPage]);

  useEffect(() => {
    fetchRepairStats(true);
    fetchRepairStatus();
  }, [fetchRepairStats, fetchRepairStatus]);

  useEffect(() => {
    const statusInterval = setInterval(() => {
      fetchRepairStatus();
    }, 10000);

    return () => {
      clearInterval(statusInterval);
    };
  }, [fetchRepairStatus]);

  const prevStatusRef = useRef<{
    processed: number;
    queueSize: number;
    isRunning: boolean;
  } | null>(null);
  
  useEffect(() => {
    if (!status) {
      return;
    }
    
    const currentStatus = {
      processed: status.processed_torrents ?? 0,
      queueSize: status.queue_size ?? 0,
      isRunning: status.is_running ?? false,
    };

    if (prevStatusRef.current) {
      const hasChanged = 
        prevStatusRef.current.processed !== currentStatus.processed ||
        prevStatusRef.current.queueSize !== currentStatus.queueSize ||
        prevStatusRef.current.isRunning !== currentStatus.isRunning;
      
      if (hasChanged) {
        fetchRepairStats(false);
      }
    }
    
    prevStatusRef.current = currentStatus;
  }, [status?.processed_torrents, status?.queue_size, status?.is_running, fetchRepairStats]);


  useEffect(() => {
    if (!isQueueView) {
      setQueueLoading(false);
      return;
    }

    fetchRepairQueue(true);
    const interval = setInterval(() => {
      fetchRepairQueue(false);
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, [isQueueView, queuePage, queueRowsPerPage]);
  const prevQueueSizeRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!isQueueView) {
      return;
    }
    
    if (prevQueueSizeRef.current !== undefined && prevQueueSizeRef.current !== status?.queue_size) {
      fetchRepairQueue(false);
    }
    
    prevQueueSizeRef.current = status?.queue_size;
  }, [status?.queue_size, isQueueView, fetchRepairQueue]);


  const deleteRepairs = useCallback(
    async (ids: string[], deleteFromDebrid = false) => {
      if (ids.length === 0) {
        return;
      }

      setDeleting(true);
      setError('');

      try {
        const response = await axios.post('/api/realdebrid/repair-delete', {
          torrent_ids: ids,
          delete_from_debrid: deleteFromDebrid,
        });

        if (response.data.success) {
          setSelectedTorrents(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
          });
          fetchRepairStats(false);
          fetchRepairStatus();
          setError('');
          setToastSeverity('success');
          setToastMsg(response.data.message || (deleteFromDebrid ? 'Deleted (Real-Debrid)' : 'Deleted'));
          setToastOpen(true);
        } else {
          const message = response.data.message || 'Failed to delete torrents';
          setError(message);
          setToastSeverity('error');
          setToastMsg(message);
          setToastOpen(true);
        }
      } catch (err: any) {
        console.error('Failed to delete torrents:', err);
        const message = err.response?.data?.error || 'Failed to delete selected torrents';
        setError(message);
        setToastSeverity('error');
        setToastMsg(message);
        setToastOpen(true);
      } finally {
        setDeleting(false);
      }
    },
    [fetchRepairStats, fetchRepairStatus]
  );

  const openConfirm = useCallback(
    (config: ConfirmConfig) => {
      setConfirmState({
        open: true,
        title: config.title,
        message: config.message,
        confirmLabel: config.confirmLabel ?? 'Confirm',
        cancelLabel: config.cancelLabel ?? 'Cancel',
        secondaryConfirmLabel: config.secondaryConfirmLabel,
        onConfirm: config.onConfirm,
        onSecondaryConfirm: config.onSecondaryConfirm,
      });
    },
    []
  );

  const closeConfirm = useCallback(() => {
    setConfirmState({
      open: false,
      title: '',
      message: '',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      secondaryConfirmLabel: undefined,
      onConfirm: undefined,
      onSecondaryConfirm: undefined,
    });
  }, []);

  const handleConfirmAction = useCallback(async () => {
    try {
      if (confirmState.onConfirm) {
        await confirmState.onConfirm();
      }
    } finally {
      closeConfirm();
    }
  }, [confirmState, closeConfirm]);

  const handleSecondaryConfirmAction = useCallback(async () => {
    try {
      if (confirmState.onSecondaryConfirm) {
        await confirmState.onSecondaryConfirm();
      }
    } finally {
      closeConfirm();
    }
  }, [confirmState, closeConfirm]);

  const handleDialogClose = useCallback(
    (_event?: object, reason?: string) => {
      if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
        if (repairing || deleting) {
          return;
        }
      }
      closeConfirm();
    },
    [closeConfirm, repairing, deleting]
  );

  const runRepairAll = useCallback(async () => {
    setRepairing(true);
    setError('');

    try {
      const response = await axios.post('/api/realdebrid/repair-all');
      if (response.data.success) {
        fetchRepairStats(false);
        fetchRepairStatus();
        fetchRepairQueue();
        setToastSeverity('success');
        setToastMsg(response.data.message || 'Queued repair for all');
        setToastOpen(true);
      } else {
        setToastSeverity('error');
        setToastMsg(response.data.message || 'Failed to queue repair for all');
        setToastOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to repair all:', err);
      setToastSeverity('error');
      setToastMsg(err.response?.data?.error || 'Failed to queue repair for all');
      setToastOpen(true);
    } finally {
      setRepairing(false);
    }
  }, [fetchRepairQueue, fetchRepairStats, fetchRepairStatus]);

  const handleRepairAll = async () => {
    if (isQueueView) {
      return;
    }

    openConfirm({
      title: 'Queue Repairs',
      message: 'Queue repair for all torrents except Not Cached items?',
      confirmLabel: 'Queue',
      onConfirm: runRepairAll,
    });
  };

  const handleStopRepair = async () => {
    try {
      const response = await axios.post('/api/realdebrid/repair-stop');
      if (response.data.success) {
        fetchRepairStatus();
      }
    } catch (err) {
      console.error('Failed to stop repair:', err);
      setError('Failed to stop repair scan');
    }
  };

  const handleSelectTorrent = (torrentId: string) => {
    setSelectedTorrents(prev => {
      const newSet = new Set(prev);
      if (newSet.has(torrentId)) {
        newSet.delete(torrentId);
      } else {
        newSet.add(torrentId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    const rows = isQueueView ? queueEntries : (stats?.repairs || []);
    if (rows.length === 0) {
      return;
    }
    
    if (selectedTorrents.size === rows.length) {
      setSelectedTorrents(new Set());
    } else {
      setSelectedTorrents(new Set(rows.map(r => r.torrent_id)));
    }
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setSelectedTorrents(new Set()); // reset selection per page
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseInt(e.target.value, 10);
    setRowsPerPage(next);
    setPage(0);
    setSelectedTorrents(new Set());
  };

  const handleQueuePageChange = (_: unknown, newPage: number) => {
    setSelectedTorrents(new Set());
    setQueuePage(newPage);
  };

  const handleQueueRowsPerPageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseInt(e.target.value, 10);
    setQueueRowsPerPage(next);
    setQueuePage(0);
    setSelectedTorrents(new Set());
  };

  const clearReasons = () => {
    setSelectedReasons(new Set());
    setPage(0);
    setSelectedTorrents(new Set());
  };

  const handleToggleQueueView = () => {
    if (isQueueView) {
      setIsQueueView(false);
    } else {
      setIsQueueView(true);
      setSelectedTorrents(new Set());
      setQueuePage(0);
    }
  };

  const repairs = useMemo(() => stats?.repairs || [], [stats?.repairs]);
  const total = useMemo(() => stats?.total || 0, [stats?.total]);
  const reasonCounts = useMemo(() => stats?.reasonCounts || {}, [stats?.reasonCounts]);
  const tableRows = useMemo(() => isQueueView ? queueEntries : repairs, [isQueueView, queueEntries, repairs]);

  const notCachedPrefixes = useMemo(() => ['no_links', 'complete_but_no_links', 'unavailable_file', 'infringing_file', 'not_cached', 'reinsert_failed'], []);
  
  const unrestrictFailedCount = useMemo(() => {
    return Object.entries(reasonCounts).reduce((acc, [k, v]) => {
      return acc + (k.startsWith('unrestrict_failed') ? v : 0);
    }, 0);
  }, [reasonCounts]);
  
  const notCachedCount = useMemo(() => {
    return Object.entries(reasonCounts).reduce((acc, [k, v]) => {
      return acc + (notCachedPrefixes.some(prefix => k === prefix || k.startsWith(prefix)) ? v : 0);
    }, 0);
  }, [reasonCounts, notCachedPrefixes]);

  const removeQueueItems = async (ids: string[]) => {
    if (ids.length === 0) {
      setToastSeverity('warning');
      setToastMsg('Select at least one item');
      setToastOpen(true);
      return;
    }

    setDeleting(true);
    setError('');

    try {
      const response = await axios.post('/api/realdebrid/repair-queue/delete', {
        torrent_ids: ids,
      });

      if (response.data.success) {
        setSelectedTorrents(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.delete(id));
          return next;
        });
        fetchRepairQueue(false);
        fetchRepairStatus();
        setToastSeverity('success');
        setToastMsg(response.data.message || 'Removed from queue');
        setToastOpen(true);
      } else {
        setToastSeverity('warning');
        setToastMsg(response.data.message || 'No items were removed from queue');
        setToastOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to remove from queue:', err);
      setToastSeverity('error');
      setToastMsg(err.response?.data?.error || 'Failed to remove from queue');
      setToastOpen(true);
    } finally {
      setDeleting(false);
    }
  };

  const handleRepairSelected = async () => {
    if (isQueueView) {
      return;
    }
    if (selectedTorrents.size === 0) {
      setError('Please select at least one torrent to repair');
      setToastSeverity('warning'); setToastMsg('Select at least one item'); setToastOpen(true);
      return;
    }

    setRepairing(true);
    setError('');

    try {
      const response = await axios.post('/api/realdebrid/repair-torrent', {
        torrent_ids: Array.from(selectedTorrents)
      });

      if (response.data.success) {
        setSelectedTorrents(new Set());
        fetchRepairStats(false);
        fetchRepairStatus();
        setError('');
        setToastSeverity('success'); setToastMsg(response.data.message || 'Repair queued'); setToastOpen(true);
      } else {
        setError(response.data.message || 'Failed to repair torrents');
        setToastSeverity('error'); setToastMsg(response.data.message || 'Failed to repair'); setToastOpen(true);
      }
    } catch (err: any) {
      console.error('Failed to repair torrents:', err);
      setError(err.response?.data?.error || 'Failed to repair selected torrents');
      setToastSeverity('error'); setToastMsg('Failed to repair selected'); setToastOpen(true);
    } finally {
      setRepairing(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedTorrents.size === 0) {
      if (!isQueueView) {
        setError('Please select at least one torrent to delete');
      }
      setToastSeverity('warning'); setToastMsg('Select at least one item'); setToastOpen(true);
      return;
    }

    const ids = Array.from(selectedTorrents);

    if (isQueueView) {
      openConfirm({
        title: 'Remove from Repair Queue',
        message: `Remove ${ids.length} torrent(s) from the repair queue?`,
        confirmLabel: 'Remove',
        onConfirm: () => removeQueueItems(ids),
      });
      return;
    }

    openConfirm({
      title: 'Delete from Repair Table',
      message: `Delete ${ids.length} torrent(s) from the repair table?`,
      confirmLabel: 'Delete',
      secondaryConfirmLabel: 'Delete + RD',
      onConfirm: () => deleteRepairs(ids, false),
      onSecondaryConfirm: () => deleteRepairs(ids, true),
    });
  };

  const handleDeleteSingle = async (torrentId: string, filename: string) => {
    if (isQueueView) {
      openConfirm({
        title: 'Remove from Repair Queue',
        message: `Remove "${filename}" from the repair queue?`,
        confirmLabel: 'Remove',
        onConfirm: () => removeQueueItems([torrentId]),
      });
      return;
    }

    openConfirm({
      title: 'Delete from Repair Table',
      message: `Delete "${filename}" from the repair table?`,
      confirmLabel: 'Delete',
      secondaryConfirmLabel: 'Delete + RD',
      onConfirm: () => deleteRepairs([torrentId], false),
      onSecondaryConfirm: () => deleteRepairs([torrentId], true),
    });
  };

  if (loading && !stats) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          gap: 2,
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" sx={{ color: 'text.secondary' }}>
          Loading repair data...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const allowSelection = true;

  return (
    <Box 
      sx={{ 
        p: { xs: 1.5, md: 3 }, 
        height: '100%', 
        overflow: 'auto',
        background: theme.palette.mode === 'dark' 
          ? `linear-gradient(135deg, ${alpha(theme.palette.background.default, 1)} 0%, ${alpha(theme.palette.primary.main, 0.02)} 100%)`
          : 'transparent',
      }}
    >
      {/* Header */}
      <Box sx={{ mb: { xs: 2, md: 3 }, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' }, gap: { xs: 2, sm: 0 } }}>
        <Box>
          <Typography 
            variant="h4" 
            fontWeight="700" 
            sx={{ 
              mb: 1,
              fontSize: { xs: '1.75rem', sm: '2.125rem' },
              background: theme.palette.mode === 'dark' 
                ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`
                : 'inherit',
              backgroundClip: theme.palette.mode === 'dark' ? 'text' : 'initial',
              WebkitBackgroundClip: theme.palette.mode === 'dark' ? 'text' : 'initial',
              WebkitTextFillColor: theme.palette.mode === 'dark' ? 'transparent' : 'inherit',
            }}
          >
            Repair Queue
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ opacity: 0.8 }}>
            Event-driven repair for broken torrents (auto-detected on file access)
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {!isQueueView && selectedTorrents.size > 0 && (
              <>
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={<BuildIcon />}
                  onClick={handleRepairSelected}
                  disabled={repairing || deleting}
                  sx={{ fontWeight: 600 }}
                >
                  {repairing ? 'Repairing...' : `Repair (${selectedTorrents.size})`}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleDeleteSelected}
                  disabled={repairing || deleting}
                  sx={{ fontWeight: 600 }}
                >
                  {deleting ? 'Deleting...' : `Delete (${selectedTorrents.size})`}
                </Button>
              </>
          )}
          {isQueueView && selectedTorrents.size > 0 && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => {
                const ids = Array.from(selectedTorrents);
                openConfirm({
                  title: 'Remove from Repair Queue',
                  message: `Remove ${ids.length} torrent(s) from the repair queue?`,
                  confirmLabel: 'Remove',
                  onConfirm: () => removeQueueItems(ids),
                });
              }}
              disabled={deleting}
              sx={{ fontWeight: 600 }}
            >
              {deleting ? 'Removing...' : `Remove (${selectedTorrents.size})`}
            </Button>
          )}
          {!isQueueView && selectedTorrents.size === 0 && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<BuildIcon />}
              onClick={handleRepairAll}
              disabled={repairing || deleting}
              sx={{ fontWeight: 600 }}
            >
              {repairing ? 'Queuing...' : 'Repair All'}
            </Button>
          )}
          {/* Show Stop button only when repair is running */}
          {status?.is_running && (
            <Button
              variant="contained"
              color="error"
              startIcon={<StopIcon />}
              onClick={handleStopRepair}
              sx={{ fontWeight: 600 }}
            >
              Stop Repair
            </Button>
          )}
        </Box>
      </Box>

      {/* Repair Status/Progress Indicator and Quick Filter Cards */}
      {status && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card
            sx={{
              mb: { xs: 2, md: 3 },
              background: status.is_running
                ? `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`
                : `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.05)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`,
              border: status.is_running
                ? `1px solid ${alpha(theme.palette.info.main, 0.3)}`
                : `1px solid ${alpha(theme.palette.divider, 0.2)}`,
            }}
          >
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 2, gap: { xs: 1, sm: 0 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {status.is_running && <CircularProgress size={20} />}
                  <Typography variant="h6" fontWeight="600">
                    {status.is_running ? 'Repair in Progress' : 'Event-Driven Repair'}
                  </Typography>
                </Box>
                <Chip 
                  label={`${status.processed_torrents} / ${status.total_torrents}`}
                  color={status.is_running ? 'info' : 'default'}
                  size="small"
                />
              </Box>
              
              {/* Quick filter cards */}
              <Stack direction="row" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Chip
                  icon={<PlayIcon sx={{ fontSize: 16 }} />}
                  label={`Broken: ${status.total_torrents}`}
                  variant="outlined"
                  onClick={() => { clearReasons(); }}
                  sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.1s' }}
                />
                <Chip
                  icon={<ErrorIcon sx={{ fontSize: 16 }} />}
                  label={`Unrestrict Failed: ${unrestrictFailedCount}`}
                  color={selectedReasons.has('unrestrict_failed') ? 'error' : 'default'}
                  variant={selectedReasons.has('unrestrict_failed') ? 'filled' : 'outlined'}
                  onClick={() => {
                    setSelectedReasons(new Set(['unrestrict_failed']));
                    setPage(0);
                    setSelectedTorrents(new Set());
                  }}
                  sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.1s' }}
                />
                <Chip
                  icon={<WarningIcon sx={{ fontSize: 16 }} />}
                  label={`Not Cached: ${notCachedCount}`}
                  color={[...selectedReasons].some(r => notCachedPrefixes.some(prefix => r === prefix || r.startsWith(prefix))) ? 'warning' : 'default'}
                  variant={[...selectedReasons].some(r => notCachedPrefixes.some(prefix => r === prefix || r.startsWith(prefix))) ? 'filled' : 'outlined'}
                  onClick={() => {
                    setSelectedReasons(new Set(notCachedPrefixes));
                    setPage(0);
                    setSelectedTorrents(new Set());
                  }}
                  sx={{ fontWeight: 600, cursor: 'pointer', '&:hover': { transform: 'scale(1.02)' }, transition: 'transform 0.1s' }}
                />
                {selectedReasons.size > 0 && (
                  <Button size="small" onClick={clearReasons}>
                    Clear Filters
                  </Button>
                )}
              </Stack>
              
              {status.is_running && (
                <Box sx={{ width: '100%', mb: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" color="text.secondary">
                      Progress
                    </Typography>
                    <Typography variant="body2" fontWeight="600">
                      {status.progress_percentage.toFixed(1)}%
                    </Typography>
                  </Box>
                  <Box
                    sx={{
                      height: 8,
                      bgcolor: alpha(theme.palette.info.main, 0.1),
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${status.progress_percentage}%` }}
                      transition={{ duration: 0.5 }}
                      style={{
                        height: '100%',
                        background: `linear-gradient(90deg, ${theme.palette.info.main}, ${theme.palette.info.light})`,
                        borderRadius: 4,
                      }}
                    />
                  </Box>
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: { xs: 2, sm: 3 }, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Processing
                  </Typography>
                  <Typography variant="body1" fontWeight="600" color="info.main">
                    {status.processed_torrents}
                  </Typography>
                </Box>
                {status.queue_size > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Queue Size
                    </Typography>
                    <Typography variant="body1" fontWeight="600" color="warning.main">
                      {status.queue_size}
                    </Typography>
                  </Box>
                )}
              </Box>

              {status.current_torrent_id && status.is_running && (
                <Box sx={{ mt: 2, p: 1, bgcolor: alpha(theme.palette.info.main, 0.05), borderRadius: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Currently checking: {status.current_torrent_id}
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Stats Overview */}
      <Box sx={{ 
        display: 'flex', 
        gap: { xs: 1, sm: 2 }, 
        mb: { xs: 2, md: 3 }, 
        flexWrap: 'wrap',
        overflowX: { xs: 'auto', sm: 'visible' },
      }}>
        <Box sx={{ minWidth: { xs: 140, sm: 160 }, flex: '0 0 auto' }}>
          <Card sx={{ 
            minWidth: { xs: 140, sm: 160 }, 
            height: 60, 
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'center', 
            background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`, 
            border: `1px solid ${alpha(theme.palette.warning.main, 0.18)}`, 
            borderRadius: 2, 
            boxShadow: 'none', 
            m: 0 
          }}>
            <CardContent sx={{ p: 0.5, '&:last-child': { pb: 0.5 } }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <BuildIcon sx={{ fontSize: 20, color: 'warning.main' }} />
                <Box>
                  <Typography variant="h4" fontWeight="700" color="warning.main" sx={{ fontSize: '1.1rem' }}>{total}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>Needs Repair</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ minWidth: { xs: 140, sm: 160 }, flex: '0 0 auto' }}>
          <Card sx={{ 
            minWidth: { xs: 140, sm: 160 }, 
            height: 60,
            display: 'flex', 
            flexDirection: 'column', 
            justifyContent: 'center', 
            background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.10)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`, 
            border: `1px solid ${alpha(theme.palette.info.main, 0.15)}`, 
            borderRadius: 2, 
            boxShadow: 'none', 
            m: 0 
          }}>
            <CardContent sx={{ p: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5, '&:last-child': { pb: 1 } }}>
              <Typography variant="h4" fontWeight="700" color="info.main" sx={{ fontSize: '1.1rem', lineHeight: 1.2 }}>
                {2}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <PlayIcon sx={{ fontSize: 12, color: 'info.main' }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.7rem', lineHeight: 1.2 }}>
                  Available Workers
                </Typography>
              </Box>
              <Typography variant="caption" color={status && status.is_running ? 'info.main' : 'text.secondary'} sx={{ fontWeight: 600, fontSize: '0.7rem', lineHeight: 1.2 }}>
                Running: {status && status.is_running ? 1 : 0}
              </Typography>
            </CardContent>
          </Card>
        </Box>
        <Box sx={{ minWidth: { xs: 140, sm: 160 }, flex: '0 0 auto' }}>
          <Card
            onClick={handleToggleQueueView}
            sx={{ 
              minWidth: { xs: 140, sm: 160 },
              height: 60,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              background: isQueueView
                ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`
                : `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.06)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
              border: isQueueView
                ? `1px solid ${alpha(theme.palette.primary.main, 0.3)}`
                : `1px solid ${alpha(theme.palette.divider, 0.18)}`,
              borderRadius: 2,
              boxShadow: 'none',
              m: 0,
              cursor: 'pointer',
              transition: 'transform 0.1s',
              '&:hover': { transform: 'scale(1.02)' }
            }}
          >
            <CardContent sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.5, '&:last-child': { pb: 1 } }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                {queueLoading ? (
                  <CircularProgress size={16} />
                ) : (
                  <ListAltIcon sx={{ fontSize: 18, color: isQueueView ? 'primary.main' : 'text.secondary' }} />
                )}
                <Typography variant="h4" fontWeight="700" color={isQueueView ? 'primary.main' : 'text.primary'} sx={{ fontSize: '1.05rem' }}>
                  {isQueueView ? queueTotal : status?.queue_size ?? 0}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                Repair Queue
              </Typography>
              <Typography variant="caption" color={isQueueView ? 'primary.main' : 'text.secondary'} sx={{ fontWeight: 600, fontSize: '0.7rem' }}>
                {isQueueView ? 'Viewing queue' : 'Tap to view'}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {tableRows.length === 0 ? (
        <Card sx={{ borderRadius: 2, boxShadow: 'none', mb: 2 }}>
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <BuildIcon sx={{ fontSize: 40, color: isQueueView ? 'info.main' : 'success.main', mb: 1 }} />
              <Typography variant="h6" fontWeight="600" color={isQueueView ? 'info.main' : 'success.main'} sx={{ fontSize: '1rem' }}>
                {isQueueView ? 'Queue Empty' : 'All Clear!'}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem' }}>
                {isQueueView ? 'No torrents are waiting in the repair queue' : 'No broken torrents detected. Broken torrents are automatically added when file access fails.'}
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <>
          <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
            {tableRows.map((repair) => (
              <Card 
                key={`${repair.torrent_id}-${(repair as RepairQueueEntry).position ?? 'mobile'}`}
                sx={{ 
                  mb: 1.5, 
                  boxShadow: 'none',
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  bgcolor: selectedTorrents.has(repair.torrent_id) ? alpha(theme.palette.primary.main, 0.05) : 'background.paper'
                }}
              >
                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                    {allowSelection && (
                      <Checkbox
                        checked={selectedTorrents.has(repair.torrent_id)}
                        onChange={() => handleSelectTorrent(repair.torrent_id)}
                        size="small"
                        sx={{ p: 0, mt: 0.25 }}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontWeight: 600, 
                          mb: 0.5,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          lineHeight: 1.3
                        }}
                      >
                        {repair.filename}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
                        {isQueueView && (
                          <Chip 
                            label={`#${(repair as RepairQueueEntry).position}`} 
                            size="small" 
                            sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600 }} 
                          />
                        )}
                        <Chip 
                          label={repair.status} 
                          size="small" 
                          variant="outlined" 
                          sx={{ height: 18, fontSize: '0.65rem' }} 
                        />
                        <Chip 
                          icon={getReasonIcon(repair.reason)} 
                          label={getReasonLabel(repair.reason)} 
                          size="small" 
                          color={getReasonColor(repair.reason)} 
                          sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600, '& .MuiChip-icon': { fontSize: 12 } }} 
                        />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        Progress: {repair.progress}% • ID: {repair.torrent_id.substring(0, 8)}...
                      </Typography>
                    </Box>
                    {allowSelection && (
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => handleDeleteSingle(repair.torrent_id, repair.filename)}
                        disabled={deleting}
                        sx={{ p: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    )}
                  </Box>
                </CardContent>
              </Card>
            ))}
          </Box>
          <TableContainer
            component={Paper}
            sx={{
              display: { xs: 'none', sm: 'block' },
              boxShadow: 'none',
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              borderRadius: 2,
              overflowX: 'auto',
            }}
          >
            <Table>
              <TableHead>
                <TableRow
                  sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}
                >
                  {allowSelection && (
                    <TableCell padding="checkbox" sx={{ fontWeight: 700 }}>
                      <Checkbox
                        indeterminate={selectedTorrents.size > 0 && selectedTorrents.size < tableRows.length}
                        checked={tableRows.length > 0 && selectedTorrents.size === tableRows.length}
                        onChange={handleSelectAll}
                      />
                    </TableCell>
                  )}
                  {isQueueView && (
                    <TableCell sx={{ fontWeight: 700 }}>Pos</TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>Torrent ID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Filename</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', lg: 'table-cell' } }}>Hash</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', md: 'table-cell' } }}>Progress</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                  <TableCell sx={{ fontWeight: 700, display: { xs: 'none', lg: 'table-cell' } }}>Updated</TableCell>
                  {allowSelection && <TableCell padding="checkbox" sx={{ fontWeight: 700 }}></TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((repair) => (
                  <RepairTableRow
                    key={`${repair.torrent_id}-${(repair as RepairQueueEntry).position ?? 'row'}`}
                    repair={repair}
                    isQueueView={isQueueView}
                    isSelected={selectedTorrents.has(repair.torrent_id)}
                    allowSelection={allowSelection}
                    deleting={deleting}
                    onSelect={handleSelectTorrent}
                    onDelete={handleDeleteSingle}
                    theme={theme}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* Pagination */}
      {!isQueueView && total > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[25, 50, 100, 200]}
            labelRowsPerPage="Rows per page"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} of ${count}`}
          />
        </Box>
      )}
      {isQueueView && queueTotal > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <TablePagination
            component="div"
            count={queueTotal}
            page={queuePage}
            onPageChange={handleQueuePageChange}
            rowsPerPage={queueRowsPerPage}
            onRowsPerPageChange={handleQueueRowsPerPageChange}
            rowsPerPageOptions={[25, 50, 100, 200]}
            labelRowsPerPage="Rows per page"
            labelDisplayedRows={({ from, to, count }) => `${from}-${to} of ${count}`}
          />
        </Box>
      )}

      {/* Action feedback */}
      <Backdrop
        open={repairing || deleting}
        sx={{ color: '#fff', zIndex: (th) => th.zIndex.drawer + 1, backdropFilter: 'blur(2px)' }}
      >
        <Stack alignItems="center" spacing={2}>
          <CircularProgress color="inherit" />
          <Typography variant="body2">
            {repairing ? 'Queuing repair...' : isQueueView ? 'Removing from queue...' : 'Deleting...'}
          </Typography>
        </Stack>
      </Backdrop>
      <Dialog open={confirmState.open} onClose={handleDialogClose}>
        <DialogTitle>{confirmState.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmState.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeConfirm} disabled={repairing || deleting}>
            {confirmState.cancelLabel}
          </Button>
          {confirmState.secondaryConfirmLabel && (
            <Button
              onClick={handleSecondaryConfirmAction}
              disabled={repairing || deleting}
              color="error"
            >
              {confirmState.secondaryConfirmLabel}
            </Button>
          )}
          <Button onClick={handleConfirmAction} disabled={repairing || deleting} autoFocus>
            {confirmState.confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={toastOpen}
        autoHideDuration={2500}
        onClose={() => setToastOpen(false)}
        TransitionComponent={(props) => <Slide {...props} direction="up" />}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message=""
      >
        <Alert onClose={() => setToastOpen(false)} severity={toastSeverity} sx={{ width: '100%' }}>
          {toastMsg}
        </Alert>
      </Snackbar>
      {/* Footer Info */}
      {stats && (
        <Box sx={{ mt: 2, textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">
            Last updated: {formatDate(stats.lastUpdated)}
          </Typography>
        </Box>
      )}
    </Box>
  );
}