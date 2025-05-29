import React from 'react';
import { Box, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { OptionCard } from './StyledComponents';
import { ActionOptionsProps } from './types';

const ActionOptions: React.FC<ActionOptionsProps> = ({
  selectedOption,
  onOptionSelect,
  options
}) => {
  return (
    <Box sx={{
      display: 'grid',
      gap: 2,
      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
      mt: 1
    }}>
      {options.map((option) => (
        <OptionCard
          key={option.value}
          selected={selectedOption === option.value}
          onClick={() => onOptionSelect(option.value)}
          elevation={selectedOption === option.value ? 4 : 1}
        >
          <Box sx={{
            fontSize: '24px',
            lineHeight: 1,
            mt: '2px'
          }}>
            {option.icon}
          </Box>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>
              {option.label}
            </Typography>
            <Typography variant="body2" color="text.secondary" mt={0.5}>
              {option.description}
            </Typography>
          </Box>
          {selectedOption === option.value && (
            <CheckCircleOutlineIcon
              color="primary"
              sx={{
                ml: 'auto',
                alignSelf: 'flex-start',
                fontSize: '20px'
              }}
            />
          )}
        </OptionCard>
      ))}
    </Box>
  );
};

export default ActionOptions;
