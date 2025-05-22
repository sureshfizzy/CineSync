import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Typography,
  CircularProgress,
  useTheme,
  Button,
  Avatar,
  Stack,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Folder as FolderIcon,
  AccessTime as TimeIcon,
  Description as DescriptionIcon,
  CloudDone as CloudDoneIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import axios from 'axios';
import { motion } from 'framer-motion';

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

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get('/api/stats');
        const data = response.data;

        if (data.scanning) {
          // If scanning is in progress, update stats with progress info
          setStats(data);
          // Continue polling until scan is complete
          setTimeout(fetchStats, 1000);
        } else {
          setStats(data);
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to fetch statistics');
        console.error('Error fetching stats:', err);
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading || (stats?.scanning)) {
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
          {stats?.scanning ? 'Scanning files...' : 'Loading dashboard data...'}
        </Typography>
        {stats?.scanning && stats.progress && (
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
          </Box>
        )}
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ mt: 2, textAlign: 'center' }}>
        {error}
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
      icon: <FolderIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.primary.main,
    },
    {
      title: 'Total Files',
      value: safeStats.totalFiles.toLocaleString(),
      icon: <DescriptionIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.secondary.main,
    },
    {
      title: 'WebDAV Status',
      value: safeStats.webdavStatus,
      icon: <CloudDoneIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.success.main,
    },
    {
      title: 'Storage Used',
      value: safeStats.storageUsed,
      icon: <StorageIcon sx={{ fontSize: 40 }} />,
      color: theme.palette.success.main,
    },
  ];

  return (
    <Box sx={{ px: { xs: 1, sm: 1, md: 0 }, maxWidth: 1600, mx: 'auto' }}>
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, 
        gap: { xs: 2, sm: 1 },
        mb: 4 
      }}>
        <Typography 
          variant="h4" 
          sx={{ 
            fontWeight: 800, 
            flex: 1, 
            letterSpacing: 0.5,
            fontSize: { xs: '1.35rem', sm: '1.8rem', md: '2.1rem' }
          }}
        >
          Dashboard
        </Typography>
        <Button 
          variant="contained" 
          startIcon={<RefreshIcon />} 
          sx={{ 
            borderRadius: 2, 
            fontWeight: 600, 
            bgcolor: 'primary.main', 
            boxShadow: 2,
            width: { xs: '100%', sm: 'auto' },
            fontSize: { xs: '0.95rem', sm: '1.08rem' },
            py: 0.7, px: 2
          }}
        >
          Refresh
        </Button>
      </Box>
      <Grid container spacing={{ xs: 2, sm: 3, md: 4 }} mb={4}>
        {cards.map((card, index) => (
          <Grid item xs={12} sm={6} md={3} key={card.title}>
            <MotionCard
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              custom={index}
              sx={{
                height: '100%',
                background: 'background.paper',
                borderRadius: '20px',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: { xs: 1, sm: 2, md: 4 },
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                  transform: { xs: 'none', sm: 'translateY(-5px) scale(1.025)' },
                  boxShadow: { xs: 1, sm: 4, md: 8 },
                },
                p: { xs: 1.3, sm: 1.8 },
                mb: { xs: 1.5, sm: 0 },
              }}
            >
              <CardContent sx={{ p: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                  <Box sx={{
                    backgroundColor: `${card.color}22`,
                    borderRadius: '12px',
                    p: { xs: 1, sm: 1.2 },
                    mr: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {React.cloneElement(card.icon, { 
                      sx: { fontSize: { xs: 32, sm: 40 } } 
                    })}
                  </Box>
                  <Typography
                    variant="subtitle2"
                    sx={{ 
                      color: 'text.secondary', 
                      fontWeight: 700, 
                      textTransform: 'uppercase', 
                      letterSpacing: 1,
                      fontSize: { xs: '1.8rem', sm: '1.52rem' }
                    }}
                  >
                    {card.title}
                  </Typography>
                </Box>
                <Typography
                  variant="h3"
                  sx={{ 
                    fontWeight: 900, 
                    color: card.color, 
                    lineHeight: 1.1,
                    fontSize: { xs: '1.5rem', sm: '2.1rem', md: '2.6rem' }
                  }}
                >
                  {card.value}
                </Typography>
              </CardContent>
            </MotionCard>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
} 