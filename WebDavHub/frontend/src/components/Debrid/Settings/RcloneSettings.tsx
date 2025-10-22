import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, TextField, Switch, FormControlLabel, Button, Alert, Snackbar, CircularProgress, Stack, Divider, IconButton, Tooltip, useTheme, useMediaQuery, alpha } from '@mui/material';
import { Storage, Settings, CheckCircle, Error, Refresh, Science, FolderOpen } from '@mui/icons-material';
import axios from 'axios';

interface RcloneConfig {
  enabled: boolean;
  mountPath: string;
  vfsCacheMode: string;
  vfsCacheMaxSize: string;
  vfsCacheMaxAge: string;
  bufferSize: string;
  dirCacheTime: string;
  pollInterval: string;
  rclonePath: string;
  vfsReadChunkSize: string;
  vfsReadChunkSizeLimit: string;
  streamBufferSize: string;
}

interface RcloneStatus {
  mounted: boolean;
  mountPath?: string;
  error?: string;
  processId?: number;
}

const RcloneSettings: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [config, setConfig] = useState<RcloneConfig>({
    enabled: false,
    mountPath: '',
    vfsCacheMode: 'writes',
    vfsCacheMaxSize: '1G',
    vfsCacheMaxAge: '24h',
    bufferSize: '16M',
    dirCacheTime: '5m',
    pollInterval: '1m',
    rclonePath: '',
    vfsReadChunkSize: '64M',
    vfsReadChunkSizeLimit: '128M',
    streamBufferSize: '1M',
  });
  const [status, setStatus] = useState<RcloneStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' | 'info' });
  const [mounting, setMounting] = useState(false);
  const [unmounting, setUnmounting] = useState(false);

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' | 'info' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/realdebrid/config');
      if (response.data.config.rcloneSettings) {
        setConfig(response.data.config.rcloneSettings);
      }
      if (response.data.status.rcloneStatus) {
        setStatus(response.data.status.rcloneStatus);
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
      const configToSave = Object.fromEntries(
        Object.entries(config).filter(([_, value]) => {
          // Keep boolean values and non-empty strings
          return typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
        })
      );
      
      const response = await axios.put('/api/realdebrid/config', {
        rcloneSettings: configToSave
      });
      if (response.data.config.rcloneSettings) {
        setConfig(response.data.config.rcloneSettings);
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

  const testRclone = async () => {
    setTesting(true);
    try {
      const response = await axios.post('/api/realdebrid/rclone/test', { rclonePath: config.rclonePath });
      if (response.data.success) {
        showMessage('Rclone test successful!', 'success');
      } else {
        showMessage(`Rclone test failed: ${response.data.error}`, 'error');
      }
    } catch (error) {
      console.error('Rclone test failed:', error);
      showMessage('Rclone test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const viewConfig = async () => {
    try {
      const response = await axios.get('/api/realdebrid/config');
      const configPath = response.data.configPath || 'Unknown';
      showMessage(`Rclone config location: ${configPath}`, 'info');
    } catch (error) {
      console.error('Failed to get config info:', error);
      showMessage('Failed to get config info', 'error');
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
    try {
      // Filter out empty string values to allow defaults to be applied
      const configToMount = Object.fromEntries(
        Object.entries(config).filter(([_, value]) => {
          // Keep boolean values and non-empty strings
          return typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '');
        })
      );
      
      const response = await axios.post('/api/realdebrid/rclone/mount', configToMount);
      if (response.data.success) {
        showMessage('Rclone mount started successfully', 'success');
        await loadConfig(); // Refresh status
      } else {
        showMessage(`Failed to mount: ${response.data.error}`, 'error');
      }
    } catch (error) {
      console.error('Mount failed:', error);
      showMessage('Failed to mount rclone', 'error');
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
        await loadConfig(); // Refresh status
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: { xs: 2, md: 4 } }}>
      {/* Header */}
      <Box sx={{ mb: { xs: 2, md: 3 } }}>
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
              borderColor: status.mounted ? 'success.main' : 'error.main',
              bgcolor: status.mounted ? alpha(theme.palette.success.main, 0.05) : alpha(theme.palette.error.main, 0.05),
            }}
          >
            <CardContent sx={{ py: { xs: 1.5, md: 2 }, '&:last-child': { pb: { xs: 1.5, md: 2 } } }}>
              <Stack direction="row" alignItems="flex-start" spacing={2}>
                {status.mounted ? (
                  <CheckCircle sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                ) : (
                  <Error sx={{ color: 'error.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600" sx={{ color: status.mounted ? 'success.main' : 'error.main' }}>
                    {status.mounted ? 'Mounted' : 'Not Mounted'}
                  </Typography>
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

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 3 } }}>
        {/* Main Configuration */}
        <Box>
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 2, md: 3 } }}>
                <Settings sx={{ color: 'primary.main', fontSize: { xs: 20, md: 24 } }} />
                <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">
                  Configuration
                </Typography>
              </Stack>

              <Stack spacing={{ xs: 2.5, md: 3 }}>
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

                    {/* Rclone Path (Windows) */}
                    {navigator.platform.toLowerCase().includes('win') && (
                      <Box>
                        <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                          Rclone Executable Path
                        </Typography>
                        <TextField
                          fullWidth
                          size={isMobile ? 'small' : 'medium'}
                          value={config.rclonePath}
                          onChange={(e) => handleConfigChange('rclonePath', e.target.value)}
                          placeholder="C:\Program Files\rclone\rclone.exe"
                          helperText="Path to rclone.exe (leave empty to use PATH)"
                          InputProps={{
                            endAdornment: (
                              <Stack direction="row" spacing={0.5}>
                                <Tooltip title="Test">
                                  <IconButton
                                    onClick={testRclone}
                                    disabled={testing}
                                    edge="end"
                                    size="small"
                                  >
                                    {testing ? <CircularProgress size={18} /> : <Science fontSize="small" />}
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="View Config Location">
                                  <IconButton
                                    onClick={viewConfig}
                                    edge="end"
                                    size="small"
                                  >
                                    <Settings fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Stack>
                            ),
                          }}
                        />
                      </Box>
                    )}

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
                      <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2 }}>
                        Advanced Settings
                      </Typography>
                      <Stack spacing={2}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              VFS Cache Mode
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.vfsCacheMode}
                              onChange={(e) => handleConfigChange('vfsCacheMode', e.target.value)}
                              placeholder="writes"
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
                              placeholder="1G"
                            />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
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
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          <Box>
                            <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                              Directory Cache Time
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.dirCacheTime}
                              onChange={(e) => handleConfigChange('dirCacheTime', e.target.value)}
                              placeholder="5m"
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
                              placeholder="1m"
                            />
                          </Box>
                        </Box>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
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
                            <Typography variant="body2" fontWeight="500" gutterBottom>
                              Stream Buffer Size
                            </Typography>
                            <TextField
                              fullWidth
                              size="small"
                              value={config.streamBufferSize}
                              onChange={(e) => handleConfigChange('streamBufferSize', e.target.value)}
                              placeholder="1M"
                              helperText="Buffer size for streaming (higher for 4K/remux)"
                            />
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
                          disabled={mounting || !config.mountPath || status?.mounted}
                          startIcon={mounting ? <CircularProgress size={20} /> : <FolderOpen />}
                          fullWidth={isMobile}
                        >
                          {mounting ? 'Mounting...' : 'Mount'}
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
              </Stack>

              {/* Action Buttons */}
              <Stack 
                direction={{ xs: 'column', sm: 'row' }} 
                spacing={{ xs: 1.5, sm: 2 }} 
                sx={{ mt: { xs: 3, md: 4 } }}
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
        </Box>

        {/* Information Panel */}
        <Box>
          <Stack spacing={{ xs: 2, md: 3 }}>
            {/* Windows Info */}
            {navigator.platform.toLowerCase().includes('win') && (
              <Card>
                <CardContent sx={{ p: { xs: 2, md: 3 } }}>
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

            {/* Mount Status */}
            {status && (
              <Card>
                <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                    <Storage sx={{ color: status.mounted ? 'success.main' : 'error.main', fontSize: { xs: 20, md: 24 } }} />
                    <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">Mount Status</Typography>
                  </Stack>
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Status
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }} color={status.mounted ? 'success.main' : 'error.main'}>
                        {status.mounted ? 'Mounted' : 'Not Mounted'}
                      </Typography>
                    </Box>
                    {status.mountPath && (
                      <Box>
                        <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Mount Path
                        </Typography>
                        <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.mountPath}</Typography>
                      </Box>
                    )}
                    {status.processId && (
                      <Box>
                        <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Process ID
                        </Typography>
                        <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.processId}</Typography>
                      </Box>
                    )}
                    {status.error && (
                      <Box>
                        <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Error
                        </Typography>
                        <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }} color="error.main">{status.error}</Typography>
                      </Box>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Box>
      </Box>

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