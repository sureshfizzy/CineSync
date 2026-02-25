import { useEffect, useState } from 'react';
import { Alert, alpha, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, List, ListItem, Stack, Switch, Tooltip, Typography, useTheme } from '@mui/material';
import { Add as AddIcon, CheckCircle as CheckCircleIcon, Delete as DeleteIcon, Error as ErrorIcon, Schedule as ScheduleIcon, Science as TestTubeIcon, Search as SearchIcon, Warning as WarningIcon, Edit as EditIcon } from '@mui/icons-material';
import { Indexer, IndexerFormData, TestStatus, TEST_STATUS_COLORS, TEST_STATUS_LABELS } from '../../types/indexer';
import { IndexerApi } from '../../api/indexerApi';
import IndexerForm from './IndexerForm';
import ProtocolPickerDialog from './ProtocolPickerDialog';

export default function IndexerManagement() {
  console.log('IndexerManagement component loaded');
  const theme = useTheme();
  const [indexers, setIndexers] = useState<Indexer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [protocolPickerOpen, setProtocolPickerOpen] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState<'torznab'>('torznab');
  const [editingIndexer, setEditingIndexer] = useState<Indexer | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [indexerToDelete, setIndexerToDelete] = useState<Indexer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Fetch indexers from API
  const fetchIndexers = async () => {
    try {
      setLoading(true);
      setError('');

      console.log('Fetching indexers from API...');
      const indexersData = await IndexerApi.getIndexers();
      console.log('Fetched indexers:', indexersData);
      setIndexers(indexersData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch indexers');
      console.error('Error fetching indexers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIndexers();
  }, []);

  const enabledCount = indexers.filter((indexer) => indexer.enabled).length;
  const disabledCount = indexers.length - enabledCount;

  const handleAddIndexer = () => {
    setEditingIndexer(null);
    setProtocolPickerOpen(true);
  };

  const handleProtocolPicked = (protocol: typeof selectedProtocol) => {
    setSelectedProtocol(protocol);
    setProtocolPickerOpen(false);
    setFormOpen(true);
  };

  const handleEditIndexer = (indexer: Indexer) => {
    setEditingIndexer(indexer);
    setFormOpen(true);
  };

  const handleDeleteIndexer = (indexer: Indexer) => {
    setIndexerToDelete(indexer);
    setDeleteDialogOpen(true);
  };

  const handleToggleEnabled = async (indexer: Indexer) => {
    try {
      const updatedIndexer = { ...indexer, enabled: !indexer.enabled };
      await IndexerApi.updateIndexer(indexer.id, updatedIndexer);
      setIndexers((prev) => prev.map((i) => (i.id === indexer.id ? { ...i, enabled: !i.enabled } : i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update indexer');
    }
  };

  const handleFormSubmit = async (formData: IndexerFormData) => {
    try {
      setError('');

      if (editingIndexer) {
        const updatedIndexer = await IndexerApi.updateIndexer(editingIndexer.id, formData);
        setIndexers((prev) => prev.map((i) => (i.id === editingIndexer.id ? updatedIndexer : i)));
      } else {
        const newIndexer = await IndexerApi.createIndexer(formData);
        setIndexers((prev) => [...prev, newIndexer]);
      }

      setFormOpen(false);
      setEditingIndexer(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save indexer');
    }
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setEditingIndexer(null);
  };

  const confirmDeleteIndexer = async () => {
    if (!indexerToDelete) return;

    try {
      setDeleting(true);
      setError('');

      await IndexerApi.deleteIndexer(indexerToDelete.id);
      setIndexers((prev) => prev.filter((indexer) => indexer.id !== indexerToDelete.id));
      setDeleteDialogOpen(false);
      setIndexerToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete indexer');
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteDialogOpen(false);
    setIndexerToDelete(null);
  };

  const getStatusIcon = (status: TestStatus | undefined) => {
    switch (status) {
      case 'success':
        return <CheckCircleIcon sx={{ color: TEST_STATUS_COLORS.success, fontSize: 18 }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: TEST_STATUS_COLORS.failed, fontSize: 18 }} />;
      case 'timeout':
        return <ScheduleIcon sx={{ color: TEST_STATUS_COLORS.timeout, fontSize: 18 }} />;
      default:
        return <TestTubeIcon sx={{ color: TEST_STATUS_COLORS.unknown, fontSize: 18 }} />;
    }
  };

  const getProtocolColor = (protocol: string) => {
    const colors: Record<string, string> = {
      torznab: theme.palette.primary.main,
      jackett: theme.palette.secondary.main,
      prowlarr: theme.palette.success.main,
      custom: theme.palette.warning.main
    };
    return colors[protocol] || theme.palette.grey[500];
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 320,
          gap: 1.5
        }}
      >
        <CircularProgress size={32} />
        <Typography variant="body2" color="text.secondary">
          Loading indexers...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ bgcolor: 'background.default', py: { xs: 1.5, sm: 2.5 } }}>
      <Box sx={{ maxWidth: 980, mx: 'auto', px: { xs: 1.5, sm: 2.5 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ mb: 2, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box>
              <Typography variant="h6" fontWeight={600}>
                Indexers
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Configure and manage your indexer connections
              </Typography>
            </Box>
          </Stack>

          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 18 }} />}
            onClick={handleAddIndexer}
            sx={{ fontWeight: 600, borderRadius: 2, minHeight: 36 }}
          >
            Add Indexer
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 1.5, borderRadius: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, color: 'text.secondary' }}>
          <Typography variant="caption">{indexers.length} total</Typography>
          <Typography variant="caption">•</Typography>
          <Typography variant="caption">{enabledCount} enabled</Typography>
          <Typography variant="caption">•</Typography>
          <Typography variant="caption">{disabledCount} disabled</Typography>
        </Stack>

        <Typography
          variant="caption"
          sx={{
            display: 'block',
            mb: 0.5,
            ml: 0.5,
            fontWeight: 600,
            color: theme.palette.text.secondary
          }}
        >
          Indexer Connections
        </Typography>
        <Card variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <CardContent sx={{ p: 0 }}>
            {indexers.length === 0 ? (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Avatar sx={{ width: 48, height: 48, mx: 'auto', mb: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: theme.palette.primary.main }}>
                  <SearchIcon sx={{ fontSize: 24 }} />
                </Avatar>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  No indexers yet
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 420, mx: 'auto' }}>
                  Indexers provide access to torrent and usenet search results.
                </Typography>
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={handleAddIndexer}>
                  Add Indexer
                </Button>
              </Box>
            ) : (
              <List dense disablePadding>
                {indexers.map((indexer, index) => (
                  <ListItem
                    key={indexer.id}
                    divider={index < indexers.length - 1}
                    secondaryAction={
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Tooltip title={indexer.enabled ? 'Disable' : 'Enable'}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={indexer.enabled}
                                onChange={() => handleToggleEnabled(indexer)}
                                size="small"
                                color="primary"
                              />
                            }
                            label=""
                            sx={{ m: 0 }}
                          />
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => handleEditIndexer(indexer)}
                            sx={{
                              bgcolor: alpha(theme.palette.primary.main, 0.1),
                              color: theme.palette.primary.main,
                              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.2) }
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            onClick={() => handleDeleteIndexer(indexer)}
                            sx={{
                              bgcolor: alpha(theme.palette.error.main, 0.08),
                              color: theme.palette.error.main,
                              '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.16) }
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    }
                    sx={{
                      py: 1,
                      pr: { xs: 10, sm: 12 },
                      '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.25) },
                      transition: 'background-color 0.2s ease',
                      alignItems: 'flex-start'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, width: '100%' }}>
                      <Avatar
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: alpha(getProtocolColor(indexer.protocol), 0.12),
                          color: getProtocolColor(indexer.protocol)
                        }}
                      >
                        <SearchIcon sx={{ fontSize: 14 }} />
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', mb: 0.25 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {indexer.name}
                          </Typography>
                          <Chip
                            label={IndexerApi.getProtocolDisplayName(indexer.protocol)}
                            size="small"
                            variant="outlined"
                            sx={{
                              height: 18,
                              fontSize: '0.65rem',
                              borderColor: alpha(getProtocolColor(indexer.protocol), 0.35),
                              color: getProtocolColor(indexer.protocol)
                            }}
                          />
                          {indexer.testStatus && indexer.testStatus !== 'unknown' && getStatusIcon(indexer.testStatus)}
                        </Stack>
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            color: theme.palette.text.secondary,
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
                          }}
                        >
                          {IndexerApi.formatIndexerUrl(indexer.url)}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                          {indexer.testStatus && indexer.testStatus !== 'unknown' && (
                            <Chip
                              label={TEST_STATUS_LABELS[indexer.testStatus]}
                              size="small"
                              variant="outlined"
                              sx={{
                                height: 18,
                                fontSize: '0.65rem',
                                borderColor: alpha(TEST_STATUS_COLORS[indexer.testStatus], 0.35),
                                color: TEST_STATUS_COLORS[indexer.testStatus]
                              }}
                            />
                          )}
                          {indexer.testStatus && indexer.testStatus !== 'unknown' && indexer.lastTested && (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                              {IndexerApi.getRelativeTime(indexer.lastTested)}
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    </Box>
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <IndexerForm
          open={formOpen}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
          indexer={editingIndexer}
          initialProtocol={selectedProtocol}
        />

        <ProtocolPickerDialog
          open={protocolPickerOpen}
          onClose={() => setProtocolPickerOpen(false)}
          onPick={handleProtocolPicked}
        />

        <Dialog
          open={deleteDialogOpen}
          onClose={cancelDelete}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              borderRadius: 2,
              boxShadow: theme.palette.mode === 'dark'
                ? `0 20px 60px ${alpha(theme.palette.common.black, 0.45)}`
                : `0 12px 28px ${alpha(theme.palette.common.black, 0.18)}`,
              border: `1px solid ${alpha(theme.palette.divider, 0.6)}`
            }
          }}
        >
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
            <WarningIcon color="warning" fontSize="small" />
            Delete Indexer
          </DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              This removes the indexer from your configuration.
            </Typography>
            <Box
              sx={{
                p: 1.5,
                bgcolor: theme.palette.mode === 'dark'
                  ? alpha(theme.palette.common.white, 0.08)
                  : alpha(theme.palette.common.black, 0.04),
                borderRadius: 1,
                border: `1px solid ${alpha(theme.palette.divider, 0.8)}`
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  wordBreak: 'break-all',
                  fontWeight: 500
                }}
              >
                {indexerToDelete?.name}
              </Typography>
            </Box>
            <Alert
              severity="warning"
              variant="outlined"
              sx={{
                mt: 2,
                bgcolor: alpha(theme.palette.warning.main, 0.08),
                borderColor: alpha(theme.palette.warning.main, 0.4),
                color: 'text.primary',
                '& .MuiAlert-icon': { color: theme.palette.warning.main }
              }}
            >
              Deleting this indexer will remove it from your configuration and affect scheduled searches.
            </Alert>
          </DialogContent>
          <DialogActions sx={{ p: 2 }}>
            <Button onClick={cancelDelete} disabled={deleting} sx={{ minWidth: 90 }}>
              Cancel
            </Button>
            <Button
              onClick={confirmDeleteIndexer}
              variant="contained"
              color="error"
              disabled={deleting}
              startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
              sx={{ minWidth: 130 }}
            >
              {deleting ? 'Deleting...' : 'Delete Indexer'}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </Box>
  );
}
