import { useState, useEffect, useCallback } from 'react';
import { Box, Card, CardContent, Typography, CircularProgress, Avatar, Divider, Stack, useTheme, Alert, Paper, alpha, LinearProgress } from '@mui/material';
import { Memory, Storage, CloudSync } from '@mui/icons-material';
import { motion } from 'framer-motion';
import axios from 'axios';
import { formatBytes, formatDate } from '../FileBrowser/fileUtils';

interface TorrentManagerStats {
  directoryMap: {
    totalTorrents: number;
    memoryBytes: number;
    description: string;
  };
  infoMap: {
    completeTorrents: number;
    memoryBytes: number;
    description: string;
  };
  downloadCache: {
    cachedLinks: number;
    memoryBytes: number;
    ttl: string;
    description: string;
  };
  failedCache: {
    failedFiles: number;
    memoryBytes: number;
    ttl: string;
    description: string;
  };
  memoryUsage: {
    totalBytes: number;
    torrentMapBytes: number;
    infoMapBytes: number;
    downloadCacheBytes: number;
    failedCacheBytes: number;
  };
  refresh: {
    initialized: boolean;
    lastRefresh: string;
    refreshInterval: number;
  };
  state: {
    totalCount: number;
    lastUpdated: string;
  };
  lastUpdated: string;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
    },
  }),
};

export default function TorrentManagerTab() {
  const [stats, setStats] = useState<TorrentManagerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const theme = useTheme();

  const fetchStats = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    }
    setError('');

    try {
      const response = await axios.get('/api/realdebrid/torrent-manager-stats');
      setStats(response.data);
    } catch (err: any) {
      if (isInitial) {
        setError(err.response?.data || 'Failed to fetch torrent manager statistics');
      }
    } finally {
      if (isInitial) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchStats(true);
    const interval = setInterval(() => {
      fetchStats(false);
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchStats]);

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
        <Typography variant="h6" sx={{ color: 'text.secondary', opacity: 0.8 }}>
          Loading torrent manager stats...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3, minHeight: '50vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Alert severity="error" sx={{ maxWidth: 600, width: '100%' }}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!stats) {
    return null;
  }

  const memoryPercentages = {
    torrentMap: (stats.memoryUsage.torrentMapBytes / stats.memoryUsage.totalBytes) * 100,
    infoMap: (stats.memoryUsage.infoMapBytes / stats.memoryUsage.totalBytes) * 100,
    downloadCache: (stats.memoryUsage.downloadCacheBytes / stats.memoryUsage.totalBytes) * 100,
    failedCache: (stats.memoryUsage.failedCacheBytes / stats.memoryUsage.totalBytes) * 100,
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" fontWeight="700" sx={{ mb: 2, fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
          Torrent Manager
        </Typography>
        {stats && (
          <Typography variant="body2" sx={{ color: 'text.secondary', opacity: 0.8, fontSize: '0.875rem' }}>
            Last updated: {formatDate(stats.lastUpdated)}
          </Typography>
        )}
      </Box>

      {/* Memory Usage Overview */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={0}>
        <Card
          sx={{
            mb: 3,
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
              <Avatar sx={{ bgcolor: 'primary.main', width: 48, height: 48 }}>
                <Memory sx={{ fontSize: 26 }} />
              </Avatar>
              <Box>
                <Typography variant="h6" fontWeight="700">
                  Total Memory Usage
                </Typography>
                <Typography variant="h4" fontWeight="700" color="primary.main">
                  {formatBytes(stats.memoryUsage.totalBytes)}
                </Typography>
              </Box>
            </Stack>

            <Divider sx={{ my: 2 }} />

            {/* Memory Breakdown */}
            <Typography variant="caption" fontWeight="700" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Memory Distribution
            </Typography>

            <Stack spacing={2}>
              {/* Torrent Map */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight="600">
                    Directory Map
                  </Typography>
                  <Typography variant="body2" color="primary.main" fontWeight="600">
                    {formatBytes(stats.memoryUsage.torrentMapBytes)} ({memoryPercentages.torrentMap.toFixed(1)}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memoryPercentages.torrentMap}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    '& .MuiLinearProgress-bar': {
                      bgcolor: theme.palette.primary.main,
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {stats.directoryMap.totalTorrents.toLocaleString()} torrents
                </Typography>
              </Box>

              {/* Info Map */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight="600">
                    Info Map (Complete)
                  </Typography>
                  <Typography variant="body2" color="info.main" fontWeight="600">
                    {formatBytes(stats.memoryUsage.infoMapBytes)} ({memoryPercentages.infoMap.toFixed(1)}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memoryPercentages.infoMap}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    '& .MuiLinearProgress-bar': {
                      bgcolor: theme.palette.info.main,
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {stats.infoMap.completeTorrents.toLocaleString()} complete torrents (progress==100%)
                </Typography>
              </Box>

              {/* Download Cache */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight="600">
                    Download Cache ({stats.downloadCache.ttl} TTL)
                  </Typography>
                  <Typography variant="body2" color="success.main" fontWeight="600">
                    {formatBytes(stats.memoryUsage.downloadCacheBytes)} ({memoryPercentages.downloadCache.toFixed(1)}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memoryPercentages.downloadCache}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.success.main, 0.1),
                    '& .MuiLinearProgress-bar': {
                      bgcolor: theme.palette.success.main,
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {stats.downloadCache.cachedLinks.toLocaleString()} unrestricted links
                </Typography>
              </Box>

              {/* Failed Cache */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight="600">
                    Failed File Cache ({stats.failedCache.ttl} TTL)
                  </Typography>
                  <Typography variant="body2" color="warning.main" fontWeight="600">
                    {formatBytes(stats.memoryUsage.failedCacheBytes)} ({memoryPercentages.failedCache.toFixed(1)}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={memoryPercentages.failedCache}
                  sx={{
                    height: 8,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    '& .MuiLinearProgress-bar': {
                      bgcolor: theme.palette.warning.main,
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  {stats.failedCache.failedFiles.toLocaleString()} failed entries
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </motion.div>

      {/* Data Structure Details */}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Directory Map Card */}
        <Box sx={{ flex: 1 }}>
          <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={1}>
            <Card
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
                border: `1px solid ${alpha(theme.palette.info.main, 0.1)}`,
                height: '100%',
              }}
            >
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: 'info.main', width: 40, height: 40 }}>
                    <Storage sx={{ fontSize: 22 }} />
                  </Avatar>
                  <Typography variant="subtitle1" fontWeight="700">
                    Directory Map
                  </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                  {stats.directoryMap.description}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1.5, flexDirection: 'column' }}>
                  <Paper elevation={0} sx={{ p: 1.5, background: alpha(theme.palette.info.main, 0.08), borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="600" display="block">
                      Total Torrents
                    </Typography>
                    <Typography variant="h5" fontWeight="700" color="info.main">
                      {stats.directoryMap.totalTorrents.toLocaleString()}
                    </Typography>
                  </Paper>
                  <Paper elevation={0} sx={{ p: 1.5, background: alpha(theme.palette.info.main, 0.08), borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="600" display="block">
                      Memory Used
                    </Typography>
                    <Typography variant="h6" fontWeight="700" color="info.main">
                      {formatBytes(stats.directoryMap.memoryBytes)}
                    </Typography>
                  </Paper>
                </Box>
              </CardContent>
            </Card>
          </motion.div>
        </Box>

        {/* Info Map Card */}
        <Box sx={{ flex: 1 }}>
          <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={2}>
            <Card
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
                border: `1px solid ${alpha(theme.palette.success.main, 0.1)}`,
                height: '100%',
              }}
            >
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: 'success.main', width: 40, height: 40 }}>
                    <CloudSync sx={{ fontSize: 22 }} />
                  </Avatar>
                  <Typography variant="subtitle1" fontWeight="700">
                    Info Map
                  </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
                  {stats.infoMap.description}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1.5, flexDirection: 'column' }}>
                  <Paper elevation={0} sx={{ p: 1.5, background: alpha(theme.palette.success.main, 0.08), borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="600" display="block">
                      Complete Torrents
                    </Typography>
                    <Typography variant="h5" fontWeight="700" color="success.main">
                      {stats.infoMap.completeTorrents.toLocaleString()}
                    </Typography>
                  </Paper>
                  <Paper elevation={0} sx={{ p: 1.5, background: alpha(theme.palette.success.main, 0.08), borderRadius: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="600" display="block">
                      Memory Used
                    </Typography>
                    <Typography variant="h6" fontWeight="700" color="success.main">
                      {formatBytes(stats.infoMap.memoryBytes)}
                    </Typography>
                  </Paper>
                </Box>
              </CardContent>
            </Card>
          </motion.div>
        </Box>
      </Box>

      {/* Refresh Status */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={3}>
        <Card sx={{ mt: 3, border: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 2 }}>
              Refresh Status
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Initialized
                </Typography>
                <Typography variant="body1" fontWeight="600" color={stats.refresh.initialized ? 'success.main' : 'warning.main'}>
                  {stats.refresh.initialized ? 'Yes' : 'No'}
                </Typography>
              </Box>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Last Refresh
                </Typography>
                <Typography variant="body1" fontWeight="600">
                  {formatDate(stats.refresh.lastRefresh)}
                </Typography>
              </Box>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Interval
                </Typography>
                <Typography variant="body1" fontWeight="600">
                  {stats.refresh.refreshInterval} seconds
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
}
