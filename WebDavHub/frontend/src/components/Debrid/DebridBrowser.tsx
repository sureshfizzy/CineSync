import RealDebridBrowser from './RealDebridBrowser';
import { Box } from '@mui/material';

export default function DebridBrowser() {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <RealDebridBrowser />
    </Box>
  );
}
