import React, { useState, useEffect, useRef } from 'react';
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
import { searchTmdb, getTmdbPosterUrl } from '../api/tmdbApi';
import { processStructuredMessage } from '../../utils/symlinkUpdates';

interface ModifyDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (selectedOption: string, selectedIds: Record<string, string>) => void;
  currentFilePath?: string;
}

const slideIn = keyframes`
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const pulse = keyframes`
  0% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.1); opacity: 0.8; }
  100% { transform: scale(1); opacity: 1; }
`;

const shimmer = keyframes`
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
`;

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const fadeOut = keyframes`
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-10px); }
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

const getDialogMaxWidth = (count: number) => {
  if (count <= 2) return 'xs';
  if (count <= 4) return 'md';
  return 'lg';
};

const getDialogPaperMaxWidth = (count: number) => {
  if (count <= 2) return 400;
  if (count <= 4) return 800;
  return 1100;
};

const ExecutionDialog = muiStyled(Dialog, {
  shouldForwardProp: (prop) => prop !== 'posterCount',
})<{ posterCount?: number }>(({ theme, posterCount = 1 }) => ({
  '& .MuiDialog-paper': {
    borderRadius: '16px',
    background: theme.palette.mode === 'dark'
      ? '#121212'
      : '#fff',
    boxShadow: theme.palette.mode === 'dark'
      ? '0 8px 32px 0 rgba(0, 0, 0, 0.7)'
      : '0 8px 32px 0 rgba(31, 38, 135, 0.3)',
    border: '1px solid',
    borderColor: theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.15)'
      : 'rgba(0, 0, 0, 0.15)',
    maxWidth: getDialogPaperMaxWidth(posterCount),
    width: '100%',
    margin: '16px',
    display: 'flex',
    flexDirection: 'column',
  },
  '& .MuiDialogTitle-root': {
    padding: '16px 24px',
    borderBottom: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  '& .MuiDialogContent-root': {
    padding: '16px 24px',
    flexGrow: 1,
    overflowY: 'auto',
  },
  '& .MuiDialogActions-root': {
    padding: '16px 24px',
    borderTop: `1px solid ${theme.palette.divider}`,
    display: 'flex',
    justifyContent: 'flex-end',
  },
}));

const PosterSkeleton = muiStyled(Paper)(({ theme }) => ({
  padding: 0,
  borderRadius: 12,
  boxShadow: theme.shadows[1],
  background: theme.palette.mode === 'dark' ? '#18181b' : '#fff',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  maxWidth: '140px',
  width: '100%',
  opacity: 0.7,
  '& .skeleton-poster': {
    width: '100%',
    maxWidth: '140px',
    aspectRatio: '2/3',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
  '& .skeleton-text': {
    width: '80%',
    height: '12px',
    margin: '8px 0 4px 0',
    borderRadius: '6px',
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
  '& .skeleton-text-small': {
    width: '60%',
    height: '10px',
    margin: '0 0 8px 0',
    borderRadius: '5px',
    background: `linear-gradient(90deg, ${theme.palette.grey[300]} 0px, ${theme.palette.grey[200]} 40px, ${theme.palette.grey[300]} 80px)`,
    backgroundSize: '200px',
    animation: `${shimmer} 1.5s infinite linear`,
  },
}));

const ModifyDialog: React.FC<ModifyDialogProps> = ({ open, onClose, onSubmit, currentFilePath }) => {
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('actions');
  const [execOpen, setExecOpen] = useState(false);
  const [execOutput, setExecOutput] = useState<string>('');
  const [execInput, setExecInput] = useState('');
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [movieOptions, setMovieOptions] = useState<any[]>([]);
  const [isLoadingNewOptions, setIsLoadingNewOptions] = useState(false);
  const [previousOptions, setPreviousOptions] = useState<any[]>([]);
  const [operationComplete, setOperationComplete] = useState(false);
  const [operationSuccess, setOperationSuccess] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const inputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const resetAllStates = () => {
    setSelectedOption('');
    setSelectedIds({});
    setActiveTab('actions');
    setExecOutput('');
    setExecInput('');
    setWaitingForInput(false);
    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);

    // Clear timeouts
    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current);
      inputTimeoutRef.current = null;
    }
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };

  const handleClose = () => {
    resetAllStates();
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
    // Reset execution states
    setExecOutput('');
    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
    setExecOpen(true);
    startPythonCommand();
  };

  const startPythonCommand = async () => {
    if (!currentFilePath) {
      setExecOutput('Error: No file path provided\n');
      return;
    }

    const disableMonitor = true;

    try {
      const response = await fetch('/api/python-bridge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sourcePath: currentFilePath,
          disableMonitor
        })
      });

      if (!response.body) {
        setExecOutput('No response body from server.');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          // The backend sends JSON lines, parse each line
          const lines = chunk.split('\n').filter(Boolean);
          lines.forEach(line => {
            try {
              const msg = JSON.parse(line);

              // Process structured messages for folder name updates
              if (msg.structuredData) {
                processStructuredMessage(msg);
              }

              if (msg.output) {
                const output = msg.output;
                setExecOutput(prev => prev + output + '\n');

                // Check if this output contains movie/show options
                parseMovieOptions(output);

                // Check if waiting for user input - be more flexible with detection
                if (output.includes('Enter your choice:') ||
                    output.includes('Select an option:') ||
                    output.includes('Choose:') ||
                    output.includes('enter to search') ||
                    output.includes('Enter to search') ||
                    output.includes('Press Enter') ||
                    output.includes('Type') ||
                    output.includes('Input') ||
                    output.endsWith(': ') ||
                    output.endsWith('? ') ||
                    output.includes('>>')) {
                  setWaitingForInput(true);
                }

                // Set a timeout to enable input after 3 seconds if not already enabled
                if (inputTimeoutRef.current) {
                  clearTimeout(inputTimeoutRef.current);
                }
                inputTimeoutRef.current = setTimeout(() => {
                  if (!waitingForInput) {
                    setWaitingForInput(true);
                  }
                }, 3000);
              }
              if (msg.error) {
                setExecOutput(prev => prev + 'Error: ' + msg.error + '\n');
              }
              if (msg.done) {
                setWaitingForInput(false);
                setOperationComplete(true);
                setOperationSuccess(true);

                // Auto-close after 2 seconds of successful completion
                autoCloseTimeoutRef.current = setTimeout(() => {
                  setIsClosing(true);
                  // Give time for closing animation, then actually close
                  setTimeout(() => {
                    handleExecClose();
                    handleClose();
                  }, 300);
                }, 2000);
              }
            } catch (e) {
              setExecOutput(prev => prev + 'Parse error: ' + e + '\n');
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to start command:', error);
      setExecOutput('Failed to start command: ' + error);
    }
  };

  const parseMovieOptions = (output: string) => {
    // Look for numbered options with movie/show titles and TMDB IDs
    let optionRegex = /(\d+):\s*([^(\n\[]+?)\s*(?:\((\d{4})\))?\s*\[tmdb-(\d+)\]/gm;
    let matches = [...output.matchAll(optionRegex)];

    // If no matches, try a simpler pattern
    if (matches.length === 0) {
      optionRegex = /(\d+):\s*(.+?)\s*\[tmdb-(\d+)\]/gm;
      matches = [...output.matchAll(optionRegex)];
    }

    if (matches.length > 0) {
      const options = matches.map(match => {
        // Handle different regex patterns
        let option;
        if (match.length >= 5) {
          option = {
            number: match[1],
            title: match[2]?.trim(),
            year: match[3],
            tmdbId: match[4]
          };
        } else {
          // Simpler pattern: (\d+):\s*(.+?)\s*\[tmdb-(\d+)\]
          const titleAndYear = match[2]?.trim();
          const yearMatch = titleAndYear?.match(/^(.+?)\s*\((\d{4})\)$/);
          option = {
            number: match[1],
            title: yearMatch ? yearMatch[1]?.trim() : titleAndYear,
            year: yearMatch ? yearMatch[2] : undefined,
            tmdbId: match[3]
          };
        }
        return option;
      });

      // Fetch poster images for each option using title and year
      options.forEach(async (option) => {
        if (option.title) {
          try {
            // Try movie first, then TV if movie fails
            let tmdbResult = await searchTmdb(option.title, option.year, 'movie');

            if (!tmdbResult) {
              // If movie didn't work, try TV
              tmdbResult = await searchTmdb(option.title, option.year, 'tv');
            }

            if (tmdbResult && tmdbResult.poster_path) {
              const posterUrl = getTmdbPosterUrl(tmdbResult.poster_path, 'w200');

              setMovieOptions(prev => {
                const updated = [...prev];
                const existingIndex = updated.findIndex(opt => opt.number === option.number);
                const optionWithPoster = {
                  ...option,
                  posterUrl: posterUrl,
                  tmdbData: tmdbResult
                };

                if (existingIndex >= 0) {
                  updated[existingIndex] = optionWithPoster;
                } else {
                  updated.push(optionWithPoster);
                }
                return updated.sort((a, b) => parseInt(a.number) - parseInt(b.number));
              });
            }
          } catch (error) {
            console.error('Failed to fetch TMDB data:', error);
          }
        }
      });

      // Set initial options without posters and clear loading state
      setMovieOptions(options);
      setIsLoadingNewOptions(false);
      setPreviousOptions([]);

      // Clear loading timeout since we received new options
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
  };

  const sendInput = async (input: string) => {
    try {
      // Store current options as previous before clearing
      if (movieOptions.length > 0) {
        setPreviousOptions([...movieOptions]);
        setIsLoadingNewOptions(true);

        // Set a timeout to clear loading state if no new options are received
        loadingTimeoutRef.current = setTimeout(() => {
          setIsLoadingNewOptions(false);
          setPreviousOptions([]);
        }, 5000); // 5 seconds timeout
      }

      // Send input to the python process via the API
      const response = await fetch('/api/python-bridge/input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ input: input + '\n' })
      });

      if (!response.ok) {
        setExecOutput(prev => prev + `Error sending input: ${response.statusText}\n`);
        setIsLoadingNewOptions(false);
        setPreviousOptions([]);
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
        return;
      }

      // Show the input in the output for user feedback
      setExecOutput(prev => prev + `> ${input}\n`);
      setExecInput('');
      setWaitingForInput(false);

      // Clear auto-close timeout if user provides input (they're still interacting)
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
        autoCloseTimeoutRef.current = null;
      }
    } catch (error) {
      console.error('Failed to send input:', error);
      setExecOutput(prev => prev + `Error sending input: ${error}\n`);
      setIsLoadingNewOptions(false);
      setPreviousOptions([]);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }
  };

  const handleOptionClick = (optionNumber: string) => {
    sendInput(optionNumber);
  };

  const handleInputSubmit = () => {
    if (execInput.trim()) {
      sendInput(execInput.trim());
    }
  };

  const handleInputKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleInputSubmit();
    }
  };

  const handleExecClose = () => {
    setExecOpen(false);
    // Clear timeouts when closing
    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current);
      inputTimeoutRef.current = null;
    }
    if (autoCloseTimeoutRef.current) {
      clearTimeout(autoCloseTimeoutRef.current);
      autoCloseTimeoutRef.current = null;
    }
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
    setWaitingForInput(false);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
  };

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (inputTimeoutRef.current) {
        clearTimeout(inputTimeoutRef.current);
      }
      if (autoCloseTimeoutRef.current) {
        clearTimeout(autoCloseTimeoutRef.current);
      }
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
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

      <ExecutionDialog
        open={execOpen}
        onClose={handleExecClose}
        maxWidth={getDialogMaxWidth(movieOptions.length)}
        posterCount={movieOptions.length}
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            opacity: isClosing ? 0 : 1,
            transform: isClosing ? 'scale(0.95)' : 'scale(1)',
            transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
          }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: operationSuccess ? 'success.main' : 'background.paper',
          color: operationSuccess ? 'success.contrastText' : 'text.primary',
          transition: 'background-color 0.3s ease-in-out, color 0.3s ease-in-out',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {operationSuccess ? (
              <>
                <CheckCircleOutlineIcon />
                <Typography variant="h6">Operation Completed Successfully</Typography>
              </>
            ) : (
              <Typography variant="h6">Choose an Option or Provide Input</Typography>
            )}
          </Box>
          <IconButton
            onClick={handleExecClose}
            size="small"
            sx={{
              color: operationSuccess ? 'success.contrastText' : 'text.secondary',
              '&:hover': {
                backgroundColor: operationSuccess ? 'rgba(255,255,255,0.1)' : 'action.hover',
              }
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {operationSuccess && (
            <Box sx={{
              textAlign: 'center',
              py: 3,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2
            }}>
              <CheckCircleOutlineIcon
                sx={{
                  fontSize: 48,
                  color: 'success.main',
                  animation: `${pulse} 1.5s ease-in-out infinite`
                }}
              />
              <Typography variant="h6" color="success.main">
                File processing completed successfully!
              </Typography>
              <Typography variant="body2" color="text.secondary">
                This dialog will close automatically in a few seconds...
              </Typography>
            </Box>
          )}

          {!operationSuccess && (movieOptions.length > 0 || (isLoadingNewOptions && previousOptions.length > 0)) && (
            <Box
              sx={movieOptions.length <= 4
                ? {
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                    gap: 2,
                    p: 0.5,
                    mb: 2,
                    border: 'none',
                    backgroundColor: 'transparent',
                    flexWrap: 'wrap',
                  }
                : {
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      sm: 'repeat(auto-fit, minmax(140px, 1fr))',
                      md: 'repeat(auto-fit, minmax(140px, 1fr))',
                    },
                    gap: 2,
                    p: 0.5,
                    mb: 2,
                    border: 'none',
                    backgroundColor: 'transparent',
                    justifyItems: 'center',
                    alignItems: 'start',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                  }
              }
            >
              {/* Show loading skeletons when transitioning */}
              {isLoadingNewOptions && previousOptions.map((option) => (
                <PosterSkeleton
                  key={`loading-${option.number}`}
                  sx={{
                    animation: `${fadeOut} 0.3s ease-out forwards`,
                  }}
                >
                  <Box className="skeleton-poster" />
                  <Box sx={{ width: '100%', py: 1, px: 0.5, textAlign: 'center' }}>
                    <Box className="skeleton-text" />
                    <Box className="skeleton-text-small" />
                  </Box>
                </PosterSkeleton>
              ))}

              {/* Show actual movie options */}
              {!isLoadingNewOptions && movieOptions.map((option) => (
                <Paper
                  key={option.number}
                  onClick={() => handleOptionClick(option.number)}
                  sx={{
                    p: 0,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s, transform 0.2s, opacity 0.3s ease-in-out',
                    borderRadius: 3,
                    boxShadow: 1,
                    background: theme.palette.mode === 'dark' ? '#18181b' : '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    maxWidth: '140px',
                    width: '100%',
                    animation: `${fadeIn} 0.4s ease-out forwards`,
                    '&:hover': {
                      boxShadow: 6,
                      transform: 'translateY(-4px) scale(1.03)',
                    },
                  }}
                  elevation={2}
                >
                  {option.posterUrl ? (
                    <Box
                      component="img"
                      src={option.posterUrl}
                      alt={option.title}
                      sx={{
                        width: '100%',
                        maxWidth: '140px',
                        aspectRatio: '2/3',
                        objectFit: 'cover',
                        borderTopLeftRadius: 12,
                        borderTopRightRadius: 12,
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                        background: theme.palette.grey[300],
                        display: 'block',
                        transition: 'opacity 0.3s ease-in-out',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: '100%',
                        maxWidth: '140px',
                        aspectRatio: '2/3',
                        borderTopLeftRadius: 12,
                        borderTopRightRadius: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'grey.300',
                      }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        No Image
                      </Typography>
                    </Box>
                  )}
                  <Box sx={{
                    width: '100%',
                    py: 1,
                    px: 0.5,
                    textAlign: 'center',
                  }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5, color: theme.palette.text.primary }}>
                      {option.title}
                    </Typography>
                    {option.year && (
                      <Typography variant="body2" color="text.secondary">
                        {option.year}
                      </Typography>
                    )}
                  </Box>
                </Paper>
              ))}
            </Box>
          )}

          {!operationSuccess && (
            <Box sx={{ display: 'flex', gap: 1, mt: (movieOptions.length > 0 || (isLoadingNewOptions && previousOptions.length > 0)) ? 0 : 2 }}>
              <TextField
                fullWidth
                size="small"
                variant="outlined"
                placeholder={
                  isLoadingNewOptions
                    ? "Loading new options..."
                    : waitingForInput
                      ? "Type your response..."
                      : "Waiting for command..."
                }
                value={execInput}
                onChange={(e) => setExecInput(e.target.value)}
                onKeyPress={handleInputKeyPress}
                disabled={!waitingForInput || isLoadingNewOptions}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: (waitingForInput && !isLoadingNewOptions) ? 'background.paper' : 'action.disabledBackground',
                    opacity: isLoadingNewOptions ? 0.7 : 1,
                    transition: 'opacity 0.3s ease-in-out, background-color 0.3s ease-in-out'
                  }
                }}
              />
              <Button
                variant="contained"
                onClick={handleInputSubmit}
                disabled={!waitingForInput || !execInput.trim() || isLoadingNewOptions}
                sx={{
                  minWidth: '80px',
                  opacity: isLoadingNewOptions ? 0.7 : 1,
                  transition: 'opacity 0.3s ease-in-out'
                }}
              >
                {isLoadingNewOptions ? 'Loading...' : 'Send'}
              </Button>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <ActionButton
            onClick={handleExecClose}
            variant="outlined"
          >
            Close
          </ActionButton>
        </DialogActions>
      </ExecutionDialog>
    </>
  );
};

export default ModifyDialog;
