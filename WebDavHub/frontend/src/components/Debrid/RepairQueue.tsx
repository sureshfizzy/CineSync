import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, CardContent, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, CircularProgress, Alert, Tooltip, alpha, useTheme, Stack, Button } from '@mui/material';
import { Build as BuildIcon, Error as ErrorIcon, Warning as WarningIcon, Info as InfoIcon, PlayArrow as PlayIcon, Stop as StopIcon } from '@mui/icons-material';
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
  fixed: number;
  validated: number;
  queue_size: number;
  last_run_time: number;
  next_run_time: number;
  progress_percentage: number;
}

const getReasonColor = (reason: string): 'error' | 'warning' | 'info' => {
  if (reason.includes('error') || reason.includes('dead') || reason.includes('virus')) {
    return 'error';
  }
  if (reason.includes('missing') || reason.includes('no_links') || reason.includes('mismatch') || reason.includes('complete_but')) {
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
  
  // Handle dynamic reasons like "link_mismatch_expected_5_got_3"
  if (reason.startsWith('link_mismatch_')) {
    const parts = reason.match(/link_mismatch_expected_(\d+)_got_(\d+)/);
    if (parts) {
      return `Link Mismatch (Expected ${parts[1]}, Got ${parts[2]})`;
    }
    return 'Link Mismatch';
  }
  
  return labels[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

export default function RepairQueue() {
  const [stats, setStats] = useState<RepairStats | null>(null);
  const [status, setStatus] = useState<RepairStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const theme = useTheme();

  const fetchRepairStatus = useCallback(async () => {
    try {
      const response = await axios.get('/api/realdebrid/repair-status');
      console.log('Repair status response:', response.data);
      setStatus(response.data);
    } catch (err: any) {
      // Silently fail for status updates
      console.error('Failed to fetch repair status:', err);
      console.error('Error details:', err.response?.data);
    }
  }, []);

  const fetchRepairStats = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }
    setError('');

    try {
      const response = await axios.get('/api/realdebrid/repair-stats');
      setStats(response.data);
    } catch (err: any) {
      if (isInitial) {
        setError(err.response?.data?.error || 'Failed to fetch repair statistics');
      }
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchRepairStats(true);
    fetchRepairStatus();
    
    const statsInterval = setInterval(() => {
      fetchRepairStats(false);
    }, 10000); // Update stats every 10 seconds

    const statusInterval = setInterval(() => {
      fetchRepairStatus();
    }, 2000); // Update status every 2 seconds for real-time progress

    return () => {
      clearInterval(statsInterval);
      clearInterval(statusInterval);
    };
  }, [fetchRepairStats, fetchRepairStatus]);


  const handleStartRepair = async () => {
    try {
      const response = await axios.post('/api/realdebrid/repair-start');
      if (response.data.success) {
        fetchRepairStatus(); // Immediately fetch status to show it started
        fetchRepairStats(false);
      }
    } catch (err) {
      console.error('Failed to start repair:', err);
      setError('Failed to start repair scan');
    }
  };

  const handleStopRepair = async () => {
    try {
      const response = await axios.post('/api/realdebrid/repair-stop');
      if (response.data.success) {
        fetchRepairStatus(); // Immediately fetch status to show it stopped
      }
    } catch (err) {
      console.error('Failed to stop repair:', err);
      setError('Failed to stop repair scan');
    }
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

  if (!stats) {
    return null;
  }

  console.log('Current status:', status);

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
            Torrents with broken or missing links
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {status && status.is_running ? (
            <Button
              variant="contained"
              color="error"
              startIcon={<StopIcon />}
              onClick={handleStopRepair}
              sx={{ fontWeight: 600 }}
            >
              Stop Repair
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              startIcon={<PlayIcon />}
              onClick={handleStartRepair}
              sx={{ fontWeight: 600 }}
            >
              Start Repair
            </Button>
          )}
        </Box>
      </Box>

      {/* Repair Status/Progress Indicator */}
      {status && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
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
                    {status.is_running ? 'Repair in Progress' : 'Repair Status'}
                  </Typography>
                </Box>
                <Chip 
                  label={`${status.processed_torrents} / ${status.total_torrents}`}
                  color={status.is_running ? 'info' : 'default'}
                  size="small"
                />
              </Box>
              
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
                    Broken Found
                  </Typography>
                  <Typography variant="body1" fontWeight="600" color="error.main">
                    {status.broken_found}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Fixed
                  </Typography>
                  <Typography variant="body1" fontWeight="600" color="success.main">
                    {status.fixed}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Validated
                  </Typography>
                  <Typography variant="body1" fontWeight="600" color="info.main">
                    {status.validated}
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
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.3 }}
          >
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
                    <Typography variant="h4" fontWeight="700" color="warning.main" sx={{ fontSize: '1.1rem' }}>{stats.total}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>Needs Repair</Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </motion.div>
        </Box>
        <Box sx={{ minWidth: { xs: 140, sm: 160 }, flex: '0 0 auto' }}>
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.3 }}
          >
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
          </motion.div>
        </Box>
      </Box>

      {/* Repairs Table */}
      {!stats.repairs || stats.repairs.length === 0 ? (
        <Card sx={{ borderRadius: 2, boxShadow: 'none', mb: 2 }}>
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <BuildIcon sx={{ fontSize: 40, color: 'success.main', mb: 1 }} />
              <Typography variant="h6" fontWeight="600" color="success.main" sx={{ fontSize: '1rem' }}>
                All Clear!
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.9rem' }}>
                No torrents require repair at this time
              </Typography>
            </Box>
          </CardContent>
        </Card>
      ) : (
        <TableContainer
          component={Paper}
          sx={{
            boxShadow: 'none',
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            borderRadius: 2,
            overflowX: 'auto',
            fontSize: { xs: '0.85rem', sm: '1rem' },
          }}
        >
          <Table>
            <TableHead>
              <TableRow
                sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}
              >
                <TableCell sx={{ fontWeight: 700, display: { xs: 'none', sm: 'table-cell' } }}>Torrent ID</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Filename</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Hash</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Reason</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Last Updated</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stats.repairs.map((repair, index) => (
                <React.Fragment key={repair.torrent_id}>
                  <Box sx={{
                    mb: 1.5,
                    borderRadius: 2,
                    boxShadow: 'none',
                    bgcolor: alpha(theme.palette.background.paper, 0.95),
                    border: `1px solid ${alpha(theme.palette.divider, 0.08)}`,
                    p: 1.2,
                    display: { xs: 'block', sm: 'none' },
                  }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>{repair.filename}</Typography>
                    <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
                      <Chip label={repair.status} size="small" variant="outlined" />
                      <Chip icon={getReasonIcon(repair.reason)} label={getReasonLabel(repair.reason)} size="small" color={getReasonColor(repair.reason)} sx={{ fontWeight: 600 }} />
                    </Stack>
                    <Stack direction="row" spacing={2} sx={{ fontSize: '0.85rem' }}>
                      <Typography variant="caption" color="text.secondary">ID: {repair.torrent_id}</Typography>
                      <Typography variant="caption" color="text.secondary">Hash: {repair.hash ? repair.hash.substring(0, 12) + '...' : 'N/A'}</Typography>
                      <Typography variant="caption" color="text.secondary">Progress: {repair.progress}%</Typography>
                      <Typography variant="caption" color="text.secondary">Updated: {formatDate(new Date(repair.updated_at * 1000).toISOString())}</Typography>
                    </Stack>
                  </Box>
                  <TableRow
                  key={repair.torrent_id}
                  component={motion.tr}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.02 }}
                  sx={{
                    display: { xs: 'none', sm: 'table-row' },
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.05),
                    },
                  }}
                >
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
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
                        sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {repair.filename}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary' }}
                    >
                      {repair.hash ? repair.hash.substring(0, 12) + '...' : 'N/A'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={repair.status} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight="600">
                      {repair.progress}%
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      icon={getReasonIcon(repair.reason)}
                      label={getReasonLabel(repair.reason)}
                      size="small"
                      color={getReasonColor(repair.reason)}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(new Date(repair.updated_at * 1000).toISOString())}
                    </Typography>
                  </TableCell>
                </TableRow>
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Footer Info */}
      <Box sx={{ mt: 2, textAlign: 'right' }}>
        <Typography variant="caption" color="text.secondary">
          Last updated: {formatDate(stats.lastUpdated)}
        </Typography>
      </Box>
    </Box>
  );
}

