
import { Box, Chip, Typography, Stack, Tooltip, useTheme, useMediaQuery } from '@mui/material';
import { CheckCircle, Error, WifiOff } from '@mui/icons-material';
import { useConfig } from '../../contexts/ConfigContext';

interface ConfigStatusIndicatorProps {}

export function ConfigStatusIndicator({}: ConfigStatusIndicatorProps) {
  const { isConnected, lastUpdate, error } = useConfig();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isVerySmall = useMediaQuery('(max-width:400px)');

  const getStatusColor = () => {
    if (error) return 'error';
    if (!isConnected) return 'warning';
    return 'success';
  };

  const getStatusIcon = () => {
    if (error) return <Error sx={{ fontSize: 16 }} />;
    if (!isConnected) return <WifiOff sx={{ fontSize: 16 }} />;
    return <CheckCircle sx={{ fontSize: 16 }} />;
  };

  const getStatusText = () => {
    if (isVerySmall) return null;
    if (error) return isMobile ? 'Error' : 'Configuration Error';
    if (!isConnected) return 'Offline';
    return isMobile ? 'Live' : 'Live Updates';
  };

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Tooltip 
        title={
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Configuration Status
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
              {isConnected 
                ? 'Real-time configuration updates are active. Changes will be applied automatically without restart.'
                : 'Configuration updates are offline. Changes may require manual refresh.'
              }
            </Typography>
            {lastUpdate && (
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                Last update: {new Date(lastUpdate * 1000).toLocaleString()}
              </Typography>
            )}
            {error && (
              <Typography variant="caption" sx={{ display: 'block', color: 'error.main' }}>
                Error: {error}
              </Typography>
            )}
          </Box>
        }
        arrow
        placement="bottom"
      >
        <Chip
          icon={getStatusIcon()}
          label={getStatusText()}
          color={getStatusColor()}
          variant="outlined"
          size="medium"
          sx={{
            fontSize: isMobile ? '0.8rem' : '0.875rem',
            height: 40,
            minWidth: isVerySmall ? 40 : 'auto',
            width: isVerySmall ? 40 : 'auto',
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            '& .MuiChip-label': {
              px: isVerySmall ? 0 : (isMobile ? 1.5 : 2),
              fontWeight: 600,
              fontSize: isMobile ? '0.8rem' : '0.875rem',
              display: isVerySmall ? 'none' : 'block'
            },
            '& .MuiChip-icon': {
              ml: isVerySmall ? 0 : (isMobile ? 1 : 1.25),
              mr: isVerySmall ? 0 : undefined,
              fontSize: isMobile ? '1.1rem' : '1.25rem'
            },
            '&:hover': {
              borderColor: 'primary.main',
              bgcolor: 'action.hover',
            }
          }}
        />
      </Tooltip>
      

    </Stack>
  );
}

export default ConfigStatusIndicator;
