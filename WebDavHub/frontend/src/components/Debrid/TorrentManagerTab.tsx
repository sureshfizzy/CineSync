import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Box, Card, CardContent, Typography, CircularProgress, Avatar, Divider, Stack, useTheme, Alert, Paper, alpha, LinearProgress, IconButton, Chip, Tooltip } from '@mui/material';
import { Memory, Storage, CloudSync, Refresh, ErrorOutline } from '@mui/icons-material';
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

// Utility function for relative time
const getRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  
  if (diffSecs < 5) return 'just now';
  if (diffSecs < 60) return `${diffSecs} seconds ago`;
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

// Memoized memory bar component
interface MemoryBarItemProps {
  label: string;
  bytes: number;
  percentage: number;
  count: string;
  color: 'primary' | 'info' | 'success' | 'warning';
  ttl?: string;
}

const MemoryBarItem = memo(({ label, bytes, percentage, count, color, ttl }: MemoryBarItemProps) => {
  const theme = useTheme();
  const colorValue = theme.palette[color].main;
  
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="body2" fontWeight="600">
          {label} {ttl && `(${ttl} TTL)`}
        </Typography>
        <Typography variant="body2" color={`${color}.main`} fontWeight="600">
          {formatBytes(bytes)} ({percentage.toFixed(1)}%)
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(percentage, 100)}
        sx={{
          height: 8,
          borderRadius: 1,
          bgcolor: alpha(colorValue, 0.1),
          '& .MuiLinearProgress-bar': {
            bgcolor: colorValue,
          },
        }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        {count}
      </Typography>
    </Box>
  );
});

MemoryBarItem.displayName = 'MemoryBarItem';

// Memoized stat card component
interface StatCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  stats: Array<{ label: string; value: string; color: string }>;
  color: 'info' | 'success';
  customIndex: number;
}

const StatCard = memo(({ icon, title, description, stats, color, customIndex }: StatCardProps) => {
  const theme = useTheme();
  const colorValue = theme.palette[color].main;
  
  return (
    <Box sx={{ flex: 1 }}>
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={customIndex}>
        <Card
          sx={{
            background: `linear-gradient(135deg, ${alpha(colorValue, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
            border: `1px solid ${alpha(colorValue, 0.1)}`,
            height: '100%',
          }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
              <Avatar sx={{ bgcolor: `${color}.main`, width: 40, height: 40 }}>
                {icon}
              </Avatar>
              <Typography variant="subtitle1" fontWeight="700">
                {title}
              </Typography>
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              {description}
            </Typography>

            <Box sx={{ display: 'flex', gap: 1.5, flexDirection: 'column' }}>
              {stats.map((stat, idx) => (
                <Paper key={idx} elevation={0} sx={{ p: 1.5, background: alpha(colorValue, 0.08), borderRadius: 1.5 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight="600" display="block">
                    {stat.label}
                  </Typography>
                  <Typography variant={idx === 0 ? "h5" : "h6"} fontWeight="700" color={stat.color}>
                    {stat.value}
                  </Typography>
                </Paper>
              ))}
            </Box>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
});

StatCard.displayName = 'StatCard';

export default function TorrentManagerTab() {
  const [stats, setStats] = useState<TorrentManagerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');
  const theme = useTheme();

  const fetchStats = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setLoading(true);
    } else {
      setIsUpdating(true);
    }
    setError('');

    try {
      const response = await axios.get('/api/realdebrid/torrent-manager-stats');
      setStats(response.data);
      setLastUpdateTime(new Date().toISOString());
      setError('');
    } catch (err: any) {
      const errorMsg = err.response?.data || 'Failed to fetch torrent manager statistics';
      setError(errorMsg);
      console.error('Torrent stats fetch error:', err);
    } finally {
      if (isInitial) {
        setLoading(false);
      }
      setIsUpdating(false);
    }
  }, []);

  const handleRetry = useCallback(() => {
    fetchStats(true);
  }, [fetchStats]);

  useEffect(() => {
    fetchStats(true);
    
    // Smart polling: pause when tab is hidden
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStats(false);
      }
    }, 2000);

    // Handle visibility change to immediately update when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && stats) {
        fetchStats(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchStats, stats]);

  // Memoize expensive calculations
  const memoryPercentages = useMemo(() => {
    if (!stats || stats.memoryUsage.totalBytes === 0) {
      return {
        torrentMap: 0,
        infoMap: 0,
        downloadCache: 0,
        failedCache: 0,
      };
    }
    return {
      torrentMap: (stats.memoryUsage.torrentMapBytes / stats.memoryUsage.totalBytes) * 100,
      infoMap: (stats.memoryUsage.infoMapBytes / stats.memoryUsage.totalBytes) * 100,
      downloadCache: (stats.memoryUsage.downloadCacheBytes / stats.memoryUsage.totalBytes) * 100,
      failedCache: (stats.memoryUsage.failedCacheBytes / stats.memoryUsage.totalBytes) * 100,
    };
  }, [stats]);

  // Memoize additional derived stats
  const additionalStats = useMemo(() => {
    if (!stats) return null;
    
    const avgMemoryPerTorrent = stats.directoryMap.totalTorrents > 0
      ? stats.memoryUsage.torrentMapBytes / stats.directoryMap.totalTorrents
      : 0;
    
    const avgMemoryPerCompleteTorrent = stats.infoMap.completeTorrents > 0
      ? stats.memoryUsage.infoMapBytes / stats.infoMap.completeTorrents
      : 0;
    
    const totalCachedItems = stats.downloadCache.cachedLinks + stats.failedCache.failedFiles;
    
    // Calculate cache efficiency only if there are cached items
    const cacheEfficiency = totalCachedItems > 0
      ? ((stats.downloadCache.cachedLinks / totalCachedItems) * 100)
      : 0;

    const hasCacheData = totalCachedItems > 0;

    return {
      avgMemoryPerTorrent,
      avgMemoryPerCompleteTorrent,
      cacheEfficiency,
      totalCachedItems,
      hasCacheData,
    };
  }, [stats]);

  // Memoize theme-dependent values
  const gradients = useMemo(() => ({
    primary: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
  }), [theme]);

  const borders = useMemo(() => ({
    primary: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
    divider: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
  }), [theme]);

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
      <Box sx={{ p: 3, minHeight: '50vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <Alert 
          severity="error" 
          sx={{ maxWidth: 600, width: '100%' }}
          action={
            <IconButton
              color="inherit"
              size="small"
              onClick={handleRetry}
              aria-label="retry"
            >
              <Refresh />
            </IconButton>
          }
        >
          {error}
        </Alert>
        <Typography variant="body2" color="text.secondary">
          Click the refresh button to retry
        </Typography>
      </Box>
    );
  }

  if (!stats) {
    return null;
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, height: '100%', overflow: 'auto' }}>
      {/* Header with update indicator */}
      <Box sx={{ mb: 4 }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Typography variant="h4" fontWeight="700" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
            Torrent Manager
          </Typography>
          {isUpdating && (
            <Chip
              icon={<CircularProgress size={16} sx={{ color: 'inherit' }} />}
              label="Updating..."
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary', opacity: 0.8, fontSize: '0.875rem' }}>
          Last updated: {lastUpdateTime ? getRelativeTime(lastUpdateTime) : formatDate(stats.lastUpdated)}
        </Typography>
      </Box>

      {/* Memory Usage Overview */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={0}>
        <Card
          sx={{
            mb: 3,
            background: gradients.primary,
            border: borders.primary,
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

            {/* Memory Breakdown using memoized component */}
            <Typography variant="caption" fontWeight="700" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Memory Distribution
            </Typography>

            <Stack spacing={2}>
              <MemoryBarItem
                label="Directory Map"
                bytes={stats.memoryUsage.torrentMapBytes}
                percentage={memoryPercentages.torrentMap}
                count={`${stats.directoryMap.totalTorrents.toLocaleString()} torrents`}
                color="primary"
              />
              <MemoryBarItem
                label="Info Map (Complete)"
                bytes={stats.memoryUsage.infoMapBytes}
                percentage={memoryPercentages.infoMap}
                count={`${stats.infoMap.completeTorrents.toLocaleString()} complete torrents`}
                color="info"
              />
              
              {/* Only show cache memory bars if they have significant data (>1% each) */}
              {(memoryPercentages.downloadCache > 1 || memoryPercentages.failedCache > 1) && (
                <>
                  <MemoryBarItem
                    label="Download Cache"
                    bytes={stats.memoryUsage.downloadCacheBytes}
                    percentage={memoryPercentages.downloadCache}
                    count={`${stats.downloadCache.cachedLinks.toLocaleString()} unrestricted links`}
                    color="success"
                    ttl={stats.downloadCache.ttl}
                  />
                  <MemoryBarItem
                    label="Failed File Cache"
                    bytes={stats.memoryUsage.failedCacheBytes}
                    percentage={memoryPercentages.failedCache}
                    count={`${stats.failedCache.failedFiles.toLocaleString()} failed entries`}
                    color="warning"
                    ttl={stats.failedCache.ttl}
                  />
                </>
              )}
            </Stack>
            
            {/* Compact cache info when memory is negligible */}
            {(memoryPercentages.downloadCache <= 1 && memoryPercentages.failedCache <= 1) && (
              <Box sx={{ mt: 2, p: 1.5, bgcolor: alpha(theme.palette.info.main, 0.05), borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Cache Status (TTL: {stats.downloadCache.ttl})
                </Typography>
                <Stack direction="row" spacing={2} divider={<Divider orientation="vertical" flexItem />}>
                  <Box>
                    <Typography variant="caption" fontWeight="600" color="success.main">
                      {stats.downloadCache.cachedLinks} Downloads
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" fontWeight="600" color="warning.main">
                      {stats.failedCache.failedFiles} Failed
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {formatBytes(stats.memoryUsage.downloadCacheBytes + stats.memoryUsage.failedCacheBytes)} total
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Data Structure Details - Using StatCard component */}
      <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        <StatCard
          icon={<Storage sx={{ fontSize: 22 }} />}
          title="Directory Map"
          description={stats.directoryMap.description}
          color="info"
          customIndex={1}
          stats={[
            {
              label: 'Total Torrents',
              value: stats.directoryMap.totalTorrents.toLocaleString(),
              color: 'info.main'
            },
            {
              label: 'Memory Used',
              value: formatBytes(stats.directoryMap.memoryBytes),
              color: 'info.main'
            },
            {
              label: 'Avg per Torrent',
              value: formatBytes(additionalStats?.avgMemoryPerTorrent || 0),
              color: 'info.main'
            }
          ]}
        />
        
        <StatCard
          icon={<CloudSync sx={{ fontSize: 22 }} />}
          title="Info Map"
          description={stats.infoMap.description}
          color="success"
          customIndex={2}
          stats={[
            {
              label: 'Complete Torrents',
              value: stats.infoMap.completeTorrents.toLocaleString(),
              color: 'success.main'
            },
            {
              label: 'Memory Used',
              value: formatBytes(stats.infoMap.memoryBytes),
              color: 'success.main'
            },
            {
              label: 'Avg per Torrent',
              value: formatBytes(additionalStats?.avgMemoryPerCompleteTorrent || 0),
              color: 'success.main'
            }
          ]}
        />
      </Box>

      {/* Additional Stats Card - REMOVED: Cache performance not useful when empty */}
      {/* Replaced with better alternatives below */}

      {/* Refresh Status */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={4}>
        <Card sx={{ mt: 3, border: borders.divider }}>
          <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 2 }}>
              Refresh Status
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Initialized
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="body1" fontWeight="600" color={stats.refresh.initialized ? 'success.main' : 'warning.main'}>
                    {stats.refresh.initialized ? 'Yes' : 'No'}
                  </Typography>
                  {!stats.refresh.initialized && (
                    <Tooltip title="Torrent manager is still initializing">
                      <ErrorOutline sx={{ fontSize: 18, color: 'warning.main' }} />
                    </Tooltip>
                  )}
                </Stack>
              </Box>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Last Refresh
                </Typography>
                <Typography variant="body1" fontWeight="600">
                  {getRelativeTime(stats.refresh.lastRefresh)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(stats.refresh.lastRefresh)}
                </Typography>
              </Box>
              <Box sx={{ flex: '1 1 200px' }}>
                <Typography variant="caption" color="text.secondary" display="block">
                  Refresh Interval
                </Typography>
                <Typography variant="body1" fontWeight="600">
                  {stats.refresh.refreshInterval}s
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  UI updates every 2s
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
}
