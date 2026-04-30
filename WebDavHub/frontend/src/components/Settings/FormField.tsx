import React from 'react';
import { TextField, Switch, FormControlLabel, Select, MenuItem, Chip, Box, Typography, InputAdornment, IconButton, Tooltip, Stack } from '@mui/material';
import { Info, Visibility, VisibilityOff, Lock, Help } from '@mui/icons-material';

export interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'string' | 'boolean' | 'integer' | 'array' | 'password' | 'select';
  required?: boolean;
  description?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: string[];
  multiline?: boolean;
  rows?: number;
  beta?: boolean;
  locked?: boolean;
  showTokenHelper?: boolean;
  onTokenHelperClick?: () => void;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChange,
  type = 'string',
  required = false,
  description,
  error,
  disabled = false,
  placeholder,
  options,
  multiline = false,
  rows = 1,
  beta = false,
  locked = false,
  showTokenHelper = false,
  onTokenHelperClick,
}) => {
  const [showPassword, setShowPassword] = React.useState(false);

  const handleTogglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const formatOptionLabel = (option: string) => {
    if (option === 'rc_monitor') return 'RC Monitor';
    if (option === 'polling') return 'Polling';
    return option;
  };

  const renderField = () => {
    switch (type) {
      case 'boolean':
        return (
          <Stack spacing={0.5} sx={{
            alignItems: "flex-start"
          }}>
            <FormControlLabel
              control={
                <Switch
                  checked={value === 'true' || value === '1' || value === 'yes'}
                  onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
                  disabled={isFieldDisabled}
                  color="primary"
                />
              }
                label={label}
            />
            {(description || error) && (
              <Typography variant="caption" color={error ? 'error' : 'text.secondary'}>
                {error || description}
              </Typography>
            )}
          </Stack>
        );

      case 'integer':
        return (
          <TextField
            fullWidth
            type="number"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={isFieldDisabled}
            error={!!error}
            helperText={error || description}
            variant="outlined"
            size="small"
            slotProps={{ input: {
              inputProps: { min: 0 }
            } }}
          />
        );

      case 'array':
        const arrayValues = value ? value.split(',').map(v => v.trim()).filter(v => v) : [];
        if (options && options.length > 0) {
          const toggleOption = (option: string) => {
            const exists = arrayValues.includes(option);
            const nextValues = exists
              ? arrayValues.filter((item) => item !== option)
              : [...arrayValues, option];
            onChange(nextValues.join(', '));
          };
          const dummyTagValues: Record<string, string> = {
            'Resolution': '1080p',
            'Quality Full': 'Bluray-1080p Proper',
            'Quality Title': 'Bluray-1080p',
            'Custom Formats': 'iNTERNAL',
            'TMDB': '{tmdb-603}',
            'IMDB': '{imdb-tt0133093}',
            'MediaInfo VideoCodec': 'x264',
            'MediaInfo AudioCodec': 'DTS',
            'MediaInfo AudioChannels': '5.1',
            'MediaInfo Dynamic Range': 'HDR'
          };
          const dummyBaseName = 'The Matrix (1999)';
          const selectedTagValues = arrayValues
            .map((tag) => dummyTagValues[tag] || tag)
            .filter(Boolean);
          const exampleFilename = selectedTagValues.length > 0
            ? `${dummyBaseName} ${selectedTagValues.join(' ')}.mkv`
            : `${dummyBaseName}.mkv`;

          return (
            <Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {options.map((option) => {
                  const isSelected = arrayValues.includes(option);
                  return (
                    <Chip
                      key={option}
                      label={option}
                      clickable
                      disabled={isFieldDisabled}
                      onClick={() => toggleOption(option)}
                      color={isSelected ? 'primary' : 'default'}
                      variant={isSelected ? 'filled' : 'outlined'}
                      sx={{
                        transition: 'all 0.15s ease',
                        '&:hover': {
                          transform: isFieldDisabled ? 'none' : 'translateY(-1px)',
                        },
                      }}
                    />
                  );
                })}
              </Box>
              {(error || description) && (
                <Typography variant="caption" color={error ? 'error' : 'text.secondary'} sx={{ mt: 0.5, display: 'block' }}>
                  {error || description}
                </Typography>
              )}
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  mt: 0.75,
                  display: 'block'
                }}>
                Example filename: {exampleFilename}
              </Typography>
            </Box>
          );
        }
        return (
          <Box>
            <TextField
              fullWidth
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || "Comma-separated values"}
              disabled={isFieldDisabled}
              error={!!error}
            helperText={error || description || "Enter values separated by commas"}
              variant="outlined"
              size="small"
              multiline={multiline}
              rows={rows}
            />
            {arrayValues.length > 0 && (
              <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {arrayValues.map((item, index) => (
                  <Chip
                    key={index}
                    label={item}
                    size="small"
                    variant="outlined"
                    onDelete={() => {
                      const newValues = arrayValues.filter((_, i) => i !== index);
                      onChange(newValues.join(', '));
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        );

      case 'password':
        return (
          <TextField
            fullWidth
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={isFieldDisabled}
            error={!!error}
            helperText={error || description}
            variant="outlined"
            size="small"
            slotProps={{ input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={handleTogglePasswordVisibility}
                    edge="end"
                    size="small"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            } }}
          />
        );

      case 'select':
        return (
          <Box>
            <Select
              fullWidth
              value={value}
              onChange={(e) => onChange(e.target.value as string)}
              disabled={isFieldDisabled}
              variant="outlined"
              size="small"
            >
              {options && options.map((option) => (
                <MenuItem key={option} value={option}>
                  {formatOptionLabel(option)}
                  {option === 'Smart Replace' && (
                    <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                      Dash or Space Dash depending on name
                    </Typography>
                  )}
                </MenuItem>
              ))}
            </Select>
            {(error || description) && (
              <Typography variant="caption" color={error ? 'error' : 'text.secondary'} sx={{ mt: 0.5, display: 'block' }}>
                {error || description}
              </Typography>
            )}
          </Box>
        );

      default:
        if (options && options.length > 0) {
          return (
            <Select
              fullWidth
              value={value}
              onChange={(e) => onChange(e.target.value as string)}
              disabled={isFieldDisabled}
              variant="outlined"
              size="small"
              displayEmpty
            >
              <MenuItem value="">
                <em>Select an option</em>
              </MenuItem>
              {options.map((option) => (
                <MenuItem key={option} value={option}>
                  {formatOptionLabel(option)}
                </MenuItem>
              ))}
            </Select>
          );
        }

        return (
          <TextField
            fullWidth
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={isFieldDisabled}
            error={!!error}
            helperText={error || description}
            variant="outlined"
            size="small"
            multiline={multiline}
            rows={rows}
            slotProps={showTokenHelper ? {
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title="Show available tokens" placement="top">
                      <IconButton
                        onClick={onTokenHelperClick}
                        edge="end"
                        size="small"
                        sx={{
                          color: 'primary.main',
                          '&:hover': {
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                          }
                        }}
                      >
                        <Help />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }
            } : undefined}
          />
        );
    }
  };

  // Determine if field should be disabled
  const isFieldDisabled = disabled || locked;

  return (
    <Box sx={{ mb: 3 }}>
      {/* Locked Alert */}
      {/* Locked banner removed per request; rely on chip + disabled state */}
      {/* Beta/Disabled Alert */}
      {/* Removed visual message; rely on disable state only */}
      {(label || locked) && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{
            alignItems: "center"
          }}>
            {label && (
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: isFieldDisabled ? 'text.disabled' : 'text.primary',
                fontSize: '0.875rem',
              }}
            >
              {label}
              {required && (
                <Typography
                  component="span"
                  sx={{
                    color: "error.main",
                    ml: 0.5
                  }}>
                  *
                </Typography>
              )}
            </Typography>
            )}
            {locked && (
              <Chip
                label="LOCKED"
                size="small"
                color="error"
                variant="outlined"
                icon={<Lock sx={{ fontSize: '0.7rem !important' }} />}
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  '& .MuiChip-icon': {
                    fontSize: '0.7rem'
                  }
                }}
              />
            )}
            {beta && !locked && (
              <Chip
                label="BETA"
                size="small"
                color={disabled ? "default" : "info"}
                variant="outlined"
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  opacity: disabled ? 0.5 : 1
                }}
              />
            )}
          </Stack>
          {description && (
            <Tooltip
              title={description}
              placement="top"
              arrow
              sx={{
                '& .MuiTooltip-tooltip': {
                  maxWidth: 300,
                  fontSize: '0.75rem',
                }
              }}
            >
              <IconButton size="small" sx={{ ml: 1, p: 0.25, color: 'text.secondary' }}>
                <Info fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      <Box
        sx={{
          '& .MuiTextField-root': {
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
              transition: 'all 0.2s ease',
              '&:hover': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'primary.main',
                },
              },
              '&.Mui-focused': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: 2,
                },
              },
            },
          },
          '& .MuiSelect-root': {
            borderRadius: 2,
          },
          '& .MuiFormControlLabel-root': {
            '& .MuiSwitch-root': {
              '& .MuiSwitch-switchBase': {
                '&.Mui-checked': {
                  '& + .MuiSwitch-track': {
                    opacity: 1,
                  },
                },
              },
            },
          },
        }}
      >
        {renderField()}
      </Box>
    </Box>
  );
};

export default FormField;
