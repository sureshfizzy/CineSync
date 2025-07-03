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
      {/* Auto-Select - Full Width Block at Top */}
      {options.find(opt => opt.value === 'auto-select') && (
        <Box sx={{ mb: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.mode === 'dark'
                ? theme.palette.success.main
                : '#2e7d32',
              fontWeight: 600,
              fontSize: '0.75rem',
              mb: 1,
              display: 'block'
            }}
          >
            AUTO-SELECT PROCESSING
          </Typography>
          {(() => {
            const autoSelectOption = options.find(opt => opt.value === 'auto-select')!;
            const isSelected = selectedOption === 'auto-select';

            return (
              <OptionCard
                selected={isSelected}
                onClick={() => onOptionSelect('auto-select')}
                elevation={isSelected ? 4 : 1}
                sx={{
                  border: theme.palette.mode === 'dark'
                    ? `2px solid ${theme.palette.success.main}40`
                    : `2px solid #81c784`,
                  background: theme.palette.mode === 'dark'
                    ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.05) 0%, rgba(139, 195, 74, 0.05) 100%)'
                    : 'linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%)',
                  '&:hover': {
                    border: theme.palette.mode === 'dark'
                      ? `2px solid ${theme.palette.success.main}60`
                      : `2px solid #4caf50`,
                    background: theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(139, 195, 74, 0.08) 100%)'
                      : 'linear-gradient(135deg, #dcedc8 0%, #aed581 100%)',
                  },
                  ...(isSelected && {
                    border: `2px solid ${theme.palette.success.main}`,
                    background: theme.palette.mode === 'dark'
                      ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(139, 195, 74, 0.1) 100%)'
                      : 'linear-gradient(135deg, rgba(76, 175, 80, 0.05) 0%, rgba(139, 195, 74, 0.05) 100%)',
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
                  {autoSelectOption.icon}
                </Box>
                <Box>
                  <Typography
                    variant="subtitle2"
                    fontWeight={600}
                    sx={{
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.success.main
                        : '#2e7d32'
                    }}
                  >
                    {autoSelectOption.label}
                  </Typography>
                  <Typography
                    variant="body2"
                    mt={0.5}
                    sx={{
                      fontWeight: 500,
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.success.main
                        : '#2e7d32'
                    }}
                  >
                    {autoSelectOption.description}
                  </Typography>
                </Box>
                {isSelected && (
                  <CheckCircleOutlineIcon
                    sx={{
                      ml: 'auto',
                      alignSelf: 'flex-start',
                      fontSize: '20px',
                      color: theme.palette.mode === 'dark'
                        ? theme.palette.success.main
                        : '#2e7d32'
                    }}
                  />
                )}
              </OptionCard>
            );
          })()}
        </Box>
      )}

      {/* Other Options - Grid Layout */}
      <Box sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
      }}>
        {options.filter(opt => opt.value !== 'skip' && opt.value !== 'auto-select').map((option) => {
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
