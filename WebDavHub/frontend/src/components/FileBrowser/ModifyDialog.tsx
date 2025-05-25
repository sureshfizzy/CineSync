import { useState } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent, 
  DialogActions, 
  Button, 
  Tabs, 
  Tab, 
  TextField,
  Box,
  Paper,
  Typography,
  useTheme,
  keyframes,
  SxProps,
  IconButton
} from '@mui/material';
import { styled as muiStyled } from '@mui/material/styles';
import BuildIcon from '@mui/icons-material/Build';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

interface ModifyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (selectedOption: string, selectedIds: Record<string, string>) => void;
}

const slideIn = keyframes`
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const StyledDialog = muiStyled(Dialog)(({ theme }) => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    background: theme.palette.mode === 'dark' 
      ? 'linear-gradient(145deg, #1E1E1E 0%, #2C2C2E 100%)' 
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
      ? 'rgba(44, 44, 46, 0.5)' 
      : 'rgba(248, 249, 250, 0.5)',
  },
}));

const ActionButton = muiStyled(Button)(({ theme }) => ({
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

const StyledTab = muiStyled(Tab)(({ theme }) => ({
  textTransform: 'none',
  fontWeight: 600,
  minHeight: '48px',
  '&.Mui-selected': {
    color: theme.palette.primary.main,
  },
}));

const OptionCard = muiStyled(Paper, {
  shouldForwardProp: (prop) => prop !== 'selected',
})<{ selected: boolean } & SxProps>(({ theme, selected }) => ({
  padding: '16px',
  borderRadius: '12px',
  cursor: 'pointer',
  transition: 'all 0.2s ease-in-out',
  border: '2px solid',
  borderColor: selected ? theme.palette.primary.main : 'transparent',
  backgroundColor: selected 
    ? theme.palette.mode === 'dark' 
      ? 'rgba(99, 102, 241, 0.1)' 
      : 'rgba(99, 102, 241, 0.05)'
    : theme.palette.background.paper,
  boxShadow: theme.shadows[1],
  '&:hover': {
    transform: 'translateY(-2px)',
    boxShadow: theme.shadows[4],
  },
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
}));

const ModifyDialog: React.FC<ModifyDialogProps> = ({ open, onClose, onSubmit }) => {
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('actions');

  const theme = useTheme();
  
  // Media processing options with icons
  const modifyOptions = [
    { 
      value: 'force', 
      label: 'Force Recreate Symlinks', 
      description: 'Recreate symlinks even if they exist',
      icon: '🔗'
    },
    { 
      value: 'force-show', 
      label: 'Force as TV Show', 
      description: 'Process file as a TV show',
      icon: '📺'
    },
    { 
      value: 'force-movie', 
      label: 'Force as Movie', 
      description: 'Process file as a movie',
      icon: '🎬'
    },
    { 
      value: 'force-extra', 
      label: 'Force as Extra', 
      description: 'Process file as an extra',
      icon: '➕'
    },
    { 
      value: 'skip', 
      label: 'Skip Processing', 
      description: 'Skip processing this file',
      icon: '⏭️'
    },
  ];
  
  // ID options with icons
  const idOptions = [
    { 
      value: 'imdb', 
      label: 'IMDb ID', 
      placeholder: 'tt1234567',
      icon: '🎥',
      helperText: 'Enter the IMDb ID (e.g., tt1234567)'
    },
    { 
      value: 'tmdb', 
      label: 'TMDb ID', 
      placeholder: '12345',
      icon: '🎞️',
      helperText: 'Enter the TMDb ID (e.g., 12345)'
    },
    { 
      value: 'tvdb', 
      label: 'TVDb ID', 
      placeholder: '123456',
      icon: '📺',
      helperText: 'Enter the TVDb ID (e.g., 123456)'
    },
    { 
      value: 'season-episode', 
      label: 'Season/Episode', 
      placeholder: 'S01E01',
      icon: '📅',
      helperText: 'Format: S01E01 for season 1 episode 1'
    },
  ];

  const handleClose = () => {
    setSelectedOption('');
    setSelectedIds({});
    onClose();
  };

  const handleDialogClose = (_: unknown, reason: 'backdropClick' | 'escapeKeyDown') => {
    // Only close on escape key, not on backdrop click
    if (reason === 'backdropClick') {
      return;
    }
    handleClose();
  };

  const handleSubmit = () => {
    onSubmit(selectedOption, selectedIds);
    handleClose();
  };

  return (
    <StyledDialog 
      open={open} 
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle 
        component="div"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          py: 2,
          px: 3
        }}
      >
        <Typography variant="h6" component="h2" fontWeight={700}>
          Process Media File
        </Typography>
        <IconButton 
          onClick={handleClose} 
          size="small" 
          sx={{
            color: 'text.secondary',
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            },
          }}
          aria-label="close"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      
      <DialogContent>
        <Tabs 
          value={activeTab} 
          onChange={(_: React.SyntheticEvent, newValue: string) => setActiveTab(newValue)}
          sx={{ 
            mb: 3,
            '& .MuiTabs-indicator': {
              height: '3px',
              borderRadius: '3px 3px 0 0',
              background: 'linear-gradient(90deg, #6366F1 0%, #8B5CF6 100%)',
            },
          }}
          variant="fullWidth"
        >
          <StyledTab label="Actions" value="actions" />
          <StyledTab label="Set IDs" value="ids" />
        </Tabs>
        
        {activeTab === 'actions' && (
          <Box sx={{ 
            display: 'grid', 
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            mt: 1 
          }}>
            {modifyOptions.map((option) => (
              <OptionCard 
                key={option.value}
                selected={selectedOption === option.value}
                onClick={() => setSelectedOption(option.value)}
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
        )}
        
        {activeTab === 'ids' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            {idOptions.map((option) => (
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
                  onChange={(e) => setSelectedIds(prev => ({
                    ...prev,
                    [option.value]: e.target.value
                  }))}
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
        )}
      </DialogContent>
      
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <ActionButton 
          onClick={handleClose}
          variant="outlined"
        >
          Cancel
        </ActionButton>
        <ActionButton 
          onClick={handleSubmit} 
          variant="contained"
          disabled={!selectedOption && Object.values(selectedIds).every(v => !v)}
          startIcon={<BuildIcon fontSize="small" />}
        >
          Process File
        </ActionButton>
      </DialogActions>
    </StyledDialog>
  );
};

export default ModifyDialog;
