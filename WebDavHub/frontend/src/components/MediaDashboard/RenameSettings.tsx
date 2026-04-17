import { useEffect, useState } from 'react';
import { Box, Typography, Card, CardContent, Button, Alert, CircularProgress, Stack } from '@mui/material';
import { FormField } from '../Settings/FormField';
import { getAuthHeaders } from '../../contexts/AuthContext';

interface ConfigValue {
  key: string;
  value: string;
  description: string;
  category: string;
  type: 'string' | 'boolean' | 'integer' | 'array' | 'select';
  required: boolean;
  beta?: boolean;
  disabled?: boolean;
  locked?: boolean;
  hidden?: boolean;
  options?: string[];
}

export default function RenameSettings() {
  const [config, setConfig] = useState<ConfigValue[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState('');
  const [configSuccess, setConfigSuccess] = useState('');
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});

  const fetchConfig = async () => {
    try {
      setConfigLoading(true);
      setConfigError('');
      const response = await fetch(`/api/config?t=${Date.now()}`, {
        headers: getAuthHeaders({ 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' })
      });
      if (!response.ok) throw new Error(`Failed to load config: ${response.statusText}`);
      const data = await response.json();
      setConfig(data.config || []);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setConfigLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const getConfigItem = (key: string) => config.find((item) => item.key === key);
  const getFieldValue = (key: string) => pendingChanges[key] !== undefined ? pendingChanges[key] : (getConfigItem(key)?.value || '');
  const getFieldType = (item?: ConfigValue): 'string' | 'boolean' | 'integer' | 'array' | 'password' | 'select' => !item ? 'string' : (item.type === 'select' ? 'select' : item.type as 'string' | 'boolean' | 'integer' | 'array');

  const getFieldOptions = (item?: ConfigValue): string[] | undefined => {
    if (!item) return undefined;
    if (item.options && item.options.length > 0) return item.options;
    if (item.key === 'RENAME_TAGS') {
      return ['Resolution', 'Quality Full', 'Quality Title', 'Custom Formats', 'TMDB', 'IMDB', 'MediaInfo VideoCodec', 'MediaInfo AudioCodec', 'MediaInfo AudioChannels', 'MediaInfo Dynamic Range'];
    }
    return undefined;
  };

  const handleConfigFieldChange = (key: string, value: string) => {
    const originalValue = getConfigItem(key)?.value || '';
    setPendingChanges((prev) => {
      const next = { ...prev };
      if (value === originalValue) delete next[key];
      else next[key] = value;
      return next;
    });
  };

  const saveConfigChanges = async () => {
    const changedKeys = Object.keys(pendingChanges);
    if (changedKeys.length === 0) return;

    try {
      setConfigSaving(true);
      setConfigError('');
      setConfigSuccess('');

      const updates = changedKeys.map((key) => {
        const item = getConfigItem(key);
        return { key, value: pendingChanges[key], type: item?.type || 'string', required: item?.required || false };
      });

      const response = await fetch('/api/config/update', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ updates })
      });

      if (!response.ok) throw new Error(`Failed to save settings: ${response.statusText}`);
      await fetchConfig();
      setPendingChanges({});
      setConfigSuccess('Media management renaming settings saved.');
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setConfigSaving(false);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h6" fontWeight={600}>Rename Structure</Typography>
        </Box>
        <Button variant="contained" size="small" disabled={configLoading || configSaving || Object.keys(pendingChanges).length === 0} onClick={saveConfigChanges}>
          {configSaving ? 'Saving...' : `Save ${Object.keys(pendingChanges).length > 0 ? `(${Object.keys(pendingChanges).length})` : ''}`}
        </Button>
      </Stack>

      {configError && <Alert severity="error" sx={{ borderRadius: 2 }} onClose={() => setConfigError('')}>{configError}</Alert>}
      {configSuccess && <Alert severity="success" sx={{ borderRadius: 2 }} onClose={() => setConfigSuccess('')}>{configSuccess}</Alert>}

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2 }}>
          {configLoading ? (
            <Box sx={{ py: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">Loading rename settings...</Typography>
            </Box>
          ) : (
            <Stack spacing={1.5}>
              {(() => {
                const item = getConfigItem('RENAME_ENABLED');
                if (!item) return null;
                return <FormField label="Rename Enabled" value={getFieldValue(item.key)} onChange={(value) => handleConfigFieldChange(item.key, value)} type={getFieldType(item)} required={item.required} description={item.description} options={getFieldOptions(item)} beta={item.beta} disabled={item.disabled} locked={item.locked} />;
              })()}

              {(() => {
                const replaceItem = getConfigItem('REPLACE_ILLEGAL_CHARACTERS');
                const colonItem = getConfigItem('COLON_REPLACEMENT');
                return (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" fontWeight={600} color="text.primary">Illegal Characters & Colon Management</Typography>
                    {replaceItem && <FormField label="Replace Illegal Characters" value={getFieldValue(replaceItem.key)} onChange={(value) => handleConfigFieldChange(replaceItem.key, value)} type={getFieldType(replaceItem)} required={replaceItem.required} description={replaceItem.description} options={getFieldOptions(replaceItem)} beta={replaceItem.beta} disabled={replaceItem.disabled} locked={replaceItem.locked} />}
                    {colonItem && <FormField label="Colon Management" value={getFieldValue(colonItem.key)} onChange={(value) => handleConfigFieldChange(colonItem.key, value)} type={getFieldType(colonItem)} required={colonItem.required} description={colonItem.description} options={getFieldOptions(colonItem)} beta={colonItem.beta} disabled={colonItem.disabled} locked={colonItem.locked} />}
                  </Stack>
                );
              })()}

              {(() => {
                const renameTags = getConfigItem('RENAME_TAGS');
                const parserToggle = getConfigItem('MEDIAINFO_PARSER');
                const isParserEnabled = getFieldValue('MEDIAINFO_PARSER').toLowerCase() === 'true';
                const mediaInfoItems = ['MEDIAINFO_RADARR_TAGS', 'MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT', 'MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT', 'MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT', 'MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT'].map((key) => getConfigItem(key)).filter((item): item is ConfigValue => !!item);

                return (
                  <Stack spacing={1}>
                    <Typography variant="subtitle2" fontWeight={600} color="text.primary">Rename Tags & MediaInfo</Typography>
                    {renameTags && <FormField label="Rename Tags" value={getFieldValue(renameTags.key)} onChange={(value) => handleConfigFieldChange(renameTags.key, value)} type={getFieldType(renameTags)} required={renameTags.required} description={renameTags.description} options={getFieldOptions(renameTags)} beta={renameTags.beta} disabled={renameTags.disabled} locked={renameTags.locked} />}
                    {parserToggle && <FormField label="MediaInfo Parser" value={getFieldValue(parserToggle.key)} onChange={(value) => handleConfigFieldChange(parserToggle.key, value)} type={getFieldType(parserToggle)} required={parserToggle.required} description={parserToggle.description} options={getFieldOptions(parserToggle)} beta={parserToggle.beta} disabled={parserToggle.disabled} locked={parserToggle.locked} />}
                    {isParserEnabled && mediaInfoItems.length > 0 && (
                      <Stack spacing={0.5}>
                        <Typography variant="caption" color="text.secondary">MediaInfo naming formats</Typography>
                        {mediaInfoItems.map((item) => (
                          <FormField key={item.key} label={item.key.replace('MEDIAINFO_', '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase())} value={getFieldValue(item.key)} onChange={(value) => handleConfigFieldChange(item.key, value)} type={getFieldType(item)} required={item.required} description={item.description} options={getFieldOptions(item)} beta={item.beta} disabled={item.disabled} locked={item.locked} />
                        ))}
                      </Stack>
                    )}
                  </Stack>
                );
              })()}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}