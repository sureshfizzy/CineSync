import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
  InputLabel,
  TextField,
  Box
} from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';

interface MediaProcessingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (selectedOption: string, selectedIds: Record<string, string>) => void;
  filePath: string;
}

const MediaProcessingDialog: React.FC<MediaProcessingDialogProps> = ({ open, onClose, onSubmit, filePath }) => {
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('actions');

  // Media processing options
  const modifyOptions = [
    { value: 'force', label: 'Force Recreate Symlinks', description: 'Recreate symlinks even if they exist' },
    { value: 'force-show', label: 'Force as TV Show', description: 'Process file as a TV show' },
    { value: 'force-movie', label: 'Force as Movie', description: 'Process file as a movie' },
    { value: 'force-extra', label: 'Force as Extra', description: 'Process file as an extra' },
    { value: 'skip', label: 'Skip Processing', description: 'Skip processing this file' },
  ];

  // ID options
  const idOptions = [
    { value: 'imdb', label: 'Set IMDb ID', placeholder: 'Enter IMDb ID' },
    { value: 'tmdb', label: 'Set TMDb ID', placeholder: 'Enter TMDb ID' },
    { value: 'tvdb', label: 'Set TVDb ID', placeholder: 'Enter TVDb ID' },
    { value: 'season-episode', label: 'Set Season/Episode', placeholder: 'e.g., S03E15' },
  ];

  const handleClose = () => {
    setSelectedOption('');
    setSelectedIds({});
    onClose();
  };

  const handleSubmit = () => {
    onSubmit(selectedOption, selectedIds);
    handleClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      sx={{
        '& .MuiDialog-container': {
          alignItems: 'flex-start',
          mt: '10vh'
        },
        '& .MuiDialog-paper': {
          width: '100%',
          maxWidth: '500px',
          maxHeight: '80vh',
          borderRadius: 3,
          boxShadow: 6,
          overflow: 'hidden'
        },
        zIndex: 9999
      }}
    >
      <DialogTitle>Media Processing Options</DialogTitle>
      <DialogContent>
        <Tabs
          value={activeTab}
          onChange={(_: React.SyntheticEvent, newValue: string) => setActiveTab(newValue)}
          sx={{ mb: 2 }}
          variant="fullWidth"
        >
          <Tab label="Actions" value="actions" />
          <Tab label="Set IDs" value="ids" />
        </Tabs>

        {activeTab === 'actions' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {modifyOptions.map((option) => (
              <Button
                key={option.value}
                variant={selectedOption === option.value ? 'contained' : 'outlined'}
                onClick={() => setSelectedOption(option.value)}
                startIcon={<BuildIcon />}
                fullWidth
                sx={{
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  py: 1.5,
                  borderRadius: 2,
                  textTransform: 'none',
                }}
              >
                <Box sx={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 500 }}>{option.label}</div>
                  <div style={{ fontSize: '0.8em', opacity: 0.7, marginTop: 2 }}>{option.description}</div>
                </Box>
              </Button>
            ))}
          </Box>
        )}

        {activeTab === 'ids' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            {idOptions.map((option) => (
              <Box key={option.value}>
                <InputLabel sx={{ mb: 1, fontWeight: 500 }}>{option.label}</InputLabel>
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
                  sx={{ mb: 2 }}
                />
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="primary"
          disabled={!selectedOption && Object.values(selectedIds).every(v => !v)}
        >
          Apply Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default MediaProcessingDialog;
