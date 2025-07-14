import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip, IconButton, CircularProgress, Alert, useTheme, alpha, Stack, Tooltip } from '@mui/material';
import { PlayArrow, Stop, Edit, Schedule, CheckCircle, Error as ErrorIcon, Cancel, Pause, Refresh } from '@mui/icons-material';
import { Job, JobStatus, getJobStatusColor, getJobTypeColor } from '../../types/jobs';
import CountdownTimer from './CountdownTimer';
import JobEditDialog from './JobEditDialog';
import axios from 'axios';
import { useSSEEventListener } from '../../hooks/useCentralizedSSE';

interface JobsTableProps {
  onRefresh?: () => void;
}

const JobsTable: React.FC<JobsTableProps> = ({ onRefresh: _ }) => {
  const theme = useTheme();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningJobs, setRunningJobs] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const lastJobStatusRef = useRef<Map<string, JobStatus>>(new Map());

  const fetchJobs = useCallback(async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) setLoading(true);
      const response = await axios.get('/api/jobs');
      const data = response.data;
      const newJobs = data.jobs || [];

      // Update job status tracking for future reference
      newJobs.forEach((job: Job) => {
        lastJobStatusRef.current.set(job.id, job.status);
      });

      setJobs(newJobs);
      setError(null);
      setLastUpdated(new Date());

      // Auto-refresh every 5 seconds to keep job status and timers updated
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, []);

  const runJob = async (jobId: string) => {
    try {
      setRunningJobs(prev => new Set(prev).add(jobId));
      await axios.post(`/api/jobs/${jobId}/run`);
      await fetchJobs(false); // Single refresh to update status
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to run job');
    } finally {
      setRunningJobs(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      await axios.post(`/api/jobs/${jobId}/cancel`);
      await fetchJobs(false); // Single refresh to update status
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  const handleEditJob = (job: Job) => {
    setSelectedJob(job);
    setEditDialogOpen(true);
  };

  const handleEditDialogClose = () => {
    setEditDialogOpen(false);
    setSelectedJob(null);
  };

  const handleJobUpdated = () => {
    fetchJobs(false);
  };

  const getStatusIcon = (status: JobStatus) => {
    switch (status) {
      case JobStatus.RUNNING:
        return <CircularProgress size={16} />;
      case JobStatus.COMPLETED:
        return <CheckCircle sx={{ fontSize: 16, color: getJobStatusColor(status) }} />;
      case JobStatus.FAILED:
        return <ErrorIcon sx={{ fontSize: 16, color: getJobStatusColor(status) }} />;
      case JobStatus.CANCELLED:
        return <Cancel sx={{ fontSize: 16, color: getJobStatusColor(status) }} />;
      case JobStatus.DISABLED:
        return <Pause sx={{ fontSize: 16, color: getJobStatusColor(status) }} />;
      default:
        return <Schedule sx={{ fontSize: 16, color: getJobStatusColor(status) }} />;
    }
  };

  // Memoize sorted jobs to prevent unnecessary re-renders and row jumping
  const sortedJobs = useMemo(() => {
    return [...jobs].sort((a, b) => {
      // Sort by category first, then by name for stable ordering
      if (a.category !== b.category) {
        return a.category.localeCompare(b.category);
      }
      return a.name.localeCompare(b.name);
    });
  }, [jobs]);

  useEffect(() => {
    fetchJobs(true); // Initial load only
  }, [fetchJobs]);

  // Listen for job updates through centralized SSE
  useSSEEventListener(
    ['job_update'],
    (event) => {
      const data = event.data;

      if (data.jobId) {
        // Update the specific job in the list
        setJobs(prevJobs =>
          prevJobs.map(job =>
            job.id === data.jobId
              ? { ...job, status: data.status, updatedAt: data.timestamp }
              : job
          )
        );

        // If job completed or failed, refresh the full job list to get updated timers
        if (data.status === 'completed' || data.status === 'failed') {
          setTimeout(() => fetchJobs(false), 1000);
        }
      }
    },
    {
      source: 'jobs',
      dependencies: [fetchJobs]
    }
  );

  if (loading && jobs.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight={400}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h5" fontWeight="600" sx={{ mb: 1 }}>
            Jobs
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Maintenance tasks that run automatically or can be triggered manually
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary">
              Updated: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}
          <Tooltip title="Refresh Jobs">
            <IconButton
              onClick={() => fetchJobs(false)}
              disabled={loading}
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.2),
                },
                '&:disabled': {
                  bgcolor: alpha(theme.palette.action.disabled, 0.1),
                  color: 'action.disabled',
                },
              }}
            >
              {loading ? <CircularProgress size={20} /> : <Refresh />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Jobs Table */}
      <TableContainer
        component={Paper}
        sx={{
          bgcolor: 'background.paper',
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          overflow: 'hidden',
        }}
      >
        <Table>
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.05),
                '& th': {
                  fontWeight: 600,
                  color: 'text.primary',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                },
              }}
            >
              <TableCell>Job Name</TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>Type</TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Next Execution</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedJobs.map((job) => (
              <TableRow
                key={job.id}
                sx={{
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.02),
                  },
                  '& td': {
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  },
                }}
              >
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={2}>
                    {getStatusIcon(job.status)}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight="500" sx={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {job.name}
                      </Typography>
                      {job.status === JobStatus.RUNNING && (
                        <Typography variant="caption" color="primary.main">
                          Running...
                        </Typography>
                      )}
                      {/* Show type and next execution on mobile */}
                      <Box sx={{ display: { xs: 'block', md: 'none' }, mt: 0.5 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip
                            label={job.type.toUpperCase()}
                            size="small"
                            sx={{
                              bgcolor: alpha(getJobTypeColor(job.type), 0.1),
                              color: getJobTypeColor(job.type),
                              fontWeight: 600,
                              fontSize: '0.65rem',
                              height: 20,
                            }}
                          />
                          <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
                            <CountdownTimer
                              nextExecution={job.nextExecution}
                              status={job.status}
                              variant="caption"
                              color="text.secondary"
                              onExecutionTime={() => fetchJobs(false)}
                            />
                          </Box>
                        </Stack>
                      </Box>
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  <Chip
                    label={job.type.toUpperCase()}
                    size="small"
                    sx={{
                      bgcolor: alpha(getJobTypeColor(job.type), 0.1),
                      color: getJobTypeColor(job.type),
                      fontWeight: 600,
                      fontSize: '0.75rem',
                    }}
                  />
                </TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                  <CountdownTimer
                    nextExecution={job.nextExecution}
                    status={job.status}
                    onExecutionTime={() => fetchJobs(false)}
                  />
                </TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title="Edit Schedule">
                      <IconButton
                        size="small"
                        onClick={() => handleEditJob(job)}
                        sx={{
                          bgcolor: alpha(theme.palette.warning.main, 0.1),
                          color: 'warning.main',
                          '&:hover': {
                            bgcolor: alpha(theme.palette.warning.main, 0.2),
                          },
                        }}
                      >
                        <Edit sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>

                    {job.status === JobStatus.RUNNING ? (
                      <Tooltip title="Cancel Job">
                        <IconButton
                          size="small"
                          onClick={() => cancelJob(job.id)}
                          sx={{
                            bgcolor: alpha(theme.palette.error.main, 0.1),
                            color: 'error.main',
                            '&:hover': {
                              bgcolor: alpha(theme.palette.error.main, 0.2),
                            },
                          }}
                        >
                          <Stop sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="Run Now">
                        <IconButton
                          size="small"
                          onClick={() => runJob(job.id)}
                          disabled={runningJobs.has(job.id) || !job.enabled}
                          sx={{
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            color: 'primary.main',
                            '&:hover': {
                              bgcolor: alpha(theme.palette.primary.main, 0.2),
                            },
                            '&:disabled': {
                              bgcolor: alpha(theme.palette.action.disabled, 0.1),
                              color: 'action.disabled',
                            },
                          }}
                        >
                          {runningJobs.has(job.id) ? (
                            <CircularProgress size={16} />
                          ) : (
                            <PlayArrow sx={{ fontSize: 16 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {jobs.length === 0 && !loading && (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            bgcolor: 'background.paper',
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
            No jobs found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Jobs will appear here once they are configured.
          </Typography>
        </Box>
      )}

      <JobEditDialog
        open={editDialogOpen}
        onClose={handleEditDialogClose}
        job={selectedJob}
        onJobUpdated={handleJobUpdated}
      />
    </Box>
  );
};

export default JobsTable;
