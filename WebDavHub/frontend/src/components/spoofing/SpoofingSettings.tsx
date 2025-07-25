import React, { useState, useEffect } from 'react';
import { Box, Card, CardContent, Typography, Switch, TextField, Button, Alert, Snackbar, IconButton, Tooltip, Chip, Divider, CircularProgress, InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, useTheme, alpha, Stack } from '@mui/material';
import { Refresh as RefreshIcon, ContentCopy as CopyIcon, Save as SaveIcon, Security as SecurityIcon, Tv as TvIcon, Person as PersonIcon, Tag as TagIcon, Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Folder as FolderIcon, Close as CloseIcon } from '@mui/icons-material';
import SpoofingConnectionGuide from './SpoofingConnectionGuide';

interface FolderMapping {
  folderPath: string;
  serviceType: 'radarr' | 'sonarr' | 'auto';
  apiKey: string;
  enabled: boolean;
  displayName: string;
}

interface AvailableFolder {
  path: string;
  displayName: string;
  fileCount: number;
}

interface SpoofingConfig {
  enabled: boolean;
  version: string;
  branch: string;
  apiKey: string;
  folderMode: boolean;
  folderMappings: FolderMapping[];
}

const SpoofingSettings: React.FC = () => {
  const theme = useTheme();
  const [config, setConfig] = useState<SpoofingConfig>({
    enabled: false,
    version: '5.14.0.9383',
    branch: 'master',
    apiKey: '',
    folderMode: false,
    folderMappings: [],
  });
  
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' | 'warning' });

  // Folder management state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<FolderMapping | null>(null);
  const [newFolder, setNewFolder] = useState<FolderMapping>({
    folderPath: '',
    serviceType: 'auto',
    apiKey: '',
    enabled: true,
    displayName: '',
  });
  const [availableFolders, setAvailableFolders] = useState<AvailableFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const showMessage = (message: string, severity: 'success' | 'error' | 'warning' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const fetchAvailableFolders = async () => {
    setLoadingFolders(true);
    try {
      const response = await fetch('/api/spoofing/folders/available');
      if (response.ok) {
        const folders = await response.json();
        setAvailableFolders(folders || []);
      } else {
        console.error('Failed to fetch available folders');
        setAvailableFolders([]);
      }
    } catch (error) {
      console.error('Error fetching available folders:', error);
      setAvailableFolders([]);
    } finally {
      setLoadingFolders(false);
    }
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
          folderMode: data.folderMode ?? false,
          folderMappings: data.folderMappings || [],
        });
        showMessage('Configuration reset successfully');
      } else {
        showMessage('Failed to load configuration', 'error');
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

  // Folder management functions
  const toggleFolderMode = async () => {
    const originalConfig = { ...config };
    const newConfig = { ...config, folderMode: !config.folderMode };

    setConfig(newConfig);
    setLoading(true);

    try {
      const updatedConfig = await saveConfigInternal(newConfig);
      showMessage(`Folder mode ${updatedConfig.folderMode ? 'enabled' : 'disabled'}`);
    } catch (error) {
      setConfig(originalConfig);
      showMessage('Failed to toggle folder mode', 'error');
    } finally {
      setLoading(false);
    }
  };

  const openFolderDialog = (folder?: FolderMapping) => {
    if (folder) {
      setEditingFolder(folder);
      setNewFolder({ ...folder });
    } else {
      setEditingFolder(null);
      setNewFolder({
        folderPath: '',
        serviceType: 'auto',
        apiKey: '',
        enabled: true,
        displayName: '',
      });
    }
    setFolderDialogOpen(true);
    // Fetch available folders when dialog opens
    fetchAvailableFolders();
  };

  const closeFolderDialog = () => {
    setFolderDialogOpen(false);
    setEditingFolder(null);
  };

  const generateFolderAPIKey = () => {
    const chars = 'abcdef0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewFolder({ ...newFolder, apiKey: result });
  };

  const saveFolderMapping = async () => {
    if (!newFolder.folderPath || !newFolder.apiKey || !newFolder.displayName) {
      showMessage('Please fill in all required fields', 'error');
      return;
    }

    const updatedMappings = editingFolder
      ? config.folderMappings.map(m => m.folderPath === editingFolder.folderPath ? newFolder : m)
      : [...config.folderMappings, newFolder];

    const newConfig = { ...config, folderMappings: updatedMappings };

    try {
      const updatedConfig = await saveConfigInternal(newConfig);
      setConfig(updatedConfig);
      showMessage(`Folder mapping ${editingFolder ? 'updated' : 'added'} successfully`);
      closeFolderDialog();
    } catch (error) {
      showMessage('Failed to save folder mapping', 'error');
    }
  };

  const deleteFolderMapping = async (folderPath: string) => {
    const updatedMappings = config.folderMappings.filter(m => m.folderPath !== folderPath);
    const newConfig = { ...config, folderMappings: updatedMappings };

    try {
      const updatedConfig = await saveConfigInternal(newConfig);
      setConfig(updatedConfig);
      showMessage('Folder mapping deleted successfully');
    } catch (error) {
      showMessage('Failed to delete folder mapping', 'error');
    }
  };



  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" mb={2}>
          <TvIcon sx={{ mr: 1, color: 'primary.main' }} />
          <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
            Media Server Spoofing
          </Typography>
          <Chip
            label={config.enabled ? 'Enabled' : 'Disabled'}
            color={config.enabled ? 'success' : 'default'}
            size="small"
          />
        </Box>

        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2">
            This feature allows CineSync to appear as both Radarr (for movies) and Sonarr (for TV shows)
            to subtitle management tools like Bazarr. Enable this to automatically manage subtitles for your media.
          </Typography>
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
                    color: '#fff',
                  },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                    backgroundColor: '#4CAF50',
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

            {/* Folder Mode Section */}
            {config.enabled && (
              <>
                <Divider sx={{
                  my: 3,
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'divider'
                }} />

                <Box sx={{ mb: 3 }}>
                  <Box
                    display="flex"
                    alignItems="center"
                    mb={1.5}
                    sx={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 1
                    }}
                  >
                    <Box display="flex" alignItems="center" sx={{ flexGrow: 1 }}>
                      <FolderIcon sx={{ mr: 1, color: 'primary.main' }} />
                      <Typography variant="h6" component="h3" sx={{ fontWeight: 600, mr: 1 }}>
                        Folder-Level Spoofing
                      </Typography>
                      <Chip
                        label={config.folderMode ? 'Enabled' : 'Disabled'}
                        color={config.folderMode ? 'success' : 'default'}
                        size="small"
                        sx={{
                          fontWeight: 500,
                          bgcolor: config.folderMode ? '#4CAF50' : 'default',
                          color: config.folderMode ? 'white' : 'text.secondary'
                        }}
                      />
                    </Box>
                  </Box>

                  <Alert
                    severity="info"
                    sx={{
                      mb: 2,
                      bgcolor: theme.palette.mode === 'dark'
                        ? alpha(theme.palette.info.main, 0.1)
                        : alpha(theme.palette.info.main, 0.1),
                      border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
                      '& .MuiAlert-icon': {
                        color: theme.palette.mode === 'dark' ? 'info.light' : 'info.main'
                      }
                    }}
                  >
                    <Typography variant="body2" sx={{
                      color: theme.palette.mode === 'dark' ? 'grey.300' : 'text.secondary',
                      lineHeight: 1.4
                    }}>
                      Configure different API endpoints for specific folders, enabling granular control over
                      which media is exposed to subtitle management tools like Bazarr.
                    </Typography>
                  </Alert>

                  <Box
                    sx={{
                      mb: 2,
                      p: 2,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      bgcolor: config.folderMode ? 'success.main' : 'action.hover',
                      color: config.folderMode ? 'success.contrastText' : 'text.primary',
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <Box
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                    >
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                          Enable Folder Mode
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                          {config.folderMode ? 'Active - Using folder-specific endpoints' : 'Inactive - Using global endpoint'}
                        </Typography>
                      </Box>
                      <Box display="flex" alignItems="center" gap={1}>
                        {loading && <CircularProgress size={20} />}
                        <Switch
                          checked={Boolean(config.folderMode)}
                          onChange={toggleFolderMode}
                          disabled={loading}
                          size="medium"
                          sx={{
                            '& .MuiSwitch-switchBase.Mui-checked': {
                              color: '#fff',
                            },
                            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                              backgroundColor: '#4CAF50',
                            },
                          }}
                        />
                      </Box>
                    </Box>
                  </Box>

                  {/* Folder Mappings Table */}
                  {config.folderMode && (
                    <Box>
                      <Box
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        mb={2}
                        sx={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 1
                        }}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                          Folder Mappings
                        </Typography>
                        <Button
                          startIcon={<AddIcon />}
                          onClick={() => openFolderDialog()}
                          variant="contained"
                          size="small"
                          sx={{
                            px: { xs: 1.5, sm: 2 },
                            py: { xs: 0.5, sm: 0.75 },
                            borderRadius: 2,
                            fontWeight: 600,
                            textTransform: 'none',
                            fontSize: { xs: '0.8rem', sm: '0.875rem' },
                            bgcolor: '#4CAF50',
                            color: 'white',
                            boxShadow: 'none',
                            '&:hover': {
                              bgcolor: '#45a049',
                              boxShadow: 'none',
                            },
                          }}
                        >
                          Add Folder
                        </Button>
                      </Box>

                      {config.folderMappings.length > 0 ? (
                        <>
                          {/* Desktop Table View */}
                          <TableContainer
                            component={Paper}
                            sx={{
                              display: { xs: 'none', md: 'block' },
                              borderRadius: 2,
                              border: '1px solid',
                              borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'divider',
                              bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'background.paper',
                              boxShadow: theme.palette.mode === 'dark'
                                ? '0 2px 8px rgba(0,0,0,0.4)'
                                : '0 2px 8px rgba(0,0,0,0.08)',
                              overflow: 'hidden',
                            }}
                          >
                          <Table size="small">
                            <TableHead>
                              <TableRow
                                sx={{
                                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'grey.50',
                                  '& .MuiTableCell-head': {
                                    fontWeight: 600,
                                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                                    color: theme.palette.mode === 'dark' ? 'grey.300' : 'text.primary',
                                    borderBottom: `2px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'divider'}`,
                                    py: { xs: 1, sm: 1.5 },
                                    px: { xs: 1, sm: 2 }
                                  }
                                }}
                              >
                                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Folder Path</TableCell>
                                <TableCell>Service</TableCell>
                                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Display Name</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell align="right">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {config.folderMappings.map((mapping) => (
                                <TableRow
                                  key={mapping.folderPath}
                                  sx={{
                                    '&:hover': {
                                      bgcolor: theme.palette.mode === 'dark'
                                        ? 'rgba(255,255,255,0.02)'
                                        : 'grey.50',
                                    },
                                    '& .MuiTableCell-root': {
                                      borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'divider'}`,
                                      py: { xs: 1, sm: 1.5 },
                                      px: { xs: 1, sm: 2 }
                                    }
                                  }}
                                >
                                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        fontFamily: 'JetBrains Mono, Consolas, monospace',
                                        fontSize: '0.8rem',
                                        bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'grey.100',
                                        px: 1,
                                        py: 0.5,
                                        borderRadius: 1,
                                        display: 'inline-block',
                                        maxWidth: '200px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        color: theme.palette.mode === 'dark' ? 'grey.100' : 'text.primary'
                                      }}
                                      title={mapping.folderPath}
                                    >
                                      {mapping.folderPath}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Box>
                                      <Chip
                                        label={mapping.serviceType === 'auto' ? 'AUTO' : mapping.serviceType.toUpperCase()}
                                        color={
                                          mapping.serviceType === 'auto' ? 'info' :
                                          mapping.serviceType === 'radarr' ? 'primary' : 'secondary'
                                        }
                                        size="small"
                                        sx={{
                                          fontWeight: 500,
                                          fontSize: '0.7rem',
                                          height: 24
                                        }}
                                      />
                                      {/* Mobile: Show folder path below service type */}
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          display: { xs: 'block', sm: 'none' },
                                          mt: 0.5,
                                          fontFamily: 'monospace',
                                          color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                                          fontSize: '0.7rem'
                                        }}
                                      >
                                        {mapping.folderPath}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                                    <Typography
                                      variant="body2"
                                      sx={{
                                        color: theme.palette.mode === 'dark' ? 'grey.100' : 'text.primary',
                                        fontSize: '0.875rem'
                                      }}
                                    >
                                      {mapping.displayName}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Chip
                                      label={mapping.enabled ? 'Enabled' : 'Disabled'}
                                      color={mapping.enabled ? 'success' : 'default'}
                                      size="small"
                                      sx={{
                                        fontWeight: 500,
                                        fontSize: '0.7rem',
                                        height: 24,
                                        bgcolor: mapping.enabled
                                          ? theme.palette.mode === 'dark'
                                            ? alpha(theme.palette.success.main, 0.2)
                                            : alpha(theme.palette.success.main, 0.1)
                                          : theme.palette.mode === 'dark'
                                            ? 'rgba(255,255,255,0.05)'
                                            : 'grey.200',
                                        color: mapping.enabled
                                          ? theme.palette.mode === 'dark' ? 'success.light' : 'success.dark'
                                          : theme.palette.mode === 'dark' ? 'grey.400' : 'grey.600'
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell align="right">
                                    <Box display="flex" gap={0.5} justifyContent="flex-end">
                                      <Tooltip title="Copy API Key">
                                        <IconButton
                                          size="small"
                                          onClick={() => {
                                            navigator.clipboard.writeText(mapping.apiKey);
                                            showMessage('API key copied to clipboard');
                                          }}
                                          sx={{
                                            color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                                            '&:hover': {
                                              bgcolor: theme.palette.mode === 'dark'
                                                ? 'rgba(255,255,255,0.08)'
                                                : 'action.hover',
                                              color: 'primary.main'
                                            }
                                          }}
                                        >
                                          <CopyIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Edit mapping">
                                        <IconButton
                                          size="small"
                                          onClick={() => openFolderDialog(mapping)}
                                          sx={{
                                            color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                                            '&:hover': {
                                              bgcolor: theme.palette.mode === 'dark'
                                                ? 'rgba(255,255,255,0.08)'
                                                : 'action.hover',
                                              color: 'primary.main'
                                            }
                                          }}
                                        >
                                          <EditIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Delete mapping">
                                        <IconButton
                                          size="small"
                                          onClick={() => deleteFolderMapping(mapping.folderPath)}
                                          sx={{
                                            color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                                            '&:hover': {
                                              bgcolor: theme.palette.mode === 'dark'
                                                ? 'rgba(255,255,255,0.08)'
                                                : 'action.hover',
                                              color: 'error.main'
                                            }
                                          }}
                                        >
                                          <DeleteIcon fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Box>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>

                        {/* Mobile Card View */}
                        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
                          <Stack spacing={1.5}>
                            {config.folderMappings.map((mapping) => (
                              <Card
                                key={mapping.folderPath}
                                variant="outlined"
                                sx={{
                                  borderRadius: 1,
                                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'background.paper',
                                }}
                              >
                                <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                                  <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                    <Box flex={1} mr={1}>
                                      <Typography
                                        variant="subtitle2"
                                        sx={{
                                          fontWeight: 600,
                                          mb: 0.5,
                                          fontSize: '0.875rem',
                                          color: theme.palette.mode === 'dark' ? 'grey.100' : 'text.primary'
                                        }}
                                      >
                                        {mapping.displayName || mapping.folderPath}
                                      </Typography>
                                      <Typography
                                        variant="caption"
                                        sx={{
                                          fontFamily: 'monospace',
                                          fontSize: '0.7rem',
                                          color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                                          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'grey.100',
                                          px: 0.75,
                                          py: 0.25,
                                          borderRadius: 0.5,
                                          display: 'inline-block',
                                        }}
                                      >
                                        {mapping.folderPath}
                                      </Typography>
                                    </Box>
                                    <Box display="flex" gap={0.25}>
                                      <IconButton
                                        size="small"
                                        onClick={() => {
                                          navigator.clipboard.writeText(mapping.apiKey);
                                          showMessage('API key copied to clipboard');
                                        }}
                                        sx={{ p: 0.5 }}
                                      >
                                        <CopyIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                      <IconButton
                                        size="small"
                                        onClick={() => openFolderDialog(mapping)}
                                        sx={{ p: 0.5 }}
                                      >
                                        <EditIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                      <IconButton
                                        size="small"
                                        onClick={() => deleteFolderMapping(mapping.folderPath)}
                                        sx={{ p: 0.5 }}
                                        color="error"
                                      >
                                        <DeleteIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    </Box>
                                  </Box>

                                  <Box display="flex" justifyContent="space-between" alignItems="center">
                                    <Chip
                                      label={mapping.serviceType === 'auto' ? 'AUTO' : mapping.serviceType.toUpperCase()}
                                      color={
                                        mapping.serviceType === 'auto' ? 'info' :
                                        mapping.serviceType === 'radarr' ? 'primary' : 'secondary'
                                      }
                                      size="small"
                                      sx={{
                                        fontWeight: 500,
                                        fontSize: '0.65rem',
                                        height: 20
                                      }}
                                    />
                                    <Chip
                                      label={mapping.enabled ? 'Enabled' : 'Disabled'}
                                      color={mapping.enabled ? 'success' : 'default'}
                                      size="small"
                                      sx={{
                                        fontWeight: 500,
                                        fontSize: '0.65rem',
                                        height: 20
                                      }}
                                    />
                                  </Box>
                                </CardContent>
                              </Card>
                            ))}
                          </Stack>
                        </Box>
                        </>
                      ) : (
                        <Box
                          sx={{
                            p: 4,
                            textAlign: 'center',
                            border: '2px dashed',
                            borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'grey.300',
                            borderRadius: 2,
                            bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'grey.50',
                          }}
                        >
                          <FolderIcon
                            sx={{
                              fontSize: 48,
                              color: theme.palette.mode === 'dark' ? 'grey.600' : 'grey.400',
                              mb: 2
                            }}
                          />
                          <Typography
                            variant="h6"
                            sx={{
                              mb: 1,
                              color: theme.palette.mode === 'dark' ? 'grey.300' : 'text.primary',
                              fontWeight: 500
                            }}
                          >
                            No Folder Mappings
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              mb: 3,
                              color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                              maxWidth: 400,
                              mx: 'auto'
                            }}
                          >
                            Configure specific folders to have their own API endpoints for granular control over media exposure.
                          </Typography>
                          <Button
                            startIcon={<AddIcon />}
                            onClick={() => openFolderDialog()}
                            variant="contained"
                            sx={{
                              borderRadius: 2,
                              px: 3,
                              py: 1,
                              fontWeight: 500,
                              textTransform: 'none',
                              bgcolor: '#4CAF50',
                              color: 'white',
                              boxShadow: 'none',
                              '&:hover': {
                                bgcolor: '#45a049',
                                boxShadow: 'none',
                              },
                            }}
                          >
                            Add Your First Folder
                          </Button>
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              </>
            )}

            {/* Action Buttons */}
            <Box
              display="flex"
              gap={{ xs: 1, sm: 2 }}
              justifyContent="center"
              alignItems="center"
              sx={{
                mt: 2,
                mb: 1,
                flexDirection: { xs: 'column', sm: 'row' },
                width: '100%'
              }}
            >
              <Button
                onClick={loadConfig}
                disabled={loading}
                startIcon={<RefreshIcon />}
                variant="outlined"
                sx={{
                  px: { xs: 2, sm: 3 },
                  py: { xs: 1, sm: 1.2 },
                  borderRadius: 2,
                  fontWeight: 600,
                  textTransform: 'none',
                  borderColor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.23) : alpha('#000', 0.23),
                  color: 'text.primary',
                  width: { xs: '100%', sm: 'auto' },
                  minWidth: { xs: 'auto', sm: '120px' },
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                  },
                }}
              >
                Reset
              </Button>
              <Button
                variant="contained"
                onClick={saveConfig}
                disabled={loading}
                startIcon={<SaveIcon />}
                sx={{
                  px: { xs: 2, sm: 3 },
                  py: { xs: 1, sm: 1.2 },
                  borderRadius: 2,
                  fontWeight: 600,
                  textTransform: 'none',
                  bgcolor: '#4CAF50',
                  color: 'white',
                  boxShadow: 'none',
                  width: { xs: '100%', sm: 'auto' },
                  minWidth: { xs: 'auto', sm: '160px' },
                  '&:hover': {
                    bgcolor: '#45a049',
                    boxShadow: 'none',
                  },
                  '&:disabled': {
                    bgcolor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.12) : alpha('#000', 0.12),
                    color: theme.palette.mode === 'dark' ? alpha('#FFF', 0.3) : alpha('#000', 0.26),
                  },
                }}
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
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        >
          <Alert
            severity={snackbar.severity}
            onClose={() => setSnackbar({ ...snackbar, open: false })}
            sx={{
              width: '100%',
              justifyContent: 'center',
              '& .MuiAlert-message': {
                textAlign: 'center',
                width: '100%',
              },
            }}
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

      {/* Folder Mapping Dialog */}
      <Dialog
        open={folderDialogOpen}
        onClose={closeFolderDialog}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 8px 32px rgba(0, 0, 0, 0.6)'
              : '0 8px 32px rgba(0, 0, 0, 0.12)',
            bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          },
        }}
      >
        <DialogTitle sx={{
          pb: 1,
          bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FolderIcon sx={{ color: 'primary.main', fontSize: 24 }} />
              <Typography variant="h6" component="div">
                {editingFolder ? 'Edit Folder Mapping' : 'Add Folder Mapping'}
              </Typography>
            </Box>
            <IconButton
              onClick={closeFolderDialog}
              size="small"
              sx={{
                color: theme.palette.mode === 'dark' ? '#fff' : 'text.secondary',
                '&:hover': {
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'action.hover'
                }
              }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{
          pt: 2,
          pb: 1,
          bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary'
        }}>
          <Stack spacing={3}>
            <Box>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                  Folder Configuration
                </Typography>
                <IconButton
                  size="small"
                  onClick={fetchAvailableFolders}
                  disabled={loadingFolders}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.04),
                      color: 'primary.main'
                    }
                  }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Box>
              <FormControl fullWidth variant="outlined">
                <InputLabel sx={{ fontWeight: 500 }}>Folder Path</InputLabel>
                <Select
                  value={newFolder.folderPath}
                  onChange={(e) => {
                    const selectedPath = e.target.value;
                    const selectedFolder = availableFolders.find(f => f.path === selectedPath);
                    setNewFolder({
                      ...newFolder,
                      folderPath: selectedPath,
                      displayName: selectedFolder?.displayName || selectedPath
                    });
                  }}
                  label="Folder Path"
                  disabled={loadingFolders}
                  sx={{
                    borderRadius: 2,
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'background.paper',
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  {loadingFolders ? (
                    <MenuItem disabled>
                      <CircularProgress size={20} sx={{ mr: 1 }} />
                      Loading folders...
                    </MenuItem>
                  ) : availableFolders.length === 0 ? (
                    <MenuItem disabled>
                      No folders found in destination directory
                    </MenuItem>
                  ) : (
                    availableFolders.map((folder) => (
                      <MenuItem key={folder.path} value={folder.path}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {folder.displayName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {folder.path} • {folder.fileCount} files
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))
                  )}
                </Select>
                <Typography variant="caption" sx={{
                  mt: 0.5,
                  color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                  fontSize: '0.75rem'
                }}>
                  Select a folder from your destination directory
                </Typography>
              </FormControl>
            </Box>

            <TextField
              fullWidth
              label="Display Name"
              value={newFolder.displayName}
              onChange={(e) => setNewFolder({ ...newFolder, displayName: e.target.value })}
              placeholder="e.g., 4K Movies, Anime Shows"
              helperText="Human-readable name for this folder mapping"
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'background.paper',
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'primary.main',
                  },
                },
                '& .MuiInputLabel-root': {
                  fontWeight: 500,
                },
                '& .MuiFormHelperText-root': {
                  fontSize: '0.75rem',
                  color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                }
              }}
            />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.primary' }}>
                Service Configuration
              </Typography>
              <FormControl fullWidth>
                <InputLabel sx={{ fontWeight: 500 }}>Service Type</InputLabel>
                <Select
                  value={newFolder.serviceType}
                  onChange={(e) => setNewFolder({ ...newFolder, serviceType: e.target.value as 'radarr' | 'sonarr' | 'auto' })}
                  label="Service Type"
                  sx={{
                    borderRadius: 2,
                    bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'background.paper',
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <MenuItem value="auto">
                    <Box display="flex" alignItems="center" gap={1}>
                      <Chip label="Recommended" size="small" color="info" sx={{ height: 20, fontSize: '0.7rem' }} />
                      Auto-detect
                    </Box>
                  </MenuItem>
                  <MenuItem value="radarr">Radarr (Movies)</MenuItem>
                  <MenuItem value="sonarr">Sonarr (TV Shows)</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <TextField
              fullWidth
              label="API Key"
              value={newFolder.apiKey}
              onChange={(e) => setNewFolder({ ...newFolder, apiKey: e.target.value })}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Box display="flex" gap={0.5}>
                      <Tooltip title="Copy API key">
                        <IconButton
                          onClick={() => {
                            navigator.clipboard.writeText(newFolder.apiKey);
                            showMessage('API key copied to clipboard');
                          }}
                          disabled={!newFolder.apiKey}
                          size="small"
                          sx={{
                            color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                            '&:hover': {
                              color: 'primary.main',
                              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'action.hover',
                            }
                          }}
                        >
                          <CopyIcon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Generate new API key">
                        <IconButton
                          onClick={generateFolderAPIKey}
                          size="small"
                          sx={{
                            color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                            '&:hover': {
                              color: 'primary.main',
                              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'action.hover',
                            }
                          }}
                        >
                          <RefreshIcon />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </InputAdornment>
                ),
              }}
              helperText="Unique API key for this folder mapping"
              variant="outlined"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'background.paper',
                  fontFamily: 'JetBrains Mono, Consolas, monospace',
                  fontSize: '0.875rem',
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'primary.main',
                  },
                },
                '& .MuiInputLabel-root': {
                  fontWeight: 500,
                },
                '& .MuiFormHelperText-root': {
                  fontSize: '0.75rem',
                  color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                }
              }}
            />

            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                p: 2,
                border: '1px solid',
                borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'divider',
                borderRadius: 2,
                bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'grey.50',
              }}
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Enable Mapping
                </Typography>
                <Typography variant="body2" sx={{
                  color: theme.palette.mode === 'dark' ? 'grey.400' : 'text.secondary',
                  fontSize: '0.875rem'
                }}>
                  {newFolder.enabled ? 'This mapping will be active' : 'This mapping will be inactive'}
                </Typography>
              </Box>
              <Switch
                checked={newFolder.enabled}
                onChange={(e) => setNewFolder({ ...newFolder, enabled: e.target.checked })}
                sx={{
                  '& .MuiSwitch-track': {
                    bgcolor: theme.palette.mode === 'dark'
                      ? 'rgba(255,255,255,0.2)'
                      : 'rgba(0,0,0,0.2)',
                  },
                  '& .MuiSwitch-thumb': {
                    bgcolor: theme.palette.mode === 'dark' ? 'grey.300' : 'common.white',
                  }
                }}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{
          px: { xs: 2, sm: 3 },
          pb: { xs: 2, sm: 3 },
          gap: { xs: 1, sm: 1.5 },
          bgcolor: theme.palette.mode === 'dark' ? '#000' : 'background.paper',
          flexDirection: { xs: 'column', sm: 'row' }
        }}>
          <Button
            onClick={closeFolderDialog}
            variant="outlined"
            sx={{
              px: { xs: 2, sm: 3 },
              py: { xs: 1, sm: 1.2 },
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'none',
              borderColor: theme.palette.mode === 'dark' ? alpha('#FFF', 0.23) : alpha('#000', 0.23),
              color: theme.palette.mode === 'dark' ? '#fff' : 'text.primary',
              width: { xs: '100%', sm: 'auto' },
              order: { xs: 2, sm: 1 },
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: alpha(theme.palette.primary.main, 0.04),
              },
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={saveFolderMapping}
            variant="contained"
            sx={{
              px: { xs: 2, sm: 3 },
              py: { xs: 1, sm: 1.2 },
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'none',
              bgcolor: '#4CAF50',
              color: 'white',
              boxShadow: 'none',
              width: { xs: '100%', sm: 'auto' },
              order: { xs: 1, sm: 2 },
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
            {editingFolder ? 'Update' : 'Add'} Mapping
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};

export default SpoofingSettings;
