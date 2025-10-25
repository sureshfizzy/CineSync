import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, TextField, Switch, FormControlLabel, Button, Alert, Snackbar, CircularProgress, Chip, Stack, Divider, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, useTheme, useMediaQuery, alpha } from '@mui/material';
import { CloudDownload, Settings, CheckCircle, Error, Refresh, Visibility, VisibilityOff, Science, Speed } from '@mui/icons-material';
import axios from 'axios';

interface RealDebridConfig {
  enabled: boolean;
  apiKey: string;
  httpDavSettings: {
    enabled: boolean;
    userId: string;
    password: string;
  };
}

interface RealDebridStatus {
  enabled: boolean;
  apiKeySet: boolean;
  valid: boolean;
  errors: string[];
  apiStatus?: {
    valid: boolean;
    username?: string;
    email?: string;
    points?: number;
    type?: string;
    expiration?: string;
    error?: string;
  };
  httpDavStatus?: {
    enabled: boolean;
    userIdSet: boolean;
    passwordSet: boolean;
    baseUrl: string;
    connected: boolean;
    connectionError?: string;
  };
}

const RealDebridSettings: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [config, setConfig] = useState<RealDebridConfig>({
    enabled: false,
    apiKey: '',
    httpDavSettings: {
      enabled: false,
      userId: '',
      password: '',
    },
  });
  const [status, setStatus] = useState<RealDebridStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingHttpDav, setTestingHttpDav] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showHttpDavPassword, setShowHttpDavPassword] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' });
  const [testDialog, setTestDialog] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/realdebrid/config');
      setConfig(response.data.config);
      setStatus(response.data.status);
    } catch (error) {
      console.error('Failed to load Real-Debrid config:', error);
      showMessage('Failed to load configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const response = await axios.put('/api/realdebrid/config', config);
      setConfig(response.data.config);
      setStatus(response.data.status);
      showMessage('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save Real-Debrid config:', error);
      showMessage('Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!config.apiKey) {
      showMessage('Please enter an API key first', 'warning');
      return;
    }

    setTesting(true);
    try {
      const response = await axios.post('/api/realdebrid/test', { apiKey: config.apiKey });
      setTestResult(response.data);
      setTestDialog(true);
      if (response.data.success) {
        showMessage('Connection test successful!', 'success');
      } else {
        showMessage('Connection test failed', 'error');
      }
    } catch (error) {
      console.error('Connection test failed:', error);
      setTestResult({ success: false, error: 'Connection test failed' });
      setTestDialog(true);
      showMessage('Connection test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const testHttpDavConnection = async () => {
    if (!config.httpDavSettings.userId || !config.httpDavSettings.password) {
      showMessage('Please enter User ID and Password first', 'warning');
      return;
    }

    setTestingHttpDav(true);
    try {
      const response = await axios.post('/api/realdebrid/httpdav/test', {
        userId: config.httpDavSettings.userId,
        password: config.httpDavSettings.password,
      });
      setTestResult(response.data);
      setTestDialog(true);
      if (response.data.success) {
        showMessage('HTTP DAV connection test successful!', 'success');
      } else {
        showMessage('HTTP DAV connection test failed', 'error');
      }
    } catch (error) {
      console.error('HTTP DAV connection test failed:', error);
      setTestResult({ success: false, error: 'HTTP DAV connection test failed' });
      setTestDialog(true);
      showMessage('HTTP DAV connection test failed', 'error');
    } finally {
      setTestingHttpDav(false);
    }
  };

  const handleConfigChange = (field: keyof RealDebridConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const resetConfig = async () => {
    if (window.confirm('Are you sure you want to reset the Real-Debrid configuration?')) {
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
              background: 'linear-gradient(135deg, #ff6b35 0%, #f7931e 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
            }}
          >
            <CloudDownload sx={{ fontSize: { xs: 24, md: 28 } }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant={isMobile ? 'h5' : 'h4'} fontWeight="600" sx={{ color: 'text.primary' }}>
              Real-Debrid
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
              Configure Real-Debrid API access for media management
            </Typography>
          </Box>
        </Stack>

        {/* Status Card */}
        {status && (
          <Card
            sx={{
              mb: { xs: 2, md: 3 },
              border: '1px solid',
              borderColor: status.valid ? 'success.main' : 'error.main',
              bgcolor: status.valid ? alpha(theme.palette.success.main, 0.05) : alpha(theme.palette.error.main, 0.05),
            }}
          >
            <CardContent sx={{ py: { xs: 1.5, md: 2 }, '&:last-child': { pb: { xs: 1.5, md: 2 } } }}>
              <Stack direction="row" alignItems="flex-start" spacing={2}>
                {status.valid ? (
                  <CheckCircle sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                ) : (
                  <Error sx={{ color: 'error.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600" sx={{ color: status.valid ? 'success.main' : 'error.main' }}>
                    {status.valid ? 'Connected' : 'Configuration Issues'}
                  </Typography>
                  {status.apiStatus && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                      {status.apiStatus.valid ? (
                        `${status.apiStatus.username} (${status.apiStatus.type})`
                      ) : (
                        status.apiStatus.error
                      )}
                    </Typography>
                  )}
                  {Array.isArray(status.errors) && status.errors.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(status.errors || []).map((error, index) => (
                        <Chip
                          key={index}
                          label={error}
                          size="small"
                          color="error"
                          variant="outlined"
                        />
                      ))}
                    </Box>
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
                {/* Enable Real-Debrid */}
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
                        Enable Real-Debrid
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                        Enable API access to your Real-Debrid account
                      </Typography>
                    </Box>
                  }
                />

                <Divider />

                {/* API Key */}
                <Box>
                  <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 1 }}>
                    API Key
                  </Typography>
                  <TextField
                    fullWidth
                    size={isMobile ? 'small' : 'medium'}
                    type={showApiKey ? 'text' : 'password'}
                    value={config.apiKey}
                    onChange={(e) => handleConfigChange('apiKey', e.target.value)}
                    placeholder="Enter your Real-Debrid API key"
                    InputProps={{
                      endAdornment: (
                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title={showApiKey ? 'Hide' : 'Show'}>
                            <IconButton
                              onClick={() => setShowApiKey(!showApiKey)}
                              edge="end"
                              size="small"
                            >
                              {showApiKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Test">
                            <IconButton
                              onClick={testConnection}
                              disabled={testing || !config.apiKey}
                              edge="end"
                              size="small"
                            >
                              {testing ? <CircularProgress size={18} /> : <Science fontSize="small" />}
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      ),
                    }}
                    helperText="Get your API key from Real-Debrid settings"
                  />
                </Box>

                <Divider />

                {/* HTTP DAV Settings */}
                <Box>
                  <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2 }}>
                    HTTP DAV Virtual Mount
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                    Configure Real-Debrid HTTP DAV access for virtual filesystem
                  </Typography>
                  
                  <FormControlLabel
                    control={
                      <Switch
                        checked={config.httpDavSettings.enabled}
                        onChange={(e) => handleConfigChange('httpDavSettings', {
                          ...config.httpDavSettings,
                          enabled: e.target.checked
                        })}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" fontWeight="500">
                          Enable HTTP DAV Virtual Mount
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Browser-based virtual filesystem using HTTP DAV protocol
                        </Typography>
                      </Box>
                    }
                    sx={{ mb: 2 }}
                  />
                  
                  {config.httpDavSettings.enabled && (
                    <Stack spacing={2}>
                      <TextField
                        fullWidth
                        size={isMobile ? 'small' : 'medium'}
                        label="User ID"
                        value={config.httpDavSettings.userId}
                        onChange={(e) => handleConfigChange('httpDavSettings', {
                          ...config.httpDavSettings,
                          userId: e.target.value
                        })}
                        placeholder="Enter your HTTP DAV User ID (e.g., goa)"
                        helperText="Get your HTTP DAV credentials from Real-Debrid settings"
                      />
                      
                      <TextField
                        fullWidth
                        size={isMobile ? 'small' : 'medium'}
                        type={showHttpDavPassword ? 'text' : 'password'}
                        label="Password"
                        value={config.httpDavSettings.password}
                        onChange={(e) => handleConfigChange('httpDavSettings', {
                          ...config.httpDavSettings,
                          password: e.target.value
                        })}
                        placeholder="Enter your HTTP DAV Password"
                        InputProps={{
                          endAdornment: (
                            <Stack direction="row" spacing={0.5}>
                              <Tooltip title={showHttpDavPassword ? 'Hide' : 'Show'}>
                                <IconButton
                                  onClick={() => setShowHttpDavPassword(!showHttpDavPassword)}
                                  edge="end"
                                  size="small"
                                >
                                  {showHttpDavPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Test HTTP DAV Connection">
                                <IconButton
                                  onClick={testHttpDavConnection}
                                  disabled={testingHttpDav || !config.httpDavSettings.userId || !config.httpDavSettings.password}
                                  edge="end"
                                  size="small"
                                >
                                  {testingHttpDav ? <CircularProgress size={18} /> : <Science fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          ),
                        }}
                      />
                    </Stack>
                  )}
                </Box>

                {/* WebDAV Path removed per spec */}

                {/* Auto Connect - removed (always enabled on server) */}
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

        {/* Information Panel (Account only) */}
        <Box>
          <Stack spacing={{ xs: 2, md: 3 }}>

            {/* Account Status */}
            {status?.apiStatus && (
              <Card>
                <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                    <Speed sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 } }} />
                    <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">Account</Typography>
                  </Stack>
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Username
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.apiStatus.username || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Type
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.apiStatus.type || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Points
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.apiStatus.points?.toLocaleString() || 'N/A'}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Expires
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>{status.apiStatus.expiration || 'N/A'}</Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            )}

            {/* HTTP DAV Status */}
            {status?.httpDavStatus && (
              <Card>
                <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                  <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                    <CloudDownload sx={{ 
                      color: status.httpDavStatus.connected ? 'success.main' : 'error.main', 
                      fontSize: { xs: 20, md: 24 } 
                    }} />
                    <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">HTTP DAV</Typography>
                  </Stack>
                  <Stack spacing={1.5}>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Status
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }} 
                        color={status.httpDavStatus.connected ? 'success.main' : 'error.main'}>
                        {status.httpDavStatus.connected ? 'Connected' : 'Disconnected'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Credentials
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }}>
                        {status.httpDavStatus.userIdSet && status.httpDavStatus.passwordSet ? 'Configured' : 'Not Configured'}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Base URL
                      </Typography>
                      <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }} sx={{ wordBreak: 'break-all' }}>
                        https://dav.real-debrid.com/
                      </Typography>
                    </Box>
                    {status.httpDavStatus.connectionError && (
                      <Box>
                        <Typography variant="caption" fontWeight="600" color="error.main" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          Error
                        </Typography>
                        <Typography variant="body2" fontSize={{ xs: '0.875rem', md: '0.875rem' }} color="error.main">
                          {status.httpDavStatus.connectionError}
                        </Typography>
                      </Box>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Box>
      </Box>

      {/* Test Connection Dialog */}
      <Dialog
        open={testDialog}
        onClose={() => setTestDialog(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 12px 40px rgba(0,0,0,0.6)'
              : '0 12px 40px rgba(0,0,0,0.12)'
          }
        }}
      >
        <DialogTitle>Connection Test Results</DialogTitle>
        <DialogContent>
          {testResult && (
            <Box>
              {testResult.success ? (
                <Alert severity="success" sx={{ mb: 2 }}>
                  {testResult.message || 'Connection test successful!'}
                </Alert>
              ) : (
                <Alert severity="error" sx={{ mb: 2 }}>
                  Connection test failed: {testResult.error}
                </Alert>
              )}
              
              {testResult.warning && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {testResult.warning}
                </Alert>
              )}
              
              {testResult.userInfo && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    User Information
                  </Typography>
                  <Stack spacing={1}>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Username
                      </Typography>
                      <Typography variant="body2">{testResult.userInfo.username}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Email
                      </Typography>
                      <Typography variant="body2">{testResult.userInfo.email}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Account Type
                      </Typography>
                      <Typography variant="body2">{testResult.userInfo.type}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Points
                      </Typography>
                      <Typography variant="body2">{testResult.userInfo.points}</Typography>
                    </Box>
                  </Stack>
                </Box>
              )}
              
              {testResult.directoryInfo && (
                <Box>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    HTTP DAV Information
                  </Typography>
                  <Stack spacing={1}>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Base URL
                      </Typography>
                      <Typography variant="body2">https://dav.real-debrid.com/</Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Files Found
                      </Typography>
                      <Typography variant="body2">{testResult.fileCount || 0}</Typography>
                    </Box>
                    <Box>
                      <Typography variant="body2" fontWeight="500" color="text.secondary">
                        Directory Accessible
                      </Typography>
                      <Typography variant="body2">{testResult.directoryInfo.accessible ? 'Yes' : 'No'}</Typography>
                    </Box>
                  </Stack>
                </Box>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTestDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>

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

export default RealDebridSettings;
