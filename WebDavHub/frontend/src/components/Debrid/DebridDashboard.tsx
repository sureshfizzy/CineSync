import FileBrowser from '../FileBrowser/FileBrowser';
import { Box } from '@mui/material';

export default function DebridDashboard() {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <FileBrowser />
    </Box>
  );
}
