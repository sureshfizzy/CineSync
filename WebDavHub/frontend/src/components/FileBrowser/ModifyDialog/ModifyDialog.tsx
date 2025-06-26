import React, { useState, useEffect, useRef } from 'react';
import { DialogTitle, DialogContent, DialogActions, Tabs, Typography, useTheme, IconButton } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import CloseIcon from '@mui/icons-material/Close';
import { searchTmdb, getTmdbPosterUrlDirect } from '../../api/tmdbApi';
import { processStructuredMessage } from '../../../utils/symlinkUpdates';
import { StyledDialog, ActionButton, StyledTab } from './StyledComponents';
import ActionOptions from './ActionOptions';
import IDOptions from './IDOptions';
import ExecutionDialog from './ExecutionDialog';
import SkipConfirmationDialog from './SkipConfirmationDialog';
import SkipResultDialog from './SkipResultDialog';
import ForceConfirmationDialog from './ForceConfirmationDialog';
import { ModifyDialogProps, ModifyOption, IDOption } from './types';

const ModifyDialog: React.FC<ModifyDialogProps> = ({ open, onClose, currentFilePath, onNavigateBack, useBatchApply: propUseBatchApply = false, useManualSearch: propUseManualSearch = false }) => {
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
  const [posterFetchInProgress, setPosterFetchInProgress] = useState(false);
  const [operationComplete, setOperationComplete] = useState(false);
  const [operationSuccess, setOperationSuccess] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const [skipResultOpen, setSkipResultOpen] = useState(false);
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const [useBatchApply, setUseBatchApply] = useState(false);
  const [lastSelectedOption, setLastSelectedOption] = useState<string | null>(null);
  const inputTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const theme = useTheme();

  const baseModifyOptions: ModifyOption[] = [
    { value: 'force', label: 'Force Recreate Symlinks', description: 'Recreate symlinks even if they exist', icon: '🔗' },
    { value: 'force-show', label: 'Force as TV Show', description: 'Process file as a TV show', icon: '📺' },
    { value: 'force-movie', label: 'Force as Movie', description: 'Process file as a movie', icon: '🎬' },
    { value: 'force-extra', label: 'Force as Extra', description: 'Process file as an extra', icon: '➕' },
    { value: 'skip', label: 'Skip Processing', description: 'Remove symlinks and block future processing', icon: '⏭️' },
  ];

  const modifyOptions: ModifyOption[] = baseModifyOptions;

  const idOptions: IDOption[] = [
    { value: 'imdb', label: 'IMDb ID', placeholder: 'tt1234567', icon: '🎥', helperText: 'Enter the IMDb ID (e.g., tt1234567)' },
    { value: 'tmdb', label: 'TMDb ID', placeholder: '12345', icon: '🎞️', helperText: 'Enter the TMDb ID (e.g., 12345)' },
    { value: 'tvdb', label: 'TVDb ID', placeholder: '123456', icon: '📺', helperText: 'Enter the TVDb ID (e.g., 123456)' },
    { value: 'season-episode', label: 'Season/Episode', placeholder: 'S01E01', icon: '📅', helperText: 'Format: S01E01 for season 1 episode 1' },
  ];

  const clearTimeouts = () => {
    [inputTimeoutRef, autoCloseTimeoutRef, loadingTimeoutRef, parseTimeoutRef].forEach(ref => {
      if (ref.current) {
        clearTimeout(ref.current);
        ref.current = null;
      }
    });
  };

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
    setPosterFetchInProgress(false);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
    setSkipConfirmOpen(false);
    setUseBatchApply(false);
    setLastSelectedOption(null);
    clearTimeouts();
  };

  const terminatePythonBridge = async () => {
    try {
      const response = await fetch('/api/python-bridge/terminate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
        }
      });
      if (response.ok) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('Failed to terminate python bridge process:', error);
    }
  };

  const handleClose = async () => {
    await terminatePythonBridge();
    resetAllStates();
    onClose();
  };

  const handleDialogClose = (_: unknown, reason: 'backdropClick' | 'escapeKeyDown') => {
    if (reason === 'backdropClick') return;
    handleClose();
  };

  const handleSubmit = () => {
    if (selectedOption === 'skip') {
      setSkipConfirmOpen(true);
      return;
    }
    if (selectedOption === 'force') {
      setForceConfirmOpen(true);
      return;
    }

    setExecOutput('');
    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
    setExecOpen(true);

    const shouldUseBatchApply = propUseBatchApply;
    if (shouldUseBatchApply) {
      setUseBatchApply(true);
    }

    startPythonCommand(shouldUseBatchApply);
  };

  const startPythonCommand = async (batchApplyOverride?: boolean) => {
    if (!currentFilePath) {
      setExecOutput('Error: No file path provided\n');
      return;
    }



    const disableMonitor = true;
    const shouldUseBatchApply = batchApplyOverride !== undefined ? batchApplyOverride : useBatchApply;
    const shouldUseManualSearch = propUseManualSearch;

    // Prepare the request payload with selected options and IDs
    const requestPayload = {
      sourcePath: currentFilePath,
      disableMonitor,
      selectedOption: selectedOption || undefined,
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
      }
    }
    if (shouldUseManualSearch) {
      commandPreview += ' --manual-search';
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
                setExecOutput(prev => {
                  const newOutput = prev + output + '\n';
                  // Check if the accumulated output contains movie/show options
                  parseMovieOptions(newOutput);
                  return newOutput;
                });

                // Check if waiting for user input - be more flexible with detection
                if (output.includes('Enter your choice:') ||
                    output.includes('Select an option:') ||
                    output.includes('Choose:') ||
                    output.includes('enter to search') ||
                    output.includes('Enter to search') ||
                    output.includes('Press Enter') ||
                    output.includes('Type') ||
                    output.includes('Input') ||
                    output.includes('Enter your search term') ||
                    output.includes('Enter 1-') ||
                    output.includes('to select an item') ||
                    output.includes('Try a different search term') ||
                    output.includes('No results found for') ||
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
                // Only mark as complete if we're not currently showing options or waiting for input
                // This prevents premature completion when the backend is still waiting for user selection
                const hasActiveOptions = movieOptions.length > 0 || isLoadingNewOptions;
                const isWaitingForUserInput = waitingForInput || (msg.output && (
                  msg.output.includes('Enter your choice:') ||
                  msg.output.includes('Select an option:') ||
                  msg.output.includes('Enter your search term') ||
                  msg.output.includes('Enter 1-') ||
                  msg.output.includes('to select an item') ||
                  msg.output.includes('Try a different search term') ||
                  msg.output.includes('No results found for')
                ));

                if (!hasActiveOptions && !isWaitingForUserInput) {
                  console.log('Operation truly complete - no active options and not waiting for input');
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
                } else {
                  console.log('Backend sent done but still have active UI state - ignoring completion signal');
                  console.log('Has active options:', hasActiveOptions, 'Waiting for input:', isWaitingForUserInput);
                }
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

  const parseMovieOptions = (fullOutput: string) => {
    if ((window as any).selectionBlocked) {
      console.log('Parsing blocked due to recent selection');
      return;
    }

    // Clear any existing parse timeout
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
    }

    // Debounce the parsing to prevent multiple rapid calls
    parseTimeoutRef.current = setTimeout(() => {
      parseMovieOptionsImmediate(fullOutput);
    }, 200); // Wait 200ms for output to stabilize
  };

  const parseMovieOptionsImmediate = (fullOutput: string) => {
    if ((window as any).selectionBlocked) {
      console.log('Parsing blocked due to recent selection - preventing flicker');
      return;
    }

    // Simple check: if we see the user's selection input in the output, stop parsing
    if (lastSelectedOption && fullOutput.includes(`> ${lastSelectedOption}`)) {
      console.log('User selection detected in output - blocking parsing to prevent flicker');
      // Clear options immediately
      if (movieOptions.length > 0) {
        setMovieOptions([]);
        setIsLoadingNewOptions(false);
        setPreviousOptions([]);
      }
      return;
    }

    // Look for numbered options with movie/show titles and TMDB IDs in the full output
    // Support both formats: "1: Title (Year) [Movie - tmdb-12345]" and "1: Title (Year) [tmdb-12345]"
    // Also handle log prefixes like "[INFO] 1: Title..."
    const optionRegex = /(?:\[INFO\]\s+)?(\d+):\s*([^(\n\[]+?)\s*\((\d{4})\)\s*\[(?:(TV Show|Movie) - )?tmdb-(\d+)\]/gm;
    const allMatches = [...fullOutput.matchAll(optionRegex)];

    if (allMatches.length === 0) {
      return;
    }

    // Find the most recent complete set of options (1, 2, 3)
    // We look for the last occurrence of "1:" and then find the complete set from there
    let relevantMatches: RegExpMatchArray[] = [];

    // Find the last match that starts with "1:"
    let lastOneIndex = -1;
    for (let i = allMatches.length - 1; i >= 0; i--) {
      if (allMatches[i][1] === '1') {
        lastOneIndex = i;
        break;
      }
    }

    if (lastOneIndex !== -1) {
      // Get all consecutive matches starting from the last "1:"
      relevantMatches = allMatches.slice(lastOneIndex);

      // Filter to only include consecutive numbers starting from 1
      const consecutiveMatches = [];
      let expectedNumber = 1;
      for (const match of relevantMatches) {
        if (parseInt(match[1]) === expectedNumber) {
          consecutiveMatches.push(match);
          expectedNumber++;
        } else {
          break; // Stop if we hit a non-consecutive number
        }
      }
      relevantMatches = consecutiveMatches;
    }

    console.log('Relevant matches (most recent set):', relevantMatches);
    const matches = relevantMatches;

    if (matches.length > 0) {
      const options = matches.map(match => ({
        number: match[1],
        title: match[2]?.trim(),
        year: match[3],
        mediaType: match[4] ? (match[4] === 'TV Show' ? 'tv' : 'movie') : null, // Extract media type if available
        tmdbId: match[5] // TMDB ID is now in match[5] due to the capture group
      }));

      console.log('Parsed options:', options);

      // Check if these are actually new options by comparing the first option's tmdbId
      const currentFirstTmdbId = movieOptions.length > 0 ? movieOptions[0].tmdbId : null;
      const newFirstTmdbId = options.length > 0 ? options[0].tmdbId : null;



      // Only update if we have different options or more options than before
      if (options.length !== movieOptions.length || currentFirstTmdbId !== newFirstTmdbId) {
        console.log(`Updating options: ${movieOptions.length} -> ${options.length}`);
        console.log(`First TMDB ID changed: ${currentFirstTmdbId} -> ${newFirstTmdbId}`);

        // Show options immediately without posters, then load posters concurrently
        const sortedOptions = options.sort((a, b) => parseInt(a.number) - parseInt(b.number));
        setMovieOptions(sortedOptions);
        setIsLoadingNewOptions(false);
      } else {
        console.log('Same options detected, skipping update');
        return; // Don't fetch posters again if same options
      }

      // Prevent duplicate poster fetching
      if (posterFetchInProgress) {
        console.log('Poster fetch already in progress, skipping duplicate request');
        return;
      }

      // Fetch poster images for each option using the TMDb ID provided by backend
      const fetchPostersAsync = async () => {
        setPosterFetchInProgress(true);
        console.log('Starting throttled poster fetch for options:', options);
        console.log('Full output context for media type detection:', fullOutput.substring(Math.max(0, fullOutput.length - 500))); // Last 500 chars

        let totalApiCalls = 0;

        // Throttled poster fetching - limit to 3 concurrent requests at a time for better performance
        const CONCURRENT_LIMIT = 3;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        for (let i = 0; i < options.length; i += CONCURRENT_LIMIT) {
          const batch = options.slice(i, i + CONCURRENT_LIMIT);

          const batchPromises = batch.map(async (option) => {
            if (!option.tmdbId) return;

            try {
              let tmdbResult = null;

              // Use media type information if available from backend output
              if (option.mediaType && (option.mediaType === 'tv' || option.mediaType === 'movie')) {
                console.log(`Using explicit media type '${option.mediaType}' for option ${option.number}`);
                totalApiCalls++;
                tmdbResult = await searchTmdb(option.tmdbId, undefined, option.mediaType, 1, true);
              } else {
                // For regular search results without explicit media type, use smart detection
                // Check if this looks like a TV show search context by looking at the output
                const isTvContext = fullOutput.includes('Multiple shows found for query') ||
                                    fullOutput.includes('search/tv') ||
                                    fullOutput.includes('TV Show -') ||
                                    fullOutput.includes('Episode') ||
                                    fullOutput.includes('Season');

                // Check if this looks like a movie context
                const isMovieContext = fullOutput.includes('Multiple movies found for query') ||
                                       fullOutput.includes('search/movie') ||
                                       fullOutput.includes('Movie -');

                if (isTvContext && !isMovieContext) {
                  console.log(`TV context detected for option ${option.number}, using TV endpoint only`);
                  totalApiCalls++;
                  tmdbResult = await searchTmdb(option.tmdbId, undefined, 'tv', 1, true);
                } else if (isMovieContext && !isTvContext) {
                  console.log(`Movie context detected for option ${option.number}, using movie endpoint only`);
                  totalApiCalls++;
                  tmdbResult = await searchTmdb(option.tmdbId, undefined, 'movie', 1, true);
                } else {
                  // Ambiguous context - try movie first (most common), but don't fallback to TV
                  // This prevents the double API calls that cause network errors
                  console.log(`Ambiguous context for option ${option.number}, trying movie only (no fallback)`);
                  totalApiCalls++;
                  tmdbResult = await searchTmdb(option.tmdbId, undefined, 'movie', 1, true);

                  // Only try TV if we have strong indicators it might be a TV show
                  if (!tmdbResult && (option.title?.toLowerCase().includes('season') ||
                                      option.title?.toLowerCase().includes('episode') ||
                                      option.title?.toLowerCase().includes('s0') ||
                                      option.title?.toLowerCase().includes('e0'))) {
                    console.log(`Movie failed but TV indicators found for option ${option.number}, trying TV`);
                    totalApiCalls++;
                    tmdbResult = await searchTmdb(option.tmdbId, undefined, 'tv', 1, true);
                  }
                }
              }

              if (tmdbResult && tmdbResult.poster_path) {
                const posterUrl = getTmdbPosterUrlDirect(tmdbResult.poster_path, 'w200');
                console.log(`Fetched poster for option ${option.number}:`, posterUrl);

                // Update this specific option with its poster
                setMovieOptions(prevOptions =>
                  prevOptions.map(prevOption =>
                    prevOption.number === option.number
                      ? { ...prevOption, posterUrl, tmdbData: tmdbResult }
                      : prevOption
                  )
                );
              } else {
                console.log(`No poster found for option ${option.number} (ID: ${option.tmdbId}, type: ${option.mediaType || 'unknown'})`);
              }
            } catch (error) {
              console.error('Failed to fetch TMDB data for option', option.number, ':', error);
              // Option will remain without poster - that's fine
            }
          });

          // Execute current batch and wait for completion
          await Promise.allSettled(batchPromises);

          // Minimal delay between batches for optimal performance
          if (i + CONCURRENT_LIMIT < options.length) {
            await delay(10);
          }
        }

        console.log(`All poster fetch attempts completed. Total API calls made: ${totalApiCalls}`);
        setPosterFetchInProgress(false);
      };

      // Execute the async function
      fetchPostersAsync();

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
      }

      // Always set loading state when sending input
      setIsLoadingNewOptions(true);

      // Set a timeout to clear loading state if no new options are received
      loadingTimeoutRef.current = setTimeout(() => {
        setIsLoadingNewOptions(false);
        setPreviousOptions([]);
      }, 5000); // 5 seconds timeout

      // Only clear for manual text input (not numeric selections)
      if (!/^\d+$/.test(input.trim())) {
        setMovieOptions([]);
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
    setLastSelectedOption(optionNumber);

    (window as any).lastSelectionTime = Date.now();
    (window as any).selectionBlocked = true;

    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setPosterFetchInProgress(false);

    // Clear any pending parse timeouts
    if (parseTimeoutRef.current) {
      clearTimeout(parseTimeoutRef.current);
      parseTimeoutRef.current = null;
    }

    sendInput(optionNumber);

    // Clear the selection states after processing should be complete
    setTimeout(() => {
      setLastSelectedOption(null);
      (window as any).selectionBlocked = false;
    }, 5000);
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

      if (!response.body) {
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
          const lines = chunk.split('\n').filter(Boolean);
          lines.forEach(line => {
            try {
              JSON.parse(line);
            } catch (parseError) {
            }
          });
        }
      }
    } catch (error) {
    }
  };

  const handleSkipCancel = () => {
    setSkipConfirmOpen(false);
  };

  const handleForceConfirm = async () => {
    setForceConfirmOpen(false);
    await terminatePythonBridge();

    setExecOutput('');
    setMovieOptions([]);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
    setExecOpen(true);

    const shouldUseBatchApply = propUseBatchApply;
    if (shouldUseBatchApply) {
      setUseBatchApply(true);
    }

    startPythonCommand();
  };

  const handleForceCancel = () => setForceConfirmOpen(false);

  const handleSkipResultClose = () => {
    setSkipResultOpen(false);
    handleClose();
  };

  const handleSkipResultRefresh = () => {
    if (onClose) {
      onClose();
    }
  };

  const handleExecClose = async () => {
    await terminatePythonBridge();
    setExecOpen(false);
    clearTimeouts();
    setWaitingForInput(false);
    setIsLoadingNewOptions(false);
    setPreviousOptions([]);
    setOperationComplete(false);
    setOperationSuccess(false);
    setIsClosing(false);
  };

  useEffect(() => {
    if (open) resetAllStates();
  }, [open]);

  useEffect(() => {
    return clearTimeouts;
  }, []);

  return (
    <>
      <StyledDialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            margin: { xs: 1, sm: 2 },
            maxHeight: { xs: '95vh', sm: '90vh' },
            width: { xs: 'calc(100vw - 16px)', sm: 'auto' },
          }
        }}
      >
        <DialogTitle
          component="div"
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            py: { xs: 1.5, sm: 2 },
            px: { xs: 2, sm: 3 },
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

        <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
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

        <DialogActions sx={{
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: { xs: 1.5, sm: 2 },
          gap: { xs: 1, sm: 2 },
          flexDirection: { xs: 'column-reverse', sm: 'row' },
        }}>
          <ActionButton
            onClick={handleClose}
            variant="outlined"
            sx={{
              width: { xs: '100%', sm: 'auto' },
              order: { xs: 2, sm: 1 }
            }}
          >
            Cancel
          </ActionButton>
          <ActionButton
            onClick={handleSubmit}
            variant="contained"
            disabled={!selectedOption && Object.values(selectedIds).every(v => !v)}
            startIcon={<BuildIcon fontSize="small" />}
            sx={{
              width: { xs: '100%', sm: 'auto' },
              order: { xs: 1, sm: 2 }
            }}
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

      <ForceConfirmationDialog
        open={forceConfirmOpen}
        onConfirm={handleForceConfirm}
        onCancel={handleForceCancel}
        filePath={currentFilePath}
      />
    </>
  );
};

export default ModifyDialog;