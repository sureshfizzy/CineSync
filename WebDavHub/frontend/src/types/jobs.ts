// Job management types for WebDavHub
import { useState, useEffect } from 'react';

export interface Job {
  id: string;
  name: string;
  description: string;
  type: JobType;
  status: JobStatus;
  scheduleType: ScheduleType;
  intervalSeconds?: number;
  cronExpression?: string;
  command: string;
  arguments: string[];
  workingDir: string;
  enabled: boolean;
  category: string;
  tags: string[];
  dependencies?: string[];
  timeout?: number;
  maxRetries: number;
  logOutput: boolean;
  notifyOnFailure?: boolean;
  createdAt: string;
  updatedAt: string;
  lastExecution?: string;
  lastDuration?: number;
  nextExecution?: string;
}

export interface JobExecution {
  id: string;
  jobId: string;
  status: JobStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  output?: string;
  error?: string;
  exitCode?: number;
}

export enum JobType {
  PROCESS = 'process',
  SERVICE = 'service',
  COMMAND = 'command'
}

export enum JobStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  DISABLED = 'disabled'
}

export enum ScheduleType {
  MANUAL = 'manual',
  INTERVAL = 'interval',
  CRON = 'cron',
  STARTUP = 'startup'
}

export interface JobsResponse {
  jobs: Job[];
  status: string;
}

export interface JobExecutionResponse {
  executions: JobExecution[];
  status: string;
}

// Helper functions for job status and type display
export const getJobStatusColor = (status: JobStatus): string => {
  switch (status) {
    case JobStatus.IDLE:
      return '#6b7280';
    case JobStatus.RUNNING:
      return '#3b82f6';
    case JobStatus.COMPLETED:
      return '#10b981';
    case JobStatus.FAILED:
      return '#ef4444';
    case JobStatus.CANCELLED:
      return '#f59e0b';
    case JobStatus.DISABLED:
      return '#9ca3af';
    default:
      return '#6b7280';
  }
};

export const getJobTypeColor = (type: JobType): string => {
  switch (type) {
    case JobType.PROCESS:
      return '#8b5cf6';
    case JobType.SERVICE:
      return '#06b6d4';
    case JobType.COMMAND:
      return '#f59e0b';
    default:
      return '#6b7280';
  }
};

export const formatDuration = (seconds?: number): string => {
  if (!seconds) return 'N/A';
  
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
};

export const formatNextExecution = (nextExecution?: string, currentTime?: Date, status?: JobStatus): string => {
  // If job is running, show "Running"
  if (status === 'running') return 'Running';

  // If no next execution time, it's a manual job
  if (!nextExecution) return 'Manual';

  const now = currentTime || new Date();
  const next = new Date(nextExecution);
  const diffMs = next.getTime() - now.getTime();

  if (diffMs <= 0) return 'Now';

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
  } else if (diffHours > 0) {
    return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  } else if (diffMinutes > 0) {
    return `in ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;
  } else {
    return `in ${diffSeconds} second${diffSeconds > 1 ? 's' : ''}`;
  }
};

// Hook for live countdown timers
export const useCountdown = (targetDate?: string) => {
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    if (!targetDate) {
      // Update current time even without target date
      const interval = setInterval(() => {
        setCurrentTime(new Date());
      }, 1000);
      return () => clearInterval(interval);
    }

    // Always update every second, regardless of target time
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  return currentTime;
};
