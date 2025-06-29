import { createTheme, Theme } from '@mui/material/styles';
import { PaletteMode, Components } from '@mui/material';

// Custom color definitions with extended palette
const colors = {
  primary: {
    lighter: '#E3F2FD',
    light: '#64B5F6',
    main: '#2196F3',
    dark: '#1976D2',
    darker: '#0D47A1',
    contrastText: '#fff',
  },
  secondary: {
    lighter: '#E0F7F6',
    light: '#7FDED8',
    main: '#4ECDC4',
    dark: '#37B8AF',
    darker: '#2A8D86',
    contrastText: '#fff',
  },
  success: {
    lighter: '#E8F5E9',
    light: '#81C784',
    main: '#4CAF50',
    dark: '#388E3C',
    darker: '#1B5E20',
    contrastText: '#fff',
  },
  error: {
    lighter: '#FFEBEE',
    light: '#FF8E8E',
    main: '#FF6B6B',
    dark: '#E64A4A',
    darker: '#B71C1C',
    contrastText: '#fff',
  },
  warning: {
    lighter: '#FFF3E0',
    light: '#FFB74D',
    main: '#FFA726',
    dark: '#F57C00',
    darker: '#E65100',
    contrastText: '#fff',
  },
  info: {
    lighter: '#E1F5FE',
    light: '#4FC3F7',
    main: '#29B6F6',
    dark: '#0288D1',
    darker: '#01579B',
    contrastText: '#fff',
  },
  grey: {
    100: '#F5F5F5',
    200: '#EEEEEE',
    300: '#E0E0E0',
    400: '#BDBDBD',
    500: '#9E9E9E',
    600: '#757575',
    700: '#616161',
    800: '#424242',
    900: '#212121',
  },
};

// Enhanced shadows system
const shadows = [
  'none',
  '0px 2px 4px rgba(0,0,0,0.05)',
  '0px 4px 8px rgba(0,0,0,0.08)',
  '0px 8px 16px rgba(0,0,0,0.12)',
  '0px 12px 24px rgba(0,0,0,0.16)',
  '0px 16px 32px rgba(0,0,0,0.20)',
  '0px 20px 40px rgba(0,0,0,0.24)',
  '0px 24px 48px rgba(0,0,0,0.28)',
  '0px 28px 56px rgba(0,0,0,0.32)',
  '0px 32px 64px rgba(0,0,0,0.36)',
  '0px 36px 72px rgba(0,0,0,0.40)',
  '0px 40px 80px rgba(0,0,0,0.44)',
  '0px 44px 88px rgba(0,0,0,0.48)',
  '0px 48px 96px rgba(0,0,0,0.52)',
  '0px 52px 104px rgba(0,0,0,0.56)',
  '0px 56px 112px rgba(0,0,0,0.60)',
  '0px 60px 120px rgba(0,0,0,0.64)',
  '0px 64px 128px rgba(0,0,0,0.68)',
  '0px 68px 136px rgba(0,0,0,0.72)',
  '0px 72px 144px rgba(0,0,0,0.76)',
  '0px 76px 152px rgba(0,0,0,0.80)',
  '0px 80px 160px rgba(0,0,0,0.84)',
  '0px 84px 168px rgba(0,0,0,0.88)',
  '0px 88px 176px rgba(0,0,0,0.92)',
  '0px 92px 184px rgba(0,0,0,0.96)',
];

// Enhanced typography system
const typography = {
  fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  h1: {
    fontWeight: 700,
    fontSize: '2.5rem',
    lineHeight: 1.2,
    letterSpacing: '-0.01562em',
  },
  h2: {
    fontWeight: 600,
    fontSize: '2rem',
    lineHeight: 1.3,
    letterSpacing: '-0.00833em',
  },
  h3: {
    fontWeight: 600,
    fontSize: '1.75rem',
    lineHeight: 1.3,
    letterSpacing: '0em',
  },
  h4: {
    fontWeight: 600,
    fontSize: '1.5rem',
    lineHeight: 1.35,
    letterSpacing: '0.00735em',
  },
  h5: {
    fontWeight: 600,
    fontSize: '1.25rem',
    lineHeight: 1.4,
    letterSpacing: '0em',
  },
  h6: {
    fontWeight: 600,
    fontSize: '1rem',
    lineHeight: 1.4,
    letterSpacing: '0.0075em',
  },
  subtitle1: {
    fontSize: '1rem',
    lineHeight: 1.5,
    letterSpacing: '0.00938em',
    fontWeight: 500,
  },
  subtitle2: {
    fontSize: '0.875rem',
    lineHeight: 1.57,
    letterSpacing: '0.00714em',
    fontWeight: 500,
  },
  body1: {
    fontSize: '1rem',
    lineHeight: 1.5,
    letterSpacing: '0.00938em',
  },
  body2: {
    fontSize: '0.875rem',
    lineHeight: 1.43,
    letterSpacing: '0.01071em',
  },
  button: {
    fontWeight: 600,
    fontSize: '0.875rem',
    lineHeight: 1.75,
    letterSpacing: '0.02857em',
    textTransform: 'none' as const,
  },
  caption: {
    fontSize: '0.75rem',
    lineHeight: 1.66,
    letterSpacing: '0.03333em',
  },
  overline: {
    fontSize: '0.75rem',
    lineHeight: 2.66,
    letterSpacing: '0.08333em',
    textTransform: 'uppercase' as const,
    fontWeight: 500,
  },
} as const;

// Enhanced shape configurations
const shape = {
  borderRadius: 8,
};

// Comprehensive component overrides
const components = {
  MuiCssBaseline: {
    styleOverrides: {
      '*': {
        boxSizing: 'border-box',
        margin: 0,
        padding: 0,
      },
      html: {
        MozOsxFontSmoothing: 'grayscale',
        WebkitFontSmoothing: 'antialiased',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        width: '100%',
      },
      body: {
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        minHeight: '100%',
        width: '100%',
      },
      '#root': {
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
      },
    },
  },
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        fontSize: '0.875rem',
        fontWeight: 600,
        padding: '8px 16px',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-1px)',
        },
      },
      contained: {
        boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
        '&:hover': {
          boxShadow: '0 6px 20px 0 rgba(0,118,255,0.23)',
        },
      },
      outlined: {
        borderWidth: 2,
        '&:hover': {
          borderWidth: 2,
        },
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        },
      },
    },
  },
  MuiCardContent: {
    styleOverrides: {
      root: {
        padding: '24px',
      },
    },
  },
  MuiCardHeader: {
    styleOverrides: {
      root: {
        padding: '24px',
      },
    },
  },
  MuiTextField: {
    styleOverrides: {
      root: {
        '& .MuiOutlinedInput-root': {
          borderRadius: 8,
          transition: 'all 0.2s ease-in-out',
          '&:hover': {
            boxShadow: '0 0 0 1px rgba(0,118,255,0.1)',
          },
          '&.Mui-focused': {
            boxShadow: '0 0 0 2px rgba(0,118,255,0.2)',
          },
        },
      },
    },
  },
  MuiListItem: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        '&:hover': {
          backgroundColor: 'rgba(0,0,0,0.04)',
        },
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 12,
      },
    },
  },
  MuiDivider: {
    styleOverrides: {
      root: {
        margin: '16px 0',
      },
    },
  },
  MuiLink: {
    styleOverrides: {
      root: {
        textDecoration: 'none',
        '&:hover': {
          textDecoration: 'underline',
        },
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        borderRadius: 4,
        padding: '8px 12px',
        fontSize: '0.75rem',
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        borderRadius: 16,
        height: 24,
        '&:active': {
          boxShadow: 'none',
        },
      },
      sizeSmall: {
        height: 20,
      },
    },
  },
} as Components<Theme>;

export const getTheme = (mode: PaletteMode): Theme => {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: colors.primary,
      secondary: colors.secondary,
      success: colors.success,
      error: colors.error,
      warning: colors.warning,
      info: colors.info,
      grey: colors.grey,
      background: {
        default: isDark ? '#000000' : '#F5F5F7',
        paper: isDark ? '#000000' : '#FFFFFF',
      },
      text: {
        primary: isDark ? '#FFFFFF' : '#1A1A1A',
        secondary: isDark ? '#B0B0B0' : '#6B7280',
      },
      divider: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
      action: {
        active: isDark ? '#FFFFFF' : '#6B7280',
        hover: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
        selected: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.08)',
        disabled: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.26)',
        disabledBackground: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
      },
    },
    typography,
    shape,
    shadows: shadows as Theme['shadows'],
    components,
  });
};