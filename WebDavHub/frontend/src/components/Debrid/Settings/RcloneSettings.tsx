import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, TextField, Switch, FormControlLabel, Button, Alert, Snackbar, CircularProgress, Stack, Divider, useTheme, useMediaQuery, alpha } from '@mui/material';
import { Storage, Settings, CheckCircle, Error, Refresh, Science, FolderOpen, MenuBook, ExpandMore, ExpandLess } from '@mui/icons-material';
import axios from 'axios';
import CineSyncMountGuide from './CineSyncMountGuide';

interface RcloneConfig {
  enabled: boolean;
  mountPath: string;
  vfsCacheMode: string;
  vfsCacheMaxSize: string;
  vfsCacheMaxAge: string;
  CachePath: string;
  bufferSize: string;
  dirCacheTime: string;
  pollInterval: string;
  vfsReadChunkSize: string;
  vfsReadChunkSizeLimit: string;
  streamBufferSize: string;
  serveFromRclone: boolean;
  retainFolderExtension: boolean;
  autoMountOnStart: boolean;
  attrTimeout: string;
  vfsReadAhead: string;
  vfsCachePollInterval: string;
  timeout: string;
  contimeout: string;
  lowLevelRetries: string;
  retries: string;
  transfers: string;
  vfsReadWait: string;
  vfsWriteWait: string;
  tpsLimit: string;
  tpsLimitBurst: string;
  driveChunkSize: string;
  maxReadAhead: string;
  logLevel: string;
  logFile: string;
}

interface RateLimitUI {
  requestsPerMinute: number;
  burst: number;
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

interface RcloneStatus {
  mounted: boolean;
  mountPath?: string;
  error?: string;
  processId?: number;
  waiting?: boolean;
  waitingReason?: string;
}

type RcloneSettingsProps = {
  stackInfoOnTop?: boolean;
};

const RcloneSettings: React.FC<RcloneSettingsProps> = ({ stackInfoOnTop = false }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [config, setConfig] = useState<RcloneConfig>({
    enabled: false,
    mountPath: '',
    vfsCacheMode: 'full',
    vfsCacheMaxSize: '100G',
    vfsCacheMaxAge: '24h',
    CachePath: '',
    bufferSize: '16M',
    dirCacheTime: '15s',
    pollInterval: '15s',
    vfsReadChunkSize: '64M',
    vfsReadChunkSizeLimit: '128M',
    streamBufferSize: '10M',
    serveFromRclone: false,
    retainFolderExtension: false,
    autoMountOnStart: false,
    attrTimeout: '1s',
    vfsReadAhead: '128M',
    vfsCachePollInterval: '30s',
    timeout: '10m',
    contimeout: '60s',
    lowLevelRetries: '3',
    retries: '3',
    transfers: '4',
    vfsReadWait: '20ms',
    vfsWriteWait: '1s',
    tpsLimit: '10',
    tpsLimitBurst: '20',
    driveChunkSize: '64M',
    maxReadAhead: '256M',
    logLevel: '',
    logFile: '',
  });
  const [status, setStatus] = useState<RcloneStatus | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitUI>({
    requestsPerMinute: 220,
    burst: 50,
    maxRetries: 5,
    baseBackoffMs: 500,
    maxBackoffMs: 8000,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const [mounting, setMounting] = useState(false);
  const [unmounting, setUnmounting] = useState(false);
  const [serverOS, setServerOS] = useState<string>('');
  const [isPolling, setIsPolling] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/realdebrid/config');
      if (response.data.config.rcloneSettings) {
        const rcloneSettings = response.data.config.rcloneSettings;
        setConfig(rcloneSettings);
      }
      if (response.data.status.rcloneStatus) {
        setStatus(response.data.status.rcloneStatus);
      }
      if (response.data.config?.rateLimit) {
        setRateLimit({
          requestsPerMinute: response.data.config.rateLimit.requestsPerMinute ?? 220,
          burst: response.data.config.rateLimit.burst ?? 50,
          maxRetries: response.data.config.rateLimit.maxRetries ?? 5,
          baseBackoffMs: response.data.config.rateLimit.baseBackoffMs ?? 500,
          maxBackoffMs: response.data.config.rateLimit.maxBackoffMs ?? 8000,
        });
      }
      if (response.data.serverInfo?.os) {
        setServerOS(response.data.serverInfo.os);
      }
    } catch (error) {
      console.error('Failed to load Rclone config:', error);
      showMessage('Failed to load configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      // Filter out empty string values to allow defaults to be applied
      const filteredConfig = Object.fromEntries(
        Object.entries(config).filter(([_, value]) => {
          // Keep boolean values and non-empty strings
          return typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
        })
      );
      
      const response = await axios.put('/api/realdebrid/config', {
        rcloneSettings: filteredConfig,
        rateLimit: {
          requestsPerMinute: rateLimit.requestsPerMinute,
          burst: rateLimit.burst,
          maxRetries: rateLimit.maxRetries,
          baseBackoffMs: rateLimit.baseBackoffMs,
          maxBackoffMs: rateLimit.maxBackoffMs,
        },
      });
      if (response.data.config.rcloneSettings) {
        const rcloneSettings = response.data.config.rcloneSettings;
        setConfig(rcloneSettings);
      }
      if (response.data.status.rcloneStatus) {
        setStatus(response.data.status.rcloneStatus);
      }
      showMessage('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save Rclone config:', error);
      showMessage('Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleConfigChange = (field: keyof RcloneConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const mountRclone = async () => {
    if (!config.mountPath) {
      showMessage('Please specify a mount path', 'warning');
      return;
    }

    setMounting(true);
    setIsPolling(true);
    try {
      const configToSave = Object.fromEntries(
        Object.entries(config).filter(([_, value]) => {
          // Keep boolean values and non-empty strings
          return typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
        })
      );
      
      await axios.put('/api/realdebrid/config', {
        rcloneSettings: configToSave,
        rateLimit: {
          requestsPerMinute: rateLimit.requestsPerMinute,
          burst: rateLimit.burst,
          maxRetries: rateLimit.maxRetries,
          baseBackoffMs: rateLimit.baseBackoffMs,
          maxBackoffMs: rateLimit.maxBackoffMs,
        },
      });

      const response = await axios.post('/api/realdebrid/rclone/mount', configToSave);
      if (response.data.success) {
        if (response.data.status?.waiting) {
          showMessage('Configuration saved and mount is waiting for torrents to load...', 'info');
        } else {
          showMessage('Configuration saved and rclone mount started successfully', 'success');
        }
        if (response.data.status) {
          setStatus(response.data.status);
        }
      } else {
        showMessage(`Failed to mount: ${response.data.error}`, 'error');
        setIsPolling(false);
      }
    } catch (error) {
      console.error('Mount failed:', error);
      showMessage('Failed to mount rclone', 'error');
      setIsPolling(false);
    } finally {
      setMounting(false);
    }
  };

  const unmountRclone = async () => {
    setUnmounting(true);
    try {
      const response = await axios.post('/api/realdebrid/rclone/unmount', {
        path: config.mountPath
      });
      if (response.data.success) {
        showMessage('Rclone unmounted successfully', 'success');
        // Update status directly instead of reloading entire config
        if (response.data.status) {
          setStatus(response.data.status);
        }
      } else {
        showMessage(`Failed to unmount: ${response.data.error}`, 'error');
      }
    } catch (error) {
      console.error('Unmount failed:', error);
      showMessage('Failed to unmount rclone', 'error');
    } finally {
      setUnmounting(false);
    }
  };

  const resetConfig = async () => {
    if (window.confirm('Are you sure you want to reset the Rclone configuration?')) {
      try {
        await axios.delete('/api/realdebrid/config');
        await loadConfig();
        showMessage('Configuration reset successfully');
      } catch (error) {
        console.error('Failed to reset config:', error);
        showMessage('Failed to reset configuration', 'error');
      }
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  // Poll for status updates when waiting or mounting
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isPolling || status?.waiting) {
      interval = setInterval(async () => {
        try {
          const response = await axios.get(`/api/realdebrid/rclone/status?path=${encodeURIComponent(config.mountPath)}`);
          if (response.data.status) {
            const newStatus = response.data.status;
            setStatus(prevStatus => {
              if (!prevStatus || 
                  prevStatus.mounted !== newStatus.mounted ||
                  prevStatus.waiting !== newStatus.waiting ||
                  prevStatus.error !== newStatus.error ||
                  prevStatus.processId !== newStatus.processId) {
                return newStatus;
              }
              return prevStatus;
            });
          }
        } catch (error) {
          console.error('Failed to fetch status:', error);
        }
      }, 2000);
    }
    
    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isPolling, status?.waiting]);

  useEffect(() => {
    if (status?.mounted && isPolling) {
      setIsPolling(false);
      showMessage('Mount completed successfully!', 'success');
    }
  }, [status?.mounted, isPolling]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  const header = (
      <Box sx={{ mb: { xs: 1.5, md: 3 } }}>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
          <Box
            sx={{
              width: { xs: 40, md: 48 },
              height: { xs: 40, md: 48 },
              borderRadius: 2,
              background: 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
            }}
          >
            <Storage sx={{ fontSize: { xs: 24, md: 28 } }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant={isMobile ? 'h5' : 'h4'} fontWeight="600" sx={{ color: 'text.primary' }}>
              Rclone Mount
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              Mount Real-Debrid as a local filesystem using rclone
            </Typography>
          </Box>
        </Stack>

        {/* Status Card */}
        {status && (
          <Card
            sx={{
              mb: { xs: 2, md: 3 },
              border: '1px solid',
              borderColor: status.waiting || (isPolling && !status?.mounted) ? 'warning.main' : status.mounted ? 'success.main' : 'error.main',
              bgcolor: status.waiting || (isPolling && !status?.mounted) ? alpha(theme.palette.warning.main, 0.05) : status.mounted ? alpha(theme.palette.success.main, 0.05) : alpha(theme.palette.error.main, 0.05),
            }}
          >
            <CardContent sx={{ py: { xs: 1, md: 2 }, '&:last-child': { pb: { xs: 1, md: 2 } } }}>
              <Stack direction="row" alignItems="flex-start" spacing={2}>
                {status.waiting || (isPolling && !status?.mounted) ? (
                  <CircularProgress size={24} sx={{ mt: 0.5 }} />
                ) : status.mounted ? (
                  <CheckCircle sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                ) : (
                  <Error sx={{ color: 'error.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600" sx={{ color: status.waiting || (isPolling && !status?.mounted) ? 'warning.main' : status.mounted ? 'success.main' : 'error.main' }}>
                    {status.waiting ? 'Waiting for Torrents' : isPolling && !status?.mounted ? 'Mounting...' : status.mounted ? 'Mounted' : 'Not Mounted'}
                  </Typography>
                  {(status.waitingReason || (isPolling && !status?.mounted)) && (
                    <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>
                      {status.waitingReason || 'Mounting in progress...'}
                    </Typography>
                  )}
                  {status.mountPath && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Mount Path: {status.mountPath}
                    </Typography>
                  )}
                  {status.processId && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      Process ID: {status.processId}
                    </Typography>
                  )}
                  {status.error && (
                    <Typography variant="body2" color="error.main" sx={{ mt: 0.5 }}>
                      Error: {status.error}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Box>
  );

  const infoPanel = (
    <Box>
      <Stack spacing={{ xs: 1.5, md: 3 }}>
        {/* Windows Info */}
        {navigator.platform.toLowerCase().includes('win') && (
          <Card>
            <CardContent sx={{ p: { xs: 1.5, md: 3 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                <Science sx={{ color: 'info.main', fontSize: { xs: 20, md: 24 } }} />
                <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">Windows Requirements</Typography>
              </Stack>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>
                    <strong>WinFsp Required:</strong> Install WinFsp from <a href="https://github.com/winfsp/winfsp/releases" target="_blank" rel="noopener noreferrer">GitHub</a> to enable FUSE filesystem support.
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>
                    <strong>Mount Paths:</strong> Use drive letters (Z:\) or full paths (C:\mounts\realdebrid). Avoid using existing directories.
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>
                    <strong>Administrator:</strong> Running as administrator may be required for some mount operations.
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );

  const bodyWithGrid = (
    <Box
      sx={{
        display: 'grid',
        gap: { xs: 1.5, md: 3 },
        gridTemplateColumns: stackInfoOnTop ? '1fr' : { xs: '1fr', md: '2fr 1fr' },
        gridTemplateAreas: stackInfoOnTop
          ? `"info" "main"`
          : { xs: `"main" "info"`, md: `"main info"` },
      }}
    >
        {/* Main Configuration */}
      <Box sx={{ width: '100%', maxWidth: '100%', overflow: 'hidden', gridArea: 'main' }}>
          <Card sx={{ width: '100%', maxWidth: '100%' }}>
            <CardContent sx={{ p: { xs: 1.5, md: 3 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 3 } }}>
                <Settings sx={{ color: 'primary.main', fontSize: { xs: 20, md: 24 } }} />
                <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">
                  Configuration
                </Typography>
              </Stack>

              <Stack spacing={{ xs: 1.5, md: 3 }}>
                {/* Enable Rclone */}
                <FormControlLabel
                  control={
                    <Switch
                      checked={config.enabled}
                      onChange={(e) => handleConfigChange('enabled', e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body1" fontWeight="500">
                        Enable Rclone Mount
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                        Mount Real-Debrid as a local filesystem using rclone
                      </Typography>
                    </Box>
                  }
                />

                {config.enabled && (
                  <>
                    <Divider />

                    {/* Auto-mount on start */}
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.autoMountOnStart}
                          onChange={(e) => handleConfigChange('autoMountOnStart', e.target.checked)}
                          color="primary"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body1" fontWeight="500">
                            Auto-mount on application start
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                            Automatically mount rclone at startup when enabled and configured
                          </Typography>
                        </Box>
                      }
                    />

                    {/* Mount Path */}
                    <Box>
                      <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                        Mount Path
                      </Typography>
                      <TextField
                        fullWidth
                        size={isMobile ? 'small' : 'medium'}
                        value={config.mountPath}
                        onChange={(e) => handleConfigChange('mountPath', e.target.value)}
                        placeholder={navigator.platform.toLowerCase().includes('win') ? "Z:\\ or C:\\mounts\\realdebrid" : "/mnt/realdebrid"}
                        helperText={
                          navigator.platform.toLowerCase().includes('win') 
                            ? "Windows: Use drive letter (Z:\\) or full path (C:\\mounts\\realdebrid). Ensure WinFsp is installed."
                            : "Local directory where Real-Debrid will be mounted"
                        }
                      />
                    </Box>

                    {/* Remote Name removed: backend enforces 'CineSync' */}

                    {/* Advanced Settings */}
                    <Box>
                      <Typography variant="subtitle2" fontWeight="600" sx={{ mb: { xs: 1.5, md: 2 } }}>
                        Advanced Settings
                      </Typography>
                      <Stack spacing={{ xs: 1.5, md: 2 }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              VFS Cache Mode
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.vfsCacheMode}
                              onChange={(e) => handleConfigChange('vfsCacheMode', e.target.value)}
                              placeholder="full"
                            />
                          </Box>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Cache Max Size
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.vfsCacheMaxSize}
                              onChange={(e) => handleConfigChange('vfsCacheMaxSize', e.target.value)}
                              placeholder="100G"
                            />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Cache Max Age
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.vfsCacheMaxAge}
                              onChange={(e) => handleConfigChange('vfsCacheMaxAge', e.target.value)}
                              placeholder="24h"
                            />
                          </Box>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Buffer Size
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.bufferSize}
                              onChange={(e) => handleConfigChange('bufferSize', e.target.value)}
                              placeholder="16M"
                            />
                          </Box>
                        </Box>
                        {/*Cache Path */}
                        <Box>
                          <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                            Cache Directory (Optional)
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            value={config.CachePath}
                            onChange={(e) => handleConfigChange('CachePath', e.target.value)}
                            placeholder={navigator.platform.toLowerCase().includes('win') ? "C:\\temp\\rclone-cache" : "/tmp/rclone-cache"}
                            helperText="Custom directory for VFS cache files. Leave empty to use default location."
                          />
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Directory Cache Time
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.dirCacheTime}
                              onChange={(e) => handleConfigChange('dirCacheTime', e.target.value)}
                              placeholder="15s"
                            />
                          </Box>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Poll Interval
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.pollInterval}
                              onChange={(e) => handleConfigChange('pollInterval', e.target.value)}
                              placeholder="15s"
                            />
                          </Box>
                        </Box>
                        <Box sx={{ mt: { xs: 1.5, md: 2 } }}>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Attribute Timeout
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.attrTimeout}
                                onChange={(e) => handleConfigChange('attrTimeout', e.target.value)}
                                placeholder="1s"
                                helperText="File attribute cache duration"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Read Ahead
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsReadAhead}
                                onChange={(e) => handleConfigChange('vfsReadAhead', e.target.value)}
                                placeholder="128M"
                                helperText="Pre-fetch data for smoother streaming"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Cache Poll Interval
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsCachePollInterval}
                                onChange={(e) => handleConfigChange('vfsCachePollInterval', e.target.value)}
                                placeholder="30s"
                                helperText="Cache polling frequency"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Transfers
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.transfers}
                                onChange={(e) => handleConfigChange('transfers', e.target.value)}
                                placeholder="4"
                                helperText="Concurrent transfer limit"
                              />
                            </Box>
                          </Box>
                        </Box>

                        {/* VFS & Compatibility Settings */}
                        <Box sx={{ mt: { xs: 1.5, md: 2 } }}>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Read Wait
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsReadWait}
                                onChange={(e) => handleConfigChange('vfsReadWait', e.target.value)}
                                placeholder="20ms"
                                helperText="Wait time for sequential reads (helps ffprobe)"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Write Wait
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsWriteWait}
                                onChange={(e) => handleConfigChange('vfsWriteWait', e.target.value)}
                                placeholder="1s"
                                helperText="Wait time for in-sequence writes"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                TPS Limit
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.tpsLimit}
                                onChange={(e) => handleConfigChange('tpsLimit', e.target.value)}
                                placeholder="10"
                                helperText="Transactions per second to RD API"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                TPS Limit Burst
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.tpsLimitBurst}
                                onChange={(e) => handleConfigChange('tpsLimitBurst', e.target.value)}
                                placeholder="20"
                                helperText="Allow bursts for initial requests"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Drive Chunk Size
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.driveChunkSize}
                                onChange={(e) => handleConfigChange('driveChunkSize', e.target.value)}
                                placeholder="64M"
                                helperText="Chunk size for reading (optimized for video)"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Max Read Ahead
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.maxReadAhead}
                                onChange={(e) => handleConfigChange('maxReadAhead', e.target.value)}
                                placeholder="256M"
                                helperText="Maximum data to read ahead"
                              />
                            </Box>
                          </Box>
                        </Box>

                        {/* Logging */}
                        <Box sx={{ mt: { xs: 1.5, md: 2 } }}>
                          <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1.5, color: 'primary.main' }}>
                            Logging
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Log Level
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.logLevel}
                                onChange={(e) => handleConfigChange('logLevel', e.target.value)}
                                placeholder="INFO"
                                helperText="rclone --log-level (e.g., DEBUG, INFO, NOTICE, ERROR)"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Log File
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.logFile}
                                onChange={(e) => handleConfigChange('logFile', e.target.value)}
                                placeholder={navigator.platform.toLowerCase().includes('win') ? "C:\\path\\to\\rclone.log" : "/var/log/rclone.log"}
                                helperText="Absolute path to write rclone logs"
                              />
                            </Box>
                          </Box>
                        </Box>

                        {/* Network & Retry Settings */}
                        <Box sx={{ mt: { xs: 1.5, md: 2 } }}>
                          <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1.5, color: 'primary.main' }}>
                            Network & Retry Settings
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Timeout
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.timeout}
                                onChange={(e) => handleConfigChange('timeout', e.target.value)}
                                placeholder="10m"
                                helperText="Overall operation timeout"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Connection Timeout
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.contimeout}
                                onChange={(e) => handleConfigChange('contimeout', e.target.value)}
                                placeholder="60s"
                                helperText="Connection establishment timeout"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Low-Level Retries
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.lowLevelRetries}
                                onChange={(e) => handleConfigChange('lowLevelRetries', e.target.value)}
                                placeholder="3"
                                helperText="Low-level retry attempts"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Retries
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.retries}
                                onChange={(e) => handleConfigChange('retries', e.target.value)}
                                placeholder="3"
                                helperText="High-level retry attempts"
                              />
                            </Box>
                          </Box>
                        </Box>

                        {/* Streaming Settings */}
                        <Box sx={{ mt: { xs: 1.5, md: 2 } }}>
                          <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1.5, color: 'primary.main' }}>
                            Streaming Settings
                          </Typography>
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: { xs: 1.5, md: 2 } }}>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Read Chunk Size
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsReadChunkSize}
                                onChange={(e) => handleConfigChange('vfsReadChunkSize', e.target.value)}
                                placeholder="64M"
                                helperText="Chunk size for streaming"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                VFS Read Chunk Size Limit
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.vfsReadChunkSizeLimit}
                                onChange={(e) => handleConfigChange('vfsReadChunkSizeLimit', e.target.value)}
                                placeholder="128M"
                                helperText="Max chunk size limit"
                              />
                            </Box>
                            <Box>
                              <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                                Stream Buffer Size
                              </Typography>
                              <TextField
                                fullWidth
                                size="small"
                                value={config.streamBufferSize}
                                onChange={(e) => handleConfigChange('streamBufferSize', e.target.value)}
                                placeholder="10M"
                                helperText="Buffer size for streaming (higher for 4K/remux)"
                              />
                            </Box>
                          </Box>
                        </Box>
                      </Stack>
                    </Box>

                    {/* Mount Controls */}
                    <Box>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                        <Button
                          variant="contained"
                          onClick={mountRclone}
                          disabled={mounting || !config.mountPath || status?.mounted || status?.waiting || isPolling}
                          startIcon={mounting || isPolling ? <CircularProgress size={20} /> : <FolderOpen />}
                          fullWidth={isMobile}
                        >
                          {mounting ? 'Mounting...' : status?.waiting ? 'Waiting for Torrents...' : isPolling ? 'Mounting...' : 'Mount'}
                        </Button>
                        <Button
                          variant="outlined"
                          color="error"
                          onClick={unmountRclone}
                          disabled={unmounting || !status?.mounted}
                          startIcon={unmounting ? <CircularProgress size={20} /> : <Storage />}
                          fullWidth={isMobile}
                        >
                          {unmounting ? 'Unmounting...' : 'Unmount'}
                        </Button>
                      </Stack>
                    </Box>
                  </>
                )}

                <Divider />

                {/* Serve From Rclone Toggle */}
                <Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.serveFromRclone}
                        onChange={(e) => handleConfigChange('serveFromRclone', e.target.checked)}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body1" fontWeight="500">
                          Serve From Rclone Mount
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                          Files served through rclone mount filesystem (uses VFS cache)
                        </Typography>
                      </Box>
                    }
                  />
                  {/* Current Mode Indicator */}
                  <Alert
                    severity={config.serveFromRclone ? "info" : "success"}
                    sx={{ mt: 1, py: 0.5 }}
                    icon={config.serveFromRclone ? <Storage fontSize="small" /> : <CheckCircle fontSize="small" />}
                  >
                    <Typography variant="body2" fontWeight="500">
                      {config.serveFromRclone
                        ? '🔄 Active Mode: Serving from Rclone Mount (VFS cache)'
                        : '⚡ Active Mode: Direct streaming from cached RD links (Recommended)'}
                    </Typography>
                  </Alert>
                </Box>

                <Divider sx={{ my: { xs: 1.5, md: 2 } }} />

                {/* API Rate Limiting */}
                <Box>
                  <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2 }}>
                    API Rate Limiting
                  </Typography>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        type="number"
                        label="Requests per Minute"
                        size={isMobile ? 'small' : 'medium'}
                        value={rateLimit.requestsPerMinute}
                        onChange={(e) => setRateLimit(prev => ({ ...prev, requestsPerMinute: Number(e.target.value) || 0 }))}
                        helperText="Max sustained request rate (<= 250)"
                      />
                      <TextField
                        type="number"
                        label="Burst"
                        size={isMobile ? 'small' : 'medium'}
                        value={rateLimit.burst}
                        onChange={(e) => setRateLimit(prev => ({ ...prev, burst: Number(e.target.value) || 0 }))}
                        helperText="Short spikes allowed"
                      />
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                      <TextField
                        type="number"
                        label="Max Retries (429)"
                        size={isMobile ? 'small' : 'medium'}
                        value={rateLimit.maxRetries}
                        onChange={(e) => setRateLimit(prev => ({ ...prev, maxRetries: Number(e.target.value) || 0 }))}
                      />
                      <TextField
                        type="number"
                        label="Base Backoff (ms)"
                        size={isMobile ? 'small' : 'medium'}
                        value={rateLimit.baseBackoffMs}
                        onChange={(e) => setRateLimit(prev => ({ ...prev, baseBackoffMs: Number(e.target.value) || 0 }))}
                      />
                      <TextField
                        type="number"
                        label="Max Backoff (ms)"
                        size={isMobile ? 'small' : 'medium'}
                        value={rateLimit.maxBackoffMs}
                        onChange={(e) => setRateLimit(prev => ({ ...prev, maxBackoffMs: Number(e.target.value) || 0 }))}
                      />
                    </Stack>
                  </Stack>
                </Box>

                <Divider />

                {/* Retain Folder Extension Toggle */}
                <Box>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.retainFolderExtension}
                        onChange={(e) => handleConfigChange('retainFolderExtension', e.target.checked)}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body1" fontWeight="500">
                          Retain Folder Extensions
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                          Keep file extensions in mounted directory names (e.g., "Movie.mkv/" instead of "Movie/")
                        </Typography>
                      </Box>
                    }
                  />
                  <Alert
                    severity="info"
                    sx={{ mt: 1, py: 0.5 }}
                  >
                    <Typography variant="body2" fontWeight="500">
                      {config.retainFolderExtension
                        ? '📁 Directories will be named: "Movie.mkv/", "Archive.zip/"'
                        : '📂 Directories will be named: "Movie/", "Archive/" (Recommended)'}
                    </Typography>
                  </Alert>
                </Box>
              </Stack>

              {/* Action Buttons */}
              <Stack 
                direction={{ xs: 'column', sm: 'row' }} 
                spacing={{ xs: 1.5, sm: 2 }} 
                sx={{ mt: { xs: 2, md: 4 } }}
              >
                <Button
                  variant="contained"
                  onClick={saveConfig}
                  disabled={saving}
                  fullWidth={isMobile}
                  size={isMobile ? 'medium' : 'large'}
                  startIcon={saving ? <CircularProgress size={20} /> : <Settings />}
                >
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={loadConfig}
                  fullWidth={isMobile}
                  size={isMobile ? 'medium' : 'large'}
                  startIcon={<Refresh />}
                >
                  Refresh
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={resetConfig}
                  fullWidth={isMobile}
                  size={isMobile ? 'medium' : 'large'}
                >
                  Reset
                </Button>
              </Stack>
            </CardContent>
          </Card>

          {/* Optional CineSync Mount Guide - Show below when mount is disabled */}
          {!config.enabled && (
            <Card sx={{ mt: { xs: 1.5, md: 3 }, width: '100%', maxWidth: '100%' }}>
              <CardContent sx={{ p: { xs: 1.5, md: 3 }, width: '100%', maxWidth: '100%' }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                  <MenuBook sx={{ color: 'secondary.main', fontSize: { xs: 20, md: 24 } }} />
                  <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">
                    Manual Mount Guide (Optional)
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={showGuide ? <ExpandLess /> : <ExpandMore />}
                    onClick={() => setShowGuide(prev => !prev)}
                    sx={{ ml: 'auto' }}
                  >
                    {showGuide ? 'Hide' : 'View'}
                  </Button>
                </Stack>

                <CineSyncMountGuide
                  config={{
                    mountPath: config.mountPath,
                    vfsCacheMode: config.vfsCacheMode,
                    vfsCacheMaxSize: config.vfsCacheMaxSize,
                    vfsReadAhead: config.vfsReadAhead,
                    bufferSize: config.bufferSize,
                    CachePath: config.CachePath,
                    logLevel: config.logLevel,
                    logFile: config.logFile,
                  }}
                  serverOS={serverOS}
                  showGuide={showGuide}
                />
              </CardContent>
            </Card>
          )}
        </Box>

        {/* Information Panel */}
      <Box sx={{ gridArea: 'info' }}>{infoPanel}</Box>
                    </Box>
  );

  return (
    <Box sx={{ pb: { xs: 2, md: 4 }, width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {header}
      {bodyWithGrid}

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RcloneSettings;
