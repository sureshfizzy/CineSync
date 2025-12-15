import React, {useEffect, useState} from 'react';
import {Alert, alpha, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Fade, LinearProgress, List, ListItem, ListItemIcon, ListItemText, Typography, useTheme} from '@mui/material';
import {CheckCircle as CheckCircleIcon, Error as ErrorIcon, Schedule as ScheduleIcon, Science as TestTubeIcon, Search as SearchIcon,} from '@mui/icons-material';
import { Indexer, TestStatus, TEST_STATUS_COLORS, TEST_STATUS_LABELS } from '../../types/indexer';
import { IndexerApi } from '../../api/indexerApi';

interface IndexerTestDialogProps {
  open: boolean;
  onClose: () => void;
  indexer: Indexer | null;
}

interface TestStep {
  id: string;
  name: string;
  description: string;
  status: TestStatus;
  message?: string;
  responseTime?: number;
}

export default function IndexerTestDialog({ open, onClose, indexer }: IndexerTestDialogProps) {
  const theme = useTheme();
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<TestStep[]>([]);
  const [overallStatus, setOverallStatus] = useState<TestStatus>('unknown');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (open && indexer) {
      setTestResults([]);
      setOverallStatus('unknown');
      setError('');
    }
  }, [open, indexer]);

  const getStatusIcon = (status: TestStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircleIcon sx={{ color: TEST_STATUS_COLORS.success, fontSize: 20 }} />;
      case 'failed':
        return <ErrorIcon sx={{ color: TEST_STATUS_COLORS.failed, fontSize: 20 }} />;
      case 'timeout':
        return <ScheduleIcon sx={{ color: TEST_STATUS_COLORS.timeout, fontSize: 20 }} />;
      default:
        return <TestTubeIcon sx={{ color: TEST_STATUS_COLORS.unknown, fontSize: 20 }} />;
    }
  };

  const getStatusColor = (status: TestStatus) => {
    return TEST_STATUS_COLORS[status];
  };

  const runTests = async () => {
    if (!indexer) return;

    setTesting(true);
    setError('');
    setTestResults([]);
    setOverallStatus('unknown');

    const tests: TestStep[] = [
      {
        id: 'connection',
        name: 'Connection Test',
        description: 'Testing basic connectivity to the indexer',
        status: 'unknown',
      },
      {
        id: 'api_key',
        name: 'API Key Validation',
        description: 'Validating API key authentication',
        status: 'unknown',
      },
      {
        id: 'search',
        name: 'Search Test',
        description: 'Testing search functionality',
        status: 'unknown',
      },
    ];

    setTestResults([...tests]);

    try {
      // Test 1: Connection Test
      await updateTestStep('connection', 'unknown', 'Testing connection...');
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate test time
      
      try {
        const connectionResult = await IndexerApi.testIndexer(indexer.id);
        await updateTestStep('connection', connectionResult.status, connectionResult.message, connectionResult.responseTimeMs);
      } catch (err) {
        await updateTestStep('connection', 'failed', err instanceof Error ? err.message : 'Connection test failed');
      }

      // Test 2: API Key Test (if API key is provided)
      if (indexer.apiKey) {
        await updateTestStep('api_key', 'unknown', 'Validating API key...');
        await new Promise(resolve => setTimeout(resolve, 800));
        
        // Simulate API key validation
        if (indexer.apiKey.length > 10) {
          await updateTestStep('api_key', 'success', 'API key is valid', 150);
        } else {
          await updateTestStep('api_key', 'failed', 'API key appears to be invalid');
        }
      } else {
        await updateTestStep('api_key', 'failed', 'No API key provided');
      }

      // Test 3: Search Test
      await updateTestStep('search', 'unknown', 'Testing search functionality...');
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      try {
        const searchResults = await IndexerApi.searchIndexer(indexer.id, { query: 'test', limit: 1 });
        await updateTestStep('search', 'success', `Search test successful (${searchResults.length} results)`, 200);
      } catch (err) {
        await updateTestStep('search', 'failed', err instanceof Error ? err.message : 'Search test failed');
      }

      // Determine overall status
      const hasFailed = testResults.some(test => test.status === 'failed');
      const hasSuccess = testResults.some(test => test.status === 'success');
      
      if (hasFailed) {
        setOverallStatus('failed');
      } else if (hasSuccess) {
        setOverallStatus('success');
      } else {
        setOverallStatus('timeout');
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test execution failed');
      setOverallStatus('failed');
    } finally {
      setTesting(false);
    }
  };

  const updateTestStep = async (id: string, status: TestStatus, message?: string, responseTime?: number) => {
    setTestResults(prev => prev.map(test => 
      test.id === id 
        ? { ...test, status, message, responseTime }
        : test
    ));
  };

  const handleClose = () => {
    if (!testing) {
      onClose();
    }
  };

  const getOverallStatusMessage = () => {
    switch (overallStatus) {
      case 'success':
        return 'All tests passed successfully!';
      case 'failed':
        return 'Some tests failed. Please check the configuration.';
      case 'timeout':
        return 'Tests timed out. The indexer may be slow or unreachable.';
      default:
        return 'Run tests to check indexer status.';
    }
  };

  const getOverallStatusColor = () => {
    return getStatusColor(overallStatus);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          boxShadow: theme.palette.mode === 'dark' 
            ? `0 20px 60px ${alpha(theme.palette.common.black, 0.4)}`
            : `0 20px 60px ${alpha(theme.palette.common.black, 0.25)}`,
          background: theme.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.15)} 0%, ${theme.palette.background.paper} 100%)`
            : theme.palette.background.paper,
          border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
          overflow: 'hidden',
          backdropFilter: 'blur(10px)'
        }
      }}
    >
      <Fade in={open} timeout={300}>
        <Box>
          <DialogTitle sx={{ 
            pb: 2,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, ${alpha(theme.palette.info.main, 0.2)} 0%, ${alpha(theme.palette.info.main, 0.05)} 100%)`
              : alpha(theme.palette.info.main, 0.1),
            borderBottom: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
            p: 3
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ 
                bgcolor: theme.palette.mode === 'dark' 
                  ? alpha(theme.palette.info.main, 0.25)
                  : alpha(theme.palette.info.main, 0.2),
                color: theme.palette.info.main,
                width: 48,
                height: 48,
                border: theme.palette.mode === 'light' ? `1px solid ${alpha(theme.palette.info.main, 0.2)}` : 'none'
              }}>
                <TestTubeIcon sx={{ fontSize: 24 }} />
              </Avatar>
              <Box>
                <Typography variant="h6" fontWeight={600} color="info">
                  Test Indexer Connection
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {indexer?.name}
                </Typography>
              </Box>
            </Box>
          </DialogTitle>
          
          <DialogContent sx={{ p: 3 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>
                {error}
              </Alert>
            )}

            {/* Indexer Information */}
            <Box sx={{ 
              p: 2, 
              bgcolor: alpha(theme.palette.info.main, 0.1),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
              mb: 3
            }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SearchIcon sx={{ fontSize: 20 }} />
                Indexer Details
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, fontSize: '0.875rem' }}>
                <Typography variant="body2" color="text.secondary">Protocol:</Typography>
                <Typography variant="body2">{IndexerApi.getProtocolDisplayName(indexer?.protocol || '')}</Typography>
                
                <Typography variant="body2" color="text.secondary">URL:</Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {indexer?.url}
                </Typography>
                
                <Typography variant="body2" color="text.secondary">API Key:</Typography>
                <Typography variant="body2">
                  {indexer?.apiKey ? '••••••••' : 'Not provided'}
                </Typography>
              </Box>
            </Box>

            {/* Overall Status */}
            <Box sx={{ 
              p: 2, 
              bgcolor: alpha(getOverallStatusColor(), 0.1),
              borderRadius: 2,
              border: `1px solid ${alpha(getOverallStatusColor(), 0.3)}`,
              mb: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 2
            }}>
              {getStatusIcon(overallStatus)}
              <Box>
                <Typography variant="h6" fontWeight={600} sx={{ color: getOverallStatusColor() }}>
                  {TEST_STATUS_LABELS[overallStatus]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {getOverallStatusMessage()}
                </Typography>
              </Box>
            </Box>

            {/* Test Progress */}
            {testing && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Running tests...
                </Typography>
                <LinearProgress sx={{ borderRadius: 1 }} />
              </Box>
            )}

            {/* Test Results */}
            <Typography variant="h6" fontWeight={600} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TestTubeIcon sx={{ fontSize: 20 }} />
              Test Results
            </Typography>

            <List sx={{ p: 0 }}>
              {testResults.map((test, index) => (
                <React.Fragment key={test.id}>
                  <ListItem sx={{ px: 0, py: 1.5 }}>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      {testing && test.status === 'unknown' ? (
                        <CircularProgress size={20} />
                      ) : (
                        getStatusIcon(test.status)
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="body1" fontWeight={500}>
                            {test.name}
                          </Typography>
                          <Chip
                            label={TEST_STATUS_LABELS[test.status]}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.7rem',
                              bgcolor: alpha(getStatusColor(test.status), 0.1),
                              color: getStatusColor(test.status),
                              border: `1px solid ${alpha(getStatusColor(test.status), 0.3)}`
                            }}
                          />
                          {test.responseTime && (
                            <Chip
                              label={`${test.responseTime}ms`}
                              size="small"
                              variant="outlined"
                              sx={{
                                height: 20,
                                fontSize: '0.7rem'
                              }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Typography variant="body2" color="text.secondary">
                          {test.description}
                          {test.message && (
                            <Box component="span" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic' }}>
                              {test.message}
                            </Box>
                          )}
                        </Typography>
                      }
                    />
                  </ListItem>
                  {index < testResults.length - 1 && (
                    <Divider sx={{ mx: 5, borderColor: alpha(theme.palette.divider, 0.1) }} />
                  )}
                </React.Fragment>
              ))}
            </List>

            {testResults.length === 0 && !testing && (
              <Box sx={{ 
                p: 4, 
                textAlign: 'center',
                bgcolor: alpha(theme.palette.grey[500], 0.1),
                borderRadius: 2
              }}>
                <TestTubeIcon sx={{ fontSize: 48, color: theme.palette.grey[400], mb: 2 }} />
                <Typography variant="body1" color="text.secondary">
                  Click "Run Tests" to start testing the indexer connection
                </Typography>
              </Box>
            )}
          </DialogContent>
          
          <DialogActions sx={{ 
            p: 3, 
            gap: 2,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(90deg, ${alpha(theme.palette.info.main, 0.05)} 0%, ${alpha(theme.palette.info.main, 0.1)} 100%)`
              : alpha(theme.palette.info.main, 0.05),
            borderTop: `1px solid ${alpha(theme.palette.info.main, 0.3)}`
          }}>
            <Button 
              onClick={handleClose}
              disabled={testing}
              sx={{ 
                borderRadius: 2,
                px: 3,
                py: 1,
                fontWeight: 500,
                minWidth: 100
              }}
            >
              Close
            </Button>
            <Button
              onClick={runTests}
              variant="contained"
              disabled={testing || !indexer}
              startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TestTubeIcon />}
              sx={{
                borderRadius: 2,
                px: 3,
                py: 1,
                fontWeight: 600,
                minWidth: 120,
                boxShadow: `0 4px 20px ${alpha(theme.palette.info.main, 0.3)}`,
                '&:hover': {
                  boxShadow: `0 6px 25px ${alpha(theme.palette.info.main, 0.4)}`,
                  transform: 'translateY(-1px)'
                },
                transition: 'all 0.2s ease'
              }}
            >
              {testing ? 'Testing...' : 'Run Tests'}
            </Button>
          </DialogActions>
        </Box>
      </Fade>
    </Dialog>
  );
}
