import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Switch, TextField, Button, Alert, Snackbar, IconButton, Tooltip, Chip, Divider, CircularProgress, InputAdornment } from '@mui/material';
import { Refresh as RefreshIcon, ContentCopy as CopyIcon, Info as InfoIcon, Save as SaveIcon, Security as SecurityIcon, Tv as TvIcon, Person as PersonIcon, Tag as TagIcon } from '@mui/icons-material';
import SpoofingConnectionGuide from './SpoofingConnectionGuide';

interface SpoofingConfig {
  enabled: boolean;
  version: string;
  branch: string;
  apiKey: string;
}

const SpoofingSettings: React.FC = () => {
  const [config, setConfig] = useState<SpoofingConfig>({
    enabled: false,
    version: '5.14.0.9383',
    branch: 'master',
    apiKey: '',
  });
  
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' });

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/spoofing/config');
      if (response.ok) {
        const data = await response.json();
        setConfig({
          enabled: data.enabled ?? false,
          version: data.version || '5.14.0.9383',
          branch: data.branch || 'master',
          apiKey: data.apiKey || '',
        });
      }
    } catch (error) {
      console.error('Failed to load spoofing config:', error);
      showMessage('Failed to load configuration', 'error');
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const saveConfigInternal = async (configToSave: SpoofingConfig) => {
    const response = await fetch('/api/spoofing/config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(configToSave),
    });

    if (response.ok) {
      const updatedConfig = await response.json();
      setConfig(updatedConfig);
      return updatedConfig;
    } else {
      throw new Error('Failed to save configuration');
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      await saveConfigInternal(config);
      showMessage('Configuration saved successfully');
    } catch (error) {
      showMessage('Failed to save configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const regenerateAPIKey = async () => {
    setRegenerating(true);
    try {
      const response = await fetch('/api/spoofing/regenerate-key', { method: 'POST' });
      if (response.ok) {
        const updatedConfig = await response.json();
        setConfig(updatedConfig);
        showMessage('API key regenerated successfully');
      } else {
        throw new Error('Failed to regenerate API key');
      }
    } catch (error) {
      console.error('API key regeneration failed:', error);
      showMessage('Failed to regenerate API key', 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const copyAPIKey = () => {
    navigator.clipboard.writeText(config.apiKey);
    showMessage('API key copied to clipboard');
  };

  const toggleEnabled = async () => {
    const originalConfig = { ...config };
    const newConfig = { ...config, enabled: !config.enabled };

    setConfig(newConfig);
    setLoading(true);

    try {
      const updatedConfig = await saveConfigInternal(newConfig);
      showMessage(`Spoofing ${updatedConfig.enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setConfig(originalConfig);
      showMessage('Failed to toggle spoofing', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" mb={2}>
          <TvIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            Universal Media Server Spoofing
          </Typography>
          <Chip
            label={config.enabled ? 'Enabled' : 'Disabled'}
            color={config.enabled ? 'success' : 'default'}
            size="small"
          />
        </Box>

        <Alert severity="info" sx={{ mb: 3 }}>
          <Box display="flex" alignItems="center">
            <InfoIcon sx={{ mr: 1 }} />
            <Typography variant="body2">
              This feature allows CineSync to appear as both Radarr (for movies) and Sonarr (for TV shows) 
              to subtitle management tools like Bazarr. Enable this to automatically manage subtitles for your media.
            </Typography>
          </Box>
        </Alert>

        <Box sx={{ mb: 3 }}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            sx={{
              mb: 3,
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: config.enabled ? 'success.main' : 'action.hover',
              color: config.enabled ? 'success.contrastText' : 'text.primary',
              transition: 'all 0.3s ease',
            }}
          >
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                Enable Spoofing
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {config.enabled ? 'Active - CineSync is spoofing as Radarr/Sonarr' : 'Inactive - Spoofing is disabled'}
              </Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              {loading && <CircularProgress size={20} />}
              <Switch
                checked={Boolean(config.enabled)}
                onChange={toggleEnabled}
                disabled={loading}
                size="medium"
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': {
                    color: config.enabled ? 'success.contrastText' : 'primary.main',
                  },
                }}
              />
            </Box>
          </Box>

          <Divider sx={{ mb: 3 }} />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Instance Name and Version Row */}
            <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
              <Box sx={{ flex: 1 }}>
                <Box display="flex" alignItems="center" mb={1}>
                  <PersonIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="subtitle1">
                    Instance Name
                  </Typography>
                </Box>
                <TextField
                  fullWidth
                  value="CineSync"
                  disabled={true}
                  helperText="Name displayed to connecting applications"
                  InputProps={{
                    style: { fontSize: '14px' }
                  }}
                />
              </Box>

              <Box sx={{ flex: 1 }}>
                <Box display="flex" alignItems="center" mb={1}>
                  <TagIcon sx={{ mr: 1, color: 'primary.main' }} />
                  <Typography variant="subtitle1">
                    Version
                  </Typography>
                </Box>
                <TextField
                  fullWidth
                  value={config.version || ''}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, version: e.target.value })}
                  disabled={loading}
                  helperText="Version reported to applications"
                  InputProps={{
                    style: { fontSize: '14px' }
                  }}
                />
              </Box>
            </Box>

            {/* API Key Section */}
            <Box>
              <Box display="flex" alignItems="center" mb={1}>
                <SecurityIcon sx={{ mr: 1, color: 'primary.main' }} />
                <Typography variant="subtitle1">
                  API Key
                </Typography>
              </Box>
              <TextField
                fullWidth
                value={regenerating ? 'Generating API key...' : (config.apiKey || '')}
                InputProps={{
                  readOnly: true,
                  style: {
                    fontFamily: 'monospace',
                    fontSize: '14px',
                  },
                  endAdornment: (
                    <InputAdornment position="end">
                      <Box display="flex" gap={0.5}>
                        <Tooltip title="Copy API Key">
                          <IconButton
                            onClick={copyAPIKey}
                            size="small"
                            disabled={!config.apiKey}
                          >
                            <CopyIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Regenerate API Key">
                          <IconButton
                            onClick={regenerateAPIKey}
                            disabled={loading || regenerating}
                            size="small"
                          >
                            <RefreshIcon
                              sx={{
                                animation: regenerating ? 'spin 1s linear infinite' : 'none',
                                '@keyframes spin': {
                                  '0%': {
                                    transform: 'rotate(0deg)',
                                  },
                                  '100%': {
                                    transform: 'rotate(360deg)',
                                  },
                                },
                              }}
                            />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </InputAdornment>
                  ),
                }}
                error={!config.apiKey && !regenerating}
              />
              <Typography variant="caption" color="text.secondary">
                Use this API key when configuring Bazarr or other applications
              </Typography>
            </Box>

            {/* Action Buttons */}
            <Box display="flex" gap={2} justifyContent="center" alignItems="center" sx={{ mt: 2 }}>
              <Button
                onClick={loadConfig}
                disabled={loading}
                startIcon={<RefreshIcon />}
                variant="outlined"
                color="secondary"
              >
                Reset
              </Button>
              <Button
                variant="contained"
                onClick={saveConfig}
                disabled={loading}
                startIcon={<SaveIcon />}
                size="large"
              >
                Save Configuration
              </Button>
            </Box>
          </Box>
        </Box>

        <Snackbar
          open={snackbar.open}
          autoHideDuration={4000}
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          <Alert
            severity={snackbar.severity}
            onClose={() => setSnackbar({ ...snackbar, open: false })}
          >
            {snackbar.message}
          </Alert>
        </Snackbar>
      </CardContent>

      {/* Connection Guide */}
      {config.enabled && config.apiKey && (
        <SpoofingConnectionGuide
          apiKey={config.apiKey}
          serverUrl={window.location.origin}
        />
      )}
    </Card>
  );
};

export default SpoofingSettings;
