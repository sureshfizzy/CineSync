import React, {useEffect, useState} from 'react';
import {Alert, alpha, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fade, FormControlLabel, IconButton, List, ListItem, ListItemSecondaryAction, ListItemText, Switch, Tooltip, Typography, useTheme} from '@mui/material';
import {Add as AddIcon, ArrowBack as ArrowBackIcon, CheckCircle as CheckCircleIcon, Delete as DeleteIcon, Error as ErrorIcon, Schedule as ScheduleIcon, Science as TestTubeIcon, Search as SearchIcon, Storage as StorageIcon, Warning as WarningIcon, Edit as EditIcon,} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { Indexer, IndexerFormData, TestStatus, TEST_STATUS_COLORS, TEST_STATUS_LABELS } from '../../types/indexer';
import { IndexerApi } from '../../api/indexerApi';
import IndexerForm from './IndexerForm';
import ProtocolPickerDialog from './ProtocolPickerDialog';

interface IndexerManagementProps {
  onBack?: () => void;
}

export default function IndexerManagement({ onBack }: IndexerManagementProps) {
  console.log('IndexerManagement component loaded');
  const navigate = useNavigate();
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
      setIndexers(prev => prev.map(i => i.id === indexer.id ? { ...i, enabled: !i.enabled } : i));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update indexer');
    }
  };

  const handleFormSubmit = async (formData: IndexerFormData) => {
    try {
      setError('');
      
      if (editingIndexer) {
        const updatedIndexer = await IndexerApi.updateIndexer(editingIndexer.id, formData);
        setIndexers(prev => prev.map(i => i.id === editingIndexer.id ? updatedIndexer : i));
      } else {
        const newIndexer = await IndexerApi.createIndexer(formData);
        setIndexers(prev => [...prev, newIndexer]);
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
      setIndexers(prev => prev.filter(indexer => indexer.id !== indexerToDelete.id));
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
        return <CheckCircleIcon sx={{ color: TEST_STATUS_COLORS.success, fontSize: 20 }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: TEST_STATUS_COLORS.failed, fontSize: 20 }} />;
      case 'timeout':
        return <ScheduleIcon sx={{ color: TEST_STATUS_COLORS.timeout, fontSize: 20 }} />;
      default:
        return <TestTubeIcon sx={{ color: TEST_STATUS_COLORS.unknown, fontSize: 20 }} />;
    }
  };

  const getProtocolColor = (protocol: string) => {
    const colors: Record<string, string> = {
      torznab: theme.palette.primary.main,
      jackett: theme.palette.secondary.main,
      prowlarr: theme.palette.success.main,
      custom: theme.palette.warning.main,
    };
    return colors[protocol] || theme.palette.grey[500];
  };

  if (loading) {
    return (
      <Box sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: 400,
        gap: 2
      }}>
        <CircularProgress size={40} />
        <Typography variant="body2" color="text.secondary">
          Loading indexers...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
      p: { xs: 2, sm: 2, md: 3 }
    }}>
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
        {/* Header Section */}
        <Box sx={{ 
          mb: { xs: 2, sm: 3 },
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 2, sm: 2 }
        }}>
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: { xs: 1.5, sm: 2 },
            width: { xs: '100%', sm: 'auto' }
          }}>
            <IconButton 
              onClick={() => {
                if (onBack) {
                  onBack();
                } else {
                  navigate('/dashboard/settings');
                }
              }} 
              sx={{ 
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.2)
                },
                minWidth: { xs: 40, sm: 44 },
                minHeight: { xs: 40, sm: 44 }
              }}
            >
              <ArrowBackIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h5" fontWeight={600} sx={{ 
                background: `linear-gradient(45deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                mb: 0.5,
                fontSize: { xs: '1.25rem', sm: '1.5rem' }
              }}>
                Indexer Management
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{
                fontSize: { xs: '0.75rem', sm: '0.875rem' }
              }}>
                Configure and manage your indexer connections
              </Typography>
            </Box>
          </Box>
          
          <Button
            variant="contained"
            startIcon={<AddIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />}
            onClick={handleAddIndexer}
            sx={{ 
              borderRadius: 3,
              px: { xs: 2, sm: 3 },
              py: { xs: 1, sm: 1.5 },
              fontSize: { xs: '0.875rem', sm: '0.95rem' },
              fontWeight: 600,
              boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
              '&:hover': {
                boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.4)}`,
                transform: 'translateY(-2px)'
              },
              transition: 'all 0.3s ease',
              width: { xs: '100%', sm: 'auto' },
              minHeight: { xs: 44, sm: 48 }
            }}
          >
            Add Indexer
          </Button>
        </Box>

        {/* Error Alert */}
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 3,
              borderRadius: 2,
              '& .MuiAlert-message': {
                width: '100%'
              }
            }} 
            onClose={() => setError('')}
          >
            {error}
          </Alert>
        )}

        {/* Stats Card */}
        <Card sx={{
          mb: { xs: 2, sm: 3 },
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          borderRadius: 2
        }}>
          <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 } }}>
              <Avatar sx={{
                width: { xs: 28, sm: 32 },
                height: { xs: 28, sm: 32 },
                bgcolor: alpha(theme.palette.primary.main, 0.2),
                color: theme.palette.primary.main
              }}>
                <StorageIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
              </Avatar>
              <Box>
                <Typography variant="h5" fontWeight={600} color="primary" sx={{
                  fontSize: { xs: '1.25rem', sm: '1.5rem' }
                }}>
                  {indexers.length}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{
                  fontSize: { xs: '0.75rem', sm: '0.875rem' }
                }}>
                  Configured Indexers
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>

        {/* Indexers List */}
        <Card sx={{ 
          borderRadius: 3,
          boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`
        }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ 
              p: 3, 
              borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, transparent 100%)`
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Avatar sx={{ 
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  color: theme.palette.primary.main
                }}>
                  <SearchIcon />
                </Avatar>
                <Box>
                  <Typography variant="h6" fontWeight={600}>
                    Indexer Connections
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Manage your indexer configurations and test connections
                  </Typography>
                </Box>
              </Box>
            </Box>

            {indexers.length === 0 ? (
              <Box sx={{ 
                p: 6, 
                textAlign: 'center',
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(135deg, ${alpha(theme.palette.grey[800], 0.3)} 0%, ${alpha(theme.palette.grey[700], 0.2)} 100%)`
                  : `linear-gradient(135deg, ${alpha(theme.palette.grey[50], 0.5)} 0%, ${alpha(theme.palette.grey[100], 0.3)} 100%)`
              }}>
                <Avatar sx={{ 
                  width: 80, 
                  height: 80, 
                  mx: 'auto', 
                  mb: 3,
                  bgcolor: theme.palette.mode === 'dark'
                    ? alpha(theme.palette.grey[600], 0.3)
                    : alpha(theme.palette.grey[400], 0.2),
                  color: theme.palette.mode === 'dark'
                    ? theme.palette.grey[300]
                    : theme.palette.grey[600]
                }}>
                  <SearchIcon sx={{ fontSize: 40 }} />
                </Avatar>
                <Typography variant="h5" fontWeight={600} color="text.primary" gutterBottom>
                  No Indexers Configured
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ mb: 4, maxWidth: 400, mx: 'auto' }}>
                  Indexers provide access to torrent and usenet search results. Add your first indexer to start searching for content.
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<AddIcon />}
                  onClick={handleAddIndexer}
                  sx={{
                    borderRadius: 3,
                    px: 4,
                    py: 1.5,
                    fontSize: '1rem',
                    fontWeight: 600,
                    boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.3)}`,
                    '&:hover': {
                      boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.4)}`,
                      transform: 'translateY(-2px)'
                    },
                    transition: 'all 0.3s ease'
                  }}
                >
                  Add Your First Indexer
                </Button>
              </Box>
            ) : (
              <List sx={{ p: 0 }}>
                {indexers.map((indexer, index) => (
                  <React.Fragment key={indexer.id}>
                    <ListItem
                      sx={{
                        p: { xs: 1.5, sm: 2 },
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.02),
                          '& .indexer-actions': {
                            opacity: 1
                          }
                        },
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <Avatar sx={{
                        mr: { xs: 1.5, sm: 2 },
                        width: { xs: 28, sm: 32 },
                        height: { xs: 28, sm: 32 },
                        bgcolor: alpha(getProtocolColor(indexer.protocol), 0.1),
                        color: getProtocolColor(indexer.protocol)
                      }}>
                        <SearchIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                      </Avatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="body1" fontWeight={500} sx={{ 
                              fontSize: { xs: '0.875rem', sm: '1rem' }
                            }}>
                              {indexer.name}
                            </Typography>
                            <Chip
                              label={IndexerApi.getProtocolDisplayName(indexer.protocol)}
                              size="small"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem',
                                bgcolor: alpha(getProtocolColor(indexer.protocol), 0.1),
                                color: getProtocolColor(indexer.protocol),
                                border: `1px solid ${alpha(getProtocolColor(indexer.protocol), 0.3)}`
                              }}
                            />
                            {indexer.testStatus && indexer.testStatus !== 'unknown' && getStatusIcon(indexer.testStatus)}
                          </Box>
                        }
                        secondary={
                          <Box>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{
                              fontSize: { xs: '0.7rem', sm: '0.75rem' },
                              mb: 0.5
                            }}>
                              {IndexerApi.formatIndexerUrl(indexer.url)}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              {indexer.testStatus && indexer.testStatus !== 'unknown' && (
                                <Chip
                                  label={TEST_STATUS_LABELS[indexer.testStatus]}
                                  size="small"
                                  sx={{
                                    height: 18,
                                    fontSize: '0.65rem',
                                    bgcolor: alpha(TEST_STATUS_COLORS[indexer.testStatus], 0.1),
                                    color: TEST_STATUS_COLORS[indexer.testStatus],
                                    border: `1px solid ${alpha(TEST_STATUS_COLORS[indexer.testStatus], 0.3)}`
                                  }}
                                />
                              )}
                              {indexer.testStatus && indexer.testStatus !== 'unknown' && indexer.lastTested && (
                                <Typography variant="caption" color="text.secondary" sx={{
                                  fontSize: '0.65rem'
                                }}>
                                  {IndexerApi.getRelativeTime(indexer.lastTested)}
                                </Typography>
                              )}
                            </Box>
                          </Box>
                        }
                      />
                      <ListItemSecondaryAction>
                        <Box sx={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 1,
                          opacity: 0,
                          transition: 'opacity 0.2s ease',
                          '&.indexer-actions': {
                            opacity: 1
                          }
                        }} className="indexer-actions">
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
                          <Tooltip title="Edit">
                            <IconButton
                              onClick={() => handleEditIndexer(indexer)}
                              sx={{
                                bgcolor: alpha(theme.palette.primary.main, 0.1),
                                color: theme.palette.primary.main,
                                '&:hover': {
                                  bgcolor: alpha(theme.palette.primary.main, 0.2)
                                },
                                minWidth: { xs: 36, sm: 40 },
                                minHeight: { xs: 36, sm: 40 }
                              }}
                            >
                              <EditIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton
                              onClick={() => handleDeleteIndexer(indexer)}
                              sx={{
                                bgcolor: alpha(theme.palette.error.main, 0.1),
                                color: theme.palette.error.main,
                                '&:hover': {
                                  bgcolor: alpha(theme.palette.error.main, 0.2)
                                },
                                minWidth: { xs: 36, sm: 40 },
                                minHeight: { xs: 36, sm: 40 }
                              }}
                            >
                              <DeleteIcon sx={{ fontSize: { xs: 18, sm: 20 } }} />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </ListItemSecondaryAction>
                    </ListItem>
                    {index < indexers.length - 1 && (
                      <Divider sx={{ 
                        mx: { xs: 2, sm: 3 },
                        borderColor: alpha(theme.palette.divider, 0.1)
                      }} />
                    )}
                  </React.Fragment>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        {/* Indexer Form Dialog */}
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


        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteDialogOpen}
          onClose={cancelDelete}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              borderRadius: 3,
              boxShadow: theme.palette.mode === 'dark' 
                ? `0 20px 60px ${alpha(theme.palette.common.black, 0.4)}`
                : `0 20px 60px ${alpha(theme.palette.common.black, 0.25)}`,
              background: theme.palette.mode === 'dark'
                ? `linear-gradient(135deg, ${alpha(theme.palette.error.main, 0.15)} 0%, ${theme.palette.background.paper} 100%)`
                : theme.palette.background.paper,
              border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
              overflow: 'hidden',
              backdropFilter: 'blur(10px)'
            }
          }}
        >
          <Fade in={deleteDialogOpen} timeout={300}>
            <Box>
              <DialogTitle sx={{ 
                pb: 2,
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(90deg, ${alpha(theme.palette.error.main, 0.2)} 0%, ${alpha(theme.palette.error.main, 0.05)} 100%)`
                  : alpha(theme.palette.error.main, 0.1),
                borderBottom: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                p: 3
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ 
                    bgcolor: theme.palette.mode === 'dark' 
                      ? alpha(theme.palette.error.main, 0.25)
                      : alpha(theme.palette.error.main, 0.2),
                    color: theme.palette.error.main,
                    width: 48,
                    height: 48,
                    border: theme.palette.mode === 'light' ? `1px solid ${alpha(theme.palette.error.main, 0.2)}` : 'none'
                  }}>
                    <WarningIcon sx={{ fontSize: 24 }} />
                  </Avatar>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="error">
                      Delete Indexer
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      This action cannot be undone
                    </Typography>
                  </Box>
                </Box>
              </DialogTitle>
              
              <DialogContent sx={{ p: 3 }}>
                <Box sx={{ 
                  p: 2, 
                  bgcolor: theme.palette.mode === 'dark' 
                    ? alpha(theme.palette.error.main, 0.12)
                    : alpha(theme.palette.error.main, 0.15),
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
                  mb: 2
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <SearchIcon sx={{ color: theme.palette.error.main, fontSize: 20 }} />
                    <Typography variant="body2" fontWeight={500} color="error">
                      Indexer to be deleted:
                    </Typography>
                  </Box>
                  <Typography variant="body1" sx={{ 
                    fontFamily: 'monospace',
                    bgcolor: theme.palette.mode === 'dark' 
                      ? theme.palette.background.paper 
                      : theme.palette.grey[50],
                    p: 1,
                    borderRadius: 1,
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    wordBreak: 'break-all',
                    color: theme.palette.text.primary,
                    fontWeight: 500
                  }}>
                    {indexerToDelete?.name}
                  </Typography>
                </Box>
                
                <Alert 
                  severity="warning" 
                  sx={{ 
                    borderRadius: 2,
                    '& .MuiAlert-icon': {
                      fontSize: 20
                    }
                  }}
                >
                  <Typography variant="body2">
                    <strong>Warning:</strong> Deleting this indexer will remove it from your configuration. 
                    Any scheduled updates or searches using this indexer will be affected.
                  </Typography>
                </Alert>
              </DialogContent>
              
              <DialogActions sx={{ 
                p: 3, 
                gap: 2,
                background: theme.palette.mode === 'dark'
                  ? `linear-gradient(90deg, ${alpha(theme.palette.error.main, 0.05)} 0%, ${alpha(theme.palette.error.main, 0.1)} 100%)`
                  : alpha(theme.palette.error.main, 0.05),
                borderTop: `1px solid ${alpha(theme.palette.error.main, 0.3)}`
              }}>
                <Button 
                  onClick={cancelDelete}
                  disabled={deleting}
                  sx={{ 
                    borderRadius: 2,
                    px: 3,
                    py: 1,
                    fontWeight: 500,
                    minWidth: 100
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmDeleteIndexer}
                  variant="contained"
                  color="error"
                  disabled={deleting}
                  startIcon={deleting ? <CircularProgress size={16} color="inherit" /> : <DeleteIcon />}
                  sx={{
                    borderRadius: 2,
                    px: 3,
                    py: 1,
                    fontWeight: 600,
                    minWidth: 120,
                    boxShadow: `0 4px 20px ${alpha(theme.palette.error.main, 0.3)}`,
                    '&:hover': {
                      boxShadow: `0 6px 25px ${alpha(theme.palette.error.main, 0.4)}`,
                      transform: 'translateY(-1px)'
                    },
                    transition: 'all 0.2s ease'
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete Indexer'}
                </Button>
              </DialogActions>
            </Box>
          </Fade>
        </Dialog>
      </Box>
    </Box>
  );
}
