import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, TextField, Switch, FormControlLabel, Button, Alert, Snackbar, CircularProgress, Chip, Stack, Divider, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, useTheme, useMediaQuery, alpha, List, ListItem, ListItemText, ListItemSecondaryAction } from '@mui/material';
import { CloudDownload, Settings, CheckCircle, Error, Refresh, Visibility, VisibilityOff, Science, Speed, Add, Delete, SwapHoriz } from '@mui/icons-material';
import axios from 'axios';

interface TokenStatus {
  label: string;
  expired: boolean;
  current: boolean;
  masked: string;
}

interface RealDebridConfig {
  enabled: boolean;
  apiKey: string;
  additionalApiKeys?: string[];
  httpDavSettings: {
    enabled: boolean;
    userId: string;
    password: string;
  };
  repairSettings: {
    enabled: boolean;
    autoStartRepair: boolean;
    autoFix: boolean;
    onDemand: boolean;
    scanIntervalHours: number;
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

type RealDebridSettingsProps = {
  stackInfoOnTop?: boolean;
};

const RealDebridSettings: React.FC<RealDebridSettingsProps> = ({ stackInfoOnTop = false }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [config, setConfig] = useState<RealDebridConfig>({
    enabled: false,
    apiKey: '',
    additionalApiKeys: [],
    httpDavSettings: {
      enabled: false,
      userId: '',
      password: '',
    },
    repairSettings: {
      enabled: false,
      autoStartRepair: false,
      autoFix: false,
      onDemand: false,
      scanIntervalHours: 48,
    },
  });
  const [status, setStatus] = useState<RealDebridStatus | null>(null);
  const [tokenStatuses, setTokenStatuses] = useState<TokenStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingHttpDav, setTestingHttpDav] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showHttpDavPassword, setShowHttpDavPassword] = useState(false);
  const [showAdditionalTokens, setShowAdditionalTokens] = useState<Record<number, boolean>>({});
  const [newToken, setNewToken] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' });
  const [testDialog, setTestDialog] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const isApiKeyPresent = !!(config.apiKey && config.apiKey.trim());
  const isMainEnabled = !!config.enabled;
  const isApiConnected =
    isMainEnabled &&
    isApiKeyPresent &&
    !!status?.apiStatus?.valid &&
    !!status?.apiKeySet &&
    !!status?.apiStatus?.username;

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/realdebrid/config');
      setConfig({
        ...response.data.config,
        additionalApiKeys: response.data.config.additionalApiKeys || [],
        repairSettings: response.data.config.repairSettings || {
          enabled: false,
          autoStartRepair: false,
          autoFix: false,
          onDemand: false,
          scanIntervalHours: 48,
        },
      });
      setStatus(response.data.status);
      setTokenStatuses(response.data.tokenStatuses || []);
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
      setConfig({
        ...response.data.config,
        additionalApiKeys: response.data.config.additionalApiKeys || [],
        repairSettings: response.data.config.repairSettings || {
          enabled: false,
          autoStartRepair: false,
          autoFix: false,
          onDemand: false,
          scanIntervalHours: 48,
        },
      });
      setStatus(response.data.status);
      setTokenStatuses(response.data.tokenStatuses || []);
      showMessage('Configuration saved successfully');
    } catch (error) {
      console.error('Failed to save Real-Debrid config:', error);
      showMessage('Failed to save configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addToken = () => {
    if (!newToken.trim()) {
      showMessage('Please enter a token', 'warning');
      return;
    }
    const updatedTokens = [...(config.additionalApiKeys || []), newToken];
    setConfig({ ...config, additionalApiKeys: updatedTokens });
    setNewToken('');
    showMessage('Token added. Click Save to apply changes.', 'success');
  };

  const removeToken = (index: number) => {
    const updatedTokens = (config.additionalApiKeys || []).filter((_, i) => i !== index);
    setConfig({ ...config, additionalApiKeys: updatedTokens });
    showMessage('Token removed. Click Save to apply changes.', 'warning');
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

  const header = (
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
            borderColor: isApiConnected ? 'success.main' : isMainEnabled ? 'warning.main' : 'divider',
            bgcolor: isApiConnected
              ? alpha(theme.palette.success.main, 0.05)
              : isMainEnabled
              ? alpha(theme.palette.warning.main, 0.06)
              : alpha(theme.palette.divider, 0.06),
            }}
          >
            <CardContent sx={{ py: { xs: 1.5, md: 2 }, '&:last-child': { pb: { xs: 1.5, md: 2 } } }}>
              <Stack direction="row" alignItems="flex-start" spacing={2}>
              {isApiConnected ? (
                  <CheckCircle sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                ) : (
                <Error sx={{ color: isMainEnabled ? 'warning.main' : 'text.secondary', fontSize: { xs: 20, md: 24 }, mt: 0.5 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant={isMobile ? 'subtitle1' : 'h6'}
                  fontWeight="600"
                  sx={{ color: isApiConnected ? 'success.main' : isMainEnabled ? 'warning.main' : 'text.secondary' }}
                >
                  {isApiConnected ? 'Connected' : isMainEnabled ? 'Not configured yet' : 'Disabled'}
                  </Typography>
                {status.apiStatus && isApiConnected && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                    {status.apiStatus.username} ({status.apiStatus.type})
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
  );

  const infoPanel = (
        <Box>
      <Stack spacing={{ xs: 2, md: 3 }}>
        {/* Account Status */}
        {!isApiConnected ? (
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="700" sx={{ mb: 1 }}>
                Account not connected
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enter a valid API key and enable Real-Debrid to see account details here.
              </Typography>
            </CardContent>
          </Card>
        ) : status?.apiStatus ? (
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                <Speed sx={{ color: 'success.main', fontSize: { xs: 20, md: 24 } }} />
                <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">
                  Account
                </Typography>
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
        ) : null}

        {/* HTTP DAV Status */}
        {status?.httpDavStatus ? (
          <Card>
            <CardContent sx={{ p: { xs: 2, md: 3 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: { xs: 1.5, md: 2 } }}>
                <CloudDownload
                  sx={{
                    color: status.httpDavStatus.connected ? 'success.main' : 'error.main',
                    fontSize: { xs: 20, md: 24 },
                  }}
                />
                <Typography variant={isMobile ? 'subtitle1' : 'h6'} fontWeight="600">
                  HTTP DAV
                </Typography>
              </Stack>
              <Stack spacing={1.5}>
                <Box>
                  <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Status
                  </Typography>
                  <Typography
                    variant="body2"
                    fontSize={{ xs: '0.875rem', md: '0.875rem' }}
                    color={status.httpDavStatus.connected ? 'success.main' : 'error.main'}
                  >
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
        ) : null}
      </Stack>
    </Box>
  );

  const mainConfig = (
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

          {!config.enabled && (
            <Alert severity="info" sx={{ mb: 1 }}>
              Turn on Real-Debrid to enter API key, tokens, and DAV settings.
            </Alert>
          )}

          {config.enabled && (
            <Stack spacing={{ xs: 2.5, md: 3 }}>
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

                {/* Additional Tokens Section */}
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                    <SwapHoriz sx={{ color: 'primary.main' }} />
                    <Typography variant="subtitle2" fontWeight="600">
                      Additional API Tokens (Bandwidth Rotation)
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                    Add extra Real-Debrid API tokens to automatically rotate when daily bandwidth limit is reached
                  </Typography>

                  {/* Token Status Display */}
                  {tokenStatuses && tokenStatuses.length > 0 && (
                    <Box sx={{ mb: 2, p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderRadius: 1 }}>
                      <Typography variant="caption" fontWeight="600" sx={{ mb: 1, display: 'block' }}>
                        Current Token Status
                      </Typography>
                      <List dense sx={{ py: 0 }}>
                        {tokenStatuses.map((tokenStatus, index) => (
                          <ListItem key={index} sx={{ px: 0 }}>
                            <ListItemText
                              primary={
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <Typography variant="body2" fontWeight="500">
                                    {tokenStatus.label}
                                  </Typography>
                                  {tokenStatus.current && (
                                    <Chip label="Active" size="small" color="primary" sx={{ height: 20 }} />
                                  )}
                                  {tokenStatus.expired ? (
                                    <Chip label="Bandwidth Limit" size="small" color="error" sx={{ height: 20 }} />
                                  ) : (
                                    <Chip label="Available" size="small" color="success" sx={{ height: 20 }} />
                                  )}
                                </Stack>
                              }
                              secondary={
                                <Typography variant="caption" color="text.secondary">
                                  {tokenStatus.masked}
                                </Typography>
                              }
                            />
                          </ListItem>
                        ))}
                      </List>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Tokens reset daily at 12AM CET
                      </Typography>
                    </Box>
                  )}

                  {/* Additional Tokens List */}
                  {config.additionalApiKeys && config.additionalApiKeys.length > 0 && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" fontWeight="600" sx={{ mb: 1, display: 'block' }}>
                        Additional Tokens
                      </Typography>
                      <List dense sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                        {config.additionalApiKeys.map((token, index) => (
                          <ListItem key={index}>
                            <ListItemText
                              primary={
                                <Typography variant="body2" fontFamily="monospace">
                                  {showAdditionalTokens[index] ? token : token.slice(0, 8) + '...' + token.slice(-8)}
                                </Typography>
                              }
                            />
                            <ListItemSecondaryAction>
                              <Stack direction="row" spacing={0.5}>
                                <Tooltip title={showAdditionalTokens[index] ? 'Hide' : 'Show'}>
                                  <IconButton
                                    size="small"
                                    onClick={() => setShowAdditionalTokens({
                                      ...showAdditionalTokens,
                                      [index]: !showAdditionalTokens[index]
                                    })}
                                  >
                                    {showAdditionalTokens[index] ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                                  </IconButton>
                                </Tooltip>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => removeToken(index)}
                                >
                                  <Delete fontSize="small" />
                                </IconButton>
                              </Stack>
                            </ListItemSecondaryAction>
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  {/* Add Token Input */}
                  <Stack direction="row" spacing={1}>
                    <TextField
                      fullWidth
                      size="small"
                      type="password"
                      value={newToken}
                      onChange={(e) => setNewToken(e.target.value)}
                      placeholder="Enter additional API token"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          addToken();
                        }
                      }}
                    />
                    <Button
                      variant="outlined"
                      startIcon={<Add />}
                      onClick={addToken}
                      disabled={!newToken.trim()}
                      sx={{ minWidth: 100 }}
                    >
                      Add
                    </Button>
                  </Stack>
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

                <Divider />

                {/* Repair Settings */}
                <Box>
                  <Typography variant="subtitle2" fontWeight="600" sx={{ mb: 2 }}>
                    Repair Settings
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: { xs: '0.8rem', md: '0.875rem' } }}>
                    Control automatic repair behavior for broken torrents
                  </Typography>
                  
                  <Stack spacing={2}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.repairSettings.enabled}
                          onChange={(e) => handleConfigChange('repairSettings', {
                            ...config.repairSettings,
                            enabled: e.target.checked
                          })}
                          color="primary"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" fontWeight="500">
                            Enable Repair
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Master switch to enable or disable all repair functionality
                          </Typography>
                        </Box>
                      }
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.repairSettings.autoStartRepair}
                          onChange={(e) => handleConfigChange('repairSettings', {
                            ...config.repairSettings,
                            autoStartRepair: e.target.checked
                          })}
                          color="primary"
                          disabled={!config.repairSettings.enabled}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" fontWeight="500">
                            Auto Start Repair
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Periodically scans for broken files at the specified interval
                          </Typography>
                        </Box>
                      }
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.repairSettings.autoFix}
                          onChange={(e) => handleConfigChange('repairSettings', {
                            ...config.repairSettings,
                            autoFix: e.target.checked
                          })}
                          color="primary"
                          disabled={!config.repairSettings.enabled}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" fontWeight="500">
                            Auto Fix
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Automatically fixes broken files found during scans
                          </Typography>
                        </Box>
                      }
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={config.repairSettings.onDemand}
                          onChange={(e) => handleConfigChange('repairSettings', {
                            ...config.repairSettings,
                            onDemand: e.target.checked
                          })}
                          color="primary"
                          disabled={!config.repairSettings.enabled}
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body2" fontWeight="500">
                            On Demand
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Fixes files when requested during playback
                          </Typography>
                        </Box>
                      }
                    />

                    {config.repairSettings.autoStartRepair && (
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Scan Interval (hours)"
                        value={config.repairSettings.scanIntervalHours}
                        onChange={(e) => {
                          const value = parseInt(e.target.value) || 48;
                          handleConfigChange('repairSettings', {
                            ...config.repairSettings,
                            scanIntervalHours: Math.max(1, value)
                          });
                        }}
                        disabled={!config.repairSettings.enabled || !config.repairSettings.autoStartRepair}
                        helperText="How often to scan for broken torrents (default: 48 hours = 2 days)"
                        InputProps={{
                          inputProps: { min: 1, max: 720 }
                        }}
                      />
                    )}
                  </Stack>
                </Box>

                {/* WebDAV Path removed per spec */}

                {/* Auto Connect - removed (always enabled on server) */}
            </Stack>
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
  );

  const body = stackInfoOnTop ? (
          <Stack spacing={{ xs: 2, md: 3 }}>
      {infoPanel}
      {mainConfig}
                  </Stack>
  ) : (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 3 } }}>
      <Box>{mainConfig}</Box>
      <Box>{infoPanel}</Box>
                    </Box>
  );

  return (
    <Box sx={{ pb: { xs: 2, md: 4 } }}>
      {header}
      {body}

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
