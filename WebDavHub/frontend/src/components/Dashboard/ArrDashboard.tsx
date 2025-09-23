import { Box, Typography, Paper } from '@mui/material';
import ConfigurationWrapper from '../Layout/ConfigurationWrapper';

export default function ArrDashboard() {
  return (
    <ConfigurationWrapper>
      <Box sx={{ px: { xs: 0.8, sm: 1, md: 0 }, maxWidth: 1400, mx: 'auto' }}>
        <Box sx={{ mb: { xs: 1.5, sm: 2.5 } }}>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              letterSpacing: 0.3,
              fontSize: { xs: '1.1rem', sm: '1.5rem', md: '1.75rem' }
            }}
          >
            Arr Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Base view placeholder for application link insights.
          </Typography>
        </Box>

        <Paper sx={{ p: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body1" color="text.secondary">
            This is the new integration dashboard shell. Widgets will be added in subsequent steps.
          </Typography>
        </Paper>
      </Box>
    </ConfigurationWrapper>
  );
}