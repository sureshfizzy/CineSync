import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningIcon from '@mui/icons-material/Warning';
import { OptionCard } from './StyledComponents';
import { ActionOptionsProps } from './types';

const ActionOptions: React.FC<ActionOptionsProps> = ({
  selectedOption,
  onOptionSelect,
  options
}) => {
  const theme = useTheme();

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      mt: 1
    }}>
      {/* Other Options - Grid Layout */}
      <Box sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
      }}>
        {options.filter(opt => opt.value !== 'skip').map((option) => {
          const isSelected = selectedOption === option.value;

          return (
            <OptionCard
              key={option.value}
              selected={isSelected}
              onClick={() => onOptionSelect(option.value)}
              elevation={isSelected ? 4 : 1}
            >
              <Box sx={{
                fontSize: '24px',
                lineHeight: 1,
                mt: '2px',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5
              }}>
                {option.icon}
              </Box>
              <Box>
                <Typography
                  variant="subtitle2"
                  fontWeight={600}
                >
                  {option.label}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  mt={0.5}
                >
                  {option.description}
                </Typography>
              </Box>
              {isSelected && (
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
          );
        })}
      </Box>

      {/* Skip Processing - Full Width Block at Bottom */}
      {options.find(opt => opt.value === 'skip') && (
        <Box sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.mode === 'dark'
                ? theme.palette.warning.main
                : '#f57c00',
              fontWeight: 600,
              fontSize: '0.75rem',
              mb: 1,
              display: 'block'
            }}
          >
            SKIP PROCESSING
          </Typography>
          {(() => {
            const skipOption = options.find(opt => opt.value === 'skip')!;
            const isSelected = selectedOption === 'skip';

            return (
              <OptionCard
                selected={isSelected}
                onClick={() => onOptionSelect('skip')}
                elevation={isSelected ? 4 : 1}
                sx={{
                  border: theme.palette.mode === 'dark'
                    ? `2px solid ${theme.palette.warning.main}40`
                    : `2px solid #ffb74d`,
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.05) 0%, rgba(244, 67, 54, 0.05) 100%)'
                    : 'linear-gradient(135deg, #fff8e1 0%, #ffecb3 100%)',
                  '&:hover': {
                    border: theme.palette.mode === 'dark'
                      ? `2px solid ${theme.palette.warning.main}60`
                      : `2px solid #ff9800`,
                    background: theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.08) 0%, rgba(244, 67, 54, 0.08) 100%)'
                      : 'linear-gradient(135deg, #fff3c4 0%, #ffe082 100%)',
                  },
                  ...(isSelected && {
                    border: `2px solid ${theme.palette.warning.main}`,
                    background: theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.1) 0%, rgba(244, 67, 54, 0.1) 100%)'
                      : 'linear-gradient(135deg, rgba(255, 152, 0, 0.05) 0%, rgba(244, 67, 54, 0.05) 100%)',
                  })
                }}
              >
                <Box sx={{
                  fontSize: '24px',
                  lineHeight: 1,
                  mt: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5
                }}>
                  {skipOption.icon}
                  <WarningIcon
                    sx={{
                      fontSize: '16px',
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.warning.main
                        : '#f57c00',
                      ml: 0.5
                    }}
                  />
                </Box>
                <Box>
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    sx={{
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.warning.main
                        : '#f57c00'
                    }}
                  >
                    {skipOption.label}
                  </Typography>
                  <Typography
                    variant="body2"
                    mt={0.5}
                    sx={{
                      fontWeight: 500,
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.warning.main
                        : '#f57c00'
                    }}
                  >
                    {skipOption.description}
                  </Typography>
                </Box>
                {isSelected && (
                  <CheckCircleOutlineIcon
                    sx={{
                      ml: 'auto',
                      alignSelf: 'flex-start',
                      fontSize: '20px',
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.warning.main
                        : '#f57c00'
                    }}
                  />
                )}
              </OptionCard>
            );
          })()}
        </Box>
      )}
    </Box>
  );
};

export default ActionOptions;
