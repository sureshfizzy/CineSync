import React from 'react';
import { Typography } from '@mui/material';
import { formatNextExecution, useCountdown, JobStatus } from '../../types/jobs';

interface CountdownTimerProps {
  nextExecution?: string;
  status?: JobStatus;
  variant?: 'body2' | 'caption';
  color?: string;
  onExecutionTime?: () => void;
}

const CountdownTimer: React.FC<CountdownTimerProps> = ({
  nextExecution,
  status,
  variant = 'body2',
  color,
  onExecutionTime
}) => {
  const currentTime = useCountdown(nextExecution);
  const formattedTime = formatNextExecution(nextExecution, currentTime, status);

  // Trigger callback when execution time is reached
  React.useEffect(() => {
    if (formattedTime === 'Now' && onExecutionTime) {
      const timeout = setTimeout(onExecutionTime, 2000);
      return () => clearTimeout(timeout);
    }
  }, [formattedTime, onExecutionTime]);
  
  return (
    <Typography
      variant={variant}
      color={color}
      sx={{
        fontWeight: (formattedTime === 'Now' || formattedTime === 'Running') ? 600 : 'inherit',
        color: formattedTime === 'Now' ? 'warning.main' :
               formattedTime === 'Running' ? 'success.main' : color,
      }}
    >
      {formattedTime}
    </Typography>
  );
};

export default CountdownTimer;
