import React from 'react';
import { Box, Paper, Typography, Button, Alert, Stack, Chip, useTheme, alpha } from '@mui/material';
import { Settings as SettingsIcon, Folder as FolderIcon, Warning as WarningIcon, Info as InfoIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

interface ConfigurationPlaceholderProps {
  destinationDir?: string;
  effectiveRootDir?: string;
}

const ConfigurationPlaceholder: React.FC<ConfigurationPlaceholderProps> = ({
  destinationDir,
  effectiveRootDir,
}) => {
  const theme = useTheme();
  const navigate = useNavigate();

  const handleGoToSettings = () => {
    navigate('/settings');
  };

  const isPlaceholder = destinationDir === '/path/to/destination' || 
                       destinationDir === '\\path\\to\\destination' ||
                       !destinationDir;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        p: 3,
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 600,
          width: '100%',
          textAlign: 'center',
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box
          sx={{
            mb: 3,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Box
            sx={{
              p: 2,
              borderRadius: '50%',
              bgcolor: alpha(theme.palette.warning.main, 0.1),
              border: `2px solid ${alpha(theme.palette.warning.main, 0.2)}`,
            }}
          >
            <WarningIcon
              sx={{
                fontSize: 48,
                color: theme.palette.warning.main,
              }}
            />
          </Box>
        </Box>

        <Typography
          variant="h4"
          gutterBottom
          sx={{
            fontWeight: 600,
            color: theme.palette.text.primary,
            mb: 2,
          }}
        >
          Configuration Required
        </Typography>

        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ mb: 3, lineHeight: 1.6 }}
        >
          The destination directory is not properly configured. Please update your
          configuration to start browsing your media files.
        </Typography>

        <Stack spacing={2} sx={{ mb: 4 }}>
          <Alert
            severity="warning"
            icon={<InfoIcon />}
            sx={{
              textAlign: 'left',
              '& .MuiAlert-message': {
                width: '100%',
              },
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              Current Configuration:
            </Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FolderIcon sx={{ fontSize: 16 }} />
                <Typography variant="body2" component="span">
                  Destination Directory:
                </Typography>
                <Chip
                  label={isPlaceholder ? 'Not Set' : destinationDir || 'Not Set'}
                  size="small"
                  color={isPlaceholder ? 'error' : 'warning'}
                  variant="outlined"
                />
              </Box>
              {effectiveRootDir && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <FolderIcon sx={{ fontSize: 16 }} />
                  <Typography variant="body2" component="span">
                    Currently Serving:
                  </Typography>
                  <Chip
                    label={effectiveRootDir}
                    size="small"
                    color="info"
                    variant="outlined"
                  />
                </Box>
              )}
            </Stack>
          </Alert>
        </Stack>

        <Stack spacing={2} direction={{ xs: 'column', sm: 'row' }} justifyContent="center">
          <Button
            variant="contained"
            size="large"
            startIcon={<SettingsIcon />}
            onClick={handleGoToSettings}
            sx={{
              px: 4,
              py: 1.5,
              borderRadius: 2,
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            Go to Settings
          </Button>
        </Stack>

        <Box sx={{ mt: 4, pt: 3, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            What you need to do:
          </Typography>
          <Stack spacing={1} sx={{ textAlign: 'left' }}>
            <Typography variant="body2" color="text.secondary">
              • Set <code>DESTINATION_DIR</code> to a valid directory path in your .env file
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • Ensure the directory exists and is accessible
            </Typography>
            <Typography variant="body2" color="text.secondary">
              • Restart the server after making changes
            </Typography>
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
};

export default ConfigurationPlaceholder;
