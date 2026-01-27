import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Avatar, Paper, Stack, alpha, useTheme, Chip, List, ListItem, ListItemText, ListItemIcon, CircularProgress, IconButton, Collapse, Divider, LinearProgress } from '@mui/material';
import { Link as LinkIcon, CheckCircle, Schedule, Error as ErrorIcon, PlayArrow, Pause, Movie as MovieIcon, Tv as TvIcon, ExpandMore, ExpandLess, Memory, Queue as QueueIcon } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import { useSSEEventListener } from '../../hooks/useCentralizedSSE';
import axios from 'axios';

interface SymlinkActivity {
  id: string;
  mediaName: string;
  mediaType: 'movie' | 'tv' | 'tvshow';
  sourceFile: string;
  filename: string;
  destinationFile: string;
  tmdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  timestamp: number;
  error?: string;
}

interface SymlinkStats {
  total: number;
  completed: number;
  pending: number;
  processing: number;
  errors: number;
}

interface WorkerStats {
  maxWorkers: number;
  activeWorkers: number;
  queueSize: number;
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5 },
  }),
};

const SymlinkQueueTab: React.FC = () => {
  const theme = useTheme();
  const [activities, setActivities] = useState<SymlinkActivity[]>([]);
  const [stats, setStats] = useState<SymlinkStats>({
    total: 0,
    completed: 0,
    pending: 0,
    processing: 0,
    errors: 0,
  });
  const [workerStats, setWorkerStats] = useState<WorkerStats>({
    maxWorkers: 30,
    activeWorkers: 0,
    queueSize: 0,
  });
  const [isRunning, setIsRunning] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'recent' | 'errors' | null>('recent');
  const processedIds = useRef<Set<string>>(new Set());

  const extractFilename = useCallback((path: string): string => {
    if (!path) return '';
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || parts[parts.length - 2] || path;
  }, []);

  const fetchWorkerStats = useCallback(async () => {
    try {
      const response = await axios.get('/api/stats');
      if (response.data) {
        setWorkerStats((prev) => ({
          ...prev,
          maxWorkers: response.data.maxProcesses || 30,
        }));
      }
    } catch {
    }
  }, []);

  const fetchRecentMedia = useCallback(async () => {
    try {
      const response = await axios.get('/api/recent-media');
      if (response.data && Array.isArray(response.data)) {
        const mediaItems: SymlinkActivity[] = response.data.map((item: any, index: number) => {
          const sourceFile = item.path || item.filename || '';
          const filename = item.filename || extractFilename(sourceFile);
          const uniqueKey = `${sourceFile}-${item.name || item.properName}-${item.tmdbId || ''}-${item.seasonNumber || ''}-${item.episodeNumber || ''}`;
          
          processedIds.current.add(uniqueKey);
          
          return {
            id: `initial-${index}-${Date.now()}`,
            mediaName: item.properName || item.showName || item.name || 'Unknown',
            mediaType: item.type === 'movie' ? 'movie' : (item.type as 'tv' | 'tvshow'),
            sourceFile,
            filename,
            destinationFile: item.path || '',
            tmdbId: item.tmdbId,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            status: 'completed' as const,
            timestamp: item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now(),
          };
        });
        
        setActivities(mediaItems);
      }
    } catch {
    }
  }, [extractFilename]);

  useEffect(() => {
    fetchWorkerStats();
    fetchRecentMedia();
  }, [fetchWorkerStats, fetchRecentMedia]);

  const formatTimeAgo = useCallback((timestamp: number) => {
    const now = Date.now();
    const diffInSecs = Math.floor((now - timestamp) / 1000);
    const diffInMins = Math.floor(diffInSecs / 60);
    const diffInHours = Math.floor(diffInMins / 60);

    if (diffInSecs < 60) return 'Just now';
    if (diffInMins < 60) return `${diffInMins}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  }, []);

  const getStatusIcon = useCallback((status: SymlinkActivity['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle sx={{ color: 'success.main', fontSize: 18 }} />;
      case 'processing':
        return <CircularProgress size={16} sx={{ color: 'info.main' }} />;
      case 'pending':
        return <Schedule sx={{ color: 'warning.main', fontSize: 18 }} />;
      case 'error':
        return <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />;
      default:
        return <LinkIcon sx={{ color: 'text.secondary', fontSize: 18 }} />;
    }
  }, []);

  const addActivity = useCallback(
    (data: any, status: SymlinkActivity['status'] = 'completed') => {
      const sourceFile = data.source_file || data.sourceFile || '';
      const filename = data.filename || extractFilename(sourceFile);
      const mediaName = data.media_name || data.mediaName || 'Unknown';
      const tmdbId = data.tmdb_id || data.tmdbId || '';
      const seasonNum = data.season_number || data.seasonNumber;
      const episodeNum = data.episode_number || data.episodeNumber;

      const uniqueKey = `${sourceFile}-${mediaName}-${tmdbId}-${seasonNum || ''}-${episodeNum || ''}`;

      if (processedIds.current.has(uniqueKey)) {
        return;
      }
      processedIds.current.add(uniqueKey);

      const newActivity: SymlinkActivity = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        mediaName,
        mediaType: data.media_type || data.mediaType || 'movie',
        sourceFile,
        filename,
        destinationFile: data.destination_file || data.destinationFile || '',
        tmdbId,
        seasonNumber: seasonNum,
        episodeNumber: episodeNum,
        status,
        timestamp: Date.now(),
        error: data.error,
      };

      setActivities((prev) => [newActivity, ...prev].slice(0, 100));
      if (status === 'error') {
        setStats((prev) => ({
          ...prev,
          errors: prev.errors + 1,
        }));
      }
    },
    [extractFilename]
  );

  useSSEEventListener(
    ['symlink_created'],
    (event) => {
      if (event.type === 'symlink_created' && event.data) {
        addActivity(event.data, 'completed');
        setStats((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
        setWorkerStats((prev) => ({
          ...prev,
          activeWorkers: Math.min(prev.activeWorkers + 1, prev.maxWorkers),
          queueSize: Math.max(prev.queueSize - 1, 0),
        }));
        setTimeout(() => {
          setWorkerStats((prev) => ({
            ...prev,
            activeWorkers: Math.max(prev.activeWorkers - 1, 0),
          }));
        }, 1000);
      }
    },
    { source: 'mediahub', dependencies: [addActivity] }
  );

  useSSEEventListener(
    ['scan_started', 'scan_completed', 'scan_failed'],
    (event) => {
      if (event.type === 'scan_started') {
        setIsRunning(true);
        const totalFiles = event.data?.total_files || event.data?.file_count || 0;
        const maxWorkers = event.data?.max_workers || 30;
        setStats({
          total: totalFiles,
          completed: 0,
          pending: totalFiles,
          processing: 0,
          errors: 0,
        });
        setWorkerStats((prev) => ({
          ...prev,
          queueSize: totalFiles,
          maxWorkers: maxWorkers,
        }));
      } else if (event.type === 'scan_completed' || event.type === 'scan_failed') {
        setIsRunning(false);
        setWorkerStats((prev) => ({ ...prev, queueSize: 0, activeWorkers: 0 }));
      }
    },
    { source: 'mediahub', dependencies: [] }
  );

  const recentCompleted = activities.filter((a) => a.status === 'completed').slice(0, 15);
  const recentErrors = activities.filter((a) => a.status === 'error').slice(0, 5);
  const progressPercentage = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <Box>
      {/* Main Stats Card */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={0}>
        <Card
          sx={{
            mb: 3,
            background:
              theme.palette.mode === 'dark'
                ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`
                : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
            border:
              theme.palette.mode === 'dark'
                ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}`
                : `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
            {/* Header */}
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Avatar sx={{ bgcolor: 'primary.main', width: 44, height: 44 }}>
                  <LinkIcon sx={{ fontSize: 24 }} />
                </Avatar>
                <Box>
                  <Typography variant="h6" fontWeight="700">
                    Symlink Activity
                  </Typography>
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    {isRunning ? (
                      <CircularProgress size={10} sx={{ color: 'success.main' }} />
                    ) : (
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: 'text.disabled',
                        }}
                      />
                    )}
                    <Typography
                      variant="caption"
                      color={isRunning ? 'success.main' : 'text.secondary'}
                      fontWeight={500}
                    >
                      {isRunning ? 'Processing' : 'Idle'}
                    </Typography>
                  </Stack>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  icon={isRunning ? <PlayArrow sx={{ fontSize: 14 }} /> : <Pause sx={{ fontSize: 14 }} />}
                  label={isRunning ? 'Active' : 'Idle'}
                  size="small"
                  color={isRunning ? 'success' : 'default'}
                  variant="outlined"
                  sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                />
              </Stack>
            </Stack>

            {/* Workers & Queue Stats */}
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  flex: '1 1 140px',
                  background: alpha(theme.palette.info.main, 0.08),
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <Memory sx={{ fontSize: 24, color: 'info.main' }} />
                <Box>
                  <Typography
                    variant="caption"
                    fontWeight="600"
                    color="text.secondary"
                    sx={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase' }}
                  >
                    Workers
                  </Typography>
                  <Typography variant="body1" fontWeight="700" color="info.main">
                    {workerStats.activeWorkers}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      / {workerStats.maxWorkers}
                    </Typography>
                  </Typography>
                </Box>
              </Paper>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  flex: '1 1 140px',
                  background: alpha(theme.palette.warning.main, 0.08),
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <QueueIcon sx={{ fontSize: 24, color: 'warning.main' }} />
                <Box>
                  <Typography
                    variant="caption"
                    fontWeight="600"
                    color="text.secondary"
                    sx={{ display: 'block', fontSize: '0.65rem', textTransform: 'uppercase' }}
                  >
                    Queue
                  </Typography>
                  <Typography variant="body1" fontWeight="700" color="warning.main">
                    {workerStats.queueSize.toLocaleString()}
                  </Typography>
                </Box>
              </Paper>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Smart Processing Statistics - real-time updates */}
            <Typography
              variant="caption"
              fontWeight="700"
              color="text.secondary"
              sx={{
                display: 'block',
                mb: 1.5,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontSize: '0.65rem',
              }}
            >
              Smart Processing
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  textAlign: 'center',
                  flex: '1 1 100px',
                  background: alpha(theme.palette.warning.main, 0.08),
                  borderRadius: 1.5,
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight="600"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5, fontSize: '0.65rem' }}
                >
                  Processing
                </Typography>
                <Typography variant="h5" fontWeight="700" color="warning.main">
                  {Math.max(0, stats.total - stats.completed - stats.errors).toLocaleString()}
                </Typography>
              </Paper>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  textAlign: 'center',
                  flex: '1 1 100px',
                  background: alpha(theme.palette.success.main, 0.08),
                  borderRadius: 1.5,
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight="600"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5, fontSize: '0.65rem' }}
                >
                  Completed
                </Typography>
                <Typography variant="h5" fontWeight="700" color="success.main">
                  {stats.completed.toLocaleString()}
                </Typography>
              </Paper>
              <Paper
                elevation={0}
                sx={{
                  p: 1.5,
                  textAlign: 'center',
                  flex: '1 1 100px',
                  background: alpha(theme.palette.error.main, 0.08),
                  borderRadius: 1.5,
                }}
              >
                <Typography
                  variant="caption"
                  fontWeight="600"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5, fontSize: '0.65rem' }}
                >
                  Errors
                </Typography>
                <Typography variant="h5" fontWeight="700" color="error.main">
                  {stats.errors.toLocaleString()}
                </Typography>
              </Paper>
            </Box>

            {/* Progress Bar - only show during active processing */}
            {isRunning && stats.total > 0 && (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
                    Progress
                  </Typography>
                  <Typography variant="caption" color="text.secondary" fontSize="0.7rem">
                    {stats.completed} / {stats.total} ({progressPercentage}%)
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={progressPercentage}
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                    '& .MuiLinearProgress-bar': { borderRadius: 1 },
                  }}
                />
              </Box>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Symlinks Card */}
      <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={1}>
        <Card
          sx={{
            mb: recentErrors.length > 0 ? 3 : 0,
            background:
              theme.palette.mode === 'dark'
                ? `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.06)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`
                : `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.04)} 0%, ${theme.palette.background.paper} 100%)`,
            border: `1px solid ${alpha(theme.palette.success.main, 0.15)}`,
          }}
        >
          <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              onClick={() => setExpandedSection(expandedSection === 'recent' ? null : 'recent')}
              sx={{ cursor: 'pointer', py: 0.5 }}
            >
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Avatar sx={{ bgcolor: alpha(theme.palette.success.main, 0.15), width: 32, height: 32 }}>
                  <CheckCircle sx={{ fontSize: 18, color: 'success.main' }} />
                </Avatar>
                <Typography variant="subtitle2" fontWeight="700">
                  Recent Symlinks
                </Typography>
                <Chip
                  label={recentCompleted.length}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    height: 20,
                    bgcolor: alpha(theme.palette.success.main, 0.1),
                    color: 'success.main',
                  }}
                />
              </Stack>
              <IconButton size="small" sx={{ color: 'text.secondary' }}>
                {expandedSection === 'recent' ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </Stack>

            <Collapse in={expandedSection === 'recent'}>
              {recentCompleted.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <LinkIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    No symlinks created yet
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    Activity will appear here in real-time
                  </Typography>
                </Box>
              ) : (
                <List dense sx={{ p: 0, mt: 1 }}>
                  <AnimatePresence>
                    {recentCompleted.map((activity, index) => (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        transition={{ duration: 0.15, delay: index * 0.02 }}
                      >
                        <ListItem
                          sx={{
                            px: 1,
                            py: 0.75,
                            borderRadius: 1,
                            mb: 0.5,
                            bgcolor: alpha(theme.palette.background.paper, 0.5),
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 32 }}>
                            {activity.mediaType === 'movie' ? (
                              <MovieIcon sx={{ color: 'primary.main', fontSize: 18 }} />
                            ) : (
                              <TvIcon sx={{ color: 'secondary.main', fontSize: 18 }} />
                            )}
                          </ListItemIcon>
                          <ListItemText
                            primary={
                              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                                <Typography variant="body2" fontWeight="600" sx={{ fontSize: '0.8rem' }}>
                                  {activity.mediaName}
                                </Typography>
                                {(activity.mediaType === 'tv' || activity.mediaType === 'tvshow') &&
                                  activity.seasonNumber &&
                                  activity.episodeNumber && (
                                    <Chip
                                      label={`S${String(activity.seasonNumber).padStart(2, '0')}E${String(activity.episodeNumber).padStart(2, '0')}`}
                                      size="small"
                                      sx={{
                                        fontWeight: 600,
                                        fontSize: '0.6rem',
                                        height: 18,
                                        bgcolor: alpha(theme.palette.secondary.main, 0.1),
                                        color: 'secondary.main',
                                      }}
                                    />
                                  )}
                              </Stack>
                            }
                            secondary={
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                  fontSize: '0.7rem',
                                  display: 'block',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  maxWidth: { xs: 200, sm: 350, md: 500 },
                                }}
                              >
                                {activity.filename || activity.sourceFile || formatTimeAgo(activity.timestamp)}
                              </Typography>
                            }
                            sx={{ my: 0 }}
                          />
                          <Stack direction="row" alignItems="center" spacing={0.5}>
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ fontSize: '0.65rem', display: { xs: 'none', sm: 'block' } }}
                            >
                              {formatTimeAgo(activity.timestamp)}
                            </Typography>
                            {getStatusIcon(activity.status)}
                          </Stack>
                        </ListItem>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </List>
              )}
            </Collapse>
          </CardContent>
        </Card>
      </motion.div>

      {/* Errors Card */}
      {recentErrors.length > 0 && (
        <motion.div variants={cardVariants} initial="hidden" animate="visible" custom={2}>
          <Card
            sx={{
              background:
                theme.palette.mode === 'dark'
                  ? `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.06)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`
                  : `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.04)} 0%, ${theme.palette.background.paper} 100%)`,
              border: `1px solid ${alpha(theme.palette.error.main, 0.15)}`,
            }}
          >
            <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                onClick={() => setExpandedSection(expandedSection === 'errors' ? null : 'errors')}
                sx={{ cursor: 'pointer', py: 0.5 }}
              >
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Avatar sx={{ bgcolor: alpha(theme.palette.error.main, 0.15), width: 32, height: 32 }}>
                    <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />
                  </Avatar>
                  <Typography variant="subtitle2" fontWeight="700">
                    Recent Errors
                  </Typography>
                  <Chip
                    label={recentErrors.length}
                    size="small"
                    color="error"
                    sx={{ fontWeight: 700, fontSize: '0.7rem', height: 20 }}
                  />
                </Stack>
                <IconButton size="small" sx={{ color: 'text.secondary' }}>
                  {expandedSection === 'errors' ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              </Stack>

              <Collapse in={expandedSection === 'errors'}>
                <List dense sx={{ p: 0, mt: 1 }}>
                  {recentErrors.map((activity) => (
                    <ListItem
                      key={activity.id}
                      sx={{
                        px: 1,
                        py: 0.75,
                        borderRadius: 1,
                        mb: 0.5,
                        bgcolor: alpha(theme.palette.error.main, 0.04),
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <ErrorIcon sx={{ color: 'error.main', fontSize: 18 }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Typography variant="body2" fontWeight="600" sx={{ fontSize: '0.8rem' }}>
                            {activity.mediaName}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" color="error.main" sx={{ fontSize: '0.7rem' }}>
                            {activity.error || 'Unknown error'}
                          </Typography>
                        }
                        sx={{ my: 0 }}
                      />
                    </ListItem>
                  ))}
                </List>
              </Collapse>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </Box>
  );
};

export default SymlinkQueueTab;
