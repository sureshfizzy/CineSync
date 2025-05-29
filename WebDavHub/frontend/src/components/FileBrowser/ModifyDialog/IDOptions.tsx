import React from 'react';
import { Box, TextField, Typography } from '@mui/material';
import { IDOptionsProps } from './types';

const IDOptions: React.FC<IDOptionsProps> = ({
  selectedIds,
  onIdsChange,
  options
}) => {
  const handleIdChange = (optionValue: string, value: string) => {
    onIdsChange({
      ...selectedIds,
      [optionValue]: value
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
      {options.map((option) => (
        <Box key={option.value}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {option.icon} {option.label}
            </Typography>
          </Box>
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            placeholder={option.placeholder}
            value={selectedIds[option.value] || ''}
            onChange={(e) => handleIdChange(option.value, e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '12px',
                '&:hover fieldset': {
                  borderColor: 'primary.main',
                },
              }
            }}
            helperText={
              <Typography variant="caption" color="text.secondary">
                {option.helperText}
              </Typography>
            }
          />
        </Box>
      ))}
    </Box>
  );
};

export default IDOptions;
