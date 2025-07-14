import { Dialog, Button, Tab, Paper, keyframes, SxProps } from '@mui/material';
import { styled as muiStyled } from '@mui/material/styles';

export const slideIn = keyframes`
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

export const pulse = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
`;

export const shimmer = keyframes`
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
`;

export const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const fadeOut = keyframes`
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-10px); }
`;

// Crazy animations for ID-based operations
export const matrixRain = keyframes`
  0% { transform: translateY(-100vh) rotateX(0deg); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateY(100vh) rotateX(360deg); opacity: 0; }
`;

export const dataStream = keyframes`
  0% {
    transform: translateX(-100%) scaleX(0);
    background: linear-gradient(90deg, #00ff00, #00ff00);
  }
  25% {
    transform: translateX(0%) scaleX(1);
    background: linear-gradient(90deg, #00ff00, #00ffff);
  }
  50% {
    transform: translateX(50%) scaleX(1.2);
    background: linear-gradient(90deg, #00ffff, #ff00ff);
  }
  75% {
    transform: translateX(100%) scaleX(0.8);
    background: linear-gradient(90deg, #ff00ff, #ffff00);
  }
  100% {
    transform: translateX(200%) scaleX(0);
    background: linear-gradient(90deg, #ffff00, #ff0000);
  }
`;

export const glitchEffect = keyframes`
  0% { transform: translate(0); }
  10% { transform: translate(-2px, 2px); }
  20% { transform: translate(-4px, -2px); }
  30% { transform: translate(4px, 2px); }
  40% { transform: translate(-2px, -2px); }
  50% { transform: translate(2px, 2px); }
  60% { transform: translate(-4px, 2px); }
  70% { transform: translate(4px, -2px); }
  80% { transform: translate(-2px, 2px); }
  90% { transform: translate(2px, -2px); }
  100% { transform: translate(0); }
`;

export const neonGlow = keyframes`
  0% {
    box-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 15px #00ff00;
    border-color: #00ff00;
  }
  25% {
    box-shadow: 0 0 10px #00ffff, 0 0 20px #00ffff, 0 0 30px #00ffff;
    border-color: #00ffff;
  }
  50% {
    box-shadow: 0 0 15px #ff00ff, 0 0 30px #ff00ff, 0 0 45px #ff00ff;
    border-color: #ff00ff;
  }
  75% {
    box-shadow: 0 0 10px #ffff00, 0 0 20px #ffff00, 0 0 30px #ffff00;
    border-color: #ffff00;
  }
  100% {
    box-shadow: 0 0 5px #00ff00, 0 0 10px #00ff00, 0 0 15px #00ff00;
    border-color: #00ff00;
  }
`;

export const hologramFlicker = keyframes`
  0% { opacity: 1; filter: hue-rotate(0deg) brightness(1); }
  10% { opacity: 0.8; filter: hue-rotate(36deg) brightness(1.2); }
  20% { opacity: 1; filter: hue-rotate(72deg) brightness(0.9); }
  30% { opacity: 0.9; filter: hue-rotate(108deg) brightness(1.1); }
  40% { opacity: 1; filter: hue-rotate(144deg) brightness(1); }
  50% { opacity: 0.7; filter: hue-rotate(180deg) brightness(1.3); }
  60% { opacity: 1; filter: hue-rotate(216deg) brightness(0.8); }
  70% { opacity: 0.9; filter: hue-rotate(252deg) brightness(1.1); }
  80% { opacity: 1; filter: hue-rotate(288deg) brightness(1); }
  90% { opacity: 0.8; filter: hue-rotate(324deg) brightness(1.2); }
  100% { opacity: 1; filter: hue-rotate(360deg) brightness(1); }
`;

export const codeRain = keyframes`
  0% {
    transform: translateY(-20px);
    opacity: 0;
    color: #00ff00;
  }
  10% {
    opacity: 1;
    color: #00ffff;
  }
  50% {
    color: #ff00ff;
  }
  90% {
    opacity: 1;
    color: #ffff00;
  }
  100% {
    transform: translateY(20px);
    opacity: 0;
    color: #ff0000;
  }
`;

export const scanLine = keyframes`
  0% { transform: translateY(-100%); opacity: 0; }
  50% { opacity: 1; }
  100% { transform: translateY(100%); opacity: 0; }
`;

export const digitalDissolve = keyframes`
  0% {
    clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%);
    filter: brightness(1) contrast(1);
  }
  25% {
    clip-path: polygon(10% 0, 90% 0, 95% 100%, 5% 100%);
    filter: brightness(1.2) contrast(1.1);
  }
  50% {
    clip-path: polygon(20% 10%, 80% 5%, 85% 90%, 15% 95%);
    filter: brightness(1.5) contrast(1.3);
  }
  75% {
    clip-path: polygon(30% 20%, 70% 15%, 75% 80%, 25% 85%);
    filter: brightness(1.8) contrast(1.5);
  }
  100% {
    clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
    filter: brightness(2) contrast(2);
    opacity: 0;
  }
`;

export const StyledDialog = muiStyled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    background: theme.palette.mode === 'dark'
      ? '#000000'
      : 'linear-gradient(145deg, #FFFFFF 0%, #F8F9FA 100%)',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 8px 32px 0 rgba(0, 0, 0, 0.36)'
      : '0 8px 32px 0 rgba(31, 38, 135, 0.16)',
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.1)'
      : 'rgba(0, 0, 0, 0.1)',
    animation: `${slideIn} 0.3s ease-out forwards`,
    maxWidth: '500px',
    width: '100%',
    margin: '16px',
    overflow: 'hidden',
  },
  '& .MuiDialogTitle-root': {
    padding: '20px 24px',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'transparent',
  },
  '& .MuiDialogContent-root': {
    padding: '24px',
  },
  '& .MuiDialogActions-root': {
    padding: '16px 24px',
    borderTop: `1px solid ${theme.palette.divider}`,
    background: theme.palette.mode === 'dark'
      ? '#000000'
      : 'rgba(248, 249, 250, 0.5)',
  },
}));

export const ActionButton = muiStyled(Button)(({ theme }) => ({
  textTransform: 'none',
  fontWeight: 600,
  borderRadius: '12px',
  padding: '10px 20px',
  transition: 'all 0.2s ease-in-out',
  '&.MuiButton-contained': {
    background: 'linear-gradient(90deg, #6366F1 0%, #8B5CF6 100%)',
    boxShadow: '0 4px 14px 0 rgba(99, 102, 241, 0.3)',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 6px 20px 0 rgba(99, 102, 241, 0.4)',
    },
  },
  '&.MuiButton-outlined': {
    borderColor: theme.palette.divider,
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
      borderColor: theme.palette.divider,
    },
  },
}));

export const ConfirmationDialog = muiStyled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    maxWidth: '500px',
    width: '100%',
    margin: '16px',
    background: theme.palette.mode === 'dark'
      ? 'linear-gradient(135deg, rgba(30, 30, 30, 0.95) 0%, rgba(20, 20, 20, 0.98) 100%)'
      : 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(250, 250, 250, 0.98) 100%)',
    backdropFilter: 'blur(20px)',
    border: theme.palette.mode === 'dark'
      ? '1px solid rgba(255, 255, 255, 0.1)'
      : '1px solid rgba(0, 0, 0, 0.05)',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 20px 40px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.05)'
      : '0 20px 40px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.02)',
  },
}));

export const ConfirmationActionButton = muiStyled(Button)(({ theme }) => ({
  borderRadius: '12px',
  textTransform: 'none',
  fontWeight: 600,
  padding: '10px 24px',
  transition: 'all 0.2s ease-in-out',
  '&:hover': {
    transform: 'translateY(-1px)',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 8px 25px rgba(0, 0, 0, 0.3)'
      : '0 8px 25px rgba(0, 0, 0, 0.15)',
  },
}));

export const StyledTab = muiStyled(Tab)(({ theme }) => ({
  textTransform: 'none',
  fontWeight: 600,
  minHeight: '48px',
  '&.Mui-selected': {
    color: theme.palette.primary.main,
  },
}));

export const OptionCard = muiStyled(Paper, {
  shouldForwardProp: (prop) => prop !== 'selected',
})<{ selected: boolean } & SxProps>(({ theme, selected }) => ({
  padding: '16px',
  borderRadius: '12px',
  cursor: 'pointer',
  transition: 'all 0.2s ease-in-out',
  border: '2px solid',
  borderColor: selected ? theme.palette.primary.main : 'transparent',
  backgroundColor: theme.palette.background.paper,
  boxShadow: selected
    ? theme.palette.mode === 'dark'
      ? `${theme.shadows[1]}, 0 0 0 2px transparent, 0 0 0 4px rgba(59, 130, 246, 0.6)`
      : `${theme.shadows[1]}, 0 0 0 2px transparent, 0 0 0 4px rgba(59, 130, 246, 0.3)`
    : theme.palette.mode === 'dark'
      ? `${theme.shadows[1]}, 0 0 0 1px rgba(59, 130, 246, 0.4)`
      : `${theme.shadows[1]}, 0 0 0 1px rgba(59, 130, 246, 0.2)`,
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: selected
      ? theme.palette.mode === 'dark'
        ? `${theme.shadows[4]}, 0 0 0 2px transparent, 0 0 0 4px rgba(59, 130, 246, 0.8)`
        : `${theme.shadows[4]}, 0 0 0 2px transparent, 0 0 0 4px rgba(59, 130, 246, 0.5)`
      : theme.palette.mode === 'dark'
        ? `${theme.shadows[4]}, 0 0 0 1px rgba(59, 130, 246, 0.6)`
        : `${theme.shadows[4]}, 0 0 0 1px rgba(59, 130, 246, 0.4)`,
  },
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
}));
