import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Accordion, AccordionSummary, AccordionDetails, List, ListItem, ListItemText, ListItemIcon, Chip, Alert, TextField, InputAdornment, IconButton, Tooltip } from '@mui/material';
import { ExpandMore as ExpandMoreIcon, CheckCircle as CheckCircleIcon, ContentCopy as CopyIcon, Launch as LaunchIcon, Movie as MovieIcon, Tv as TvIcon } from '@mui/icons-material';
import { useConfig } from '../../contexts/ConfigContext';

interface ConnectionGuideProps {
  apiKey: string;
  serverUrl?: string;
}

const SpoofingConnectionGuide: React.FC<ConnectionGuideProps> = ({
  apiKey
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { config } = useConfig();

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const actualIp = config.ip || 'localhost';
  const actualPort = config.apiPort?.toString() || '8082';
  const hostname = actualIp === '0.0.0.0' ? 'localhost' : actualIp;
  const port = actualPort;

  const connectionSteps = [
    {
      title: 'Open Bazarr Settings',
      description: 'Navigate to Settings → Providers in your Bazarr interface',
      icon: <LaunchIcon />,
    },
    {
      title: 'Add Radarr Connection (for Movies)',
      description: 'Configure Radarr connection to access your movies',
      icon: <MovieIcon />,
      details: [
        'Click "Add" under Radarr section',
        'Set Name: "CineSync Movies"',
        `Set Hostname: ${hostname}`,
        `Set Port: ${port}`,
        `Set API Key: ${apiKey}`,
        'Leave Base URL empty, Set SSL: No',
        'Click "Test" then Save',
      ],
    },
    {
      title: 'Add Sonarr Connection (for TV Shows)',
      description: 'Configure Sonarr connection to access your TV shows',
      icon: <TvIcon />,
      details: [
        'Click "Add" under Sonarr section',
        'Set Name: "CineSync TV Shows"',
        `Set Hostname: ${hostname}`,
        `Set Port: ${port}`,
        `Set API Key: ${apiKey}`,
        'Leave Base URL empty, Set SSL: No',
        'Click "Test" then Save',
      ],
    },
    {
      title: 'Verify Connection',
      description: 'Check that Bazarr can see your media',
      icon: <CheckCircleIcon />,
      details: [
        'Check Movies and Series sections in Bazarr',
        'Your media should be visible',
        'If not, verify connection settings',
      ],
    },
  ];

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Connection Guide for Bazarr
        </Typography>
        
        <Alert severity="info" sx={{ mb: 3 }}>
          <Typography variant="body2">
            Follow these steps to connect Bazarr to CineSync for automatic subtitle management.
            CineSync will appear as both Radarr (movies) and Sonarr (TV shows) to Bazarr.
          </Typography>
        </Alert>

        {/* Quick Copy Section */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" gutterBottom>
            Quick Copy Connection Details
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Hostname"
              value={hostname}
              size="small"
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={copiedField === 'hostname' ? 'Copied!' : 'Copy'}>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(hostname, 'hostname')}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="Port"
              value={port}
              size="small"
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={copiedField === 'port' ? 'Copied!' : 'Copy'}>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(port, 'port')}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              label="API Key"
              value={apiKey}
              size="small"
              type="password"
              InputProps={{
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={copiedField === 'apikey' ? 'Copied!' : 'Copy'}>
                      <IconButton
                        size="small"
                        onClick={() => copyToClipboard(apiKey, 'apikey')}
                      >
                        <CopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </Box>

        {/* Step-by-step Guide */}
        <Typography variant="subtitle2" gutterBottom>
          Step-by-step Setup Guide
        </Typography>
        
        {connectionSteps.map((step, index) => (
          <Accordion key={index} sx={{ mb: 1 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip 
                  label={index + 1} 
                  size="small" 
                  color="primary" 
                  sx={{ minWidth: 32 }}
                />
                {step.icon}
                <Box>
                  <Typography variant="subtitle1">{step.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {step.description}
                  </Typography>
                </Box>
              </Box>
            </AccordionSummary>
            {step.details && (
              <AccordionDetails>
                <List dense>
                  {step.details.map((detail, detailIndex) => (
                    <ListItem key={detailIndex}>
                      <ListItemIcon>
                        <CheckCircleIcon color="success" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={detail} />
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            )}
          </Accordion>
        ))}

        <Alert severity="success" sx={{ mt: 3 }}>
          <Typography variant="body2">
            <strong>Pro Tip:</strong> Once connected, Bazarr will automatically sync with your CineSync library 
            and can download subtitles for your movies and TV shows based on your configured preferences.
          </Typography>
        </Alert>
      </CardContent>
    </Card>
  );
};

export default SpoofingConnectionGuide;
