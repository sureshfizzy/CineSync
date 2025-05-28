import { useState, useEffect } from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  CardHeader,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  Storage as StorageIcon,
  Folder as FolderIcon,
  Upload as UploadIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import axios from 'axios';

interface Stats {
  totalFiles: number;
  totalSize: string;
  lastSync: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get('/api/stats');
        setStats(response.data);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        Dashboard
      </Typography>

      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <StorageIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Storage
                  </Typography>
                  <Typography variant="h5">
                    {stats?.totalSize || '0 B'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <FolderIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Total Files
                  </Typography>
                  <Typography variant="h5">
                    {stats?.totalFiles || 0}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center">
                <UploadIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                <Box>
                  <Typography color="textSecondary" gutterBottom>
                    Last Sync
                  </Typography>
                  <Typography variant="h5">
                    {stats?.lastSync || 'Never'}
                  </Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" gutterBottom>
              Quick Actions
            </Typography>
            <Grid container spacing={2}>
              <Grid item>
                <IconButton
                  color="primary"
                  sx={{ p: 2, border: 1, borderColor: 'divider' }}
                >
                  <UploadIcon />
                </IconButton>
              </Grid>
              <Grid item>
                <IconButton
                  color="primary"
                  sx={{ p: 2, border: 1, borderColor: 'divider' }}
                >
                  <DownloadIcon />
                </IconButton>
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
}