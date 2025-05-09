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
        setStats(response.data);
      } catch (err) {
        setError('Failed to fetch statistics');
        console.error('Error fetching stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        <CircularProgress />
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
    <Box sx={{ px: { xs: 1, sm: 2, md: 0 } }}>
      <Box sx={{ 
        display: 'flex', 
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' }, 
        gap: { xs: 2, sm: 0 },
        mb: 4 
      }}>
        <Typography 
          variant="h4" 
          sx={{ 
            fontWeight: 800, 
            flex: 1, 
            letterSpacing: 0.5,
            fontSize: { xs: '1.5rem', sm: '2rem', md: '2.125rem' }
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
            width: { xs: '100%', sm: 'auto' }
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
                  transform: { xs: 'none', sm: 'translateY(-6px) scale(1.03)' },
                  boxShadow: { xs: 1, sm: 4, md: 8 },
                },
                p: { xs: 1.5, sm: 2 },
                mb: { xs: 2, sm: 0 },
              }}
            >
              <CardContent sx={{ p: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
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
                      fontSize: { xs: '0.75rem', sm: '0.875rem' }
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
                    fontSize: { xs: '1.75rem', sm: '2.5rem', md: '3rem' }
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