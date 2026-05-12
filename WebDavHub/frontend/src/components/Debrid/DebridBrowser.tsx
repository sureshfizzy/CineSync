import RealDebridBrowser from './RealDebridBrowser';
import { Box, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useDebridProvider } from '../../contexts/DebridProviderContext';

export default function DebridBrowser() {
  const [provider, setProvider] = useDebridProvider();

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, pt: 2, pb: 0 }}>
        <ToggleButtonGroup
          value={provider}
          exclusive
          onChange={(_e, next) => next && setProvider(next)}
          size="small"
          sx={{ mb: 1 }}
        >
          <ToggleButton value="realdebrid">Real-Debrid</ToggleButton>
          <ToggleButton value="torbox">TorBox</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <RealDebridBrowser provider={provider} />
    </Box>
  );
}
