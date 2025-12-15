import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Container, Divider, LinearProgress, Paper, Snackbar, Stack, Tooltip, Typography, alpha, useTheme, Fade, Collapse, IconButton, useMediaQuery } from '@mui/material';
import { RocketLaunchRounded, FolderSpecialRounded, CloudRounded, CheckCircleRounded, WarningAmberRounded, RefreshRounded, SaveRounded, BoltRounded, SettingsRounded, DriveFileRenameOutlineRounded, NetworkCheckRounded, LiveTvRounded, ApiRounded, StorageRounded, ChevronLeft, ChevronRight, SettingsApplicationsRounded, ExpandMore as ExpandMoreIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { FormField } from '../components/Settings/FormField';
import RcloneSettings from '../components/Debrid/Settings/RcloneSettings';
import RealDebridSettings from '../components/Settings/RealDebridSettings';
import logoImage from '../assets/logo.png';

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
  hidden?: boolean;
}

interface ConfigResponse {
  config: ConfigValue[];
  status: string;
}

interface ConfigStatus {
  isPlaceholder: boolean;
  destinationDir: string;
  effectiveRootDir: string;
  needsConfiguration: boolean;
}

type Step = {
  id: string;
  title: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  keys: string[];
};

const wizardSteps: Step[] = [
  {
    id: 'paths',
    title: 'Directories',
    description: 'Source & destination roots',
    accent: '#22c55e',
    icon: <FolderSpecialRounded />,
    keys: ['SOURCE_DIR', 'DESTINATION_DIR', 'USE_SOURCE_STRUCTURE'],
  },
  {
    id: 'realdebrid',
    title: 'Real-Debrid',
    description: 'API keys and HTTP DAV access',
    accent: '#f97316',
    icon: <ApiRounded />,
    keys: [],
  },
  {
    id: 'rclone',
    title: 'Rclone Mount',
    description: 'Built-in rclone mount for Real-Debrid',
    accent: '#0ea5e9',
    icon: <CloudRounded />,
    keys: [],
  },
  {
    id: 'organization',
    title: 'Media Organization',
    description: 'CineSync layout, 4K/Anime/Kids splits, custom folders',
    accent: '#8b5cf6',
    icon: <SettingsRounded />,
    keys: [
      'CINESYNC_LAYOUT',
      'ANIME_SEPARATION',
      '4K_SEPARATION',
      'KIDS_SEPARATION',
      'MOVIE_COLLECTION_ENABLED',
      'CUSTOM_SHOW_FOLDER',
      'CUSTOM_4KSHOW_FOLDER',
      'CUSTOM_ANIME_SHOW_FOLDER',
      'CUSTOM_MOVIE_FOLDER',
      'CUSTOM_4KMOVIE_FOLDER',
      'CUSTOM_ANIME_MOVIE_FOLDER',
      'CUSTOM_KIDS_MOVIE_FOLDER',
      'CUSTOM_KIDS_SHOW_FOLDER',
      'CUSTOM_SPORTS_FOLDER',
    ],
  },
  {
    id: 'resolution',
    title: 'Resolution Structure',
    description: 'Quality-based subfolders for shows and movies',
    accent: '#06b6d4',
    icon: <BoltRounded />,
    keys: [
      'SHOW_RESOLUTION_STRUCTURE',
      'SHOW_RESOLUTION_FOLDER_REMUX_4K',
      'SHOW_RESOLUTION_FOLDER_REMUX_1080P',
      'SHOW_RESOLUTION_FOLDER_REMUX_DEFAULT',
      'SHOW_RESOLUTION_FOLDER_2160P',
      'SHOW_RESOLUTION_FOLDER_1080P',
      'SHOW_RESOLUTION_FOLDER_720P',
      'SHOW_RESOLUTION_FOLDER_480P',
      'SHOW_RESOLUTION_FOLDER_DVD',
      'SHOW_RESOLUTION_FOLDER_DEFAULT',
      'MOVIE_RESOLUTION_STRUCTURE',
      'MOVIE_RESOLUTION_FOLDER_REMUX_4K',
      'MOVIE_RESOLUTION_FOLDER_REMUX_1080P',
      'MOVIE_RESOLUTION_FOLDER_REMUX_DEFAULT',
      'MOVIE_RESOLUTION_FOLDER_2160P',
      'MOVIE_RESOLUTION_FOLDER_1080P',
      'MOVIE_RESOLUTION_FOLDER_720P',
      'MOVIE_RESOLUTION_FOLDER_480P',
      'MOVIE_RESOLUTION_FOLDER_DVD',
      'MOVIE_RESOLUTION_FOLDER_DEFAULT',
    ],
  },
  {
    id: 'metadata',
    title: 'Metadata & IDs',
    description: 'TMDB key, language, ID formats, anime scan, originals',
    accent: '#a855f7',
    icon: <RocketLaunchRounded />,
    keys: [
      'TMDB_API_KEY',
      'LANGUAGE',
      'ORIGINAL_TITLE',
      'ORIGINAL_TITLE_COUNTRIES',
      'ANIME_SCAN',
      'JELLYFIN_ID_FORMAT',
      'TMDB_FOLDER_ID',
      'IMDB_FOLDER_ID',
      'TVDB_FOLDER_ID',
    ],
  },
  {
    id: 'renaming',
    title: 'Renaming',
    description: 'Enable renaming, MediaInfo usage, tags and formats',
    accent: '#f59e0b',
    icon: <DriveFileRenameOutlineRounded />,
    keys: [
      'RENAME_ENABLED',
      'MEDIAINFO_PARSER',
      'RENAME_TAGS',
      'MEDIAINFO_RADARR_TAGS',
      'MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT',
    ],
  },
  {
    id: 'system',
    title: 'System & Logging',
    description: 'Logging level, cores, workers, symlinks, rclone checks',
    accent: '#3b82f6',
    icon: <CloudRounded />,
    keys: ['LOG_LEVEL', 'RCLONE_MOUNT', 'MOUNT_CHECK_INTERVAL', 'RELATIVE_SYMLINK', 'MAX_CORES', 'MAX_PROCESSES'],
  },
  {
    id: 'files',
    title: 'File Handling',
    description: 'Extras handling, size limits, allowed extensions, skip patterns',
    accent: '#ef4444',
    icon: <WarningAmberRounded />,
    keys: [
      'SKIP_EXTRAS_FOLDER',
      'SHOW_EXTRAS_SIZE_LIMIT',
      'MOVIE_EXTRAS_SIZE_LIMIT',
      '4K_SHOW_EXTRAS_SIZE_LIMIT',
      '4K_MOVIE_EXTRAS_SIZE_LIMIT',
      'ALLOWED_EXTENSIONS',
      'SKIP_ADULT_PATTERNS',
      'SKIP_VERSIONS',
    ],
  },
  {
    id: 'monitoring',
    title: 'Monitoring',
    description: 'Real-time monitor intervals and cleanup',
    accent: '#0ea5e9',
    icon: <NetworkCheckRounded />,
    keys: ['SLEEP_TIME', 'SYMLINK_CLEANUP_INTERVAL'],
  },
  {
    id: 'plex',
    title: 'Plex',
    description: 'Plex updates and credentials',
    accent: '#f97316',
    icon: <LiveTvRounded />,
    keys: ['ENABLE_PLEX_UPDATE', 'PLEX_URL', 'PLEX_TOKEN'],
  },
  {
    id: 'server',
    title: 'CineSync Server',
    description: 'Bind IP, ports, and authentication',
    accent: '#3b82f6',
    icon: <ApiRounded />,
    keys: ['CINESYNC_IP', 'CINESYNC_API_PORT', 'CINESYNC_UI_PORT', 'CINESYNC_AUTH_ENABLED', 'CINESYNC_USERNAME', 'CINESYNC_PASSWORD'],
  },
  {
    id: 'services',
    title: 'MediaHub & RTM',
    description: 'Auto-start behaviors and file operations auto mode',
    accent: '#10b981',
    icon: <SettingsApplicationsRounded />,
    keys: ['MEDIAHUB_AUTO_START', 'RTM_AUTO_START', 'FILE_OPERATIONS_AUTO_MODE'],
  },
  {
    id: 'database',
    title: 'Database',
    description: 'DB throughput, retries, batching, workers',
    accent: '#6366f1',
    icon: <StorageRounded />,
    keys: ['DB_THROTTLE_RATE', 'DB_MAX_RETRIES', 'DB_RETRY_DELAY', 'DB_BATCH_SIZE', 'DB_MAX_WORKERS'],
  },
];

export default function SetupWizard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const { refreshAuthEnabled } = useAuth();

  const [configValues, setConfigValues] = useState<ConfigValue[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const configMap = useMemo(() => {
    const map: Record<string, ConfigValue> = {};
    configValues.forEach((c) => {
      map[c.key] = c;
    });
    return map;
  }, [configValues]);

  const curatedKeys = useMemo(() => new Set(wizardSteps.flatMap((s) => s.keys)), []);

  const [activeStep, setActiveStep] = useState(0);
  const [stepsOpen, setStepsOpen] = useState(!isMobile);
  const [rcloneSummary, setRcloneSummary] = useState<{ enabled: boolean; mountPath?: string; autoMountOnStart?: boolean; serveFromRclone?: boolean }>({
    enabled: false,
    mountPath: '',
    autoMountOnStart: false,
    serveFromRclone: false,
  });

  const fetchDefaults = async () => {
    try {
      const resp = await axios.get('/api/config/defaults', { headers: { 'Cache-Control': 'no-cache' } });
      if (resp.data?.defaults) {
        return resp.data.defaults as Record<string, string>;
      }
    } catch (err) {
      console.error('Failed to fetch defaults:', err);
    }
    return {};
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const defaults = await fetchDefaults();

      const [configRes, statusRes, rdConfigResp] = await Promise.all([
        axios.get<ConfigResponse>('/api/config', {
          headers: { 'Cache-Control': 'no-cache' },
          params: { t: Date.now() },
        }),
        axios.get<ConfigStatus>('/api/config-status'),
        axios.get('/api/realdebrid/config'),
      ]);

      const cfg = rdConfigResp?.data?.config?.rcloneSettings || {};
      setRcloneSummary({
        enabled: !!cfg.enabled,
        mountPath: cfg.mountPath || '',
        autoMountOnStart: !!cfg.autoMountOnStart,
        serveFromRclone: !!cfg.serveFromRclone,
      });

      const filteredConfig = (configRes.data.config || []).filter((c) => !c.hidden);
      const initial: Record<string, string> = {};
      filteredConfig.forEach((item) => {
        initial[item.key] = item.value || defaults[item.key] || '';
      });

      const prefilled = { ...defaults, ...initial };
      setConfigValues(filteredConfig);
      setValues(prefilled);
      setInitialValues(prefilled);
      setStatus(statusRes.data);

    } catch (err) {
      setError('Failed to load setup data. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    setStepsOpen(!isMobile);
  }, []);

  useEffect(() => {
    if (!loading && status && !status.needsConfiguration) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, status, navigate]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    Object.values(configMap).forEach((item) => {
      if (item.required && curatedKeys.has(item.key) && !(values[item.key] || '').trim()) {
        nextErrors[item.key] = 'Required for initial setup';
      }
    });
    setValidationErrors(nextErrors);
    return nextErrors;
  };

  const handleSave = async (): Promise<boolean> => {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setError('Please fill the required fields before saving.');
      return false;
    }

    const isFirstTime = status?.needsConfiguration;
    const isFinalStep = activeStep === wizardSteps.length - 1;

    const nextValues = { ...values };
    if (isFinalStep) {
      nextValues['SETUP_COMPLETED'] = 'true';
    }

    const updates = Object.entries(nextValues)
      .filter(([key, value]) => isFirstTime || value !== initialValues[key])
      .map(([key, value]) => ({
        key,
        value,
        type: configMap[key]?.type || 'string',
        required: configMap[key]?.required || false,
      }));

    if (updates.length === 0) {
      setSuccess('No changes to apply — you are already up to date.');
      return true;
    }

    try {
      setSaving(true);
      await axios.post('/api/config/update-silent', { updates });
      setSuccess('Configuration saved successfully');
      setError(null);
      setInitialValues(values);
      const statusRes = await axios.get<ConfigStatus>('/api/config-status');
      setStatus(statusRes.data);
      window.dispatchEvent(
        new CustomEvent('config-status-refresh', { detail: { timestamp: Date.now() } })
      );
      return true;
    } catch (err) {
      setError('Failed to save configuration. Please try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };


  const isToggleOn = (key: string) => {
    const v = (values[key] ?? '').toString().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes' || v === 'on';
  };

  const getToggleController = (key: string): string | null => {
    if (key.startsWith('SHOW_RESOLUTION_FOLDER_')) return 'SHOW_RESOLUTION_STRUCTURE';
    if (key.startsWith('MOVIE_RESOLUTION_FOLDER_')) return 'MOVIE_RESOLUTION_STRUCTURE';

    const mediaFolderKeys = [
      'CUSTOM_SHOW_FOLDER',
      'CUSTOM_4KSHOW_FOLDER',
      'CUSTOM_ANIME_SHOW_FOLDER',
      'CUSTOM_MOVIE_FOLDER',
      'CUSTOM_4KMOVIE_FOLDER',
      'CUSTOM_ANIME_MOVIE_FOLDER',
      'CUSTOM_KIDS_MOVIE_FOLDER',
      'CUSTOM_KIDS_SHOW_FOLDER',
      'CUSTOM_SPORTS_FOLDER',
    ];
    if (['CUSTOM_ANIME_SHOW_FOLDER', 'CUSTOM_ANIME_MOVIE_FOLDER'].includes(key)) return 'ANIME_SEPARATION';
    if (['CUSTOM_KIDS_SHOW_FOLDER', 'CUSTOM_KIDS_MOVIE_FOLDER'].includes(key)) return 'KIDS_SEPARATION';
    if (['CUSTOM_4KSHOW_FOLDER', 'CUSTOM_4KMOVIE_FOLDER'].includes(key)) return '4K_SEPARATION';
    if (mediaFolderKeys.includes(key)) return 'CINESYNC_LAYOUT';

    const renamingKeys = [
      'RENAME_TAGS',
    ];
    if (renamingKeys.includes(key)) return 'RENAME_ENABLED';

    const mediainfoFormats = [
      'MEDIAINFO_RADARR_TAGS',
      'MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT',
    ];
    if (mediainfoFormats.includes(key)) return 'MEDIAINFO_PARSER';

    return null;
  };

  const renderFields = (keys: string[]) => {
    const items = keys
      .map((key) => configMap[key])
      .filter(Boolean)
      .sort((a, b) => {
        const isBoolA = a!.type === 'boolean';
        const isBoolB = b!.type === 'boolean';
        if (isBoolA !== isBoolB) return isBoolA ? -1 : 1; // booleans first
        return a!.key.localeCompare(b!.key);
      });

    const mediainfoFormatKeys = [
      'MEDIAINFO_RADARR_TAGS',
      'MEDIAINFO_SONARR_STANDARD_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_DAILY_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_ANIME_EPISODE_FORMAT',
      'MEDIAINFO_SONARR_SEASON_FOLDER_FORMAT',
    ];

    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 2,
        }}
      >
        {items.map((item) => {
          const controller = getToggleController(item.key);
          const controlledDisabled = controller ? !isToggleOn(controller) : false;
          if (controller === 'MEDIAINFO_PARSER' && controlledDisabled && mediainfoFormatKeys.includes(item.key)) {
            return null;
          }
          const disabled = controlledDisabled || item.disabled || item.locked;

          return (
            <Box key={item.key} sx={{ minWidth: 0 }}>
              <FormField
                label={item.key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                value={values[item.key] ?? ''}
                onChange={(val) => handleChange(item.key, val)}
                type={
                  item.key.includes('PASSWORD') || item.key.includes('TOKEN') || item.key.includes('KEY')
                    ? 'password'
                    : item.type
                }
                required={item.required}
                description={item.description}
                error={validationErrors[item.key]}
                locked={item.locked}
                options={
                  item.type === 'boolean' || item.key.includes('_ENABLED')
                    ? ['true', 'false']
                    : undefined
                }
                disabled={disabled}
              />
            </Box>
          );
        })}
      </Box>
    );
  };

  if (loading) {
    return null;
  }

  if (!loading && status && !status.needsConfiguration) {
    return null;
  }

  const heroStatusChip = status?.needsConfiguration ? (
    <Chip
      color="warning"
      icon={<WarningAmberRounded />}
      label="Setup required"
      sx={{ fontWeight: 600 }}
    />
  ) : (
    <Chip
      color="success"
      icon={<CheckCircleRounded />}
      label="Ready"
      sx={{ fontWeight: 600 }}
    />
  );

  const step = wizardSteps[activeStep] || wizardSteps[0];
  const availableKeys = (step.keys || []).filter((key) => configMap[key]);
  const requiredInStep = availableKeys.filter((k) => configMap[k]?.required);
  const missingRequired = requiredInStep.filter((k) => !(values[k] || '').trim());
  const canProceed = missingRequired.length === 0;

  const booleanBlurbs: Record<string, string> = {
    USE_SOURCE_STRUCTURE: 'Preserve the exact folder structure from your source directory without applying CineSync\'s organized layout. This maintains your original organization but bypasses CineSync\'s categorization features. Not recommended for beginners.',
    CINESYNC_LAYOUT: 'Enable CineSync\'s curated folder layout for organized media.',
    ANIME_SEPARATION: 'Route anime into dedicated Anime folders.',
    '4K_SEPARATION': 'Split 4K content into its own folders.',
    KIDS_SEPARATION: 'Separate kids/family content into Kids folders.',
    SHOW_RESOLUTION_STRUCTURE: 'Add resolution-based subfolders for TV shows.',
    MOVIE_RESOLUTION_STRUCTURE: 'Add resolution-based subfolders for movies.',
    ORIGINAL_TITLE: 'Prefer original titles when available/allowed.',
    ANIME_SCAN: 'Use anime-aware scanning rules.',
    JELLYFIN_ID_FORMAT: 'Use Jellyfin-style ID tags ([tmdbid-12345]).',
    TMDB_FOLDER_ID: 'Name folders using TMDB IDs.',
    IMDB_FOLDER_ID: 'Name folders using IMDb IDs.',
    TVDB_FOLDER_ID: 'Name folders using TVDb IDs.',
    RENAME_ENABLED: 'Enable metadata-based file renaming.',
    MEDIAINFO_PARSER: 'Use MediaInfo to enrich rename metadata.',
    RCLONE_MOUNT: 'Verify rclone mount availability before proceeding.',
    RELATIVE_SYMLINK: 'Create relative symlinks instead of absolute paths.',
    SKIP_EXTRAS_FOLDER: 'Skip processing extras folders.',
    SKIP_ADULT_PATTERNS: 'Skip files matching adult patterns.',
    SKIP_VERSIONS: 'Skip extra versions of the same release group (avoid Version 2/3 when only the group differs).',
    ENABLE_PLEX_UPDATE: 'Trigger Plex library updates after processing.',
    CINESYNC_AUTH_ENABLED: 'Require authentication for UI/API.',
    MEDIAHUB_AUTO_START: 'Auto-start MediaHub service when CineSync starts.',
    RTM_AUTO_START: 'Auto-start standalone RTM on start.',
    FILE_OPERATIONS_AUTO_MODE: 'Run file operations automatically.',
  };
  const booleanKeysInStep = availableKeys.filter((k) => booleanBlurbs[k]);

  return (
    <Container maxWidth="lg" sx={{ py: 3, px: { xs: 1.5, sm: 2, md: 3 } }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, sm: 2.5, md: 4 },
          mb: 3,
          borderRadius: 3,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.12)}, ${alpha(
            theme.palette.secondary.main,
            0.12
          )})`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.25)}`,
        }}
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '14px',
                overflow: 'hidden',
                boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.2)}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={logoImage}
                alt="CineSync Logo"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: 'block'
                }}
              />
            </Box>
            <Box>
              <Typography variant="h4" fontWeight={800}>
                CineSync Guided Setup
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Configure CineSync step-by-step.
              </Typography>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            {heroStatusChip}
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Box sx={{ minWidth: { xs: '100%', md: 260 }, flexShrink: 0 }}>
              <Paper
                elevation={0}
                sx={{
                  p: { xs: 1, sm: 2 },
                  borderRadius: 2,
                  border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Steps ({activeStep + 1}/{wizardSteps.length})
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => setStepsOpen((o) => !o)}
                    sx={{
                      transform: stepsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s ease',
                    }}
                  >
                    <ExpandMoreIcon />
                  </IconButton>
                </Stack>
                 {!stepsOpen && (
                  <Box
                    sx={{
                      mb: 1,
                      px: 1,
                      py: 0.5,
                      borderRadius: 1.5,
                      border: `1px solid ${alpha(wizardSteps[activeStep].accent, 0.4)}`,
                      background: alpha(wizardSteps[activeStep].accent, 0.08),
                    }}
                  >
                    <Typography variant="body2" fontWeight={700}>
                      {wizardSteps[activeStep].title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {wizardSteps[activeStep].description}
                    </Typography>
                  </Box>
                )}
                 <Collapse in={stepsOpen} timeout={200} unmountOnExit>
                  <Stack spacing={1}>
                    {wizardSteps.map((s, idx) => {
                      const isActive = idx === activeStep;
                      const isFutureBlocked = idx > activeStep && !canProceed;
                      return (
                        <Paper
                          key={s.id}
                          elevation={0}
                          onClick={() => {
                            if (!isFutureBlocked) {
                              setActiveStep(idx);
                            }
                          }}
                          sx={{
                            p: { xs: 0.9, sm: 1.1, md: 1.2 },
                            borderRadius: 2,
                            cursor: isFutureBlocked ? 'not-allowed' : 'pointer',
                            border: `1px solid ${alpha(s.accent, isActive ? 0.8 : 0.3)}`,
                            background: alpha(s.accent, isActive ? 0.08 : 0.03),
                            transition: 'all 0.2s ease',
                            opacity: isFutureBlocked ? 0.5 : 1,
                          }}
                        >
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Box
                              sx={{
                                width: { xs: 24, sm: 28 },
                                height: { xs: 24, sm: 28 },
                                borderRadius: '8px',
                                bgcolor: alpha(s.accent, 0.2),
                                color: s.accent,
                                display: 'grid',
                                placeItems: 'center',
                                fontSize: { xs: 12, sm: 14 },
                              }}
                            >
                              {idx + 1}
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={700} noWrap>
                                {s.title}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" noWrap>
                                {s.description}
                              </Typography>
                            </Box>
                          </Stack>
                        </Paper>
                      );
                    })}
                  </Stack>
                </Collapse>
              </Paper>
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              {loading ? (
                <Paper sx={{ p: 3, borderRadius: 3 }}>
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <CircularProgress size={20} />
                      <Typography variant="body1">Loading configuration…</Typography>
                    </Stack>
                    <LinearProgress />
                  </Stack>
                </Paper>
               ) : activeStep < wizardSteps.length ? (
                <Fade in key={activeStep} timeout={250}>
                  <Paper
                    elevation={0}
                    sx={{
                      p: { xs: 1.75, sm: 2.25, md: 3 },
                      borderRadius: 3,
                      border: `1px solid ${alpha(step.accent, 0.18)}`,
                      background: alpha(step.accent, 0.04),
                    }}
                  >
                    <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '12px',
                          bgcolor: alpha(step.accent, 0.15),
                          color: step.accent,
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        {step.icon}
                      </Box>
                      <Box>
                        <Typography variant="h6" fontWeight={700}>
                          {step.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {step.description}
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} mb={2}>
                      <Chip
                        label={`${requiredInStep.length} required in this step`}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                      {missingRequired.length > 0 && (
                        <Chip
                          label={`${missingRequired.length} missing`}
                          size="small"
                          color="warning"
                          variant="filled"
                        />
                      )}
                    </Stack>
                    <Divider sx={{ mb: 2 }} />
                  {booleanKeysInStep.length > 0 && (
                    <Alert
                      severity="info"
                      icon={false}
                      sx={{
                        mb: 2,
                        borderRadius: 2,
                        bgcolor: alpha(step.accent, 0.08),
                        border: `1px solid ${alpha(step.accent, 0.2)}`,
                      }}
                    >
                      <Stack spacing={1}>
                        <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                          What these toggles do
                        </Typography>
                        <Stack spacing={0.75}>
                          {booleanKeysInStep.map((key) => (
                            <Stack key={key} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                              <Chip
                                label={key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                                size="small"
                                variant="outlined"
                              />
                              <Typography variant="body2" color="text.secondary">
                                {booleanBlurbs[key]}
                              </Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Stack>
                    </Alert>
                  )}
                  {step.id === 'metadata' ? (
                    <>
                      {configMap['TMDB_API_KEY'] && (
                        <Box
                          sx={{
                            mb: 2,
                            p: { xs: 1.5, sm: 2 },
                            borderRadius: 2,
                            border: `1px solid ${alpha(step.accent, 0.25)}`,
                            background: alpha(step.accent, 0.03),
                          }}
                        >
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                            TMDb API Key (Optional)
                          </Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                            Your TMDb API key for lookups. Leave empty to skip TMDb-powered metadata.
                          </Typography>
                          <FormField
                            label="TMDb Api Key"
                            value={values['TMDB_API_KEY'] ?? ''}
                            onChange={(val) => handleChange('TMDB_API_KEY', val)}
                            type="string"
                            required={false}
                            description={configMap['TMDB_API_KEY']?.description}
                            error={validationErrors['TMDB_API_KEY']}
                        locked={configMap['TMDB_API_KEY']?.locked}
                          />
                        </Box>
                      )}
                      {renderFields(availableKeys.filter((k) => k !== 'TMDB_API_KEY'))}
                    </>
                  ) : step.id === 'realdebrid' ? (
                    <Box>
                      <Alert
                        severity="info"
                        icon={false}
                        sx={{
                          mb: 2,
                          borderRadius: 2,
                          bgcolor: alpha(step.accent, 0.08),
                          border: `1px solid ${alpha(step.accent, 0.2)}`,
                        }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          Optional — Useful for file repair and inbuilt rclone mount
                        </Typography>
                      </Alert>
                      <Box
                        sx={{
                          p: { xs: 2, sm: 2.5 },
                          borderRadius: 3,
                          border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
                          background: alpha(theme.palette.primary.main, 0.03),
                          boxShadow: `0 10px 30px ${alpha(theme.palette.primary.main, 0.12)}`,
                        }}
                      >
                        <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
                          Real-Debrid account & HTTP DAV
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                          Configure your Real-Debrid API keys and HTTP DAV before mounting with rclone.
                        </Typography>
                        <RealDebridSettings stackInfoOnTop={true} />
                      </Box>
                    </Box>
                  ) : step.id === 'rclone' ? (
                    <Box>
                      <Alert
                        severity="info"
                        icon={false}
                        sx={{
                          mb: 2,
                          borderRadius: 2,
                          bgcolor: alpha(step.accent, 0.08),
                          border: `1px solid ${alpha(step.accent, 0.2)}`,
                        }}
                      >
                        <Typography variant="body2" fontWeight={600}>
                          Optional — Useful for inbuilt rclone mount
                        </Typography>
                      </Alert>
                      <Box
                        sx={{
                          p: { xs: 2, sm: 3 },
                          borderRadius: 3,
                          border: `1px solid ${alpha(step.accent, 0.25)}`,
                          background: `linear-gradient(135deg, ${alpha(step.accent, 0.09)}, ${alpha(step.accent, 0.02)})`,
                          boxShadow: `0 12px 40px ${alpha(step.accent, 0.25)}`,
                          overflow: 'hidden',
                        }}
                      >
                        <Stack spacing={2.25}>
                          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }} flexWrap="wrap">
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Box
                                sx={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 2,
                                  background: alpha(step.accent, 0.2),
                                  display: 'grid',
                                  placeItems: 'center',
                                  color: step.accent,
                                  boxShadow: `0 8px 24px ${alpha(step.accent, 0.25)}`,
                                }}
                              >
                                <CloudRounded />
                              </Box>
                              <Box>
                                <Typography variant="h6" fontWeight={800}>
                                  Rclone mount hub
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  Configure Real-Debrid mount, caching, and rate limits in-place.
                                </Typography>
                              </Box>
                            </Stack>
                            <Box sx={{ flexGrow: 1 }} />
                            <Stack direction="row" spacing={1} flexWrap="wrap">
                              <Chip
                                label={rcloneSummary.enabled ? 'Enabled' : 'Disabled'}
                                color={rcloneSummary.enabled ? 'success' : 'default'}
                                variant={rcloneSummary.enabled ? 'filled' : 'outlined'}
                                size="small"
                              />
                              {rcloneSummary.mountPath && (
                                <Chip label={rcloneSummary.mountPath} variant="outlined" size="small" />
                              )}
                              {rcloneSummary.autoMountOnStart && (
                                <Chip label="Auto-mount" color="primary" variant="outlined" size="small" />
                              )}
                              {rcloneSummary.serveFromRclone && (
                                <Chip label="Serving from rclone" color="info" variant="outlined" size="small" />
                              )}
                            </Stack>
                          </Stack>

                          <Typography variant="body2" color="text.secondary" fontWeight={700} sx={{ mb: 1 }}>
                            Rclone panel
                          </Typography>

                          <Collapse in timeout={220} unmountOnExit>
                            <Box
                              sx={{
                                borderRadius: 2.5,
                                border: `1px solid ${alpha(step.accent, 0.25)}`,
                                background: alpha(step.accent, 0.02),
                                p: { xs: 1, sm: 1.5, md: 2 },
                                maxHeight: { xs: 540, md: 640 },
                                overflowY: 'auto',
                                scrollbarWidth: 'thin',
                                '&::-webkit-scrollbar': { width: 6 },
                                '&::-webkit-scrollbar-thumb': { background: alpha(step.accent, 0.35), borderRadius: 999 },
                                '& .MuiCard-root': {
                                  background: alpha(step.accent, 0.03),
                                  boxShadow: 'none',
                                  border: `1px solid ${alpha(step.accent, 0.16)}`,
                                },
                                '& .MuiCardContent-root': {
                                  p: { xs: 1.25, sm: 1.75, md: 2 },
                                },
                                '& .MuiAlert-root': {
                                  borderRadius: 1.5,
                                },
                                '& .MuiButton-root': {
                                  textTransform: 'none',
                                },
                              }}
                            >
                              <RcloneSettings stackInfoOnTop />
                            </Box>
                          </Collapse>
                        </Stack>
                      </Box>
                    </Box>
                  ) : availableKeys.length ? (
                    renderFields(availableKeys)
                  ) : (
                    <Alert severity="info">No fields found for this step.</Alert>
                  )}
                   </Paper>
                 </Fade>
               ) : null}

              <Box
                sx={{
                  mt: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexWrap: 'wrap',
                }}
              >
                 <Button
                   type="button"
                   variant="outlined"
                   disabled={activeStep === 0}
                   onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
                   startIcon={<ChevronLeft />}
                 >
                   Back
                 </Button>
                 <Button
                   type="button"
                   variant="contained"
                   onClick={() => {
                     if (canProceed) {
                       setActiveStep((s) => Math.min(wizardSteps.length - 1, s + 1));
                     }
                   }}
                   endIcon={<ChevronRight />}
                   disabled={!canProceed || activeStep >= wizardSteps.length - 1}
                 >
                   Next
                 </Button>
                <Tooltip title="Reload config from server">
                  <IconButton onClick={loadData} disabled={loading}>
                    <RefreshRounded />
                  </IconButton>
                </Tooltip>
                <Box sx={{ flexGrow: 1 }} />
                {activeStep === wizardSteps.length - 1 && (
                  <Button
                    type="button"
                    variant="contained"
                    color="success"
                    onClick={async () => {
                      const ok = await handleSave();
                      if (ok) {
                        await refreshAuthEnabled(false);
                        navigate('/dashboard', { replace: true });
                      }
                    }}
                    disabled={saving || loading}
                    startIcon={<SaveRounded />}
                  >
                    {saving ? 'Finalizing...' : 'Finalize Installation'}
                  </Button>
                )}
              </Box>

              {(error || success) && (
                <Box sx={{ mt: 2 }}>
                  {error && (
                    <Alert severity="error" sx={{ mb: success ? 1 : 0 }}>
                      {error}
                    </Alert>
                  )}
                  {success && <Alert severity="success">{success}</Alert>}
                </Box>
              )}
            </Box>
          </Stack>
        </Stack>

      </Paper>

      <Snackbar
        open={!!success}
        autoHideDuration={3200}
        onClose={() => setSuccess(null)}
        message={success}
      />
      <Snackbar
        open={!!error}
        autoHideDuration={3200}
        onClose={() => setError(null)}
        message={error || undefined}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      />
      </Container>
  );
}

