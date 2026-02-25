import React, {useEffect, useState} from 'react';
import {Alert, alpha, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Fade, FormControl, FormControlLabel, Grid, IconButton, InputAdornment, InputLabel, MenuItem, OutlinedInput, Select, Switch, TextField, Typography, useTheme} from '@mui/material';
import {Close as CloseIcon, Link as LinkIcon, Schedule as ScheduleIcon, Search as SearchIcon, Security as SecurityIcon, Timer as TimerIcon, Visibility as VisibilityIcon, VisibilityOff as VisibilityOffIcon,} from '@mui/icons-material';
import { Indexer, IndexerFormData, DEFAULT_INDEXER_CONFIG } from '../../types/indexer';
import { IndexerApi } from '../../api/indexerApi';
import { getAuthHeaders } from '../../contexts/AuthContext';

type FetchedCategory = { id: number; name: string; subs?: { id: number; name: string }[] };

interface IndexerFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: IndexerFormData) => void;
  indexer?: Indexer | null;
  initialProtocol?: 'torznab' | 'jackett' | 'prowlarr';
}

export default function IndexerForm({ open, onClose, onSubmit, indexer, initialProtocol = 'torznab' }: IndexerFormProps) {
  const theme = useTheme();
  const [formData, setFormData] = useState<IndexerFormData>({
    name: '',
    protocol: 'torznab',
    url: '',
    apiKey: '',
    enabled: true,
    updateInterval: 15,
    categories: '',
    timeout: 30,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<{ status: 'success' | 'failed' | null; message: string }>({ status: null, message: '' });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<FetchedCategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);

  useEffect(() => {
    if (indexer) {
      setFormData({
        name: indexer.name,
        protocol: indexer.protocol,
        url: indexer.url,
        apiKey: indexer.apiKey || '',
        enabled: indexer.enabled,
        updateInterval: indexer.updateInterval,
        categories: indexer.categories || '',
        timeout: indexer.timeout,
      });
      // Parse existing categories
      setSelectedCategories(indexer.categories ? indexer.categories.split(',').map(c => c.trim()) : []);
    } else {
      setFormData({
        ...DEFAULT_INDEXER_CONFIG,
        name: '',
        url: '',
        apiKey: '',
        categories: '',
      } as IndexerFormData);
      setSelectedCategories([]);
    }
    setErrors([]);
    setTestResult({ status: null, message: '' });
  }, [indexer, open, initialProtocol]);

  // Load categories (caps) from backend for saved or unsaved config
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoadingCategories(true);
      try {
        let res: Response;
        if (indexer?.id) {
          res = await fetch(`/api/indexers/${indexer.id}/caps`, { headers: getAuthHeaders() });
        } else {
          res = await fetch('/api/indexers/caps', {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(formData),
          });
        }
        if (res.ok) {
          const json = await res.json();
          setAvailableCategories(json.categories || []);
        } else {
          setAvailableCategories([]);
        }
      } catch {
        setAvailableCategories([]);
      } finally {
        setLoadingCategories(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleInputChange = (field: keyof IndexerFormData) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | { target: { value: any } }
  ) => {
    const value = event.target.value;
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    
    // Clear errors and test results when user starts typing
    if (errors.length > 0) {
      setErrors([]);
    }
    if (testResult.status) {
      setTestResult({ status: null, message: '' });
    }
  };

  const handleSwitchChange = (field: keyof IndexerFormData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.checked,
    }));
  };

  const handleCategoryChange = (event: any) => {
    const value = event.target.value;
    setSelectedCategories(typeof value === 'string' ? value.split(',') : value);
    setFormData(prev => ({
      ...prev,
      categories: (typeof value === 'string' ? value.split(',') : value).join(','),
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    const validationErrors = IndexerApi.validateIndexer(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(formData);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Failed to save indexer']);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  // Protocol description not used (single protocol)

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      fullScreen={false}
      PaperProps={{
        sx: {
          borderRadius: { xs: 0, sm: 3 },
          boxShadow: theme.palette.mode === 'dark'
            ? `0 20px 60px ${alpha(theme.palette.common.black, 0.45)}`
            : `0 12px 28px ${alpha(theme.palette.common.black, 0.18)}`,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.15)} 0%, ${theme.palette.background.paper} 100%)`
            : theme.palette.background.paper,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
          overflow: 'hidden',
          backdropFilter: 'blur(10px)',
          maxHeight: { xs: '100vh', sm: '90vh' },
          height: { xs: '100vh', sm: 'auto' },
          width: { xs: '100vw', sm: 'auto' },
          margin: { xs: 0, sm: 'auto' },
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <Fade in={open} timeout={300}>
        <Box>
          <DialogTitle sx={{ 
            pb: 2,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.2)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`
              : alpha(theme.palette.primary.main, 0.1),
            borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            p: { xs: 2, sm: 3 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 } }}>
              <Avatar sx={{ 
                bgcolor: theme.palette.mode === 'dark' 
                  ? alpha(theme.palette.primary.main, 0.25)
                  : alpha(theme.palette.primary.main, 0.2),
                color: theme.palette.primary.main,
                width: { xs: 40, sm: 48 },
                height: { xs: 40, sm: 48 },
                border: theme.palette.mode === 'light' ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}` : 'none'
              }}>
                <SearchIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h6" fontWeight={600} color="primary" sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' } }}>
                  {indexer ? 'Edit Indexer' : 'Add New Indexer'}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.75rem', sm: '0.875rem' } }}>
                  {indexer ? 'Update indexer configuration' : 'Configure a new indexer connection'}
                </Typography>
              </Box>
            </Box>
            <IconButton
              onClick={handleClose}
              disabled={submitting}
              sx={{
                bgcolor: alpha(theme.palette.error.main, 0.1),
                color: theme.palette.error.main,
                width: { xs: 36, sm: 40 },
                height: { xs: 36, sm: 40 },
                '&:hover': {
                  bgcolor: alpha(theme.palette.error.main, 0.2)
                },
                '&:disabled': {
                  bgcolor: alpha(theme.palette.grey[500], 0.1),
                  color: theme.palette.grey[500]
                }
              }}
            >
              <CloseIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />
            </IconButton>
          </DialogTitle>
          
          <DialogContent sx={{ 
            p: { xs: 2, sm: 3 },
            maxHeight: { xs: 'calc(100vh - 100px)', sm: '70vh' },
            overflowY: 'auto',
            pb: { xs: 10, sm: 8 },
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}>
            <form onSubmit={handleSubmit}>
              {errors.length > 0 && (
                <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                  <Typography variant="body2">
                    {errors.map((error, index) => (
                      <div key={index}>{error}</div>
                    ))}
                  </Typography>
                </Alert>
              )}

              {testResult.status && (
                <Alert 
                  severity={testResult.status === 'success' ? 'success' : 'error'} 
                  sx={{ mb: 3, borderRadius: 2 }}
                >
                  <Typography variant="body2">
                    {testResult.message}
                  </Typography>
                </Alert>
              )}

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
                {/* Basic Information Section */}
                <Box sx={{ 
                  p: { xs: 2, sm: 3 }, 
                  bgcolor: alpha(theme.palette.primary.main, 0.05),
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`
                }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                    <LinkIcon sx={{ color: theme.palette.primary.main, fontSize: 22 }} />
                    <Typography variant="h6" fontWeight={600}>
                      Basic Information
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={{ xs: 2, sm: 3 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Indexer Name"
                        value={formData.name}
                        onChange={handleInputChange('name')}
                        required
                        disabled={submitting}
                        placeholder="e.g., My Torrent Indexer"
                        helperText="A friendly name to identify this indexer"
                        size="medium"
                      />
                    </Grid>


                    <Grid size={12}>
                      <TextField
                        fullWidth
                        label="Indexer URL"
                        value={formData.url}
                        onChange={handleInputChange('url')}
                        required
                        disabled={submitting}
                        placeholder="https://indexer.example.com/api"
                        helperText="The base URL of your indexer API endpoint"
                        size="medium"
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <LinkIcon sx={{ color: theme.palette.text.secondary }} />
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>
                  </Grid>
                </Box>

                {/* Authentication Section */}
                <Box sx={{ 
                  p: { xs: 2, sm: 3 }, 
                  bgcolor: alpha(theme.palette.secondary.main, 0.05),
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.secondary.main, 0.1)}`
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                    <SecurityIcon sx={{ color: theme.palette.secondary.main, fontSize: 22 }} />
                    <Typography variant="h6" fontWeight={600}>
                      Authentication
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={{ xs: 2, sm: 3 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="API Key"
                        value={formData.apiKey}
                        onChange={handleInputChange('apiKey')}
                        disabled={submitting}
                        placeholder="Your API key"
                        helperText="Required for most indexers"
                        type={showPassword ? 'text' : 'password'}
                        size="medium"
                        InputProps={{
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => setShowPassword(!showPassword)}
                                edge="end"
                                size="small"
                              >
                                {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>
                  </Grid>
                </Box>

                {/* Configuration Section */}
                <Box sx={{ 
                  p: { xs: 2, sm: 3 }, 
                  bgcolor: alpha(theme.palette.success.main, 0.05),
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.success.main, 0.1)}`
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                    <ScheduleIcon sx={{ color: theme.palette.success.main, fontSize: 22 }} />
                    <Typography variant="h6" fontWeight={600}>
                      Configuration
                    </Typography>
                  </Box>
                  
                  <Grid container spacing={{ xs: 2, sm: 3 }}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Box sx={{ 
                        p: { xs: 1.5, sm: 2 }, 
                        bgcolor: alpha(theme.palette.background.paper, 0.5),
                        borderRadius: 1,
                        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`
                      }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.enabled}
                              onChange={handleSwitchChange('enabled')}
                              disabled={submitting}
                              color="primary"
                              size="medium"
                            />
                          }
                          label={
                            <Box>
                              <Typography variant="body1" fontWeight={500} sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}>
                                Enabled
                              </Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                                Enable this indexer for searches and updates
                              </Typography>
                            </Box>
                          }
                        />
                      </Box>
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Update Interval (minutes)"
                        value={formData.updateInterval}
                        onChange={handleInputChange('updateInterval')}
                        type="number"
                        disabled={submitting}
                        inputProps={{ min: 1, max: 1440 }}
                        helperText="How often to check for updates (1-1440 minutes)"
                        size="medium"
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">
                              <TimerIcon sx={{ color: theme.palette.text.secondary }} />
                            </InputAdornment>
                          ),
                        }}
                      />
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6 }}>
                      <TextField
                        fullWidth
                        label="Timeout (seconds)"
                        value={formData.timeout}
                        onChange={handleInputChange('timeout')}
                        type="number"
                        disabled={submitting}
                        inputProps={{ min: 5, max: 300 }}
                        helperText="Request timeout (5-300 seconds)"
                        size="medium"
                      />
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6 }}>
                      <FormControl fullWidth disabled={submitting || loadingCategories} size="medium">
                        <InputLabel>Categories</InputLabel>
                        <Select
                          multiple
                          value={selectedCategories}
                          onChange={handleCategoryChange}
                          input={<OutlinedInput label="Categories" />}
                          renderValue={(selected) => (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {selected.map((value) => {
                                const catId = parseInt(String(value), 10);
                                let label = String(value);
                                const top = availableCategories.find(c => c.id === catId);
                                if (top) label = top.name; else {
                                  availableCategories.forEach(c => {
                                    const sub = c.subs?.find(s => s.id === catId);
                                    if (sub) label = sub.name;
                                  });
                                }
                                return (<Chip key={value} label={label} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />);
                              })}
                            </Box>
                          )}
                        >
                          {availableCategories.map((category) => (
                            <MenuItem key={category.id} value={category.id}>
                              <Box>
                                <Typography variant="body2" fontWeight={500}>{category.name}</Typography>
                                <Typography variant="caption" color="text.secondary">ID: {category.id}</Typography>
                              </Box>
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                        {loadingCategories ? 'Loading categories…' : 'Select categories this indexer supports (optional)'}
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Box>
              {/* Spacer to prevent last inputs being hidden behind sticky actions */}
              <Box sx={{ height: { xs: 56, sm: 48 } }} />
            </form>
          </DialogContent>
          
          <DialogActions sx={{ 
            p: { xs: 1, sm: 2 }, 
            gap: { xs: 1, sm: 2 },
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.primary.main, 0.12)} 100%)`
              : alpha(theme.palette.primary.main, 0.08),
            borderTop: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
            position: 'sticky',
            bottom: 0,
            zIndex: 1,
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            minHeight: { xs: 'auto', sm: 'auto' }
          }}>
            <Button 
              onClick={handleClose}
              disabled={submitting}
              sx={{ 
                borderRadius: 2,
                px: 3,
                py: { xs: 1, sm: 0.75 },
                fontWeight: 500,
                minWidth: { xs: 'auto', sm: 100 },
                order: { xs: 3, sm: 1 }
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
              sx={{
                borderRadius: 2,
                px: 3,
                py: { xs: 1, sm: 0.75 },
                fontWeight: 600,
                minWidth: { xs: 'auto', sm: 120 },
                boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                '&:hover': {
                  boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.4)}`,
                  transform: 'translateY(-1px)'
                },
                transition: 'all 0.2s ease',
                order: { xs: 1, sm: 2 }
              }}
            >
              {submitting ? 'Saving...' : (indexer ? 'Update Indexer' : 'Add Indexer')}
            </Button>
            <Button
              onClick={async () => {
                const validationErrors = IndexerApi.validateIndexer(formData);
                if (validationErrors.length > 0) {
                  setErrors(validationErrors);
                  setTestResult({ status: null, message: '' });
                  return;
                }
                setSubmitting(true);
                setErrors([]);
                try {
                  const result = await IndexerApi.testIndexerConfig(formData);
                  if (result.status === 'success') {
                    setTestResult({ 
                      status: 'success', 
                      message: `✅ Connection successful! Response time: ${result.responseTimeMs}ms` 
                    });
                  } else {
                    setTestResult({ 
                      status: 'failed', 
                      message: `❌ Connection failed: ${result.message}` 
                    });
                  }
                } catch (e: any) {
                  setTestResult({ 
                    status: 'failed', 
                    message: `❌ Test failed: ${e?.message || 'Unknown error'}` 
                  });
                } finally {
                  setSubmitting(false);
                }
              }}
              color="info"
              variant="outlined"
              disabled={submitting}
              sx={{ 
                borderRadius: 2, 
                px: 3, 
                py: { xs: 1, sm: 0.75 }, 
                fontWeight: 600,
                order: { xs: 2, sm: 3 }
              }}
            >
              {submitting ? 'Testing...' : 'Test Connection'}
            </Button>
          </DialogActions>
        </Box>
      </Fade>
    </Dialog>
  );
}
