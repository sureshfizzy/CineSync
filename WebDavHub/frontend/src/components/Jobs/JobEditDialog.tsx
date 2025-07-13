import React, { useState, useEffect } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, FormControl, InputLabel, Select, MenuItem, Box, Typography, IconButton, Alert, useTheme, alpha } from '@mui/material';
import { Close } from '@mui/icons-material';
import { Job, ScheduleType } from '../../types/jobs';
import axios from 'axios';

interface JobEditDialogProps {
  open: boolean;
  onClose: () => void;
  job: Job | null;
  onJobUpdated: () => void;
}

const JobEditDialog: React.FC<JobEditDialogProps> = ({ open, onClose, job, onJobUpdated }) => {
  const theme = useTheme();
  const [scheduleType, setScheduleType] = useState<ScheduleType>(ScheduleType.MANUAL);
  const [intervalSeconds, setIntervalSeconds] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form data when job changes
  useEffect(() => {
    if (job) {
      setScheduleType(job.scheduleType);
      setIntervalSeconds(job.intervalSeconds || 0);
    }
  }, [job]);

  const handleSubmit = async () => {
    if (!job) return;

    setLoading(true);
    setError(null);

    try {
      // Only send the essential fields to avoid serialization issues
      const updateData = {
        name: job.name,
        description: job.description,
        type: job.type,
        scheduleType,
        intervalSeconds: scheduleType === ScheduleType.INTERVAL ? intervalSeconds : 0,
        cronExpression: "",
        command: job.command,
        arguments: job.arguments || [],
        workingDir: job.workingDir,
        enabled: job.enabled,
        category: job.category,
        tags: job.tags || [],
        dependencies: job.dependencies || [],
        maxRetries: job.maxRetries,
        logOutput: job.logOutput,
        notifyOnFailure: job.notifyOnFailure || false,
      };

      const response = await axios.put(`/api/jobs/${job.id}`, updateData, {
        timeout: 10000,
      });

      if (response.status !== 200) {
        throw new Error('Failed to update job schedule');
      }

      onJobUpdated();
      onClose();
    } catch (err: any) {
      let errorMessage = 'Failed to update job schedule';

      if (err.response) {
        errorMessage = err.response.data || `Server error: ${err.response.status}`;
      } else if (err.request) {
        errorMessage = 'No response from server. Please check your connection.';
      } else {
        errorMessage = err.message || 'Unknown error occurred';
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  if (!job) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          boxShadow: theme.palette.mode === 'light'
            ? '0 8px 32px rgba(0, 0, 0, 0.12)'
            : '0 8px 32px rgba(0, 0, 0, 0.4)',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.05),
          borderBottom: '1px solid',
          borderColor: 'divider',
          py: 2,
          minHeight: 'auto',
        }}
      >
        <Typography
          variant="h6"
          component="div"
          sx={{
            fontSize: '1.1rem',
            fontWeight: 600,
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 'calc(100% - 48px)',
          }}
        >
          Edit Schedule: {job.name}
        </Typography>
        <IconButton onClick={handleClose} size="small">
          <Close />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Schedule Type</InputLabel>
            <Select
              value={scheduleType}
              onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
              label="Schedule Type"
              sx={{
                '& .MuiSelect-select': {
                  py: '12px',
                  px: '14px',
                  minHeight: '20px',
                  display: 'flex',
                  alignItems: 'center',
                },
                '& .MuiOutlinedInput-root': {
                  minHeight: '56px',
                },
                '& .MuiInputLabel-root': {
                  lineHeight: 1.4375,
                },
              }}
            >
              <MenuItem value={ScheduleType.MANUAL}>Manual</MenuItem>
              <MenuItem value={ScheduleType.INTERVAL}>Interval</MenuItem>
            </Select>
          </FormControl>

          {scheduleType === ScheduleType.INTERVAL && (
            <TextField
              fullWidth
              label="Interval (seconds)"
              type="number"
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(parseInt(e.target.value) || 0)}
              inputProps={{ min: 1 }}
              helperText="How often the job should run (in seconds)"
            />
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 0 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
        >
          {loading ? 'Updating...' : 'Update Schedule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default JobEditDialog;
