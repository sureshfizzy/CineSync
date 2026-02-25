import { useEffect, useMemo, useState } from 'react';
import { Box, Typography, Card, CardContent, IconButton, Button, Stack, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, FormControlLabel, Switch, FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, CircularProgress, Alert, alpha, useTheme } from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { getAuthHeaders } from '../../contexts/AuthContext';

interface QualityProfile {
  id: number;
  name: string;
  mediaType: 'movie' | 'tv';
  qualities: string[];
  cutoff: string;
  upgradeAllowed: boolean;
}

interface QualityProfilesManagementProps {
  onBack?: () => void;
}

const mediaTypes: Array<{ key: 'movie' | 'tv'; label: string }> = [
  { key: 'movie', label: 'Movies' },
  { key: 'tv', label: 'Series' },
];

const emptyForm: QualityProfile = {
  id: 0,
  name: '',
  mediaType: 'movie',
  qualities: [],
  cutoff: '',
  upgradeAllowed: true,
};

export default function QualityProfilesManagement({ onBack }: QualityProfilesManagementProps) {
  const navigate = useNavigate();
  const theme = useTheme();
  const [profiles, setProfiles] = useState<Record<'movie' | 'tv', QualityProfile[]>>({ movie: [], tv: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [availableQualities, setAvailableQualities] = useState<Record<'movie' | 'tv', string[]>>({ movie: [], tv: [] });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<QualityProfile>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<QualityProfile | null>(null);

  const loadProfiles = async (mediaType: 'movie' | 'tv') => {
    const response = await fetch(`/api/quality-profiles?mediaType=${mediaType}`, { headers: getAuthHeaders() });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${mediaType} quality profiles`);
    }
    return response.json();
  };

  const loadAvailable = async (mediaType: 'movie' | 'tv') => {
    const response = await fetch(`/api/quality-profiles?available=1&mediaType=${mediaType}`, { headers: getAuthHeaders() });
    if (!response.ok) {
      return [] as string[];
    }
    const json = await response.json();
    return json.qualities || [];
  };

  const refreshAll = async () => {
    try {
      setLoading(true);
      setError('');
      const [movieProfiles, tvProfiles, movieQualities, tvQualities] = await Promise.all([
        loadProfiles('movie'),
        loadProfiles('tv'),
        loadAvailable('movie'),
        loadAvailable('tv'),
      ]);
      setProfiles({ movie: movieProfiles || [], tv: tvProfiles || [] });
      setAvailableQualities({ movie: movieQualities, tv: tvQualities });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load quality profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const openCreateDialog = (mediaType: 'movie' | 'tv') => {
    const defaults = availableQualities[mediaType] || [];
    setForm({
      ...emptyForm,
      mediaType,
      qualities: defaults,
      cutoff: defaults[0] || '',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (profile: QualityProfile) => {
    setForm({ ...profile, qualities: profile.qualities || [] });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('Profile name is required');
      return;
    }
    if (form.qualities.length === 0) {
      setError('Select at least one quality');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        name: form.name.trim(),
        mediaType: form.mediaType,
        qualities: form.qualities,
        cutoff: form.cutoff || form.qualities[0],
        upgradeAllowed: form.upgradeAllowed,
      };
      if (form.id) {
        const response = await fetch(`/api/quality-profiles?id=${form.id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error('Failed to update quality profile');
        }
      } else {
        const response = await fetch('/api/quality-profiles', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          throw new Error('Failed to create quality profile');
        }
      }
      await refreshAll();
      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quality profile');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setSaving(true);
      setError('');
      const response = await fetch(`/api/quality-profiles?id=${deleteTarget.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error('Failed to delete quality profile');
      }
      await refreshAll();
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete quality profile');
    } finally {
      setSaving(false);
    }
  };

  const renderProfileCard = (profile: QualityProfile) => (
    <Card
      key={profile.id}
      elevation={0}
      sx={{
        borderRadius: 1,
        bgcolor: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ color: 'grey.100' }}>{profile.name}</Typography>
          <Stack direction="row" spacing={0.5}>
            <IconButton size="small" onClick={() => openEditDialog(profile)} sx={{ color: 'grey.300' }}>
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setDeleteTarget(profile)} sx={{ color: 'grey.400' }}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>
        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          {profile.qualities.map((q) => (
            <Chip key={q} label={q} size="small" sx={{ mb: 0.5, bgcolor: 'rgba(255,255,255,0.12)', color: 'grey.100' }} />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );

  const dialogQualities = useMemo(() => availableQualities[form.mediaType] || [], [availableQualities, form.mediaType]);

  return (
    <Box sx={{
      minHeight: '100vh',
      background: `linear-gradient(180deg, ${alpha(theme.palette.grey[900], 0.6)} 0%, ${alpha(theme.palette.grey[900], 0.8)} 100%)`,
      p: { xs: 1.5, sm: 2 },
    }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        <Box sx={{
          mb: { xs: 1.5, sm: 2 },
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 1.5, sm: 2 },
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton
              onClick={() => {
                if (onBack) {
                  onBack();
                } else {
                  navigate('/Mediadashboard/settings');
                }
              }}
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) },
                minWidth: { xs: 40, sm: 44 },
                minHeight: { xs: 40, sm: 44 },
              }}
            >
              <ArrowBackIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />
            </IconButton>
            <Box>
              <Typography variant="h5" fontWeight={600} sx={{
                color: theme.palette.grey[100],
                
                
                mb: 0.5,
                fontSize: { xs: '1.25rem', sm: '1.5rem' },
              }}>
                Quality Profiles
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Manage quality profiles per media type
              </Typography>
            </Box>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 2 }}>
            <CircularProgress size={40} />
            <Typography variant="body2" color="text.secondary">Loading quality profiles...</Typography>
          </Box>
        ) : (
          <Stack spacing={3}>
            {mediaTypes.map(({ key, label }) => (
              <Box key={key}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                  <Typography variant="h6" sx={{ color: 'grey.100' }}>{label} Quality Profiles</Typography>
                  <Box sx={{ flex: 1, height: 1, bgcolor: 'rgba(255,255,255,0.1)' }} />
                </Box>
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)' } }}>
                  {profiles[key].map(renderProfileCard)}
                  <Card
                    elevation={0}
                    sx={{
                      borderRadius: 1,
                      border: '1px dashed rgba(255,255,255,0.2)',
                      bgcolor: 'rgba(255,255,255,0.04)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: 96,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.07)' },
                    }}
                    onClick={() => openCreateDialog(key)}
                  >
                    <Box sx={{ textAlign: 'center', color: 'grey.300' }}>
                      <AddIcon />
                      <Typography variant="caption" display="block">Add Profile</Typography>
                    </Box>
                  </Card>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Box>

      <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pb: 1 }}>{form.id ? 'Edit Quality Profile' : 'New Quality Profile'}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
          <TextField
            label="Profile Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            fullWidth
          />
          <FormControl fullWidth size="small">
            <InputLabel>Qualities</InputLabel>
            <Select
              multiple
              value={form.qualities}
              label="Qualities"
              onChange={(e) => {
                const value = e.target.value as string[];
                setForm({
                  ...form,
                  qualities: value,
                  cutoff: value.includes(form.cutoff) ? form.cutoff : value[0] || '',
                });
              }}
              renderValue={(selected) => (selected as string[]).join(', ')}
            >
              {dialogQualities.map((quality) => (
                <MenuItem key={quality} value={quality}>
                  <Checkbox checked={form.qualities.indexOf(quality) > -1} />
                  <ListItemText primary={quality} />
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel>Cutoff</InputLabel>
            <Select
              value={form.cutoff}
              label="Cutoff"
              onChange={(e) => setForm({ ...form, cutoff: String(e.target.value) })}
            >
              {form.qualities.map((quality) => (
                <MenuItem key={quality} value={quality}>{quality}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                checked={form.upgradeAllowed}
                onChange={(e) => setForm({ ...form, upgradeAllowed: e.target.checked })}
              />
            }
            label="Upgrade Allowed"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Delete Profile</DialogTitle>
        <DialogContent>
          <Typography variant="body2">Delete "{deleteTarget?.name}"?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={saving}>Cancel</Button>
          <Button color="error" variant="contained" onClick={confirmDelete} disabled={saving}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}