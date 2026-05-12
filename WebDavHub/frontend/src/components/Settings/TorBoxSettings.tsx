import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, CircularProgress, Divider, FormControlLabel, Snackbar, Stack, Switch, TextField, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import { CloudDownload, Science } from '@mui/icons-material';
import axios from 'axios';

type TorBoxConfig = {
  enabled: boolean;
  apiKey: string;
};

type TorBoxStatus = {
  enabled: boolean;
  apiKeySet: boolean;
  valid: boolean;
  errors: string[];
  apiStatus?: {
    valid: boolean;
    error?: string;
  };
};

export default function TorBoxSettings() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [config, setConfig] = useState<TorBoxConfig>({
    enabled: false,
    apiKey: '',
  });
  const [status, setStatus] = useState<TorBoxStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'warning' }>({ open: false, message: '', severity: 'success' });

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/torbox/config');
      const cfg = res.data?.config;
      setConfig({
        enabled: !!cfg?.enabled,
        apiKey: cfg?.apiKey || '',
      });
      setStatus(res.data?.status || null);
    } catch (e) {
      showMessage('Failed to load TorBox configuration', 'error');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await axios.put('/api/torbox/config', config);
      setConfig(res.data?.config || config);
      setStatus(res.data?.status || null);
      showMessage('TorBox configuration saved', 'success');
    } catch (e: any) {
      showMessage(e?.response?.data || 'Failed to save TorBox configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await axios.post('/api/torbox/test', { apiKey: config.apiKey });
      if (res.data?.success) {
        showMessage('TorBox API connection successful', 'success');
        await loadConfig();
      } else {
        showMessage(res.data?.error || 'TorBox test failed', 'error');
      }
    } catch (e: any) {
      showMessage(e?.response?.data?.error || e?.response?.data || e?.message || 'TorBox test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const infoCard = (
    <Card
      elevation={0}
      sx={{
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.25 : 0.18)}`,
        background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.10)}, ${alpha(theme.palette.background.paper, 0.9)})`,
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
          <CloudDownload sx={{ color: theme.palette.info.main }} />
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            TorBox
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Configure TorBox API access.
        </Typography>
      </CardContent>
    </Card>
  );

  const formCard = (
    <Card elevation={0} sx={{ borderRadius: 3, border: `1px solid ${alpha(theme.palette.divider, 0.6)}` }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Settings
            </Typography>
          </Stack>
          <Divider />

          <FormControlLabel
            control={
              <Switch
                checked={!!config.enabled}
                onChange={(e) => setConfig((p) => ({ ...p, enabled: e.target.checked }))}
              />
            }
            label="Enable TorBox"
          />

          <TextField
            label="TorBox API Key"
            type="password"
            value={config.apiKey || ''}
            onChange={(e) => setConfig((p) => ({ ...p, apiKey: e.target.value }))}
            fullWidth
            size={isMobile ? 'small' : 'medium'}
          />

          {status?.errors?.length ? (
            <Alert severity="warning">
              {status.errors.map((e, i) => (
                <div key={i}>{e}</div>
              ))}
            </Alert>
          ) : null}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <Button
              variant="contained"
              onClick={saveConfig}
              disabled={saving || loading}
              sx={{ fontWeight: 700 }}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="outlined"
              startIcon={testing ? <CircularProgress size={16} /> : <Science />}
              onClick={testConnection}
              disabled={testing || !config.apiKey}
              sx={{ fontWeight: 700 }}
            >
              Test connection
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ width: '100%' }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={2} direction="column" sx={{ alignItems: 'stretch' }}>
          <Box sx={{ width: '100%' }}>{infoCard}</Box>
          <Box sx={{ width: '100%' }}>{formCard}</Box>
        </Stack>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

