import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Chip,
  Stack,
  Alert,
  CircularProgress,
  useTheme,
  alpha,
  IconButton,
  Collapse,
  Grid,
  Tooltip,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Refresh,
  Terminal,
  Speed,
  Storage,
  Timeline,
  FolderOpen,
  Link,
  Visibility,
  Circle,
} from '@mui/icons-material';
import LoadingButton from './LoadingButton';

interface MediaHubStatus {
  isRunning: boolean;
  processExists: boolean;
  lockFileExists: boolean;
  monitorRunning: boolean;
  sourceDir: string;
  destinationDir: string;
  monitorPID?: number;
  uptime?: string;
}

interface MediaHubActivity {
  totalFiles: number;
  symlinkCount: number;
  recentLogs: string[];
  lastActivity?: string;
}

interface MediaHubServiceProps {
  onStatusChange?: (status: MediaHubStatus) => void;
}

const MediaHubService: React.FC<MediaHubServiceProps> = ({ onStatusChange }) => {
  const theme = useTheme();
  const [status, setStatus] = useState<MediaHubStatus | null>(null);
  const [activity, setActivity] = useState<MediaHubActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fetchStatus = async (showRefreshIndicator = false) => {
    if (showRefreshIndicator) {
      setIsRefreshing(true);
    }
    try {
      const response = await fetch('/api/mediahub/status');
      if (!response.ok) throw new Error('Failed to fetch status');
      const data = await response.json();

      setStatus(data);
      onStatusChange?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch status');
    } finally {
      if (showRefreshIndicator) {
        setIsRefreshing(false);
      }
    }
  };

  const fetchActivity = async () => {
    try {
      const response = await fetch('/api/mediahub/logs');
      if (!response.ok) throw new Error('Failed to fetch activity');
      const data = await response.json();
      setActivity(data);
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    }
  };

  const fetchData = async (showRefreshIndicator = false) => {
    setLoading(true);
    await Promise.all([
      fetchStatus(showRefreshIndicator),
      fetchActivity()
    ]);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // No polling - status updates only on user actions and manual refresh

  useEffect(() => {
    if (status && onStatusChange) {
      onStatusChange(status);
    }
  }, [status, onStatusChange]);

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setActionLoading(action);
    setError(null);
    setSuccess(null);

    // Optimistic UI update
    if (status) {
      const optimisticStatus = { ...status };
      if (action === 'start') {
        optimisticStatus.isRunning = true;
        optimisticStatus.monitorRunning = true;
      } else if (action === 'stop') {
        optimisticStatus.isRunning = false;
        optimisticStatus.monitorRunning = false;
      }
      setStatus(optimisticStatus);
    }

    try {
      const response = await fetch(`/api/mediahub/${action}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} MediaHub service`);
      }

      const result = await response.json();

      if (result.success) {
        setSuccess(result.message || `MediaHub service ${action}ed successfully`);

        // Multiple refreshes to ensure we catch the status change
        const refreshStatus = async (attempt = 1, maxAttempts = 5) => {
          try {
            const response = await fetch('/api/mediahub/status');
            if (response.ok) {
              const data = await response.json();

              if (action === 'start' && (!data.isRunning || !data.monitorRunning) && attempt < maxAttempts) {
                setTimeout(() => refreshStatus(attempt + 1, maxAttempts), 1000);
              } else {
                setStatus(data);
              }
            }
          } catch (error) {
            console.error('Failed to refresh status:', error);
          }
        };

        setTimeout(() => refreshStatus(), 1500);
      } else {
        setError(result.message || `Failed to ${action} MediaHub service`);
        // Revert optimistic update on error
        try {
          const response = await fetch('/api/mediahub/status');
          if (response.ok) {
            const data = await response.json();
            setStatus(data);
          }
        } catch (error) {
          console.error('Failed to refresh status:', error);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} service`);
      // Revert optimistic update on error
      try {
        const response = await fetch('/api/mediahub/status');
        if (response.ok) {
          const data = await response.json();
          setStatus(data);
        }
      } catch (error) {
        console.error('Failed to refresh status:', error);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleMonitorAction = async (action: 'start' | 'stop') => {
    setActionLoading(`monitor-${action}`);
    setError(null);
    setSuccess(null);

    // Optimistic UI update for monitor only
    if (status) {
      const optimisticStatus = { ...status };
      if (action === 'start') {
        optimisticStatus.monitorRunning = true;
      } else if (action === 'stop') {
        optimisticStatus.monitorRunning = false;
      }
      setStatus(optimisticStatus);
    }

    try {
      const response = await fetch(`/api/mediahub/monitor/${action}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action} monitor`);
      }

      const result = await response.json();

      if (result.success) {
        setSuccess(result.message || `Monitor ${action}ed successfully`);

        // Multiple refreshes to ensure we catch the status change
        const refreshStatus = async (attempt = 1, maxAttempts = 4) => {
          try {
            const response = await fetch('/api/mediahub/status');
            if (response.ok) {
              const data = await response.json();

              // For monitor actions, keep trying until monitor status matches expected state
              const expectedMonitorState = action === 'start';
              if (data.monitorRunning !== expectedMonitorState && attempt < maxAttempts) {
                setTimeout(() => refreshStatus(attempt + 1, maxAttempts), 1000);
              } else {
                setStatus(data);
              }
            }
          } catch (error) {
            console.error('Failed to refresh status:', error);
          }
        };

        setTimeout(() => refreshStatus(), 1000);
      } else {
        setError(result.message || `Failed to ${action} monitor`);
        // Revert optimistic update on error
        try {
          const response = await fetch('/api/mediahub/status');
          if (response.ok) {
            const data = await response.json();
            setStatus(data);
          }
        } catch (error) {
          console.error('Failed to refresh status:', error);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action} monitor`);
      // Revert optimistic update on error
      try {
        const response = await fetch('/api/mediahub/status');
        if (response.ok) {
          const data = await response.json();
          setStatus(data);
        }
      } catch (error) {
        console.error('Failed to refresh status:', error);
      }
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusColor = () => {
    if (!status) return '#6B7280';
    if (status.isRunning && status.monitorRunning) return '#10B981';
    if (status.isRunning || status.monitorRunning) return '#F59E0B';
    return '#EF4444';
  };

  const getStatusText = () => {
    if (!status) return 'Unknown';
    if (status.isRunning && status.monitorRunning) return 'Active';
    if (status.isRunning) return 'Partial';
    if (status.monitorRunning) return 'Monitor';
    return 'Stopped';
  };

  if (loading) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="200px"
        sx={{
          background: `linear-gradient(135deg, ${alpha('#000', 0.02)} 0%, ${alpha('#000', 0.05)} 100%)`,
          borderRadius: 3,
          border: `1px solid ${alpha('#000', 0.08)}`,
        }}
      >
        <CircularProgress size={32} thickness={4} />
      </Box>
    );
  }

  return (
    <Box>
      {/* Alerts */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: 3,
            borderRadius: 2,
            border: 'none',
            bgcolor: alpha('#EF4444', 0.1),
            color: '#DC2626',
            '& .MuiAlert-icon': { color: '#DC2626' }
          }}
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {success && (
        <Alert
          severity="success"
          sx={{
            mb: 3,
            borderRadius: 2,
            border: 'none',
            bgcolor: alpha('#10B981', 0.1),
            color: '#059669',
            '& .MuiAlert-icon': { color: '#059669' }
          }}
          onClose={() => setSuccess(null)}
        >
          {success}
        </Alert>
      )}

      {/* Main Service Card */}
      <Box
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          p: 3,
        }}
      >
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={3}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Speed sx={{ fontSize: 24, color: 'primary.main' }} />
            <Box>
              <Typography variant="h6" fontWeight="600">
                MediaHub Service
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Automated media processing & organization
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Tooltip title="Refresh status">
              <IconButton
                onClick={() => fetchData(true)}
                disabled={isRefreshing}
                size="small"
                sx={{
                  animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              >
                <Refresh />
              </IconButton>
            </Tooltip>

            <Chip
              label={getStatusText()}
              size="small"
              sx={{
                bgcolor: alpha(getStatusColor(), 0.1),
                color: getStatusColor(),
                border: `1px solid ${alpha(getStatusColor(), 0.2)}`,
                fontWeight: 600,
                transition: 'all 0.4s ease-in-out',
              }}
              icon={<Circle sx={{ fontSize: '8px !important', color: getStatusColor() }} />}
            />
          </Stack>
        </Stack>

        {/* Process Status Grid */}
        {status && (
          <Grid container spacing={2} mb={3}>
            <Grid item xs={12} md={6}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: status.isRunning
                    ? alpha('#10B981', 0.1)
                    : alpha('#EF4444', 0.1),
                  border: '1px solid',
                  borderColor: status.isRunning
                    ? alpha('#10B981', 0.2)
                    : alpha('#EF4444', 0.2),
                  transition: 'all 0.4s ease-in-out',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Speed
                    sx={{
                      fontSize: 20,
                      color: status.isRunning ? '#10B981' : '#EF4444'
                    }}
                  />
                  <Box flex={1}>
                    <Typography variant="subtitle2" fontWeight="600">
                      Main Process
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {status.isRunning ? 'Processing files' : 'Inactive'}
                    </Typography>
                  </Box>
                  <Chip
                    label={status.isRunning ? 'Running' : 'Stopped'}
                    size="small"
                    sx={{
                      bgcolor: status.isRunning ? '#10B981' : '#EF4444',
                      color: 'white',
                      fontWeight: 600,
                      transition: 'all 0.4s ease-in-out',
                    }}
                  />
                </Stack>
              </Box>
            </Grid>

            <Grid item xs={12} md={6}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: status.monitorRunning
                    ? alpha('#10B981', 0.1)
                    : alpha('#EF4444', 0.1),
                  border: '1px solid',
                  borderColor: status.monitorRunning
                    ? alpha('#10B981', 0.2)
                    : alpha('#EF4444', 0.2),
                  transition: 'all 0.4s ease-in-out',
                }}
              >
                <Stack direction="row" alignItems="center" spacing={2}>
                  <Visibility
                    sx={{
                      fontSize: 20,
                      color: status.monitorRunning ? '#10B981' : '#EF4444'
                    }}
                  />
                  <Box flex={1}>
                    <Typography variant="subtitle2" fontWeight="600">
                      Monitor
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {status.monitorRunning ? 'Watching directories' : 'Not monitoring'}
                    </Typography>
                  </Box>
                  <Chip
                    label={status.monitorRunning ? 'Active' : 'Stopped'}
                    size="small"
                    sx={{
                      bgcolor: status.monitorRunning ? '#10B981' : '#EF4444',
                      color: 'white',
                      fontWeight: 600,
                      transition: 'all 0.4s ease-in-out',
                    }}
                  />
                </Stack>
              </Box>
            </Grid>
          </Grid>
        )}

        {/* Directory Configuration */}
        {status && (status.sourceDir || status.destinationDir) && (
          <Box mb={3}>
            <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <FolderOpen sx={{ fontSize: 18 }} />
              Directories
            </Typography>
            <Stack spacing={2}>
              {status.sourceDir && (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: alpha('#3B82F6', 0.1),
                    border: '1px solid',
                    borderColor: alpha('#3B82F6', 0.2),
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
                    <Storage sx={{ fontSize: 16, color: '#3B82F6' }} />
                    <Typography variant="body2" fontWeight="600" color="#3B82F6">
                      Source Directory
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{
                      wordBreak: 'break-all',
                      fontSize: '0.875rem',
                      color: 'text.secondary'
                    }}
                  >
                    {status.sourceDir}
                  </Typography>
                </Box>
              )}

              {status.destinationDir && (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: alpha('#8B5CF6', 0.1),
                    border: '1px solid',
                    borderColor: alpha('#8B5CF6', 0.2),
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5} mb={1}>
                    <Link sx={{ fontSize: 16, color: '#8B5CF6' }} />
                    <Typography variant="body2" fontWeight="600" color="#8B5CF6">
                      Destination Directory
                    </Typography>
                  </Stack>
                  <Typography
                    variant="body2"
                    fontFamily="monospace"
                    sx={{
                      wordBreak: 'break-all',
                      fontSize: '0.875rem',
                      color: 'text.secondary'
                    }}
                  >
                    {status.destinationDir}
                  </Typography>
                </Box>
              )}
            </Stack>
          </Box>
        )}

          {/* Control Panel */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
            <LoadingButton
              variant="contained"
              startIcon={<PlayArrow />}
              loading={actionLoading === 'start'}
              disabled={status?.isRunning || actionLoading !== null}
              onClick={() => handleAction('start')}
              sx={{
                px: 3,
                py: 1.2,
                borderRadius: 2,
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: '#10B981',
                color: 'white',
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#059669',
                  boxShadow: 'none',
                },
                '&:disabled': {
                  bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.12) : alpha('#000', 0.12),
                  color: theme.palette.mode === 'dark' ? alpha('#FFF', 0.3) : alpha('#000', 0.26),
                },
              }}
            >
              Start Service
            </LoadingButton>

            <LoadingButton
              variant="contained"
              startIcon={<Stop />}
              loading={actionLoading === 'stop'}
              disabled={!status?.isRunning && !status?.monitorRunning || actionLoading !== null}
              onClick={() => handleAction('stop')}
              sx={{
                px: 3,
                py: 1.2,
                borderRadius: 2,
                fontWeight: 600,
                textTransform: 'none',
                bgcolor: '#EF4444',
                color: 'white',
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#DC2626',
                  boxShadow: 'none',
                },
                '&:disabled': {
                  bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.12) : alpha('#000', 0.12),
                  color: theme.palette.mode === 'dark' ? alpha('#FFF', 0.3) : alpha('#000', 0.26),
                },
              }}
            >
              Stop Service
            </LoadingButton>

            <LoadingButton
              variant="outlined"
              startIcon={<Refresh />}
              loading={actionLoading === 'restart'}
              disabled={actionLoading !== null}
              onClick={() => handleAction('restart')}
              sx={{
                px: 3,
                py: 1.2,
                borderRadius: 2,
                fontWeight: 600,
                textTransform: 'none',
                borderColor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.23) : alpha('#000', 0.23),
                color: 'text.primary',
                '&:hover': {
                  borderColor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.23) : alpha('#000', 0.23),
                  bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.04) : alpha('#000', 0.04),
                },
              }}
            >
              Restart
            </LoadingButton>

            <Button
              variant="text"
              startIcon={<Terminal />}
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) fetchActivity();
              }}
              sx={{
                px: 3,
                py: 1.2,
                borderRadius: 2,
                fontWeight: 600,
                textTransform: 'none',
                color: 'text.secondary',
                '&:hover': {
                  bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.04) : alpha('#000', 0.04),
                  color: 'text.primary',
                },
              }}
            >
              {showLogs ? 'Hide' : 'Show'} Logs
            </Button>
          </Stack>

        {/* Advanced Controls Toggle */}
        <Box sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch
                checked={showAdvanced}
                onChange={(e) => setShowAdvanced(e.target.checked)}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: '#8B5CF6',
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: '#8B5CF6',
                  },
                }}
              />
            }
            label={
              <Typography variant="body2" fontWeight="600">
                Advanced Controls
              </Typography>
            }
          />
        </Box>

        {/* Advanced Monitor Controls */}
        <Collapse in={showAdvanced}>
          <Box
            sx={{
              p: 3,
              borderRadius: 2,
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'divider',
              mb: 3,
            }}
          >
            <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Visibility sx={{ fontSize: 18 }} />
              Monitor Controls
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Control the directory monitor independently from the main service.
            </Typography>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <LoadingButton
                variant="contained"
                startIcon={<PlayArrow />}
                loading={actionLoading === 'monitor-start'}
                disabled={status?.monitorRunning || actionLoading !== null}
                onClick={() => handleMonitorAction('start')}
                sx={{
                  px: 3,
                  py: 1.2,
                  borderRadius: 2,
                  fontWeight: 600,
                  textTransform: 'none',
                  bgcolor: '#10B981',
                  color: 'white',
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: '#059669',
                    boxShadow: 'none',
                  },
                  '&:disabled': {
                    bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.12) : alpha('#000', 0.12),
                    color: theme.palette.mode === 'dark' ? alpha('#FFF', 0.3) : alpha('#000', 0.26),
                  },
                }}
              >
                Start Monitor
              </LoadingButton>

              <LoadingButton
                variant="contained"
                startIcon={<Stop />}
                loading={actionLoading === 'monitor-stop'}
                disabled={!status?.monitorRunning || actionLoading !== null}
                onClick={() => handleMonitorAction('stop')}
                sx={{
                  px: 3,
                  py: 1.2,
                  borderRadius: 2,
                  fontWeight: 600,
                  textTransform: 'none',
                  bgcolor: '#EF4444',
                  color: 'white',
                  boxShadow: 'none',
                  '&:hover': {
                    bgcolor: '#DC2626',
                    boxShadow: 'none',
                  },
                  '&:disabled': {
                    bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.12) : alpha('#000', 0.12),
                    color: theme.palette.mode === 'dark' ? alpha('#FFF', 0.3) : alpha('#000', 0.26),
                  },
                }}
              >
                Stop Monitor
              </LoadingButton>
            </Stack>
          </Box>
        </Collapse>
      </Box>

      {/* Activity Summary */}
      {activity && (
        <Box
          sx={{
            mt: 3,
            p: 3,
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Timeline sx={{ fontSize: 18 }} />
            Activity Summary
          </Typography>

          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: alpha('#3B82F6', 0.1),
                  border: '1px solid',
                  borderColor: alpha('#3B82F6', 0.2),
                  textAlign: 'center',
                }}
              >
                <Typography variant="h5" fontWeight="700" color="#3B82F6" sx={{ mb: 0.5 }}>
                  {activity.totalFiles.toLocaleString()}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Files Processed
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} sm={4}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: alpha('#10B981', 0.1),
                  border: '1px solid',
                  borderColor: alpha('#10B981', 0.2),
                  textAlign: 'center',
                }}
              >
                <Typography variant="h5" fontWeight="700" color="#10B981" sx={{ mb: 0.5 }}>
                  {activity.symlinkCount.toLocaleString()}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Symlinks Created
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} sm={4}>
              <Box
                sx={{
                  p: 2,
                  borderRadius: 2,
                  bgcolor: alpha('#8B5CF6', 0.1),
                  border: '1px solid',
                  borderColor: alpha('#8B5CF6', 0.2),
                  textAlign: 'center',
                }}
              >
                <Typography variant="h5" fontWeight="700" color="#8B5CF6" sx={{ mb: 0.5 }}>
                  {Math.round((activity.symlinkCount / Math.max(activity.totalFiles, 1)) * 100)}%
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Success Rate
                </Typography>
              </Box>
            </Grid>

            {activity.lastActivity && (
              <Grid item xs={12}>
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: alpha('#F59E0B', 0.1),
                    border: '1px solid',
                    borderColor: alpha('#F59E0B', 0.2),
                    textAlign: 'center',
                  }}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    Last Activity
                  </Typography>
                  <Typography variant="body1" fontWeight="600" color="#F59E0B">
                    {new Date(activity.lastActivity).toLocaleString()}
                  </Typography>
                </Box>
              </Grid>
            )}
          </Grid>
        </Box>
      )}

      {/* Logs Section */}
      <Collapse in={showLogs}>
        <Box
          sx={{
            mt: 3,
            borderRadius: 2,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {/* Logs Header */}
          <Box
            sx={{
              p: 2,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: alpha('#000', 0.02),
            }}
          >
            <Typography variant="subtitle2" fontWeight="600" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Terminal sx={{ fontSize: 18 }} />
              System Logs
            </Typography>
          </Box>

          {/* Logs Content */}
          {activity?.recentLogs && activity.recentLogs.length > 0 ? (
            <Box
              sx={{
                p: 2,
                maxHeight: 300,
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.875rem',
              }}
            >
              {activity.recentLogs.map((log, index) => (
                <Box
                  key={index}
                  sx={{
                    mb: 1,
                    p: 1,
                    borderRadius: 1,
                    bgcolor: index % 2 === 0 ? alpha('#000', 0.02) : 'transparent',
                    border: '1px solid',
                    borderColor: alpha('#000', 0.08),
                  }}
                >
                  <Typography
                    variant="body2"
                    component="pre"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      margin: 0,
                      color: log.includes('[ERROR]') ? '#EF4444' :
                            log.includes('[WARNING]') ? '#F59E0B' :
                            log.includes('[INFO]') ? '#3B82F6' :
                            log.includes('[SUCCESS]') ? '#10B981' :
                            'text.primary',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                    }}
                  >
                    {log}
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Terminal sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                No logs available
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

export default MediaHubService;
