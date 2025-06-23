import React, { useState, useEffect, useRef } from 'react';
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Tabs,
  Typography,
  useTheme,
  IconButton
} from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import CloseIcon from '@mui/icons-material/Close';
import { searchTmdb, getTmdbPosterUrlDirect } from '../../api/tmdbApi';
import { processStructuredMessage } from '../../../utils/symlinkUpdates';


// Import the modular components
import { StyledDialog, ActionButton, StyledTab } from './StyledComponents';
import ActionOptions from './ActionOptions';
import IDOptions from './IDOptions';
import ExecutionDialog from './ExecutionDialog';
import SkipConfirmationDialog from './SkipConfirmationDialog';
import SkipResultDialog from './SkipResultDialog';
import { ModifyDialogProps, ModifyOption, IDOption, MovieOption } from './types';

const ModifyDialog: React.FC<ModifyDialogProps> = ({ open, onClose, currentFilePath, mediaType = 'movie', onNavigateBack, useBatchApply: propUseBatchApply = false, useManualSearch: propUseManualSearch = false }) => {
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
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [skipResultOpen, setSkipResultOpen] = useState(false);
  const [useBatchApply, setUseBatchApply] = useState(false);
  const inputTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = useTheme();

  // Media processing options with icons
  const baseModifyOptions: ModifyOption[] = [
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
      description: 'Remove symlinks and block future processing',
      icon: '⏭️'
    },
  ];

  // Add manual search option if enabled (for failed files)
  const modifyOptions: ModifyOption[] = propUseManualSearch
    ? [
        ...baseModifyOptions.slice(0, -1), // All options except skip
        {
          value: 'manual-search',
          label: 'Manual Search',
          description: 'Enable manual TMDB search when automatic search fails',
          icon: '🔍'
        },
        baseModifyOptions[baseModifyOptions.length - 1] // Skip option at the end
      ]
    : baseModifyOptions;

  // ID options with icons
  const idOptions: IDOption[] = [
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
    setSkipConfirmOpen(false);
    setUseBatchApply(false);

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
    // Check if skip is selected and show confirmation dialog
    if (selectedOption === 'skip') {
      setSkipConfirmOpen(true);
      return;
    }

    // Reset execution states and start python command
    setExecOutput('');
    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
    setExecOpen(true);

    // Determine if we should use batch apply from the prop
    const shouldUseBatchApply = propUseBatchApply;

    // Set the state for future reference
    if (shouldUseBatchApply) {
      setUseBatchApply(true);
    }

    // Log what we're about to send for debugging
    console.log('ModifyDialog submitting with:', {
      selectedOption,
      selectedIds,
      currentFilePath,
      batchApply: shouldUseBatchApply
    });

    startPythonCommand(shouldUseBatchApply);
  };

  const startPythonCommand = async (batchApplyOverride?: boolean) => {
    if (!currentFilePath) {
      setExecOutput('Error: No file path provided\n');
      return;
    }

    const disableMonitor = true;
    const shouldUseBatchApply = batchApplyOverride !== undefined ? batchApplyOverride : useBatchApply;
    const shouldUseManualSearch = selectedOption === 'manual-search' || propUseManualSearch;

    // Prepare the request payload with selected options and IDs
    const requestPayload = {
      sourcePath: currentFilePath,
      disableMonitor,
      selectedOption: selectedOption === 'manual-search' ? undefined : (selectedOption || undefined),
      selectedIds: Object.keys(selectedIds).length > 0 ? selectedIds : undefined,
      batchApply: shouldUseBatchApply,
      manualSearch: shouldUseManualSearch
    };

    // Log the exact payload being sent
    console.log('Sending to python-bridge API:', requestPayload);
    console.log('Selected IDs state:', selectedIds);
    console.log('Selected IDs entries:', Object.entries(selectedIds));

    // Show user what command will be executed
    let commandPreview = 'python main.py ' + currentFilePath + ' --force';
    if (selectedOption) {
      switch (selectedOption) {
        case 'force-show':
          commandPreview += ' --force-show';
          break;
        case 'force-movie':
          commandPreview += ' --force-movie';
          break;
        case 'force-extra':
          commandPreview += ' --force-extra';
          break;
        case 'skip':
          commandPreview += ' --skip';
          break;
        case 'manual-search':
          commandPreview += ' --manual-search';
          break;
      }
    }
    if (Object.keys(selectedIds).length > 0) {
      Object.entries(selectedIds).forEach(([key, value]) => {
        if (value) {
          commandPreview += ` --${key} ${value}`;
        }
      });
    }
    setExecOutput(`Executing: ${commandPreview}\n\n`);

    try {
      const response = await fetch('/api/python-bridge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
        },
        body: JSON.stringify(requestPayload)
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
        let option: MovieOption;
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

      // Fetch poster images for each option using the TMDb ID provided by backend
      // Use Promise.all to avoid excessive concurrent requests and reduce caching overhead
      const fetchPostersAsync = async () => {
        const posterPromises = options.map(async (option) => {
          if (!option.tmdbId) return option;

          try {
            // Skip caching for temporary poster fetches in ModifyDialog - these are just for user selection
            const tmdbResult = await searchTmdb(option.tmdbId, undefined, mediaType, 3, true);

            if (tmdbResult && tmdbResult.poster_path) {
              const posterUrl = getTmdbPosterUrlDirect(tmdbResult.poster_path, 'w200');
              return {
                ...option,
                posterUrl: posterUrl,
                tmdbData: tmdbResult
              };
            }
          } catch (error) {
            console.error('Failed to fetch TMDB data for option', option.number, ':', error);
          }

          return option;
        });

        // Wait for all poster fetches to complete, then update state once
        try {
          const optionsWithPosters = await Promise.all(posterPromises);
          setMovieOptions(prev => {
            const updated = [...prev];

            optionsWithPosters.forEach(option => {
              const existingIndex = updated.findIndex(opt => opt.number === option.number);
              if (existingIndex >= 0) {
                updated[existingIndex] = option;
              } else {
                updated.push(option);
              }
            });

            return updated.sort((a, b) => parseInt(a.number) - parseInt(b.number));
          });
        } catch (error) {
          console.error('Failed to fetch poster data:', error);
        }
      };

      // Execute the async function
      fetchPostersAsync();

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
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
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

  const handleSkipConfirm = async () => {
    setSkipConfirmOpen(false);
    setSkipResultOpen(true);

    if (!currentFilePath) {
      console.error('No file path provided for skip operation');
      return;
    }

    const disableMonitor = true;
    const requestPayload = {
      sourcePath: currentFilePath,
      disableMonitor,
      selectedOption: 'skip'
    };

    try {
      const response = await fetch('/api/python-bridge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        console.error('Skip operation failed:', response.statusText);
      }
    } catch (error) {
      console.error('Error during skip operation:', error);
    }
  };

  const handleSkipCancel = () => {
    setSkipConfirmOpen(false);
  };

  const handleSkipResultClose = () => {
    setSkipResultOpen(false);
    handleClose();
  };

  const handleSkipResultRefresh = () => {
    if (onClose) {
      onClose();
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
            px: 3,
            ...(Object.values(selectedIds).some(v => v) && {
              background: theme.palette.mode === 'dark'
                ? 'linear-gradient(45deg, rgba(25, 118, 210, 0.1), rgba(156, 39, 176, 0.1))'
                : 'linear-gradient(45deg, rgba(25, 118, 210, 0.05), rgba(156, 39, 176, 0.05))',
              borderBottom: `2px solid ${theme.palette.primary.main}`,
            })
          }}
        >
          <Typography
            variant="h6"
            component="h2"
            fontWeight={700}
            sx={{
              ...(Object.values(selectedIds).some(v => v) && {
                color: theme.palette.primary.main,
                fontWeight: 700,
              })
            }}
          >
            {Object.values(selectedIds).some(v => v) ? '🆔 ID-Based Processing' : 'Process Media File'}
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
            <ActionOptions
              selectedOption={selectedOption}
              onOptionSelect={setSelectedOption}
              options={modifyOptions}
            />
          )}

          {activeTab === 'ids' && (
            <IDOptions
              selectedIds={selectedIds}
              onIdsChange={setSelectedIds}
              options={idOptions}
            />
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
        execOutput={execOutput}
        execInput={execInput}
        onInputChange={setExecInput}
        onInputSubmit={handleInputSubmit}
        onInputKeyPress={handleInputKeyPress}
        waitingForInput={waitingForInput}
        movieOptions={movieOptions}
        isLoadingNewOptions={isLoadingNewOptions}
        previousOptions={previousOptions}
        operationComplete={operationComplete}
        operationSuccess={operationSuccess}
        isClosing={isClosing}
        onOptionClick={handleOptionClick}
        selectedIds={selectedIds}
      />

      <SkipConfirmationDialog
        open={skipConfirmOpen}
        onConfirm={handleSkipConfirm}
        onCancel={handleSkipCancel}
        filePath={currentFilePath}
      />

      <SkipResultDialog
        open={skipResultOpen}
        onClose={handleSkipResultClose}
        onRefresh={handleSkipResultRefresh}
        onNavigateBack={onNavigateBack}
        filePath={currentFilePath}
      />
    </>
  );
};

export default ModifyDialog;