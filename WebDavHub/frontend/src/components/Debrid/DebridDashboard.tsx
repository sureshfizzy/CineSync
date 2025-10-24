import React, { useState, useEffect, useCallback } from 'react';
import { Box, Card, CardContent, Typography, CircularProgress, Chip, Avatar, Divider, Stack, useTheme, Alert, Paper, alpha } from '@mui/material';
import { AccountCircle, CloudDownload, Storage, CheckCircle, Error as ErrorIcon, TrendingUp, DataUsage, Timer, CloudSync, Today as TodayIcon } from '@mui/icons-material';
import { motion } from 'framer-motion';
import axios from 'axios';
import { formatBytes, formatDate } from '../FileBrowser/fileUtils';

interface DebridStats {
  account: {
    username: string;
    email: string;
    points: number;
    type: string;
    expiration: string;
  };
  torrents: {
    total: number;
    totalSize: number;
    statusCounts: Record<string, number>;
  };
  traffic: {
    today: number;
  };
  lastUpdated: string;
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


const StatusChip: React.FC<{ status: string; count: number }> = ({ status, count }) => {
  const getStatusColor = (status: string): 'success' | 'info' | 'error' | 'warning' => {
    switch (status.toLowerCase()) {
      case 'downloaded':
      case 'completed':
        return 'success';
      case 'downloading':
      case 'processing':
        return 'info';
      case 'error':
      case 'failed':
        return 'error';
      case 'waiting':
      case 'queued':
        return 'warning';
      default:
        return 'info';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'downloaded':
      case 'completed':
        return <CheckCircle sx={{ fontSize: 16 }} />;
      case 'downloading':
      case 'processing':
        return <CloudSync sx={{ fontSize: 16 }} />;
      case 'error':
      case 'failed':
        return <ErrorIcon sx={{ fontSize: 16 }} />;
      case 'waiting':
      case 'queued':
        return <Timer sx={{ fontSize: 16 }} />;
      default:
        return <Storage sx={{ fontSize: 16 }} />;
    }
  };

  const theme = useTheme();
  const color = getStatusColor(status);
  
  return (
    <Chip
      icon={getStatusIcon(status)}
      label={`${status}: ${count}`}
      size="small"
      sx={{
        fontWeight: 600,
        fontSize: { xs: '0.7rem', sm: '0.75rem' },
        px: { xs: 0.5, sm: 0.75 },
        height: { xs: 24, sm: 28 },
        border: theme.palette.mode === 'dark' 
          ? `1px solid ${alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.4)}`
          : `1px solid ${alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.3)}`,
        bgcolor: theme.palette.mode === 'dark' 
          ? alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.15)
          : alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.1),
        color: `${color}.main`,
        backdropFilter: theme.palette.mode === 'dark' ? 'blur(5px)' : 'none',
        boxShadow: theme.palette.mode === 'dark' 
          ? `0 2px 8px ${alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.1)}`
          : 'none',
        '& .MuiChip-icon': {
          fontSize: 14,
          marginLeft: 0.5,
        },
        '&:hover': {
          bgcolor: theme.palette.mode === 'dark' 
            ? alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.25)
            : alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.2),
          transform: 'translateY(-1px)',
          boxShadow: theme.palette.mode === 'dark' 
            ? `0 4px 12px ${alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.2)}`
            : `0 2px 8px ${alpha(theme.palette[color]?.main || theme.palette.grey[400], 0.1)}`,
        },
        transition: 'all 0.2s ease-in-out',
      }}
    />
  );
};

export default function DebridDashboard() {
  const [stats, setStats] = useState<DebridStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const theme = useTheme();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await axios.get('/api/realdebrid/dashboard-stats');
      setStats(response.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch debrid statistics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading && !stats) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          gap: 2,
          background: theme.palette.mode === 'dark' 
            ? `linear-gradient(135deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.primary.main, 0.02)} 100%)`
            : 'transparent',
        }}
      >
        <CircularProgress 
          size={40} 
          sx={{ 
            color: theme.palette.mode === 'dark' ? theme.palette.primary.main : undefined,
            filter: theme.palette.mode === 'dark' ? `drop-shadow(0 0 8px ${alpha(theme.palette.primary.main, 0.3)})` : 'none',
          }} 
        />
        <Typography 
          variant="h6" 
          sx={{ 
            color: 'text.secondary',
            opacity: 0.8,
          }}
        >
          Loading debrid dashboard...
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box 
        sx={{ 
          p: 3,
          background: theme.palette.mode === 'dark' 
            ? `linear-gradient(135deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.error.main, 0.02)} 100%)`
            : 'transparent',
          minHeight: '50vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Alert 
          severity="error"
          sx={{
            maxWidth: 600,
            width: '100%',
            backdropFilter: theme.palette.mode === 'dark' ? 'blur(10px)' : 'none',
            boxShadow: theme.palette.mode === 'dark' 
              ? `0 8px 32px ${alpha(theme.palette.error.main, 0.1)}`
              : '0 2px 8px rgba(0,0,0,0.1)',
            border: theme.palette.mode === 'dark' 
              ? `1px solid ${alpha(theme.palette.error.main, 0.2)}`
              : 'none',
          }}
        >
          {error}
        </Alert>
      </Box>
    );
  }

  if (!stats) {
    return null;
  }

  const accountTypeColor = stats.account.type === 'premium' ? 'success' : 'warning';

  return (
    <Box 
      sx={{ 
        p: { xs: 2, md: 3 }, 
        height: '100%', 
        overflow: 'auto',
        background: theme.palette.mode === 'dark' 
          ? `linear-gradient(135deg, ${theme.palette.background.default} 0%, ${alpha(theme.palette.primary.main, 0.02)} 100%)`
          : 'transparent',
        minHeight: '100vh',
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography 
          variant="h4" 
          fontWeight="700" 
          sx={{ 
            mb: 2,
            fontSize: { xs: '1.75rem', sm: '2.125rem' },
            background: theme.palette.mode === 'dark' 
              ? `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`
              : 'inherit',
            backgroundClip: theme.palette.mode === 'dark' ? 'text' : 'initial',
            WebkitBackgroundClip: theme.palette.mode === 'dark' ? 'text' : 'initial',
            WebkitTextFillColor: theme.palette.mode === 'dark' ? 'transparent' : 'inherit',
          }}
        >
          Debrid Dashboard
        </Typography>
        
        {stats && (
          <Typography 
            variant="body2" 
            sx={{ 
              color: 'text.secondary',
              opacity: 0.8,
              fontSize: '0.875rem',
            }}
          >
            Last updated: {formatDate(stats.lastUpdated)}
          </Typography>
        )}
      </Box>

      {/* Account Info Card */}
      <motion.div
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        custom={0}
      >
        <Card 
          sx={{ 
            mb: 3, 
            background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          }}
        >
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'center', sm: 'center' }} spacing={{ xs: 1.5, sm: 2 }} sx={{ mb: 3 }}>
              <Avatar 
                sx={{ 
                  bgcolor: 'primary.main', 
                  width: 64, 
                  height: 64,
                  boxShadow: theme.shadows[4],
                }}
              >
                <AccountCircle sx={{ fontSize: 40 }} />
              </Avatar>
              <Box sx={{ 
                flex: 1, 
                textAlign: { xs: 'center', sm: 'left' },
                minWidth: 0
              }}>
                <Typography variant="h5" fontWeight="700" sx={{ 
                  mb: 0.5,
                  fontSize: { xs: '1.25rem', sm: '1.5rem' }
                }}>
                  {stats.account.username}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{
                  wordBreak: 'break-word',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {stats.account.email}
                </Typography>
              </Box>
              <Chip
                label={stats.account.type.toUpperCase()}
                color={accountTypeColor as any}
                variant="filled"
                sx={{ 
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  px: 2,
                  height: 36,
                }}
              />
            </Stack>
            
            <Divider sx={{ my: 2.5 }} />
            
            <Box sx={{ 
              display: 'flex', 
              gap: { xs: 2, sm: 3 }, 
              flexDirection: { xs: 'column', sm: 'row' }
            }}>
              <Box sx={{ 
                flex: { xs: 'none', sm: '1 1 calc(50% - 12px)' }, 
                width: { xs: '100%', sm: 'auto' }
              }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    textAlign: 'center',
                    background: alpha(theme.palette.primary.main, 0.08),
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="h4" fontWeight="700" color="primary.main" sx={{ 
                    mb: 0.5,
                    fontSize: { xs: '1.75rem', sm: '2.125rem' }
                  }}>
                    {stats.account.points.toLocaleString()}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" fontWeight="500">
                    Points Available
                  </Typography>
                </Paper>
              </Box>
              <Box sx={{ 
                flex: { xs: 'none', sm: '1 1 calc(50% - 12px)' }, 
                width: { xs: '100%', sm: 'auto' }
              }}>
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    textAlign: 'center',
                    background: alpha(theme.palette.success.main, 0.08),
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="h6" fontWeight="700" color="success.main" sx={{ 
                    mb: 0.5,
                    fontSize: { xs: '1rem', sm: '1.25rem' }
                  }}>
                    {formatDate(stats.account.expiration)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" fontWeight="500">
                    Subscription Expires
                  </Typography>
                </Paper>
              </Box>
            </Box>
          </CardContent>
        </Card>
      </motion.div>

      {/* Main Stats Cards - Compact Side by Side */}
      <Box sx={{ 
        display: 'flex', 
        gap: { xs: 2, md: 2 }, 
        mb: 3, 
        flexDirection: { xs: 'column', md: 'row' }
      }}>
        {/* Torrents Card */}
        <Box sx={{ 
          flex: { xs: 'none', md: '1 1 calc(50% - 8px)' }, 
          width: { xs: '100%', md: 'auto' }
        }}>
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            custom={1}
          >
        <Card 
          sx={{ 
            background: theme.palette.mode === 'dark' 
              ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`
              : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
            border: theme.palette.mode === 'dark' 
              ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}`
              : `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            backdropFilter: theme.palette.mode === 'dark' ? 'blur(10px)' : 'none',
            boxShadow: theme.palette.mode === 'dark' 
              ? `0 8px 32px ${alpha(theme.palette.primary.main, 0.1)}`
              : '0 2px 8px rgba(0,0,0,0.1)',
            }}
        >
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: 'primary.main', width: 40, height: 40 }}>
                    <CloudDownload sx={{ fontSize: 22 }} />
                  </Avatar>
                  <Typography variant="subtitle1" fontWeight="700">
                    Torrent Statistics
                  </Typography>
                </Stack>
                
                <Box sx={{ 
                  display: 'flex', 
                  gap: { xs: 1, sm: 1.5 }, 
                  mb: 2,
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <Box sx={{ 
                    flex: { xs: 'none', sm: '1 1 calc(50% - 6px)' },
                    width: { xs: '100%', sm: 'auto' }
                  }}>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.5,
                        textAlign: 'center',
                        background: alpha(theme.palette.primary.main, 0.08),
                        borderRadius: 1.5,
                      }}
                    >
                      <Storage sx={{ fontSize: 28, color: 'primary.main', mb: 0.5 }} />
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: '0.7rem' }}>
                        Total Torrents
                      </Typography>
                      <Typography variant="h6" fontWeight="700" color="primary.main">
                        {stats.torrents.total}
                      </Typography>
                    </Paper>
                  </Box>
                  
                  <Box sx={{ 
                    flex: { xs: 'none', sm: '1 1 calc(50% - 6px)' },
                    width: { xs: '100%', sm: 'auto' }
                  }}>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 1.5,
                        textAlign: 'center',
                        background: alpha(theme.palette.info.main, 0.08),
                        borderRadius: 1.5,
                      }}
                    >
                      <DataUsage sx={{ fontSize: 28, color: 'info.main', mb: 0.5 }} />
                      <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: '0.7rem' }}>
                        Total Size
                      </Typography>
                      <Typography variant="h6" fontWeight="700" color="info.main">
                        {formatBytes(stats.torrents.totalSize)}
                      </Typography>
                    </Paper>
                  </Box>
                </Box>

                <Divider sx={{ my: 1.5 }} />

                <Box>
                  <Typography variant="caption" fontWeight="700" color="text.secondary" sx={{ 
                    mb: 1, 
                    display: 'block', 
                    textTransform: 'uppercase', 
                    letterSpacing: 0.5, 
                    fontSize: { xs: '0.65rem', sm: '0.7rem' }
                  }}>
                    Status Breakdown
                  </Typography>
                  <Box sx={{ 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    gap: { xs: 0.5, sm: 0.75 },
                    justifyContent: { xs: 'center', sm: 'flex-start' }
                  }}>
                    {Object.entries(stats.torrents.statusCounts).map(([status, count]) => (
                      <StatusChip key={status} status={status} count={count} />
                    ))}
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </motion.div>
        </Box>

        {/* Traffic Card */}
        <Box sx={{ 
          flex: { xs: 'none', md: '1 1 calc(50% - 8px)' }, 
          width: { xs: '100%', md: 'auto' }
        }}>
          <motion.div
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            custom={2}
          >
            <Card 
              sx={{ 
                background: theme.palette.mode === 'dark' 
                  ? `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.9)} 100%)`
                  : `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.05)} 0%, ${theme.palette.background.paper} 100%)`,
                border: theme.palette.mode === 'dark' 
                  ? `1px solid ${alpha(theme.palette.success.main, 0.2)}`
                  : `1px solid ${alpha(theme.palette.success.main, 0.1)}`,
                backdropFilter: theme.palette.mode === 'dark' ? 'blur(10px)' : 'none',
                boxShadow: theme.palette.mode === 'dark' 
                  ? `0 8px 32px ${alpha(theme.palette.success.main, 0.1)}`
                  : '0 2px 8px rgba(0,0,0,0.1)',
              }}
            >
              <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
                  <Avatar sx={{ bgcolor: 'success.main', width: 40, height: 40 }}>
                    <TrendingUp sx={{ fontSize: 22 }} />
                  </Avatar>
                  <Typography variant="subtitle1" fontWeight="700">
                    Traffic Statistics
                  </Typography>
                </Stack>
                
                <Paper
                  elevation={0}
                  sx={{
                    p: 2,
                    textAlign: 'center',
                    background: alpha(theme.palette.success.main, 0.08),
                    borderRadius: 1.5,
                  }}
                >
                  <TodayIcon sx={{ fontSize: 32, color: 'success.main', mb: 0.5 }} />
                  <Typography variant="caption" fontWeight="600" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontSize: '0.7rem' }}>
                    Today's Usage
                  </Typography>
                  <Typography variant="h5" fontWeight="700" color="success.main">
                    {formatBytes(stats.traffic.today)}
                  </Typography>
                </Paper>
              </CardContent>
            </Card>
          </motion.div>
        </Box>
      </Box>
    </Box>
  );
}