import { Box, Paper, Typography, Stack, Button, alpha, useTheme } from '@mui/material';
import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import ConstructionRoundedIcon from '@mui/icons-material/ConstructionRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import { useNavigate } from 'react-router-dom';

export default function ArrComingSoon() {
  const theme = useTheme();
  const navigate = useNavigate();

  return (
    <Box
      sx={{
        minHeight: '65vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 1, sm: 2 },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          maxWidth: 720,
          width: '100%',
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.08)}, ${alpha(theme.palette.background.paper, 0.85)})`,
          boxShadow: `0 20px 60px ${alpha(theme.palette.common.black, 0.25)}`,
        }}
      >
        <Stack spacing={2.5} alignItems="flex-start">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 3,
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.15),
                color: theme.palette.primary.main,
              }}
            >
              <AccessTimeRoundedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Box>
              <Typography variant="h5" fontWeight={800}>
                ArrDash is coming soon
              </Typography>
              <Typography variant="body2" color="text.secondary">
                We&apos;re still polishing the ArrDash experience. In the meantime you can keep using your current Symlinks and Debrid tools.
              </Typography>
            </Box>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap>
            <Button
              variant="contained"
              startIcon={<ArrowBackRoundedIcon />}
              onClick={() => navigate('/dashboard')}
            >
              Go to Symlinks
            </Button>
            <Button
              variant="outlined"
              startIcon={<CloudDownloadRoundedIcon />}
              onClick={() => navigate('/dashboard/debrid')}
            >
              Open Debrid
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" color="text.secondary">
            <ConstructionRoundedIcon sx={{ fontSize: 20 }} />
            <Typography variant="body2">
              Thanks for your patience — we&apos;ll light this up soon.
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}