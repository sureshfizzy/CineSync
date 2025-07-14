import { useState, useEffect, ReactNode } from 'react';
import { Box, Fade, Slide, Zoom } from '@mui/material';
import axios from 'axios';
import ConfigurationPlaceholder from '../FileBrowser/ConfigurationPlaceholder';

interface ConfigStatus {
  isPlaceholder: boolean;
  destinationDir: string;
  effectiveRootDir: string;
  needsConfiguration: boolean;
}

interface ConfigurationWrapperProps {
  children: ReactNode;
  fallbackComponent?: ReactNode;
}

export function ConfigurationWrapper({ children, fallbackComponent }: ConfigurationWrapperProps) {
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPlaceholder, setShowPlaceholder] = useState(false);

  const checkConfigStatus = async () => {
    try {
      const response = await axios.get('/api/config-status');
      const newStatus = response.data;

      // If transitioning from placeholder to configured, add a delay for smooth animation
      if (configStatus?.needsConfiguration && !newStatus.needsConfiguration) {
        setShowPlaceholder(false);
        setTimeout(() => {
          setConfigStatus(newStatus);
        }, 300);
      } else {
        setConfigStatus(newStatus);
        setShowPlaceholder(newStatus.needsConfiguration);
      }
    } catch (err) {
      console.error('Failed to check config status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkConfigStatus();

    // Listen for config status refresh events
    const handleConfigStatusRefresh = () => {
      checkConfigStatus();
    };

    window.addEventListener('config-status-refresh', handleConfigStatusRefresh);

    return () => {
      window.removeEventListener('config-status-refresh', handleConfigStatusRefresh);
    };
  }, []);

  // Update showPlaceholder when configStatus changes
  useEffect(() => {
    if (configStatus) {
      if (configStatus.needsConfiguration) {
        setShowPlaceholder(true);
      }
    }
  }, [configStatus]);

  if (loading) {
    return fallbackComponent || (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        Loading...
      </Box>
    );
  }

  // Show configuration placeholder with animations
  if (configStatus?.needsConfiguration || showPlaceholder) {
    return (
      <Fade in={showPlaceholder} timeout={500}>
        <Box>
          <Zoom in={showPlaceholder} timeout={300} style={{ transitionDelay: showPlaceholder ? '100ms' : '0ms' }}>
            <Box>
              <ConfigurationPlaceholder
                destinationDir={configStatus?.destinationDir || ''}
                effectiveRootDir={configStatus?.effectiveRootDir || ''}
              />
            </Box>
          </Zoom>
        </Box>
      </Fade>
    );
  }

  // Show main content with slide-in animation
  return (
    <Slide direction="up" in={!showPlaceholder} timeout={500}>
      <Box>
        <Fade in={!showPlaceholder} timeout={700} style={{ transitionDelay: '200ms' }}>
          <Box>
            {children}
          </Box>
        </Fade>
      </Box>
    </Slide>
  );
}

export default ConfigurationWrapper;
