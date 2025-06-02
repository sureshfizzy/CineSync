import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  CircularProgress,
  useTheme,
  IconButton,
  Button,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Folder as FolderIcon,
  Description as DescriptionIcon,
  CloudDone as CloudDoneIcon,
  Refresh as RefreshIcon,
  Dashboard as DashboardIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { motion } from 'framer-motion';
import RecentlyAddedMedia from './RecentlyAddedMedia';

const MotionCard = motion(Card);

interface Stats {
  totalFiles: number;
  totalSize: string;
  lastModified?: string;
  totalFolders: number;
  webdavStatus: string;
  storageUsed: string;
  scanning?: boolean;
  progress?: {
    currentPath: string;
    filesScanned: number;
    foldersScanned: number;
    totalSize: number;
    lastUpdate: string;
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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const theme = useTheme();

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/stats');
      const data = response.data;

      if (data.scanning) {
        setStats(data); // Update with progress
        setTimeout(fetchStats, 2000); // Continue polling
      } else {
        setStats(data);
        setLoading(false);
      }
    } catch (err) {
      setError('Failed to fetch statistics');
      setLoading(false);
    }
  }, []); // No dependencies, so it's stable

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleRefresh = () => {
    // Clear existing stats to show loading indicator immediately
    // setStats(null); // Optional: depends on desired UX
    fetchStats();
  };

  if (loading && !stats) { // Initial loading state
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
          Loading dashboard data...
        </Typography>
      </Box>
    );
  }

  if (stats?.scanning) { // Scanning in progress
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
          Scanning files...
        </Typography>
        {stats.progress && (
          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Files scanned: {stats.progress.filesScanned.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Folders scanned: {stats.progress.foldersScanned.toLocaleString()}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Current path: {stats.progress.currentPath}
            </Typography>
             <Button
              onClick={handleRefresh}
              variant="outlined"
              startIcon={<RefreshIcon />}
              sx={{ mt: 2 }}
            >
              Manual Refresh
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ mt: 2, textAlign: 'center' }}>
        {error} <Button onClick={handleRefresh}>Try again</Button>
      </Typography>
    );
  }

  // Safe fallback values for stats
  const safeStats = {
    totalFolders: stats && typeof stats.totalFolders === 'number' ? stats.totalFolders : 0,
    totalFiles: stats && typeof stats.totalFiles === 'number' ? stats.totalFiles : 0,
    webdavStatus: stats && typeof stats.webdavStatus === 'string' ? stats.webdavStatus : 'Unknown',
    storageUsed: stats && typeof stats.storageUsed === 'string' ? stats.storageUsed : '0 B',
  };

  const cards = [
    {
      title: 'Total Folders',
      value: safeStats.totalFolders.toLocaleString(),
      icon: <FolderIcon />,
      color: theme.palette.primary.main,
    },
    {
      title: 'Total Files',
      value: safeStats.totalFiles.toLocaleString(),
      icon: <DescriptionIcon />,
      color: theme.palette.secondary.main,
    },
    {
      title: 'WebDAV Status',
      value: safeStats.webdavStatus,
      icon: <CloudDoneIcon />,
      color: theme.palette.success.main,
    },
    {
      title: 'Storage Used',
      value: safeStats.storageUsed,
      icon: <StorageIcon />,
      color: theme.palette.success.main,
    },
  ];

  return (
    <Box sx={{ px: { xs: 0.8, sm: 1, md: 0 }, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: { xs: 1.5, sm: 2.5 }
      }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1
        }}>
          <Box sx={{
            backgroundColor: `${theme.palette.primary.main}15`,
            borderRadius: '12px',
            p: 0.8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${theme.palette.primary.main}30`,
          }}>
            <DashboardIcon sx={{
              color: 'primary.main',
              fontSize: { xs: 18, sm: 22 }
            }} />
          </Box>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              letterSpacing: 0.3,
              fontSize: { xs: '1.1rem', sm: '1.5rem', md: '1.75rem' }
            }}
          >
            Dashboard
          </Typography>
        </Box>
        <IconButton
          onClick={handleRefresh}
          sx={{
            bgcolor: { xs: 'transparent', sm: 'action.hover' },
            color: 'text.secondary',
            '&:hover': {
              bgcolor: 'action.hover',
              color: 'primary.main',
              transform: 'rotate(180deg)'
            },
            transition: 'all 0.3s ease',
            p: { xs: 0.5, sm: 1 }
          }}
        >
          <RefreshIcon sx={{ fontSize: { xs: 20, sm: 24 } }} />
        </IconButton>
      </Box>
      <Grid container spacing={{ xs: 0.8, sm: 2, md: 3 }} mb={{ xs: 2, sm: 3 }}>
        {cards.map((card, index) => (
          <Grid item xs={6} sm={6} md={3} key={card.title}>
            <MotionCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              custom={index}
              sx={{
                height: '100%',
                background: 'background.paper',
                borderRadius: { xs: '16px', sm: '20px' },
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: { xs: 'none', sm: 1, md: 2 },
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: { xs: 'none', sm: 'translateY(-2px)' },
                  boxShadow: { xs: 'none', sm: 2, md: 4 },
                  borderColor: { xs: 'divider', sm: 'primary.main' }
                },
                p: { xs: 1, sm: 1.5 },
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <CardContent sx={{ p: 0 }}>
                {/* Mobile Layout - Compact Horizontal */}
                <Box sx={{
                  display: { xs: 'flex', sm: 'block' },
                  alignItems: { xs: 'center', sm: 'flex-start' },
                  gap: { xs: 1, sm: 0 }
                }}>
                  <Box sx={{
                    backgroundColor: 'action.hover',
                    borderRadius: { xs: '12px', sm: '14px' },
                    p: { xs: 0.8, sm: 1.2 },
                    mr: { xs: 0, sm: 1.5 },
                    mb: { xs: 0, sm: 2 },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid',
                    borderColor: 'divider',
                  }}>
                    {React.cloneElement(card.icon, {
                      sx: {
                        fontSize: { xs: 20, sm: 28 },
                        color: card.color
                      }
                    })}
                  </Box>

                  <Box sx={{ flex: { xs: 1, sm: 'none' }, minWidth: 0 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{
                        color: 'text.secondary',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        fontSize: { xs: '0.65rem', sm: '0.75rem' },
                        mb: { xs: 0.2, sm: 0.5 },
                        lineHeight: 1.2
                      }}
                    >
                      {card.title}
                    </Typography>
                    <Typography
                      variant="h3"
                      sx={{
                        fontWeight: 700,
                        color: 'text.primary',
                        lineHeight: 1.1,
                        fontSize: { xs: '1.1rem', sm: '1.5rem', md: '1.75rem' }
                      }}
                    >
                      {card.value}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </MotionCard>
          </Grid>
        ))}
      </Grid>

      {/* Recently Added Media Section */}
      <Box sx={{ mt: { xs: 2, sm: 3 } }}>
        <RecentlyAddedMedia />
      </Box>
    </Box>
  );
}