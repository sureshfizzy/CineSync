import React, { useState, useEffect } from 'react';
import { Container, Alert, Snackbar, Box, Typography, Grid, IconButton, Chip, Stack, useTheme, alpha, Backdrop, CircularProgress, Fade } from '@mui/material';
import axios from 'axios';
import { Refresh, Save, TuneRounded, ChevronRight, ChevronLeft, HomeRounded, VideoLibraryRounded, StorageRounded, NetworkCheckRounded, ApiRounded, LiveTvRounded, CreateNewFolderRounded, AccountTreeRounded, DriveFileRenameOutlineRounded, SettingsApplicationsRounded, Build, WorkRounded } from '@mui/icons-material';
import ConfirmDialog from '../components/Settings/ConfirmDialog';
import LoadingButton from '../components/Settings/LoadingButton';
import { FormField } from '../components/Settings/FormField';
import MediaHubService from '../components/Settings/MediaHubService';
import JobsTable from '../components/Jobs/JobsTable';


interface ConfigValue {
  key: string;
  value: string;
  description: string;
  category: string;
  type: 'string' | 'boolean' | 'integer' | 'array';
  required: boolean;
  beta?: boolean;
  disabled?: boolean;
  locked?: boolean;
  lockedBy?: string;
}

interface ConfigResponse {
  config: ConfigValue[];
  status: string;
}

interface CategoryInfo {
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  gradient: string;
  count: number;
  requiredCount: number;
  modifiedCount: number;
}

const Settings: React.FC = () => {
  const theme = useTheme();

  const [config, setConfig] = useState<ConfigValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedMainTab, setSelectedMainTab] = useState<number>(0); // 0: General, 1: Services, 2: Jobs
  const [selectedTab, setSelectedTab] = useState<number>(0);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, string>>({});
  const [configStatus, setConfigStatus] = useState<{
    isPlaceholder: boolean;
    destinationDir: string;
    effectiveRootDir: string;
    needsConfiguration: boolean;
  } | null>(null);

  useEffect(() => {
    fetchConfig();
    checkConfigStatus();

    // Listen for config status refresh events
    const handleConfigStatusRefresh = () => {
      checkConfigStatus();
      fetchConfig();
    };

    window.addEventListener('config-status-refresh', handleConfigStatusRefresh);

    return () => {
      window.removeEventListener('config-status-refresh', handleConfigStatusRefresh);
    };
  }, []);

  const checkConfigStatus = async () => {
    try {
      const response = await axios.get('/api/config-status');
      setConfigStatus(response.data);
    } catch (err) {
      console.error('Failed to check config status:', err);
    }
  };

  const getCategoryInfo = (category: string, items: ConfigValue[]): CategoryInfo => {
    const modifiedCount = items.filter(item => pendingChanges[item.key] !== undefined).length;
    const requiredCount = items.filter(item => item.required).length;

    const categoryMap: Record<string, Omit<CategoryInfo, 'count' | 'requiredCount' | 'modifiedCount'>> = {
      'Directory Paths': {
        name: 'General',
        description: 'Source & destination paths',
        icon: <HomeRounded sx={{ fontSize: 28 }} />,
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      },
      'Media Folders Configuration': {
        name: 'Media Folders',
        description: 'Custom folder organization',
        icon: <CreateNewFolderRounded sx={{ fontSize: 28 }} />,
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
      },
      'Resolution Folder Mappings Configuration': {
        name: 'Resolution Mappings',
        description: 'Quality-based folder structure',
        icon: <AccountTreeRounded sx={{ fontSize: 28 }} />,
        color: '#06b6d4',
        gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
      },
      'TMDb/IMDB Configuration': {
        name: 'TMDB Configuration',
        description: 'Movie & TV show metadata',
        icon: <VideoLibraryRounded sx={{ fontSize: 28 }} />,
        color: '#f59e0b',
        gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      },
      'Renaming Structure Configuration': {
        name: 'Renaming Structure',
        description: 'File renaming & metadata parsing',
        icon: <DriveFileRenameOutlineRounded sx={{ fontSize: 28 }} />,
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      },
      'Plex Integration Configuration': {
        name: 'Plex Integration',
        description: 'Plex server & library settings',
        icon: <LiveTvRounded sx={{ fontSize: 28 }} />,
        color: '#e97e00',
        gradient: 'linear-gradient(135deg, #e97e00 0%, #cc6e00 100%)',
      },
      'Database Configuration': {
        name: 'Database',
        description: 'Database settings & performance',
        icon: <StorageRounded sx={{ fontSize: 28 }} />,
        color: '#10b981',
        gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      },
      'Real-Time Monitoring Configuration': {
        name: 'Monitoring',
        description: 'Real-time file monitoring',
        icon: <NetworkCheckRounded sx={{ fontSize: 28 }} />,
        color: '#06b6d4',
        gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
      },
      'CineSync Configuration': {
        name: 'CineSync',
        description: 'Server settings & authentication',
        icon: <ApiRounded sx={{ fontSize: 28 }} />,
        color: '#3b82f6',
        gradient: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
      },
      'System Configuration': {
        name: 'Advanced',
        description: 'Advanced system settings',
        icon: <SettingsApplicationsRounded sx={{ fontSize: 28 }} />,
        color: '#6b7280',
        gradient: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
      },
      'Services': {
        name: 'Services',
        description: 'Service management & control',
        icon: <Build sx={{ fontSize: 28 }} />,
        color: '#8b5cf6',
        gradient: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
      },
    };

    const info = categoryMap[category] || {
      name: category,
      description: 'Configuration settings',
      icon: <TuneRounded sx={{ fontSize: 28 }} />,
      color: '#6b7280',
      gradient: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
    };

    return {
      ...info,
      count: items.length,
      requiredCount,
      modifiedCount,
    };
  };

  const fetchConfig = async () => {
    try {
      setLoading(true);
      // Add cache-busting parameter to ensure fresh data
      const response = await axios.get(`/api/config?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      const data: ConfigResponse = response.data;
      setConfig(data.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (key: string, value: string) => {
    // Find the original value from config
    const originalItem = config.find(item => item.key === key);
    const originalValue = originalItem?.value || '';

    setPendingChanges(prev => {
      const newChanges = { ...prev };

      // If the new value equals the original value, remove it from pending changes
      if (value === originalValue) {
        delete newChanges[key];
      } else {
        newChanges[key] = value;
      }

      return newChanges;
    });
  };

  const handleSave = async () => {
    if (Object.keys(pendingChanges).length === 0) {
      setError('No changes to save');
      return;
    }

    try {
      setSaving(true);
      const updates = Object.entries(pendingChanges).map(([key, value]) => {
        const configItem = config.find(c => c.key === key);
        return {
          key,
          value,
          type: configItem?.type || 'string',
          required: configItem?.required || false,
        };
      });

      const response = await axios.post('/api/config/update', { updates });

      if (response.status !== 200) {
        throw new Error('Failed to save configuration');
      }

      // Refresh configuration from server to ensure we have the latest data
      await fetchConfig();

      // Small delay to ensure backend has processed the changes
      setTimeout(async () => {
        await checkConfigStatus();

        // Trigger config status refresh event for other components
        window.dispatchEvent(new CustomEvent('config-status-refresh', {
          detail: { timestamp: Date.now() }
        }));
      }, 500);

      setPendingChanges({});
      setSuccess('Configuration saved successfully');
      setShowConfirmDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };



  const getFieldValue = (item: ConfigValue) => {
    return pendingChanges[item.key] !== undefined ? pendingChanges[item.key] : item.value;
  };

  const formatFieldLabel = (key: string) => {
    return key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  };

  const getFieldOptions = (item: ConfigValue): string[] | undefined => {
    if (item.key === 'SHOW_RESOLUTION_STRUCTURE' || item.key === 'MOVIE_RESOLUTION_STRUCTURE') {
      return ['none', 'year', 'resolution', 'year_resolution'];
    }
    if (item.key.includes('_ENABLED') || item.type === 'boolean') {
      return ['true', 'false'];
    }
    return undefined;
  };

  const getFieldType = (item: ConfigValue): 'string' | 'boolean' | 'integer' | 'array' | 'password' => {
    if (item.key.includes('PASSWORD') || item.key.includes('TOKEN') || item.key.includes('KEY')) {
      return 'password';
    }
    return item.type;
  };

  // Define main tabs
  const mainTabs = [
    { name: 'General', icon: <TuneRounded sx={{ fontSize: 28 }} />, color: '#3b82f6' },
    { name: 'Services', icon: <ApiRounded sx={{ fontSize: 28 }} />, color: '#10b981' },
    { name: 'Jobs', icon: <WorkRounded sx={{ fontSize: 28 }} />, color: '#8b5cf6' }
  ];

  // Define category order for General tab (configuration categories)
  const generalCategoryOrder = [
    'Directory Paths', // General - must be first
    'CineSync Configuration', // CineSync - core CineSync settings
    'Media Folders Configuration', // Media Folders - custom folder organization
    'Resolution Folder Mappings Configuration', // Resolution Mappings - quality-based folders
    'TMDb/IMDB Configuration', // TMDB Configuration - movie & TV metadata
    'Renaming Structure Configuration', // Renaming Structure - file renaming & metadata
    'Plex Integration Configuration', // Plex Integration
    'Database Configuration', // Database
    'Real-Time Monitoring Configuration', // Monitoring
    'System Configuration', // Advanced
  ];

  // Group config by category
  const configByCategory = config.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ConfigValue[]>);

  // Sort fields within each category - prioritize source/destination paths
  Object.keys(configByCategory).forEach(category => {
    configByCategory[category].sort((a, b) => {
      // For Directory Paths category, prioritize source and destination directories
      if (category === 'Directory Paths') {
        const sourceDestOrder = ['SOURCE_DIR', 'DESTINATION_DIR'];
        const aIndex = sourceDestOrder.indexOf(a.key);
        const bIndex = sourceDestOrder.indexOf(b.key);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      // For CineSync Configuration category, prioritize server settings then auth
      if (category === 'CineSync Configuration') {
        const cinesyncOrder = ['CINESYNC_IP', 'CINESYNC_API_PORT', 'CINESYNC_UI_PORT', 'CINESYNC_AUTH_ENABLED', 'CINESYNC_USERNAME', 'CINESYNC_PASSWORD'];
        const aIndex = cinesyncOrder.indexOf(a.key);
        const bIndex = cinesyncOrder.indexOf(b.key);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      // For Media Folders Configuration category, prioritize CineSync Layout first
      if (category === 'Media Folders Configuration') {
        const mediaFoldersOrder = ['CINESYNC_LAYOUT', '4K_SEPARATION', 'ANIME_SEPARATION', 'KIDS_SEPARATION'];
        const aIndex = mediaFoldersOrder.indexOf(a.key);
        const bIndex = mediaFoldersOrder.indexOf(b.key);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      // For Resolution Mappings category, prioritize structure settings at the top
      if (category === 'Resolution Folder Mappings Configuration') {
        const resolutionStructureOrder = ['MOVIE_RESOLUTION_STRUCTURE', 'SHOW_RESOLUTION_STRUCTURE'];
        const aIndex = resolutionStructureOrder.indexOf(a.key);
        const bIndex = resolutionStructureOrder.indexOf(b.key);

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
      }

      // For all categories, sort by required first, then alphabetically
      if (a.required !== b.required) {
        return a.required ? -1 : 1;
      }
      return a.key.localeCompare(b.key);
    });
  });

  // Create ordered categories array based on selected main tab
  const orderedCategories = selectedMainTab === 0
    ? generalCategoryOrder
        .filter(category => configByCategory[category])
        .map(category => [category, configByCategory[category]] as [string, ConfigValue[]])
    : [];

  const hasChanges = Object.keys(pendingChanges).length > 0;

  const totalChanges = Object.keys(pendingChanges).length;

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          bgcolor: 'background.default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h6" color="text.secondary">
          Loading configuration...
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: 'background.default',
      }}
    >
      <Container maxWidth="lg" sx={{ py: { xs: 1, sm: 2, md: 2 }, px: { xs: 1, sm: 2 } }}>
        {/* Clean Professional Header */}
        <Box sx={{ mb: { xs: 2, sm: 3, md: 4 } }}>
          <Stack
            direction="row"
            alignItems="flex-start"
            justifyContent="space-between"
            spacing={1}
            sx={{ mb: { xs: 1, sm: 4 } }}
          >
            <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
              <Typography
                variant="h3"
                fontWeight="600"
                sx={{
                  color: 'text.primary',
                  mb: 1,
                  letterSpacing: '-0.02em',
                  fontSize: { xs: '2rem', sm: '3rem' },
                }}
              >
                Settings
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                flexShrink: 0,
                alignItems: 'center',
                pt: { xs: 0, sm: 0 }
              }}
            >
              <IconButton
                onClick={fetchConfig}
                disabled={loading || saving}
                sx={{
                  bgcolor: 'background.paper',
                  border: '1px solid',
                  borderColor: 'divider',
                  width: { xs: 40, sm: 'auto' },
                  height: { xs: 40, sm: 'auto' },
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <Refresh sx={{ fontSize: { xs: 20, sm: 24 } }} />
              </IconButton>
              {hasChanges && (
                <LoadingButton
                  variant="contained"
                  startIcon={<Save sx={{ fontSize: { xs: 16, sm: 20 } }} />}
                  loading={saving}
                  onClick={() => setShowConfirmDialog(true)}
                  sx={{
                    px: { xs: 1.5, sm: 3 },
                    py: { xs: 1, sm: 1.5 },
                    borderRadius: 2,
                    textTransform: 'none',
                    fontWeight: 600,
                    boxShadow: 'none',
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    minWidth: { xs: 'auto', sm: 'auto' },
                    '&:hover': {
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                    },
                  }}
                >
                  <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
                    Save {totalChanges} Changes
                  </Box>
                  <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
                    Save
                  </Box>
                </LoadingButton>
              )}
            </Stack>
          </Stack>

          {/* Subtitle on its own line */}
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{
              fontWeight: { xs: 400, sm: 500 },
              fontSize: { xs: '0.875rem', sm: '1.125rem' },
              lineHeight: { xs: 1.4, sm: 1.6 },
              mb: { xs: 2, sm: 3 },
              letterSpacing: { xs: 'normal', sm: '0.01em' }
            }}
          >
            Configure your CineSync environment variables
          </Typography>

          {/* Configuration Status Alert */}
          {configStatus?.needsConfiguration && (
            <Box
              sx={{
                p: { xs: 2.5, sm: 3 },
                bgcolor: alpha(theme.palette.error.main, 0.1),
                borderRadius: 3,
                border: '1px solid',
                borderColor: alpha(theme.palette.error.main, 0.3),
                mb: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  bgcolor: 'error.main',
                  color: 'error.contrastText',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                !
              </Box>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.primary',
                  fontWeight: 500,
                  fontSize: { xs: '0.875rem', sm: '0.9rem' },
                  lineHeight: 1.4,
                }}
              >
                Configuration required: DESTINATION_DIR is not properly set. Please update the destination directory path below.
              </Typography>
            </Box>
          )}

          {/* Status Alert */}
          {hasChanges && (
            <Box
              sx={{
                p: { xs: 2.5, sm: 3 },
                bgcolor: alpha(theme.palette.warning.main, 0.1),
                borderRadius: 3,
                border: '1px solid',
                borderColor: alpha(theme.palette.warning.main, 0.3),
                mb: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box
                sx={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  bgcolor: 'warning.main',
                  color: 'warning.contrastText',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                {totalChanges}
              </Box>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.primary',
                  fontWeight: 500,
                  fontSize: { xs: '0.875rem', sm: '0.9rem' },
                  lineHeight: 1.4,
                }}
              >
                You have {totalChanges} unsaved change{totalChanges !== 1 ? 's' : ''}. Don't forget to save your configuration.
              </Typography>
            </Box>
          )}
        </Box>

        {/* Main Tab Navigation */}
        <Box sx={{ mb: 4 }}>
          <Box
            sx={{
              display: 'flex',
              gap: 0.5,
              p: 0.5,
              bgcolor: alpha(theme.palette.background.paper, 0.8),
              borderRadius: 3,
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.5),
              width: { xs: '100%', sm: 'fit-content' },
              maxWidth: '100%',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
              overflowX: { xs: 'auto', sm: 'visible' },
              '&::-webkit-scrollbar': {
                display: 'none',
              },
              scrollbarWidth: 'none',
            }}
          >
            {mainTabs.map((tab, index) => {
              const isSelected = selectedMainTab === index;
              return (
                <Box
                  key={tab.name}
                  onClick={() => {
                    setSelectedMainTab(index);
                    setSelectedTab(0); // Reset sub-tab selection
                  }}
                  sx={{
                    cursor: 'pointer',
                    px: { xs: 1.5, sm: 4 },
                    py: { xs: 1, sm: 2 },
                    borderRadius: 2.5,
                    bgcolor: isSelected
                      ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                      : 'transparent',
                    background: isSelected
                      ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                      : 'transparent',
                    color: isSelected ? 'white' : 'text.primary',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    flex: { xs: '1 1 0', sm: '0 0 auto' },
                    minWidth: { xs: 0, sm: 'auto' },
                    whiteSpace: 'nowrap',
                    position: 'relative',
                    overflow: 'hidden',
                    '&:hover': {
                      bgcolor: isSelected
                        ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                        : alpha(tab.color, 0.1),
                      background: isSelected
                        ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                        : alpha(tab.color, 0.1),
                      transform: 'translateY(-1px)',
                      boxShadow: isSelected
                        ? `0 12px 24px ${alpha(tab.color, 0.3)}`
                        : `0 4px 12px ${alpha(tab.color, 0.2)}`,
                    },
                    '&:active': {
                      transform: 'translateY(0px)',
                    },
                    '&::before': isSelected ? {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: `linear-gradient(135deg, ${alpha('#ffffff', 0.1)} 0%, transparent 50%)`,
                      borderRadius: 'inherit',
                      pointerEvents: 'none',
                    } : {},
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 1.5 }} sx={{ minWidth: 0, justifyContent: 'center' }}>
                    <Box
                      sx={{
                        width: { xs: 18, sm: 24 },
                        height: { xs: 18, sm: 24 },
                        borderRadius: 1,
                        bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : alpha(tab.color, 0.15),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isSelected ? 'white' : tab.color,
                        transition: 'all 0.3s ease',
                        flexShrink: 0,
                        '& svg': {
                          fontSize: { xs: 14, sm: 18 },
                          filter: isSelected ? 'none' : 'none',
                        },
                      }}
                    >
                      {tab.icon}
                    </Box>
                    <Typography
                      variant="body1"
                      fontWeight="600"
                      sx={{
                        fontSize: { xs: '0.8rem', sm: '1rem' },
                        letterSpacing: '0.02em',
                        flexShrink: 0,
                        minWidth: 0,
                        textAlign: 'center',
                      }}
                    >
                      {tab.name}
                    </Typography>
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* Sub-Tab Navigation (only for General) */}
        {selectedMainTab === 0 && (
        <Box sx={{ mb: 4, position: 'relative' }}>
          {/* Desktop: Clean Horizontal Tabs */}
          <Box
            sx={{
              display: { xs: 'none', lg: 'block' },
              mb: 2,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                gap: 0.5,
                p: 0.5,
                bgcolor: 'background.paper',
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                overflowX: 'auto',
                '&::-webkit-scrollbar': {
                  height: 6,
                },
                '&::-webkit-scrollbar-track': {
                  bgcolor: 'transparent',
                },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: 'divider',
                  borderRadius: 3,
                  '&:hover': {
                    bgcolor: 'text.secondary',
                  },
                },
              }}
            >
              {orderedCategories.map(([category, items], index) => {
                const categoryInfo = getCategoryInfo(category, items);
                const isSelected = selectedTab === index;
                const hasModifications = categoryInfo.modifiedCount > 0;

                return (
                  <Box
                    key={category}
                    onClick={() => setSelectedTab(index)}
                    sx={{
                      cursor: 'pointer',
                      px: 2,
                      py: 1.5,
                      borderRadius: 1.5,
                      bgcolor: isSelected ? 'primary.main' : 'transparent',
                      color: isSelected ? 'primary.contrastText' : 'text.primary',
                      transition: 'all 0.2s ease-in-out',
                      minWidth: 'fit-content',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      position: 'relative',
                      '&:hover': {
                        bgcolor: isSelected ? 'primary.main' : 'action.hover',
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box
                        sx={{
                          width: 20,
                          height: 20,
                          borderRadius: 0.5,
                          bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : categoryInfo.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          '& svg': { fontSize: 14 },
                        }}
                      >
                        {categoryInfo.icon}
                      </Box>
                      <Typography
                        variant="body2"
                        fontWeight="500"
                        sx={{
                          fontSize: '0.875rem',
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        {categoryInfo.name}
                      </Typography>
                      {hasModifications && (
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            bgcolor: 'warning.main',
                            color: 'warning.contrastText',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.65rem',
                            fontWeight: 600,
                          }}
                        >
                          {categoryInfo.modifiedCount}
                        </Box>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          </Box>

          {/* Tablet: Scrollable with Navigation Arrows */}
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex', lg: 'none' },
              alignItems: 'center',
              gap: 1,
            }}
          >
            <IconButton
              onClick={() => {
                const container = document.getElementById('tab-scroll-container');
                if (container) {
                  container.scrollBy({ left: -200, behavior: 'smooth' });
                }
              }}
              sx={{
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <ChevronLeft />
            </IconButton>

            <Box
              id="tab-scroll-container"
              sx={{
                display: 'flex',
                gap: 1.5,
                overflowX: 'auto',
                scrollBehavior: 'smooth',
                flex: 1,
                py: 1,
                // Custom scrollbar for tablet
                '&::-webkit-scrollbar': {
                  height: 4,
                },
                '&::-webkit-scrollbar-track': {
                  bgcolor: 'divider',
                  borderRadius: 2,
                },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: 'primary.main',
                  borderRadius: 2,
                  '&:hover': {
                    bgcolor: 'primary.dark',
                  },
                },
              }}
            >
              {orderedCategories.map(([category, items], index) => {
                const categoryInfo = getCategoryInfo(category, items);
                const isSelected = selectedTab === index;
                const hasModifications = categoryInfo.modifiedCount > 0;

                return (
                  <Box
                    key={category}
                    onClick={() => setSelectedTab(index)}
                    sx={{
                      cursor: 'pointer',
                      px: 3,
                      py: 2,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      bgcolor: isSelected ? 'primary.main' : 'background.paper',
                      color: isSelected ? 'primary.contrastText' : 'text.primary',
                      transition: 'all 0.2s ease-in-out',
                      minWidth: 'fit-content',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: isSelected ? 'primary.main' : 'action.hover',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box
                        sx={{
                          width: 20,
                          height: 20,
                          borderRadius: 0.5,
                          bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : categoryInfo.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          '& svg': { fontSize: 14 },
                        }}
                      >
                        {categoryInfo.icon}
                      </Box>
                      <Typography
                        variant="body2"
                        fontWeight="600"
                        sx={{ fontSize: '0.875rem' }}
                      >
                        {categoryInfo.name}
                      </Typography>
                      {hasModifications && (
                        <Chip
                          label={categoryInfo.modifiedCount}
                          size="small"
                          color="warning"
                          sx={{
                            height: 18,
                            fontSize: '0.7rem',
                            '& .MuiChip-label': { px: 0.5 },
                          }}
                        />
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>

            <IconButton
              onClick={() => {
                const container = document.getElementById('tab-scroll-container');
                if (container) {
                  container.scrollBy({ left: 200, behavior: 'smooth' });
                }
              }}
              sx={{
                bgcolor: 'background.paper',
                border: '1px solid',
                borderColor: 'divider',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <ChevronRight />
            </IconButton>
          </Box>

          {/* Mobile: Larger Scrollable Tabs */}
          <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
            <Box
              sx={{
                display: 'flex',
                gap: 1.5,
                overflowX: 'auto',
                scrollBehavior: 'smooth',
                pb: 1.5,
                px: 0.5,
                scrollbarWidth: 'none',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              {orderedCategories.map(([category, items], index) => {
                const categoryInfo = getCategoryInfo(category, items);
                const isSelected = selectedTab === index;
                const hasModifications = categoryInfo.modifiedCount > 0;

                return (
                  <Box
                    key={category}
                    onClick={() => setSelectedTab(index)}
                    sx={{
                      cursor: 'pointer',
                      px: 3,
                      py: 2.5,
                      borderRadius: 3,
                      border: '1px solid',
                      borderColor: isSelected ? 'primary.main' : 'divider',
                      bgcolor: isSelected ? 'primary.main' : 'background.paper',
                      color: isSelected ? 'primary.contrastText' : 'text.primary',
                      transition: 'all 0.2s ease-in-out',
                      minWidth: 'fit-content',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      '&:hover': {
                        borderColor: 'primary.main',
                        bgcolor: isSelected ? 'primary.main' : 'action.hover',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                      },
                      '&:active': {
                        transform: 'translateY(0px)',
                      },
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1.5}>
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: 1,
                          bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : categoryInfo.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          '& svg': { fontSize: 16 },
                        }}
                      >
                        {categoryInfo.icon}
                      </Box>
                      <Typography
                        variant="body2"
                        fontWeight="600"
                        sx={{
                          fontSize: '0.875rem',
                          lineHeight: 1.2,
                        }}
                      >
                        {categoryInfo.name.split(' ')[0]}
                      </Typography>
                      {hasModifications && (
                        <Box
                          sx={{
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            bgcolor: 'warning.main',
                            color: 'warning.contrastText',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {categoryInfo.modifiedCount}
                        </Box>
                      )}
                    </Stack>
                  </Box>
                );
              })}
            </Box>

            {/* Scroll indicators for mobile */}
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'center',
                mt: 1,
                gap: 0.5,
              }}
            >
              {orderedCategories.map((_, index) => (
                <Box
                  key={index}
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: selectedTab === index ? 'primary.main' : 'divider',
                    transition: 'all 0.2s ease-in-out',
                  }}
                />
              ))}
            </Box>
          </Box>
        </Box>
        )}

        {/* Tab Content */}
        {selectedMainTab === 0 && orderedCategories[selectedTab] && (() => {
          const [currentCategory, items] = orderedCategories[selectedTab];

          // Special layout for Resolution Mappings category
          if (currentCategory === 'Resolution Folder Mappings Configuration') {
            // Separate items into movies, shows, and structure settings
            const structureSettings = items.filter(item =>
              item.key === 'MOVIE_RESOLUTION_STRUCTURE' || item.key === 'SHOW_RESOLUTION_STRUCTURE'
            );
            const movieSettings = items.filter(item =>
              item.key.includes('MOVIE') && !structureSettings.includes(item)
            );
            const showSettings = items.filter(item =>
              item.key.includes('SHOW') && !structureSettings.includes(item)
            );

            return (
              <Box>
                {/* Structure Settings at the top */}
                {structureSettings.length > 0 && (
                  <Box sx={{ mb: 4 }}>
                    <Typography
                      variant="h6"
                      fontWeight="600"
                      sx={{ mb: 3, color: 'text.primary' }}
                    >
                      Resolution Structure Settings
                    </Typography>
                    <Grid container spacing={3}>
                      {structureSettings.map((item) => (
                        <Grid
                          key={item.key}
                          size={{
                            xs: 12,
                            md: 6
                          }}>
                          <Box
                            sx={{
                              p: 3,
                              bgcolor: 'background.paper',
                              border: '1px solid',
                              borderColor: pendingChanges[item.key] !== undefined
                                ? 'warning.main'
                                : 'divider',
                              borderRadius: 3,
                              transition: 'all 0.2s ease-in-out',
                              '&:hover': {
                                borderColor: 'primary.main',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                                transform: 'translateY(-1px)',
                              },
                            }}
                          >
                            <Stack spacing={2}>
                              <Box>
                                <Typography
                                  variant="subtitle2"
                                  fontWeight="600"
                                  sx={{
                                    color: 'text.primary',
                                    mb: 0.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    flexWrap: 'wrap',
                                  }}
                                >
                                  {formatFieldLabel(item.key)}
                                  {item.required && (
                                    <Chip
                                      label="Required"
                                      size="small"
                                      color="error"
                                      variant="outlined"
                                      sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                  )}
                                  {pendingChanges[item.key] !== undefined && (
                                    <Chip
                                      label="Modified"
                                      size="small"
                                      color="warning"
                                      sx={{ height: 20, fontSize: '0.7rem' }}
                                    />
                                  )}
                                </Typography>
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{ mb: 2, lineHeight: 1.4 }}
                                >
                                  {item.description}
                                </Typography>
                              </Box>
                              <FormField
                                label=""
                                value={getFieldValue(item)}
                                onChange={(value) => handleFieldChange(item.key, value)}
                                type={getFieldType(item)}
                                required={item.required}
                                options={getFieldOptions(item)}
                                multiline={item.type === 'array' || item.key.includes('TAGS')}
                                rows={item.type === 'array' ? 2 : 1}
                                beta={item.beta}
                                disabled={item.disabled}
                                disabledReason={item.disabled ? "This feature is currently in beta testing and is disabled for usage." : undefined}
                                locked={item.locked}
                                lockedBy={item.lockedBy}
                              />
                            </Stack>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>
                  </Box>
                )}
                {/* Movie and Show Columns */}
                <Grid container spacing={4}>
                  {/* Movie Settings Column */}
                  <Grid
                    size={{
                      xs: 12,
                      md: 6
                    }}>
                    <Box
                      sx={{
                        p: 3,
                        bgcolor: alpha(theme.palette.primary.main, 0.05),
                        border: '1px solid',
                        borderColor: alpha(theme.palette.primary.main, 0.2),
                        borderRadius: 3,
                        mb: 2,
                      }}
                    >
                      <Typography
                        variant="h6"
                        fontWeight="600"
                        sx={{
                          color: 'primary.main',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          mb: 2,
                        }}
                      >
                        🎬 Movie Settings
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ lineHeight: 1.4 }}
                      >
                        Configure resolution folder mappings for movies
                      </Typography>
                    </Box>
                    <Stack spacing={3}>
                      {movieSettings.map((item) => (
                        <Box
                          key={item.key}
                          sx={{
                            p: 3,
                            bgcolor: 'background.paper',
                            border: '1px solid',
                            borderColor: pendingChanges[item.key] !== undefined
                              ? 'warning.main'
                              : 'divider',
                            borderRadius: 3,
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              borderColor: 'primary.main',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Stack spacing={2}>
                            <Box>
                              <Typography
                                variant="subtitle2"
                                fontWeight="600"
                                sx={{
                                  color: 'text.primary',
                                  mb: 0.5,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {formatFieldLabel(item.key)}
                                {item.required && (
                                  <Chip
                                    label="Required"
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                  />
                                )}
                                {pendingChanges[item.key] !== undefined && (
                                  <Chip
                                    label="Modified"
                                    size="small"
                                    color="warning"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                  />
                                )}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 2, lineHeight: 1.4 }}
                              >
                                {item.description}
                              </Typography>
                            </Box>
                            <FormField
                              label=""
                              value={getFieldValue(item)}
                              onChange={(value) => handleFieldChange(item.key, value)}
                              type={getFieldType(item)}
                              required={item.required}
                              options={getFieldOptions(item)}
                              multiline={item.type === 'array' || item.key.includes('TAGS')}
                              rows={item.type === 'array' ? 2 : 1}
                              beta={item.beta}
                              disabled={item.disabled}
                              disabledReason={item.disabled ? "This feature is currently in beta testing and is disabled for usage." : undefined}
                              locked={item.locked}
                              lockedBy={item.lockedBy}
                            />
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </Grid>

                  {/* Show Settings Column */}
                  <Grid
                    size={{
                      xs: 12,
                      md: 6
                    }}>
                    <Box
                      sx={{
                        p: 3,
                        bgcolor: alpha(theme.palette.secondary.main, 0.05),
                        border: '1px solid',
                        borderColor: alpha(theme.palette.secondary.main, 0.2),
                        borderRadius: 3,
                        mb: 2,
                      }}
                    >
                      <Typography
                        variant="h6"
                        fontWeight="600"
                        sx={{
                          color: 'secondary.main',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          mb: 2,
                        }}
                      >
                        📺 TV Show Settings
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ lineHeight: 1.4 }}
                      >
                        Configure resolution folder mappings for TV shows
                      </Typography>
                    </Box>
                    <Stack spacing={3}>
                      {showSettings.map((item) => (
                        <Box
                          key={item.key}
                          sx={{
                            p: 3,
                            bgcolor: 'background.paper',
                            border: '1px solid',
                            borderColor: pendingChanges[item.key] !== undefined
                              ? 'warning.main'
                              : 'divider',
                            borderRadius: 3,
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              borderColor: 'secondary.main',
                              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                              transform: 'translateY(-1px)',
                            },
                          }}
                        >
                          <Stack spacing={2}>
                            <Box>
                              <Typography
                                variant="subtitle2"
                                fontWeight="600"
                                sx={{
                                  color: 'text.primary',
                                  mb: 0.5,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1,
                                  flexWrap: 'wrap',
                                }}
                              >
                                {formatFieldLabel(item.key)}
                                {item.required && (
                                  <Chip
                                    label="Required"
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                  />
                                )}
                                {pendingChanges[item.key] !== undefined && (
                                  <Chip
                                    label="Modified"
                                    size="small"
                                    color="warning"
                                    sx={{ height: 20, fontSize: '0.7rem' }}
                                  />
                                )}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 2, lineHeight: 1.4 }}
                              >
                                {item.description}
                              </Typography>
                            </Box>
                            <FormField
                              label=""
                              value={getFieldValue(item)}
                              onChange={(value) => handleFieldChange(item.key, value)}
                              type={getFieldType(item)}
                              required={item.required}
                              options={getFieldOptions(item)}
                              multiline={item.type === 'array' || item.key.includes('TAGS')}
                              rows={item.type === 'array' ? 2 : 1}
                              beta={item.beta}
                              disabled={item.disabled}
                              disabledReason={item.disabled ? "This feature is currently in beta testing and is disabled for usage." : undefined}
                              locked={item.locked}
                              lockedBy={item.lockedBy}
                            />
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  </Grid>
                </Grid>
              </Box>
            );
          }

          // Default layout for all other categories
          return (
            <Grid container spacing={3}>
              {items.map((item) => (
                <Grid
                  key={item.key}
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Box
                    sx={{
                      p: 3,
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: pendingChanges[item.key] !== undefined
                        ? 'warning.main'
                        : 'divider',
                      borderRadius: 3,
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        borderColor: 'primary.main',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                        transform: 'translateY(-1px)',
                      },
                    }}
                  >
                    <Stack spacing={2}>
                      <Box>
                        <Typography
                          variant="subtitle2"
                          fontWeight="600"
                          sx={{
                            color: 'text.primary',
                            mb: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            flexWrap: 'wrap',
                          }}
                        >
                          {formatFieldLabel(item.key)}
                          {item.required && (
                            <Chip
                              label="Required"
                              size="small"
                              color="error"
                              variant="outlined"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                          {pendingChanges[item.key] !== undefined && (
                            <Chip
                              label="Modified"
                              size="small"
                              color="warning"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                          )}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mb: 2, lineHeight: 1.4 }}
                        >
                          {item.description}
                        </Typography>
                      </Box>
                      <FormField
                        label=""
                        value={getFieldValue(item)}
                        onChange={(value) => handleFieldChange(item.key, value)}
                        type={getFieldType(item)}
                        required={item.required}
                        options={getFieldOptions(item)}
                        multiline={item.type === 'array' || item.key.includes('TAGS')}
                        rows={item.type === 'array' ? 2 : 1}
                        beta={item.beta}
                        disabled={item.disabled}
                        disabledReason={item.disabled ? "This feature is currently in beta testing and is disabled for usage." : undefined}
                        locked={item.locked}
                        lockedBy={item.lockedBy}
                      />
                    </Stack>
                  </Box>
                </Grid>
              ))}
            </Grid>
          );
        })()}

        {/* Services Tab Content */}
        {selectedMainTab === 1 && (
          <Box>
            <MediaHubService />
          </Box>
        )}

        {/* Jobs Tab Content */}
        {selectedMainTab === 2 && (
          <Box>
            <JobsTable onRefresh={fetchConfig} />
          </Box>
        )}
      </Container>
      {/* Confirm Dialog */}
      <ConfirmDialog
        open={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleSave}
        title="Save Configuration"
        message={`Are you sure you want to save ${Object.keys(pendingChanges).length} configuration changes? This will update your .env file.`}
        confirmText="Save Changes"
        type="info"
        loading={saving}
      />
      {/* Snackbars */}
      <Snackbar
        open={!!error}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setError(null)} severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar
        open={!!success}
        autoHideDuration={4000}
        onClose={() => setSuccess(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setSuccess(null)} severity="success" sx={{ width: '100%' }}>
          {success}
        </Alert>
      </Snackbar>
      {/* Save Loading Overlay */}
      <Backdrop
        sx={{
          color: '#fff',
          zIndex: (theme) => theme.zIndex.drawer + 1,
          backdropFilter: 'blur(8px)',
          bgcolor: alpha(theme.palette.background.default, 0.8),
        }}
        open={saving}
      >
        <Fade in={saving}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              p: 4,
              borderRadius: 3,
              bgcolor: alpha(theme.palette.background.paper, 0.9),
              border: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.2),
              boxShadow: '0 24px 48px rgba(0, 0, 0, 0.2)',
              backdropFilter: 'blur(20px)',
              minWidth: 280,
              textAlign: 'center',
            }}
          >
            <Box sx={{ position: 'relative' }}>
              <CircularProgress
                size={60}
                thickness={4}
                sx={{
                  color: 'primary.main',
                  '& .MuiCircularProgress-circle': {
                    strokeLinecap: 'round',
                  },
                }}
              />
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'primary.contrastText',
                }}
              >
                <Save sx={{ fontSize: 18 }} />
              </Box>
            </Box>

            <Box>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 600,
                  color: 'text.primary',
                  mb: 1,
                }}
              >
                Saving Configuration
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: 'text.secondary',
                  lineHeight: 1.5,
                }}
              >
                Updating {totalChanges} setting{totalChanges !== 1 ? 's' : ''}...
                <br />
                Please wait while we save your changes.
              </Typography>
            </Box>
          </Box>
        </Fade>
      </Backdrop>
    </Box>
  );
};

export default Settings;
