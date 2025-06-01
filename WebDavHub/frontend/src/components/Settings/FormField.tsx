import React from 'react';
import {
  TextField,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  Chip,
  Box,
  Typography,
  InputAdornment,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Info, Visibility, VisibilityOff } from '@mui/icons-material';

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
                disabled={disabled}
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
            disabled={disabled}
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
              disabled={disabled}
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
            disabled={disabled}
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
              disabled={disabled}
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
            disabled={disabled}
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

  return (
    <Box sx={{ mb: 3 }}>
      {label && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              color: 'text.primary',
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
