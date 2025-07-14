import React from 'react';
import { TextField, Switch, FormControlLabel, Select, MenuItem, Chip, Box, Typography, InputAdornment, IconButton, Tooltip, Stack, Alert } from '@mui/material';
import { Info, Visibility, VisibilityOff, Science, Lock } from '@mui/icons-material';

export interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'string' | 'boolean' | 'integer' | 'array' | 'password';
  required?: boolean;
  description?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: string[];
  multiline?: boolean;
  rows?: number;
  beta?: boolean;
  disabledReason?: string;
  locked?: boolean;
  lockedBy?: string;
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
  disabledReason,
  locked = false,
  lockedBy,
}) => {
  const [showPassword, setShowPassword] = React.useState(false);

  const handleTogglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const renderField = () => {
    switch (type) {
      case 'boolean':
        return (
          <FormControlLabel
            control={
              <Switch
                checked={value === 'true' || value === '1' || value === 'yes'}
                onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
                disabled={isFieldDisabled}
                color="primary"
              />
            }
            label=""
          />
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
            helperText={error}
            variant="outlined"
            size="small"
            InputProps={{
              inputProps: { min: 0 }
            }}
          />
        );

      case 'array':
        const arrayValues = value ? value.split(',').map(v => v.trim()).filter(v => v) : [];
        return (
          <Box>
            <TextField
              fullWidth
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || "Comma-separated values"}
              disabled={isFieldDisabled}
              error={!!error}
              helperText={error || "Enter values separated by commas"}
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
            helperText={error}
            variant="outlined"
            size="small"
            InputProps={{
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
            }}
          />
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
                  {option}
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
            helperText={error}
            variant="outlined"
            size="small"
            multiline={multiline}
            rows={rows}
          />
        );
    }
  };

  // Determine if field should be disabled
  const isFieldDisabled = disabled || locked;

  return (
    <Box sx={{ mb: 3 }}>
      {/* Locked Alert */}
      {locked && (
        <Alert
          severity="error"
          icon={<Lock />}
          sx={{
            mb: 2,
            '& .MuiAlert-message': {
              fontSize: '0.875rem'
            }
          }}
        >
          <Stack spacing={0.5}>
            <Typography variant="body2" fontWeight={600}>
              Configuration Locked
            </Typography>
            <Typography variant="body2">
              This setting has been locked by {lockedBy || 'Administrator'} and cannot be modified by users.
            </Typography>
          </Stack>
        </Alert>
      )}

      {/* Beta/Disabled Alert */}
      {(beta || disabled) && !locked && (
        <Alert
          severity={disabled ? "warning" : "info"}
          icon={<Science />}
          sx={{
            mb: 2,
            '& .MuiAlert-message': {
              fontSize: '0.875rem'
            }
          }}
        >
          {disabled ? (
            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={600}>
                Beta Feature - Currently Disabled
              </Typography>
              <Typography variant="body2">
                {disabledReason || "This feature is in beta testing and is currently disabled for usage. It will be available in a future release."}
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={0.5}>
              <Typography variant="body2" fontWeight={600}>
                Beta Feature
              </Typography>
              <Typography variant="body2">
                This feature is currently in beta testing. Use with caution.
              </Typography>
            </Stack>
          )}
        </Alert>
      )}

      {label && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
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
                <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
                  *
                </Typography>
              )}
            </Typography>
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
