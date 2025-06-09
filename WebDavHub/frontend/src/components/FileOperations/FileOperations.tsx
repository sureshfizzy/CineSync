import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Tabs, Tab, Card, CardContent, Chip, IconButton, CircularProgress, Alert, useTheme, alpha, Stack, Tooltip, Badge, useMediaQuery, Fab, Divider, Pagination } from '@mui/material';
import { CheckCircle, Error as ErrorIcon, Warning as WarningIcon, Delete as DeleteIcon, Refresh as RefreshIcon, Assignment as AssignmentIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Schedule as ScheduleIcon, SkipNext as SkipIcon, Storage as DatabaseIcon, Timeline as OperationsIcon } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import DatabaseSearch from './DatabaseSearch';

const MotionCard = motion(Card);
const MotionFab = motion(Fab);

interface FileOperation {
  id: string;
  filePath: string;
  destinationPath?: string;
  fileName: string;
  status: 'created' | 'failed' | 'error' | 'deleted' | 'skipped';
  timestamp: string;
  reason?: string;
  error?: string;
  tmdbId?: string;
  seasonNumber?: number;
  type: 'movie' | 'tvshow' | 'other';
  operation?: 'process' | 'delete';
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`file-operations-tabpanel-${index}`}
      aria-labelledby={`file-operations-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `file-operations-tab-${index}`,
    'aria-controls': `file-operations-tabpanel-${index}`,
  };
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * 0.1,
      duration: 0.5,
    },
  }),
};

function FileOperations() {
  const [mainTabValue, setMainTabValue] = useState(0);
  const [tabValue, setTabValue] = useState(0);
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage] = useState(50);
  const [totalOperations, setTotalOperations] = useState(0);
  const [statusCounts, setStatusCounts] = useState({
    created: 0,
    failed: 0,
    error: 0,
    skipped: 0,
    deleted: 0,
  });

  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const isSmallMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const fetchFileOperations = useCallback(async () => {
    try {
      setLoading(true);
      const offset = (currentPage - 1) * recordsPerPage;

      const statusMap = ['created', 'failed', 'error', 'skipped', 'deleted'];
      const statusFilter = statusMap[tabValue];

      const response = await axios.get('/api/file-operations', {
        params: {
          limit: recordsPerPage,
          offset: offset,
          status: statusFilter,
        },
      });
      const data = response.data;

      const operations = data.operations || [];
      setOperations(operations);
      setTotalOperations(data.total || 0);
      setStatusCounts(data.statusCounts || {
        created: 0,
        failed: 0,
        error: 0,
        skipped: 0,
        deleted: 0,
      });
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch file operations');
      setOperations([]);
      setTotalOperations(0);
    } finally {
      setLoading(false);
    }
  }, [currentPage, recordsPerPage, tabValue]);

  useEffect(() => {
    fetchFileOperations();
  }, [fetchFileOperations]);

  useEffect(() => {
    // Set up real-time updates using Server-Sent Events
    const token = localStorage.getItem('cineSyncJWT');
    const eventSourceUrl = token
      ? `/api/file-operations/events?token=${encodeURIComponent(token)}`
      : '/api/file-operations/events';
    const eventSource = new EventSource(eventSourceUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'file_operation_update') {
          // Refresh data when new operations are detected
          setCurrentPage(1);
          fetchFileOperations();
        }
      } catch (error) {

      }
    };

    eventSource.onerror = () => {
      // SSE connection error handled silently
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    setCurrentPage(1);
  };

  const handleMainTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
    setTabValue(0);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'created':
        return theme.palette.success.main;
      case 'failed':
        return theme.palette.warning.main;
      case 'error':
        return theme.palette.error.main;
      case 'deleted':
        return theme.palette.info.main;
      case 'skipped':
        return theme.palette.secondary.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'created':
        return <CheckCircle sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'failed':
        return <WarningIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'error':
        return <ErrorIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'deleted':
        return <DeleteIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'skipped':
        return <SkipIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      default:
        return <CheckCircle sx={{ fontSize: 16, color: getStatusColor(status) }} />;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (isMobile) {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleString();
  };

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  };

  const renderMobileCard = (file: FileOperation, index: number) => {
    const isExpanded = expandedCards.has(file.id);

    return (
      <MotionCard
        key={file.id}
        custom={index}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        sx={{
          mb: 1.5,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            onClick={() => toggleCardExpansion(file.id)}
            sx={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: isExpanded ? 1.5 : 0,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
              <Box sx={{
                p: 1,
                borderRadius: 2,
                bgcolor: alpha(getStatusColor(file.status), 0.1),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {getStatusIcon(file.status)}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight="600" sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'text.primary',
                }}>
                  {file.fileName}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    label={file.status.toUpperCase()}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      bgcolor: alpha(getStatusColor(file.status), 0.1),
                      color: getStatusColor(file.status),
                      border: 'none',
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}>
                    <ScheduleIcon sx={{ fontSize: 12 }} />
                    {formatTimestamp(file.timestamp)}
                  </Typography>
                </Box>
              </Box>
            </Box>
            <IconButton size="small" sx={{ color: 'text.secondary' }}>
              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight="600">
                      Source Path
                    </Typography>
                    <Typography variant="body2" sx={{
                      wordBreak: 'break-all',
                      bgcolor: 'action.hover',
                      p: 1,
                      borderRadius: 1,
                      mt: 0.5,
                      fontSize: '0.8rem',
                    }}>
                      {file.filePath}
                    </Typography>
                  </Box>

                  {file.destinationPath && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight="600">
                        Destination Path
                      </Typography>
                      <Typography variant="body2" sx={{
                        wordBreak: 'break-all',
                        bgcolor: 'action.hover',
                        p: 1,
                        borderRadius: 1,
                        mt: 0.5,
                        fontSize: '0.8rem',
                      }}>
                        {file.destinationPath}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={file.type.toUpperCase()}
                      size="small"
                      sx={{
                        bgcolor: alpha(theme.palette.info.main, 0.1),
                        color: 'info.main',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                    <Chip
                      label={file.operation === 'delete' ? 'DELETE' : 'PROCESS'}
                      size="small"
                      sx={{
                        bgcolor: file.operation === 'delete'
                          ? alpha(theme.palette.error.main, 0.1)
                          : alpha(theme.palette.success.main, 0.1),
                        color: file.operation === 'delete' ? 'error.main' : 'success.main',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                    {file.seasonNumber && (
                      <Chip
                        label={`Season ${file.seasonNumber}`}
                        size="small"
                        sx={{
                          bgcolor: alpha(theme.palette.secondary.main, 0.1),
                          color: 'secondary.main',
                          fontWeight: 600,
                          fontSize: '0.7rem',
                        }}
                      />
                    )}
                  </Box>

                  {(file.reason || file.error) && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight="600">
                        {file.error ? 'Error' : 'Reason'}
                      </Typography>
                      <Typography variant="body2" color={file.error ? 'error.main' : 'warning.main'} sx={{
                        bgcolor: file.error
                          ? alpha(theme.palette.error.main, 0.1)
                          : alpha(theme.palette.warning.main, 0.1),
                        p: 1,
                        borderRadius: 1,
                        mt: 0.5,
                        fontSize: '0.8rem',
                      }}>
                        {file.error || file.reason}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </MotionCard>
    );
  };

  const renderFileTable = (files: FileOperation[], emptyMessage: string) => {
    if (files.length === 0) {
      return (
        <Box
          sx={{
            textAlign: 'center',
            py: { xs: 6, sm: 8 },
            bgcolor: 'background.paper',
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" color="text.secondary" sx={{
            mb: 1,
            fontSize: { xs: '1rem', sm: '1.25rem' }
          }}>
            {emptyMessage}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{
            fontSize: { xs: '0.8rem', sm: '0.875rem' }
          }}>
            File operations will appear here as they are processed.
          </Typography>
        </Box>
      );
    }

    // Card layout (preferred for all screen sizes)
    return (
      <Box sx={{ px: { xs: 0, sm: 1, md: 2 } }}>
        <AnimatePresence>
          {files.map((file, index) => renderMobileCard(file, index))}
        </AnimatePresence>
      </Box>
    );
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          gap: 2
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          Loading file operations...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      px: { xs: 1, sm: 1, md: 0 },
      maxWidth: 1400,
      mx: 'auto',
      pb: { xs: 10, sm: 4 }, // Extra bottom padding for mobile FAB
      position: 'relative'
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: { xs: 2, sm: 2.5 },
        py: { xs: 1, sm: 0 },
      }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, sm: 1.5 }
        }}>
          <Box sx={{
            backgroundColor: `${theme.palette.primary.main}15`,
            borderRadius: { xs: '10px', sm: '12px' },
            p: { xs: 0.6, sm: 0.8 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${theme.palette.primary.main}30`,
          }}>
            <AssignmentIcon sx={{
              color: 'primary.main',
              fontSize: { xs: 16, sm: 20, md: 22 }
            }} />
          </Box>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              letterSpacing: 0.3,
              fontSize: { xs: '1rem', sm: '1.3rem', md: '1.75rem' }
            }}
          >
            File Operations
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary" sx={{
              display: { xs: 'none', sm: 'block' },
              fontSize: { sm: '0.7rem', md: '0.75rem' }
            }}>
              Updated: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
          {!isMobile && (
            <Tooltip title="Refresh">
              <IconButton
                onClick={fetchFileOperations}
                disabled={loading}
                sx={{
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    color: 'primary.main',
                    transform: 'rotate(180deg)'
                  },
                  transition: 'all 0.3s ease',
                  p: 1
                }}
              >
                <RefreshIcon sx={{ fontSize: 24 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

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
          {[
            { name: 'Operations', icon: <OperationsIcon />, color: '#3b82f6' },
            { name: 'Database', icon: <DatabaseIcon />, color: '#10b981' }
          ].map((tab, index) => {
            const isSelected = mainTabValue === index;
            return (
              <Box
                key={tab.name}
                onClick={() => handleMainTabChange({} as React.SyntheticEvent, index)}
                sx={{
                  cursor: 'pointer',
                  px: { xs: 2.5, sm: 4 },
                  py: { xs: 1.5, sm: 2 },
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
                      width: { xs: 20, sm: 24 },
                      height: { xs: 20, sm: 24 },
                      borderRadius: 1,
                      bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : alpha(tab.color, 0.15),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected ? 'white' : tab.color,
                      transition: 'all 0.3s ease',
                      flexShrink: 0,
                      '& svg': {
                        fontSize: { xs: 16, sm: 18 },
                      },
                    }}
                  >
                    {tab.icon}
                  </Box>
                  <Typography
                    variant="body1"
                    fontWeight="600"
                    sx={{
                      fontSize: { xs: '0.9rem', sm: '1rem' },
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

      {/* Operations Tab Content */}
      {mainTabValue === 0 && (
        <>
          {/* Sub-Tabs for Operations */}
      <Box sx={{
        borderBottom: 1,
        borderColor: 'divider',
        mb: { xs: 2, sm: 3 },
        mx: { xs: -1, sm: 0 },
        px: { xs: 1, sm: 0 },
      }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="file operations tabs"
          variant={isMobile ? "scrollable" : "standard"}
          scrollButtons={isMobile ? "auto" : false}
          allowScrollButtonsMobile={isMobile}
          sx={{
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: { xs: '0.75rem', sm: '0.875rem' },
              minHeight: { xs: 44, sm: 48 },
              minWidth: { xs: 'auto', sm: 160 },
              px: { xs: 1, sm: 2 },
            },
            '& .MuiTabs-scrollButtons': {
              color: 'primary.main',
            },
          }}
        >
          <Tab
            label={
              <Badge badgeContent={statusCounts.created} color="success" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <CheckCircle sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' }
                  }}>
                    {isSmallMobile ? 'Created' : 'Created Files'}
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(0)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.failed} color="warning" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <WarningIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' }
                  }}>
                    {isSmallMobile ? 'Failed' : 'Failed Creation'}
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(1)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.error} color="error" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <ErrorIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' }
                  }}>
                    {isSmallMobile ? 'Errors' : 'Error Files'}
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(2)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.skipped} color="secondary" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <SkipIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' }
                  }}>
                    {isSmallMobile ? 'Skipped' : 'Skipped Files'}
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(3)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.deleted} color="info" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <DeleteIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.7rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' }
                  }}>
                    {isSmallMobile ? 'Deleted' : 'Deleted Files'}
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(4)}
          />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {renderFileTable(operations, 'No files created yet')}
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        {renderFileTable(operations, 'No failed file operations')}
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        {renderFileTable(operations, 'No error files')}
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        {renderFileTable(operations, 'No skipped files')}
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        {renderFileTable(operations, 'No deleted files')}
      </TabPanel>

      {/* Pagination and Summary for Operations */}
      <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3 }}>
        {Math.ceil(totalOperations / recordsPerPage) > 1 && (
          <Pagination
            count={Math.ceil(totalOperations / recordsPerPage)}
            page={currentPage}
            onChange={(_, page) => setCurrentPage(page)}
            sx={{
              '& .MuiPaginationItem-root': {
                borderRadius: 2,
              },
            }}
          />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          Showing {operations.length} of {totalOperations.toLocaleString()} operations
        </Typography>
      </Box>

          {/* Mobile Floating Action Button for Operations */}
          {isMobile && (
            <MotionFab
              color="primary"
              aria-label="refresh"
              onClick={fetchFileOperations}
              disabled={loading}
              sx={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                zIndex: 1000,
                background: 'linear-gradient(45deg, #6366F1 30%, #8B5CF6 90%)',
                boxShadow: '0 8px 16px 0 rgba(99, 102, 241, 0.3)',
                '&:hover': {
                  background: 'linear-gradient(45deg, #5B5FE8 30%, #7C3AED 90%)',
                  boxShadow: '0 12px 20px 0 rgba(99, 102, 241, 0.4)',
                },
                '&:disabled': {
                  background: 'rgba(99, 102, 241, 0.3)',
                },
              }}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <RefreshIcon sx={{
                fontSize: 24,
                animation: loading ? 'spin 1s linear infinite' : 'none',
                '@keyframes spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' },
                },
              }} />
            </MotionFab>
          )}
        </>
      )}

      {/* Database Tab Content */}
      {mainTabValue === 1 && (
        <DatabaseSearch />
      )}
    </Box>
  );
}

export { FileOperations };
export default FileOperations;
