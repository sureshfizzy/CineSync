import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, Tabs, Tab, Card, CardContent, Chip, IconButton, CircularProgress, Alert, useTheme, alpha, Stack, Tooltip, Badge, useMediaQuery, Fab, Divider, Pagination, TextField, InputAdornment, Button, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText } from '@mui/material';
import { CheckCircle, Warning as WarningIcon, Delete as DeleteIcon, Refresh as RefreshIcon, Assignment as AssignmentIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Schedule as ScheduleIcon, SkipNext as SkipIcon, Storage as DatabaseIcon, Timeline as OperationsIcon, Source as SourceIcon, Folder as FolderIcon, Movie as MovieIcon, Tv as TvIcon, InsertDriveFile as FileIcon, PlayCircle as PlayCircleIcon, FolderOpen as FolderOpenIcon, Info as InfoIcon, CheckCircle as ProcessedIcon, RadioButtonUnchecked as UnprocessedIcon, Link as LinkIcon, Warning as WarningIcon2, Settings as SettingsIcon, Search as SearchIcon, DeleteSweep as DeleteSweepIcon } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import DatabaseSearch from './DatabaseSearch';
import ProcessingAnimation from './ProcessingAnimation';
import { useSSEEventListener } from '../../hooks/useCentralizedSSE';
import { FileItem } from '../FileBrowser/types';
import ModifyDialog from '../FileBrowser/ModifyDialog/ModifyDialog';

const MotionFab = motion(Fab);

interface FileOperation {
  id: string;
  filePath: string;
  destinationPath?: string;
  fileName: string;
  status: 'created' | 'failed' | 'deleted' | 'skipped';
  timestamp: string;
  reason?: string;
  error?: string;
  tmdbId?: string;
  seasonNumber?: number;
  type: 'movie' | 'tvshow' | 'other';
  operation?: 'process' | 'delete';
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`file-operations-tabpanel-${index}`}
      aria-labelledby={`file-operations-tab-${index}`}
      style={{ display: value === index ? 'block' : 'none' }}
      {...other}
    >
      <Box sx={{ pt: 3 }}>{children}</Box>
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `file-operations-tab-${index}`,
    'aria-controls': `file-operations-tabpanel-${index}`,
  };
}



// Remove unused interface

function FileOperations() {
  const [mainTabValue, setMainTabValue] = useState(0);
  const [tabValue, setTabValue] = useState(0);
  const [operations, setOperations] = useState<FileOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage] = useState(25);
  const [totalOperations, setTotalOperations] = useState(0);
  const [statusCounts, setStatusCounts] = useState({
    created: 0,
    failed: 0,
    skipped: 0,
    deleted: 0,
  });



  // Source File Browser state
  const [sourceFiles, setSourceFiles] = useState<FileItem[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [sourceIndex] = useState<number | undefined>(undefined);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceTotalPages, setSourceTotalPages] = useState(1);
  const [sourceTotalFiles, setSourceTotalFiles] = useState(0);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [currentFileForProcessing, setCurrentFileForProcessing] = useState<string>('');
  const [hasSourceDirectories, setHasSourceDirectories] = useState<boolean | null>(null);

  // Processing animation state
  const [processingFiles, setProcessingFiles] = useState<Map<string, {
    fileName: string;
    mediaName?: string;
    mediaType?: string;
  }>>(new Map());

  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSourceSearching, setIsSourceSearching] = useState(false);

  const searchQueryRef = useRef('');
  const sourceSearchQueryRef = useRef('');

  // Bulk delete state
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));

  const ITEMS_PER_PAGE = 50;



  const filteredSourceFiles = sourceFiles;

  const fetchSourceFilesData = useCallback(async (pageNum?: number, sourceIndexFilter?: number) => {
    setSourceLoading(true);
    setSourceError('');
    try {
      const actualPageNum = pageNum || sourcePage;
      const actualSourceIndex = sourceIndexFilter !== undefined ? sourceIndexFilter : sourceIndex;

      const params = new URLSearchParams({
        limit: ITEMS_PER_PAGE.toString(),
        offset: ((actualPageNum - 1) * ITEMS_PER_PAGE).toString(),
        activeOnly: 'true',
        mediaOnly: 'false'
      });

      if (actualSourceIndex !== undefined) {
        params.append('sourceIndex', actualSourceIndex.toString());
      }

      const currentSearch = sourceSearchQueryRef.current;
      if (currentSearch && currentSearch.trim()) {
        params.append('search', currentSearch.trim());
      }

      const response = await axios.get(`/api/database/source-files?${params.toString()}`);

      if (response.status === 200) {
        const data = response.data;

        // Add comprehensive null/undefined checks
        if (!data) {
          console.error('Source files API returned null/undefined data');
          setSourceError('Invalid response from server');
          setSourceFiles([]);
          return;
        }

        // Handle both null and empty array cases for files
        let filesArray = data.files;
        if (filesArray === null || filesArray === undefined) {
          filesArray = [];
        } else if (!Array.isArray(filesArray)) {
          setSourceError('Invalid file data from server');
          setSourceFiles([]);
          return;
        }

        // Empty files array is valid - it means all files are processed or no files found
        if (filesArray.length === 0) {
          console.log('No source files found - all files may be processed or directory is empty');
          setSourceFiles([]);
          setSourceTotalPages(data.totalPages || 1);
          setSourceTotalFiles(data.total || 0);
          setHasSourceDirectories(true);
          setError('');
          return;
        }

        // Convert database format to FileItem format for compatibility
        const convertedFiles: FileItem[] = filesArray.map((dbFile: any) => ({
          name: dbFile.fileName || 'Unknown',
          path: dbFile.relativePath || '',
          fullPath: dbFile.filePath || '',
          type: 'file',
          size: dbFile.fileSizeFormatted || '0 B',
          modified: dbFile.modifiedTime ? new Date(dbFile.modifiedTime * 1000).toISOString() : new Date().toISOString(),
          isMediaFile: dbFile.isMediaFile || false,
          isSourceRoot: false,
          processingStatus: dbFile.processingStatus || 'unprocessed',
          tmdbId: dbFile.tmdbId || '',
          seasonNumber: dbFile.seasonNumber || null,
          lastProcessedAt: dbFile.lastProcessedAt || null
        }));

        setSourceFiles(convertedFiles);
        setSourceTotalPages(data.totalPages || 1);
        setSourceTotalFiles(data.total || 0);
        setHasSourceDirectories(true);

        setError('');
      } else {
        console.error('Source files API returned non-200 status:', response.status, response.statusText);
        setSourceError(`Server error: ${response.status} ${response.statusText}`);
        setSourceFiles([]);
      }

    } catch (err) {
      console.error('Source files fetch error:', err);

      if (axios.isAxiosError(err)) {
        if (err.response) {
          const status = err.response.status;
          const message = err.response.data?.message || err.response.statusText || 'Unknown server error';

          if (status === 503 || (message && message.toLowerCase().includes('source'))) {
            setHasSourceDirectories(false);
          } else {
            setHasSourceDirectories(true);
          }

          setSourceError(`Server error (${status}): ${message}`);
        } else if (err.request) {
          setSourceError('No response from server - check if WebDavHub service is running');
          setHasSourceDirectories(null);
        } else {
          setSourceError(`Request error: ${err.message}`);
          setHasSourceDirectories(null);
        }
      } else {
        setSourceError(`Unexpected error: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setHasSourceDirectories(null);
      }

      setSourceFiles([]);
    } finally {
      setSourceLoading(false);
      setInitialLoading(false);
    }
  }, [sourcePage, sourceIndex]);

  const fetchFileOperations = useCallback(async (showLoading = false) => {
    try {
      if (tabValue === 0) {
        return;
      }

      if (showLoading) {
        setLoading(true);
      }

      const currentSearch = searchQueryRef.current;
      const offset = (currentPage - 1) * recordsPerPage;
      const statusMap = ['created', 'failed', 'skipped', 'deleted'];
      const statusFilter = statusMap[tabValue - 1];

      if (!statusFilter) {
        return;
      }

      const params: any = {
        limit: recordsPerPage,
        offset: offset,
        status: statusFilter,
        lightweight: true,
      };

      if (currentSearch && currentSearch.trim()) {
        params.search = currentSearch.trim();
      }

      const response = await axios.get('/api/file-operations', { params });
      const data = response.data;

      setOperations(data.operations || []);
      setTotalOperations(data.total || 0);
      setStatusCounts(data.statusCounts || {
        created: 0,
        failed: 0,
        skipped: 0,
        deleted: 0,
      });
      setError('');
      setLastUpdated(new Date());
      setInitialLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch file operations');
      setOperations([]);
      setTotalOperations(0);
      setInitialLoading(false);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [tabValue, currentPage, recordsPerPage]);



  // Initial load effect
  useEffect(() => {
    if (tabValue === 0) {
      fetchSourceFilesData(sourcePage, sourceIndex);
    } else {
      fetchFileOperations(false);
    }
  }, []);



  useEffect(() => {
    if (tabValue === 0) return;

    searchQueryRef.current = searchQuery;
    setIsSearching(true);

    if (currentPage !== 1) {
      setCurrentPage(1);
    } else {
      fetchFileOperations(false);
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (tabValue === 0) return;
    fetchFileOperations(false);
  }, [currentPage, recordsPerPage]);

  // Separate effect for tab changes to ensure proper data loading
  useEffect(() => {
    if (tabValue > 0) {
      fetchFileOperations(false);
    }
  }, [tabValue]);

  useEffect(() => {
    if (tabValue !== 0) return;
    fetchSourceFilesData(sourcePage, sourceIndex);
  }, [sourcePage, sourceIndex]);

  useEffect(() => {
    if (tabValue !== 0) return;

    sourceSearchQueryRef.current = sourceSearchQuery;
    setIsSourceSearching(true);

    if (sourcePage !== 1) {
      setSourcePage(1);
    } else {
      fetchSourceFilesData(1, sourceIndex);
      setIsSourceSearching(false);
    }
  }, [sourceSearchQuery]);

  const handleOperationUpdate = useCallback((newOperation: FileOperation) => {
    const statusMap = ['created', 'failed', 'skipped', 'deleted'];
    const newOperationTabIndex = statusMap.indexOf(newOperation.status) + 1;

    setStatusCounts(prev => ({
      ...prev,
      [newOperation.status]: prev[newOperation.status] + 1
    }));

    setOperations(prev => {
      const existingIndex = prev.findIndex(op =>
        op.id === newOperation.id ||
        (op.filePath === newOperation.filePath && op.filePath)
      );

      if (existingIndex !== -1) {
        const existingOperation = prev[existingIndex];

        setStatusCounts(prevCounts => ({
          ...prevCounts,
          [existingOperation.status]: Math.max(0, prevCounts[existingOperation.status] - 1)
        }));

        setTotalOperations(prevTotal => Math.max(0, prevTotal - 1));
        return prev.filter((_, index) => index !== existingIndex);
      }

      return prev;
    });

    if (tabValue === newOperationTabIndex) {
      setOperations(prev => [newOperation, ...prev.slice(0, recordsPerPage - 1)]);
      setTotalOperations(prev => prev + 1);
    }

    setLastUpdated(new Date());
  }, [tabValue, recordsPerPage]);

  const removeSourceFile = useCallback((filePath: string) => {
    if (tabValue === 0) {
      setSourceFiles(prev => prev.filter(file => file.fullPath !== filePath));
      setSourceTotalFiles(prev => Math.max(0, prev - 1));
    }
  }, [tabValue]);

  // Listen for file operation updates through centralized SSE
  useSSEEventListener(
    ['file_operation_update'],
    (event) => {
      const data = event.data;

      if (data && data.operation) {
        const newOperation: FileOperation = {
          id: data.operation.id || `${Date.now()}-${Math.random()}`,
          filePath: data.operation.filePath || '',
          destinationPath: data.operation.destinationPath,
          fileName: data.operation.fileName || data.operation.filePath?.split('/').pop() || 'Unknown',
          status: data.operation.status || 'created',
          timestamp: data.operation.timestamp || new Date().toISOString(),
          reason: data.operation.reason,
          error: data.operation.error,
          tmdbId: data.operation.tmdbId,
          seasonNumber: data.operation.seasonNumber,
          type: data.operation.type || 'other',
          operation: data.operation.operation || 'process'
        };

        handleOperationUpdate(newOperation);
      }
    },
    {
      source: 'file-operations',
      dependencies: [handleOperationUpdate]
    }
  );

  // Listen for file processing events for real-time animations
  useSSEEventListener(
    ['file_processed'],
    (event) => {
      const data = event.data;
      if (data.source_file) {
        setProcessingFiles(prev => new Map(prev.set(data.source_file, {
          fileName: data.filename || data.source_file.split('/').pop() || 'Unknown',
          mediaName: data.media_name,
          mediaType: data.media_type
        })));

        // Remove file from source files list and clear animation after delay
        setTimeout(() => {
          setProcessingFiles(prev => {
            const newMap = new Map(prev);
            newMap.delete(data.source_file);
            return newMap;
          });

          removeSourceFile(data.source_file);
        }, 3500);
      }
    },
    {
      source: 'mediahub',
      dependencies: [removeSourceFile]
    }
  );

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    setCurrentPage(1);
    setInitialLoading(false);

    if (newValue === 0) {
      fetchSourceFilesData(sourcePage, sourceIndex);
    }
  };

  const handleMainTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setMainTabValue(newValue);
    setTabValue(0);
  };

  // Source File Browser handlers
  const handleSourceFileClick = (file: FileItem) => {
    if (file.isMediaFile && file.fullPath) {
      handleProcessFile(file);
    }
  };

  const handleProcessFile = (file: FileItem) => {
    if (file.fullPath) {
      setCurrentFileForProcessing(file.fullPath);
      setModifyDialogOpen(true);
    }
  };

  const handleModifyDialogClose = () => {
    setModifyDialogOpen(false);
    setCurrentFileForProcessing('');
    if (tabValue === 0) {
      fetchSourceFilesData(sourcePage, sourceIndex);
    } else {
      fetchFileOperations(false);
    }
  };

  const handleBulkDeleteSkippedFiles = async () => {
    setBulkDeleteLoading(true);
    try {
      const response = await axios.delete('/api/file-operations');

      if (response.data.success) {
        console.log(response.data.message);

        // Update status counts to reflect the deletion
        setStatusCounts(prev => ({
          ...prev,
          skipped: 0
        }));

        // Clear operations if we're on the skipped tab
        if (tabValue === 3) {
          setOperations([]);
          setTotalOperations(0);
        }

        // Refresh data
        fetchFileOperations(false);

        setBulkDeleteDialogOpen(false);
      }
    } catch (error: any) {
      console.error('Failed to delete skipped files:', error.response?.data?.error || error.message);
      setError(error.response?.data?.error || error.message || 'Failed to delete skipped files');
    } finally {
      setBulkDeleteLoading(false);
    }
  };

  const getProcessingStatus = (file: any): any => {
    if (!file.isMediaFile) return null;

    if (file.processingStatus && file.processingStatus !== 'unprocessed') {
      return {
        status: file.processingStatus,
        tmdbId: file.tmdbId,
        seasonNumber: file.seasonNumber,
        lastProcessedAt: file.lastProcessedAt
      };
    }

    return null;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'created':
        return theme.palette.success.main;
      case 'failed':
        return theme.palette.error.main;
      case 'deleted':
        return theme.palette.info.main;
      case 'skipped':
        return theme.palette.secondary.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'created':
        return <CheckCircle sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'failed':
        return <WarningIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'deleted':
        return <DeleteIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      case 'skipped':
        return <SkipIcon sx={{ fontSize: 16, color: getStatusColor(status) }} />;
      default:
        return <CheckCircle sx={{ fontSize: 16, color: getStatusColor(status) }} />;
    }
  };

  // Source File Browser helper functions
  const getFileIcon = (file: FileItem) => {
    if (file.isSourceRoot) {
      return <DatabaseIcon sx={{ color: 'primary.main', fontSize: 28 }} />;
    }
    if (file.type === 'directory') {
      return <FolderOpenIcon sx={{ color: 'warning.main', fontSize: 24 }} />;
    }
    if (file.isMediaFile) {
      const status = getProcessingStatus(file);
      const fileName = file.name.toLowerCase();
      const isProcessed = status?.status === 'processed' || status?.status === 'created';

      const iconStyle = {
        fontSize: 24,
        color: isProcessed ? 'success.main' : 'text.secondary',
        opacity: isProcessed ? 1 : 0.7,
        position: 'relative' as const,
      };

      if (fileName.includes('s0') || fileName.includes('season') || fileName.includes('episode') || fileName.includes('e0')) {
        return (
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <TvIcon sx={iconStyle} />
            {isProcessed && (
              <LinkIcon sx={{
                position: 'absolute',
                top: -2,
                right: -2,
                fontSize: 12,
                color: 'success.main',
                bgcolor: 'background.paper',
                borderRadius: '50%',
                p: 0.2
              }} />
            )}
          </Box>
        );
      } else {
        return (
          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <MovieIcon sx={iconStyle} />
            {isProcessed && (
              <LinkIcon sx={{
                position: 'absolute',
                top: -2,
                right: -2,
                fontSize: 12,
                color: 'success.main',
                bgcolor: 'background.paper',
                borderRadius: '50%',
                p: 0.2
              }} />
            )}
          </Box>
        );
      }
    }
    return <FileIcon sx={{ color: 'text.secondary', fontSize: 20 }} />;
  };

  const getFileTypeChip = (file: FileItem) => {
    if (file.isSourceRoot) {
      return (
        <Chip
          label="Source Directory"
          size="small"
          color="primary"
          variant="outlined"
          icon={<DatabaseIcon />}
        />
      );
    }
    return null;
  };

  const getStatusTooltip = (file: any): string => {
    const status = getProcessingStatus(file);
    if (!status) {
      return file.isMediaFile ? 'This file has not been processed yet' : '';
    }

    let tooltip = `Status: ${status.status.toUpperCase()}`;

    if (status.lastProcessedAt) {
      const timestamp = new Date(status.lastProcessedAt * 1000).toLocaleString();
      tooltip += `\nProcessed: ${timestamp}`;
    }

    if (status.tmdbId) {
      tooltip += `\nTMDB ID: ${status.tmdbId}`;
    }

    if (status.seasonNumber) {
      tooltip += `\nSeason: ${status.seasonNumber}`;
    }

    return tooltip;
  };

  const getProcessingStatusChip = (file: FileItem) => {
    const status = getProcessingStatus(file);

    if (!status) {
      if (file.isMediaFile) {
        return (
          <Chip
            label="Not Processed"
            size="small"
            color="default"
            variant="outlined"
            icon={<UnprocessedIcon sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: alpha(theme.palette.grey[500], 0.1),
              color: 'text.secondary',
              fontWeight: 500,
              border: `1px solid ${alpha(theme.palette.grey[500], 0.3)}`,
              '& .MuiChip-icon': {
                color: 'text.secondary'
              }
            }}
          />
        );
      }
      return null;
    }

    switch (status.status) {
      case 'processed':
      case 'created':
        return (
          <Chip
            label="Processed"
            size="small"
            color="success"
            variant="filled"
            icon={<ProcessedIcon sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: alpha(theme.palette.success.main, 0.15),
              color: 'success.main',
              fontWeight: 600,
              border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
              '& .MuiChip-icon': {
                color: 'success.main'
              }
            }}
          />
        );

      case 'failed':
        return (
          <Chip
            label="Failed"
            size="small"
            color="error"
            variant="filled"
            icon={<WarningIcon2 sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: alpha(theme.palette.error.main, 0.15),
              color: 'error.main',
              fontWeight: 600,
              border: `1px solid ${alpha(theme.palette.error.main, 0.3)}`,
              '& .MuiChip-icon': {
                color: 'error.main'
              }
            }}
          />
        );

      case 'skipped':
        return (
          <Chip
            label="Skipped"
            size="small"
            color="warning"
            variant="filled"
            icon={<WarningIcon2 sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: alpha(theme.palette.warning.main, 0.15),
              color: 'warning.main',
              fontWeight: 600,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
              '& .MuiChip-icon': {
                color: 'warning.main'
              }
            }}
          />
        );

      case 'deleted':
        return (
          <Chip
            label="Deleted"
            size="small"
            color="info"
            variant="filled"
            icon={<DeleteIcon sx={{ fontSize: 16 }} />}
            sx={{
              bgcolor: alpha(theme.palette.info.main, 0.15),
              color: 'info.main',
              fontWeight: 600,
              border: `1px solid ${alpha(theme.palette.info.main, 0.3)}`,
              '& .MuiChip-icon': {
                color: 'info.main'
              }
            }}
          />
        );

      default:
        return null;
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    if (isMobile) {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleString();
  };

  const toggleCardExpansion = (cardId: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  };



  const renderMobileCard = React.useCallback((file: FileOperation, _index: number) => {
    const isExpanded = expandedCards.has(file.id);

    return (
      <Card
        key={file.id}
        sx={{
          mb: 1.5,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'hidden',
        }}
      >
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            onClick={() => toggleCardExpansion(file.id)}
            sx={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: isExpanded ? 1.5 : 0,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
              <Box sx={{
                p: 1,
                borderRadius: 2,
                bgcolor: alpha(getStatusColor(file.status), 0.1),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {getStatusIcon(file.status)}
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" fontWeight="600" sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'text.primary',
                }}>
                  {file.fileName}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                  <Chip
                    label={file.status.toUpperCase()}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      bgcolor: alpha(getStatusColor(file.status), 0.1),
                      color: getStatusColor(file.status),
                      border: 'none',
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}>
                    <ScheduleIcon sx={{ fontSize: 12 }} />
                    {formatTimestamp(file.timestamp)}
                  </Typography>
                </Box>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {/* Action buttons for created, skipped, and failed files */}
              {(file.status === 'created' || file.status === 'skipped' || file.status === 'failed') && (
                <Tooltip title={
                  file.status === 'created' ? 'File Actions' :
                  file.status === 'failed' ? 'Retry Processing' :
                  'Reprocess File'
                }>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Open the modify dialog for file processing
                      setCurrentFileForProcessing(file.filePath || '');
                      setModifyDialogOpen(true);
                    }}
                    sx={{
                      bgcolor: alpha(
                        file.status === 'created'
                          ? theme.palette.success.main
                          : file.status === 'failed'
                          ? theme.palette.error.main
                          : theme.palette.warning.main,
                        0.1
                      ),
                      color: file.status === 'created' ? 'success.main' :
                             file.status === 'failed' ? 'error.main' : 'warning.main',
                      '&:hover': {
                        bgcolor: alpha(
                          file.status === 'created'
                            ? theme.palette.success.main
                            : file.status === 'failed'
                            ? theme.palette.error.main
                            : theme.palette.warning.main,
                          0.2
                        ),
                        transform: 'scale(1.1)',
                      },
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <SettingsIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              )}
              <IconButton size="small" sx={{ color: 'text.secondary' }}>
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>
          </Box>

          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" fontWeight="600">
                      Source Path
                    </Typography>
                    <Typography variant="body2" sx={{
                      wordBreak: 'break-all',
                      bgcolor: 'action.hover',
                      p: 1,
                      borderRadius: 1,
                      mt: 0.5,
                      fontSize: '0.8rem',
                    }}>
                      {file.filePath}
                    </Typography>
                  </Box>

                  {file.destinationPath && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight="600">
                        Destination Path
                      </Typography>
                      <Typography variant="body2" sx={{
                        wordBreak: 'break-all',
                        bgcolor: 'action.hover',
                        p: 1,
                        borderRadius: 1,
                        mt: 0.5,
                        fontSize: '0.8rem',
                      }}>
                        {file.destinationPath}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label={file.type.toUpperCase()}
                      size="small"
                      sx={{
                        bgcolor: alpha(theme.palette.info.main, 0.1),
                        color: 'info.main',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                    <Chip
                      label={file.operation === 'delete' ? 'DELETE' : 'PROCESS'}
                      size="small"
                      sx={{
                        bgcolor: file.operation === 'delete'
                          ? alpha(theme.palette.error.main, 0.1)
                          : alpha(theme.palette.success.main, 0.1),
                        color: file.operation === 'delete' ? 'error.main' : 'success.main',
                        fontWeight: 600,
                        fontSize: '0.7rem',
                      }}
                    />
                    {file.seasonNumber && (
                      <Chip
                        label={`Season ${file.seasonNumber}`}
                        size="small"
                        sx={{
                          bgcolor: alpha(theme.palette.secondary.main, 0.1),
                          color: 'secondary.main',
                          fontWeight: 600,
                          fontSize: '0.7rem',
                        }}
                      />
                    )}
                  </Box>

                  {(file.reason || file.error) && (
                    <Box>
                      <Typography variant="caption" color="text.secondary" fontWeight="600">
                        {file.error ? 'Error' : 'Reason'}
                      </Typography>
                      <Typography variant="body2" color={file.error ? 'error.main' : 'warning.main'} sx={{
                        bgcolor: file.error
                          ? alpha(theme.palette.error.main, 0.1)
                          : alpha(theme.palette.warning.main, 0.1),
                        p: 1,
                        borderRadius: 1,
                        mt: 0.5,
                        fontSize: '0.8rem',
                      }}>
                        {file.error || file.reason}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    );
  }, [expandedCards, theme]);

  const renderFileTable = (files: FileOperation[], emptyMessage: string) => {
    if (files.length === 0) {
      return (
        <Box
          sx={{
            textAlign: 'center',
            py: { xs: 6, sm: 8 },
            bgcolor: 'background.paper',
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6" color="text.secondary" sx={{
            mb: 1,
            fontSize: { xs: '1rem', sm: '1.25rem' }
          }}>
            {emptyMessage}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{
            fontSize: { xs: '0.8rem', sm: '0.875rem' }
          }}>
            File operations will appear here as they are processed.
          </Typography>
        </Box>
      );
    }

    // Card layout (preferred for all screen sizes)
    return (
      <Box sx={{ px: { xs: 0, sm: 1, md: 2 } }}>
        {files.length > 20 ? (
          // Disable animations for large lists to improve performance
          files.map((file, index) => renderMobileCard(file, index))
        ) : (
          <AnimatePresence>
            {files.map((file, index) => renderMobileCard(file, index))}
          </AnimatePresence>
        )}
      </Box>
    );
  };

  if (initialLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
          gap: 2
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="h6" color="text.secondary">
          Loading file operations...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{
      px: { xs: 1, sm: 1, md: 0 },
      maxWidth: 1400,
      mx: 'auto',
      pb: { xs: 10, sm: 4 }, // Extra bottom padding for mobile FAB
      position: 'relative'
    }}>
      {/* Header */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        mb: { xs: 2, sm: 2.5 },
        py: { xs: 1, sm: 0 },
      }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: { xs: 1, sm: 1.5 }
        }}>
          <Box sx={{
            backgroundColor: `${theme.palette.primary.main}15`,
            borderRadius: { xs: '10px', sm: '12px' },
            p: { xs: 0.6, sm: 0.8 },
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${theme.palette.primary.main}30`,
          }}>
            <AssignmentIcon sx={{
              color: 'primary.main',
              fontSize: { xs: 16, sm: 20, md: 22 }
            }} />
          </Box>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 700,
              letterSpacing: 0.3,
              fontSize: { xs: '1rem', sm: '1.3rem', md: '1.75rem' }
            }}
          >
            File Operations
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastUpdated && (
            <Typography variant="caption" color="text.secondary" sx={{
              display: { xs: 'none', sm: 'block' },
              fontSize: { sm: '0.7rem', md: '0.75rem' }
            }}>
              Updated: {lastUpdated.toLocaleTimeString()}
            </Typography>
          )}

          {!isMobile && (
            <Tooltip title="Refresh">
              <IconButton
                onClick={() => {
                  if (tabValue === 0) {
                    fetchSourceFilesData(sourcePage, sourceIndex);
                  } else {
                    fetchFileOperations(true);
                  }
                }}
                disabled={loading}
                sx={{
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  '&:hover': {
                    bgcolor: 'action.hover',
                    color: 'primary.main',
                    transform: 'rotate(180deg)'
                  },
                  transition: 'all 0.3s ease',
                  p: 1
                }}
              >
                <RefreshIcon sx={{ fontSize: 24 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Main Tab Navigation */}
      <Box sx={{ mb: 4 }}>
        <Box
          sx={{
            display: 'flex',
            gap: 0.5,
            p: 0.5,
            bgcolor: alpha(theme.palette.background.paper, 0.8),
            borderRadius: 3,
            border: '1px solid',
            borderColor: alpha(theme.palette.divider, 0.5),
            width: { xs: '100%', sm: 'fit-content' },
            maxWidth: '100%',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
            overflowX: { xs: 'auto', sm: 'visible' },
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            scrollbarWidth: 'none',
          }}
        >
          {[
            { name: 'Operations', icon: <OperationsIcon />, color: '#3b82f6' },
            { name: 'Database', icon: <DatabaseIcon />, color: '#10b981' }
          ].map((tab, index) => {
            const isSelected = mainTabValue === index;
            return (
              <Box
                key={tab.name}
                onClick={() => handleMainTabChange({} as React.SyntheticEvent, index)}
                sx={{
                  cursor: 'pointer',
                  px: { xs: 2.5, sm: 4 },
                  py: { xs: 1.5, sm: 2 },
                  borderRadius: 2.5,
                  bgcolor: isSelected
                    ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                    : 'transparent',
                  background: isSelected
                    ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                    : 'transparent',
                  color: isSelected ? 'white' : 'text.primary',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  flex: { xs: '1 1 0', sm: '0 0 auto' },
                  minWidth: { xs: 0, sm: 'auto' },
                  whiteSpace: 'nowrap',
                  position: 'relative',
                  overflow: 'hidden',
                  '&:hover': {
                    bgcolor: isSelected
                      ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                      : alpha(tab.color, 0.1),
                    background: isSelected
                      ? `linear-gradient(135deg, ${tab.color} 0%, ${alpha(tab.color, 0.8)} 100%)`
                      : alpha(tab.color, 0.1),
                    transform: 'translateY(-1px)',
                    boxShadow: isSelected
                      ? `0 12px 24px ${alpha(tab.color, 0.3)}`
                      : `0 4px 12px ${alpha(tab.color, 0.2)}`,
                  },
                  '&:active': {
                    transform: 'translateY(0px)',
                  },
                  '&::before': isSelected ? {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: `linear-gradient(135deg, ${alpha('#ffffff', 0.1)} 0%, transparent 50%)`,
                    borderRadius: 'inherit',
                    pointerEvents: 'none',
                  } : {},
                }}
              >
                <Stack direction="row" alignItems="center" spacing={{ xs: 1, sm: 1.5 }} sx={{ minWidth: 0, justifyContent: 'center' }}>
                  <Box
                    sx={{
                      width: { xs: 20, sm: 24 },
                      height: { xs: 20, sm: 24 },
                      borderRadius: 1,
                      bgcolor: isSelected ? 'rgba(255, 255, 255, 0.2)' : alpha(tab.color, 0.15),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isSelected ? 'white' : tab.color,
                      transition: 'all 0.3s ease',
                      flexShrink: 0,
                      '& svg': {
                        fontSize: { xs: 16, sm: 18 },
                      },
                    }}
                  >
                    {tab.icon}
                  </Box>
                  <Typography
                    variant="body1"
                    fontWeight="600"
                    sx={{
                      fontSize: { xs: '0.9rem', sm: '1rem' },
                      letterSpacing: '0.02em',
                      flexShrink: 0,
                      minWidth: 0,
                      textAlign: 'center',
                    }}
                  >
                    {tab.name}
                  </Typography>
                </Stack>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Operations Tab Content */}
      {mainTabValue === 0 && (
        <>
          {/* Sub-Tabs for Operations */}
      <Box sx={{
        borderBottom: 1,
        borderColor: 'divider',
        mb: { xs: 2, sm: 3 },
        mx: { xs: -1, sm: 0 },
        px: { xs: 1, sm: 0 },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="file operations tabs"
          variant={isMobile ? "scrollable" : "standard"}
          scrollButtons={isMobile ? "auto" : false}
          allowScrollButtonsMobile={isMobile}
          sx={{
            flex: 1,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: { xs: '0.7rem', sm: '0.875rem' },
              minHeight: { xs: 40, sm: 48 },
              minWidth: { xs: 60, sm: 160 },
              px: { xs: 0.5, sm: 2 },
            },
            '& .MuiTabs-scrollButtons': {
              color: 'primary.main',
            },
            '& .MuiTabs-flexContainer': {
              gap: { xs: 0, sm: 1 },
            },
          }}
        >
          <Tab
            label={
              <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: { xs: 0.5, sm: 1 },
                flexDirection: { xs: 'column', sm: 'row' }
              }}>
                <SourceIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                <Typography variant="caption" sx={{
                  fontSize: { xs: '0.65rem', sm: '0.75rem' },
                  display: { xs: 'block', sm: 'inline' },
                  lineHeight: 1.2,
                }}>
                  Source
                </Typography>
              </Box>
            }
            {...a11yProps(0)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.created} color="success" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <CheckCircle sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' },
                    lineHeight: 1.2,
                  }}>
                    Created
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(1)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.failed} color="error" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <WarningIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' },
                    lineHeight: 1.2,
                  }}>
                    Failed
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(2)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.skipped} color="secondary" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <SkipIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' },
                    lineHeight: 1.2,
                  }}>
                    Skipped
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(3)}
          />
          <Tab
            label={
              <Badge badgeContent={statusCounts.deleted} color="info" max={999}>
                <Box sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: { xs: 0.5, sm: 1 },
                  flexDirection: { xs: 'column', sm: 'row' }
                }}>
                  <DeleteIcon sx={{ fontSize: { xs: 16, sm: 18 } }} />
                  <Typography variant="caption" sx={{
                    fontSize: { xs: '0.65rem', sm: '0.75rem' },
                    display: { xs: 'block', sm: 'inline' },
                    lineHeight: 1.2,
                  }}>
                    Deleted
                  </Typography>
                </Box>
              </Badge>
            }
            {...a11yProps(4)}
          />
        </Tabs>

        {/* Bulk Delete Button for Skipped Files - Tabs Line Placement */}
        {!isMobile && tabValue === 3 && statusCounts.skipped > 0 && (
          <Tooltip title={`Delete all ${statusCounts.skipped} skipped files from database`}>
            <Button
              variant="outlined"
              color="error"
              size="small"
              startIcon={<DeleteSweepIcon />}
              onClick={() => setBulkDeleteDialogOpen(true)}
              disabled={bulkDeleteLoading}
              sx={{
                borderRadius: 2,
                px: 2,
                py: 0.5,
                fontWeight: 600,
                textTransform: 'none',
                fontSize: '0.75rem',
                minWidth: 'auto',
                border: '1px solid',
                borderColor: 'error.main',
                color: 'error.main',
                bgcolor: alpha(theme.palette.error.main, 0.05),
                ml: 2,
                '&:hover': {
                  bgcolor: alpha(theme.palette.error.main, 0.1),
                  borderColor: 'error.dark',
                  transform: 'translateY(-1px)',
                  boxShadow: `0 2px 8px ${alpha(theme.palette.error.main, 0.25)}`,
                },
                '&:disabled': {
                  bgcolor: alpha(theme.palette.error.main, 0.02),
                  borderColor: alpha(theme.palette.error.main, 0.3),
                  color: alpha(theme.palette.error.main, 0.5),
                },
              }}
            >
              {bulkDeleteLoading ? (
                <>
                  <CircularProgress size={14} sx={{ mr: 1 }} />
                  Deleting...
                </>
              ) : (
                `Delete All ${statusCounts.skipped}`
              )}
            </Button>
          </Tooltip>
        )}
      </Box>

      {/* Search Input for each tab */}
      <Box sx={{ mb: { xs: 2, sm: 3 }, px: { xs: 0, sm: 0 } }}>
        {tabValue === 0 ? (
          // Source Files Search
          <TextField
            fullWidth
            size={isMobile ? "medium" : "small"}
            placeholder={isMobile ? "🔍 Search files..." : "🔍 Search source files by name, path, or type..."}
            value={sourceSearchQuery}
            onChange={(e) => setSourceSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  {isSourceSearching ? (
                    <CircularProgress size={18} sx={{ color: 'primary.main' }} />
                  ) : (
                    <SearchIcon sx={{
                      color: sourceSearchQuery ? 'primary.main' : 'text.secondary',
                      fontSize: { xs: 18, sm: 20 },
                      transition: 'color 0.2s ease'
                    }} />
                  )}
                </InputAdornment>
              ),
              sx: {
                fontSize: { xs: '0.9rem', sm: '0.875rem' },
                height: { xs: 48, sm: 40 },
              }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: { xs: 2, sm: 3 },
                bgcolor: alpha(theme.palette.background.paper, 0.8),
                backdropFilter: 'blur(10px)',
                border: '1px solid',
                borderColor: sourceSearchQuery ? 'primary.main' : alpha(theme.palette.divider, 0.3),
                transition: 'all 0.3s ease',
                minHeight: { xs: 48, sm: 40 },
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'background.paper',
                  transform: isMobile ? 'none' : 'translateY(-1px)',
                  boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.15)}`,
                },
                '&.Mui-focused': {
                  borderColor: 'primary.main',
                  borderWidth: 2,
                  bgcolor: 'background.paper',
                  boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.2)}`,
                  transform: 'none',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  border: 'none',
                },
                '& .MuiInputBase-input': {
                  padding: { xs: '12px 14px', sm: '8.5px 14px' },
                  fontSize: { xs: '1rem', sm: '0.875rem' },
                  '&::placeholder': {
                    fontSize: { xs: '0.9rem', sm: '0.875rem' },
                    opacity: 0.7,
                  },
                },
              },
            }}
          />
        ) : (
          // File Operations Search
          <TextField
            fullWidth
            size={isMobile ? "medium" : "small"}
            placeholder={isMobile
              ? `🔍 Search ${['', 'created', 'failed', 'skipped', 'deleted'][tabValue]}...`
              : `🔍 Search ${['', 'created', 'failed', 'skipped', 'deleted'][tabValue]} operations by filename, path, or error message...`
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  {isSearching ? (
                    <CircularProgress size={18} sx={{ color: 'primary.main' }} />
                  ) : (
                    <SearchIcon sx={{
                      color: searchQuery ? 'primary.main' : 'text.secondary',
                      fontSize: { xs: 18, sm: 20 },
                      transition: 'color 0.2s ease'
                    }} />
                  )}
                </InputAdornment>
              ),
              sx: {
                fontSize: { xs: '0.9rem', sm: '0.875rem' },
                height: { xs: 48, sm: 40 },
              }
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: { xs: 2, sm: 3 },
                bgcolor: alpha(theme.palette.background.paper, 0.8),
                backdropFilter: 'blur(10px)',
                border: '1px solid',
                borderColor: searchQuery ? 'primary.main' : alpha(theme.palette.divider, 0.3),
                transition: 'all 0.3s ease',
                minHeight: { xs: 48, sm: 40 },
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'background.paper',
                  transform: isMobile ? 'none' : 'translateY(-1px)',
                  boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.15)}`,
                },
                '&.Mui-focused': {
                  borderColor: 'primary.main',
                  borderWidth: 2,
                  bgcolor: 'background.paper',
                  boxShadow: `0 4px 20px ${alpha(theme.palette.primary.main, 0.2)}`,
                  transform: 'none',
                },
                '& .MuiOutlinedInput-notchedOutline': {
                  border: 'none',
                },
                '& .MuiInputBase-input': {
                  padding: { xs: '12px 14px', sm: '8.5px 14px' },
                  fontSize: { xs: '1rem', sm: '0.875rem' },
                  '&::placeholder': {
                    fontSize: { xs: '0.9rem', sm: '0.875rem' },
                    opacity: 0.7,
                  },
                },
              },
            }}
          />
        )}

        {/* Search results count for mobile */}
        {isMobile && (searchQuery || sourceSearchQuery) && (
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'center' }}>
            <Chip
              size="small"
              label={
                tabValue === 0
                  ? `${filteredSourceFiles.length} files found`
                  : `${operations.length} operations found`
              }
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.1),
                color: 'primary.main',
                fontSize: '0.75rem',
                height: 24,
              }}
            />
          </Box>
        )}
      </Box>

      {/* Tab Panels */}
      <TabPanel value={tabValue} index={0}>
        {/* Modern Source File Browser with Card Layout */}
        <Box sx={{ px: { xs: 0, sm: 1, md: 2 } }}>

          {/* Loading state */}
          {sourceLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
              <CircularProgress />
            </Box>
          )}

          {/* Error state */}
          {sourceError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {sourceError}
            </Alert>
          )}

          {/* File Cards */}
          {!sourceLoading && !sourceError && (
            <>
              {sourceFiles.length === 0 ? (
                <Box
                  sx={{
                    textAlign: 'center',
                    py: { xs: 6, sm: 8 },
                    px: { xs: 3, sm: 4 },
                    bgcolor: hasSourceDirectories !== false
                      ? `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.05)} 0%, ${alpha(theme.palette.success.light, 0.02)} 100%)`
                      : 'background.paper',
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: hasSourceDirectories !== false
                      ? alpha(theme.palette.success.main, 0.2)
                      : 'divider',
                    position: 'relative',
                    overflow: 'hidden',
                    '&::before': hasSourceDirectories !== false ? {
                      content: '""',
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: `radial-gradient(circle at 30% 20%, ${alpha(theme.palette.success.main, 0.1)} 0%, transparent 50%)`,
                      pointerEvents: 'none',
                    } : {},
                  }}
                >
                  {/* Icon based on state */}
                  <Box sx={{ mb: 3 }}>
                    {hasSourceDirectories === false ? (
                      <Box sx={{
                        p: 2,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.warning.main, 0.1),
                        border: `2px solid ${alpha(theme.palette.warning.main, 0.3)}`,
                        display: 'inline-flex'
                      }}>
                        <SettingsIcon sx={{ fontSize: 48, color: 'warning.main' }} />
                      </Box>
                    ) : (
                      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                        <Box sx={{
                          p: 2,
                          borderRadius: '50%',
                          bgcolor: alpha(theme.palette.success.main, 0.15),
                          border: `3px solid ${alpha(theme.palette.success.main, 0.4)}`,
                          display: 'inline-flex',
                          animation: 'celebrate 3s ease-in-out infinite',
                          '@keyframes celebrate': {
                            '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
                            '25%': { transform: 'scale(1.05) rotate(2deg)' },
                            '75%': { transform: 'scale(1.05) rotate(-2deg)' },
                          },
                        }}>
                          <LinkIcon sx={{ fontSize: 48, color: 'success.main' }} />
                        </Box>
                        {/* Floating particles effect */}
                        <Box
                          sx={{
                            position: 'absolute',
                            top: -10,
                            right: -5,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: 'success.light',
                            animation: 'float1 2s ease-in-out infinite',
                            '@keyframes float1': {
                              '0%, 100%': { transform: 'translateY(0px) scale(1)', opacity: 0.7 },
                              '50%': { transform: 'translateY(-10px) scale(1.2)', opacity: 1 },
                            },
                          }}
                        />
                        <Box
                          sx={{
                            position: 'absolute',
                            bottom: -5,
                            left: -10,
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: 'success.main',
                            animation: 'float2 2.5s ease-in-out infinite',
                            '@keyframes float2': {
                              '0%, 100%': { transform: 'translateY(0px) scale(1)', opacity: 0.5 },
                              '50%': { transform: 'translateY(-15px) scale(1.3)', opacity: 1 },
                            },
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  <Typography variant="h5" sx={{
                    mb: 2,
                    fontSize: { xs: '1.25rem', sm: '1.5rem' },
                    fontWeight: 600,
                    color: hasSourceDirectories === false ? 'text.secondary' : 'success.main'
                  }}>
                    {hasSourceDirectories === false
                      ? '🔧 No Source Directories Configured'
                      : '🎉 All Source Files Tracked & Symlinked!'}
                  </Typography>
                  <Typography variant="body1" color="text.secondary" sx={{
                    fontSize: { xs: '0.9rem', sm: '1rem' },
                    lineHeight: 1.6,
                    maxWidth: 500,
                    mx: 'auto',
                    mb: 1
                  }}>
                    {hasSourceDirectories === false
                      ? 'Please configure SOURCE_DIR in your environment settings to start organizing your media files.'
                      : 'Perfect! All media files in your source directories have been successfully tracked and symlinked to your organized media library.'}
                  </Typography>
                  {hasSourceDirectories !== false && (
                    <Typography variant="body2" color="text.secondary" sx={{
                      fontSize: { xs: '0.8rem', sm: '0.875rem' },
                      lineHeight: 1.5,
                      maxWidth: 450,
                      mx: 'auto',
                      fontStyle: 'italic',
                      opacity: 0.8
                    }}>
                      Your original files remain in the source directories, while organized symlinks are available in your media library.
                    </Typography>
                  )}
                  {hasSourceDirectories !== false && (
                    <Box sx={{ mt: 3 }}>
                      <Box sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 1,
                        px: 3,
                        py: 1.5,
                        borderRadius: 3,
                        bgcolor: alpha(theme.palette.success.main, 0.1),
                        border: `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
                      }}>
                        <LinkIcon sx={{ fontSize: 20, color: 'success.main' }} />
                        <Typography variant="body1" color="success.main" sx={{
                          fontSize: { xs: '0.9rem', sm: '1rem' },
                          fontWeight: 600
                        }}>
                          {sourceTotalFiles > 0
                            ? `${sourceTotalFiles.toLocaleString()} files tracked & symlinked`
                            : 'All source files tracked & symlinked'}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{
                        mt: 2,
                        fontSize: { xs: '0.8rem', sm: '0.875rem' },
                        fontStyle: 'italic'
                      }}>
                        Your media library is fully organized and up to date!
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <>
                  {/* Processing animations */}
                  <AnimatePresence>
                    {Array.from(processingFiles.entries()).map(([filePath, fileData]) => (
                      <Box key={`processing-${filePath}`} sx={{ mb: 1.5 }}>
                        <ProcessingAnimation
                          fileName={fileData.fileName}
                          mediaName={fileData.mediaName}
                          mediaType={fileData.mediaType}
                          onComplete={() => {
                            setProcessingFiles(prev => {
                              const newMap = new Map(prev);
                              newMap.delete(filePath);
                              return newMap;
                            });
                          }}
                          duration={3000}
                        />
                      </Box>
                    ))}
                  </AnimatePresence>

                  {/* Source files list */}
                  <AnimatePresence>
                    {filteredSourceFiles.map((file, _index) => (
                    <Card
                      key={file.name}
                      sx={{
                        mb: 1.5,
                        borderRadius: 3,
                        border: '1px solid',
                        borderColor: getProcessingStatus(file)?.status === 'processed' || getProcessingStatus(file)?.status === 'created'
                          ? alpha(theme.palette.success.main, 0.3)
                          : 'divider',
                        bgcolor: 'background.paper',
                        overflow: 'hidden',
                        cursor: file.type === 'directory' || file.isSourceRoot ? 'pointer' : 'default',
                        '&:hover': {
                          borderColor: getProcessingStatus(file)?.status === 'processed' || getProcessingStatus(file)?.status === 'created'
                            ? alpha(theme.palette.success.main, 0.5)
                            : 'primary.main',
                          transform: 'translateY(-2px)',
                          boxShadow: getProcessingStatus(file)?.status === 'processed' || getProcessingStatus(file)?.status === 'created'
                            ? `0 4px 20px ${alpha(theme.palette.success.main, 0.15)}`
                            : '0 8px 25px rgba(0, 0, 0, 0.15)',
                        },
                        transition: 'all 0.3s ease',
                      }}
                      onClick={() => handleSourceFileClick(file)}
                    >
                      <CardContent sx={{ p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
                        <Box sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, minWidth: 0, flex: 1 }}>
                            <Box sx={{
                              p: { xs: 0.75, sm: 1 },
                              borderRadius: 2,
                              bgcolor: alpha(
                                file.isSourceRoot ? theme.palette.primary.main :
                                file.type === 'directory' ? theme.palette.warning.main :
                                file.isMediaFile ? (getProcessingStatus(file)?.status === 'processed' || getProcessingStatus(file)?.status === 'created'
                                  ? theme.palette.success.main
                                  : theme.palette.info.main) :
                                theme.palette.grey[500], 0.1
                              ),
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}>
                              {getFileIcon(file)}
                            </Box>
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              <Typography variant="body2" fontWeight="600" sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                color: file.isSourceRoot ? 'primary.main' : 'text.primary',
                                mb: 0.5,
                                fontSize: { xs: '0.875rem', sm: '1rem' },
                              }}>
                                {file.name}
                              </Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, flexWrap: 'wrap' }}>
                                {getFileTypeChip(file)}
                                {getProcessingStatusChip(file) && (
                                  <Tooltip title={getStatusTooltip(file)} arrow placement="top">
                                    <Box>{getProcessingStatusChip(file)}</Box>
                                  </Tooltip>
                                )}
                                {!getProcessingStatusChip(file) && file.isMediaFile && (
                                  <Tooltip title="This file has not been processed yet" arrow placement="top">
                                    <Box>{getProcessingStatusChip(file)}</Box>
                                  </Tooltip>
                                )}
                                {file.type === 'directory' && !file.isSourceRoot && (
                                  <Chip
                                    label="Folder"
                                    size="small"
                                    color="warning"
                                    variant="outlined"
                                    icon={<FolderIcon />}
                                    sx={{
                                      borderRadius: 2,
                                      fontWeight: 500,
                                      fontSize: { xs: '0.7rem', sm: '0.75rem' },
                                    }}
                                  />
                                )}
                              </Box>

                              {/* File details */}
                              <Stack direction="row" spacing={{ xs: 1, sm: 2 }} sx={{ mt: { xs: 0.5, sm: 1 }, flexWrap: 'wrap', gap: { xs: 0.5, sm: 1 } }}>
                                {file.isSourceRoot && file.path && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <InfoIcon sx={{ fontSize: { xs: 10, sm: 12 }, color: 'text.secondary' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                                      {file.path}
                                    </Typography>
                                  </Box>
                                )}
                                {file.size && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <DatabaseIcon sx={{ fontSize: { xs: 10, sm: 12 }, color: 'text.secondary' }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                                      {file.size}
                                    </Typography>
                                  </Box>
                                )}
                                {file.modified && (
                                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                                    Modified: {new Date(file.modified).toLocaleDateString()}
                                  </Typography>
                                )}
                                {file.isMediaFile && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <PlayCircleIcon sx={{ fontSize: { xs: 10, sm: 12 }, color: 'success.main' }} />
                                    <Typography variant="caption" color="success.main" sx={{ fontWeight: 500, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                                      Original Media File
                                    </Typography>
                                  </Box>
                                )}
                              </Stack>
                            </Box>
                          </Box>

                          {/* Action buttons for media files */}
                          {file.isMediaFile && (
                            <Box sx={{ display: 'flex', gap: 1, ml: 2 }}>
                              <Tooltip title="Process File">
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleProcessFile(file);
                                  }}
                                  sx={{
                                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                                    color: 'primary.main',
                                    '&:hover': {
                                      bgcolor: alpha(theme.palette.primary.main, 0.2),
                                      transform: 'scale(1.1)',
                                    },
                                    transition: 'all 0.2s ease'
                                  }}
                                >
                                  <SettingsIcon sx={{ fontSize: 18 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                    ))}
                  </AnimatePresence>
                </>
              )}
            </>
          )}

          {/* Pagination */}
          {sourceTotalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
              <Pagination
                count={sourceTotalPages}
                page={sourcePage}
                onChange={(_, newPage) => setSourcePage(newPage)}
                color="primary"
                size={isMobile ? "small" : "medium"}
                siblingCount={isMobile ? 0 : 1}
                boundaryCount={isMobile ? 1 : 1}
                sx={{
                  '& .MuiPaginationItem-root': {
                    borderRadius: 2,
                    fontSize: { xs: '0.75rem', sm: '0.875rem' },
                    minWidth: { xs: 28, sm: 32 },
                    height: { xs: 28, sm: 32 },
                  },
                  '& .MuiPagination-ul': {
                    gap: { xs: 0.25, sm: 0.5 }
                  }
                }}
              />
            </Box>
          )}

          {/* Summary */}
          {filteredSourceFiles.length > 0 && (
            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 3 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  whiteSpace: { xs: 'normal', sm: 'nowrap' },
                  textAlign: 'center',
                  fontSize: { xs: '0.75rem', sm: '0.875rem' }
                }}
              >
                Showing {filteredSourceFiles.length} of {sourceTotalFiles.toLocaleString()} items
                {sourceSearchQuery && ` (filtered)`}
              </Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      {tabValue === 1 && (
        <TabPanel value={tabValue} index={1}>
          {renderFileTable(operations, searchQuery ? 'No created files match your search' : 'No files created yet')}
        </TabPanel>
      )}

      {tabValue === 2 && (
        <TabPanel value={tabValue} index={2}>
          {renderFileTable(operations, searchQuery ? 'No failed operations match your search' : 'No failed file operations')}
        </TabPanel>
      )}

      {tabValue === 3 && (
        <TabPanel value={tabValue} index={3}>
          {renderFileTable(operations, searchQuery ? 'No skipped files match your search' : 'No skipped files')}
        </TabPanel>
      )}

      {tabValue === 4 && (
        <TabPanel value={tabValue} index={4}>
          {renderFileTable(operations, searchQuery ? 'No deleted files match your search' : 'No deleted files')}
        </TabPanel>
      )}

      {/* Pagination and Summary for Operations */}
      <Box sx={{
        mt: 3,
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'center',
        alignItems: 'center',
        gap: { xs: 2, sm: 3 }
      }}>
        {Math.ceil(totalOperations / recordsPerPage) > 1 && (
          <Pagination
            count={Math.ceil(totalOperations / recordsPerPage)}
            page={currentPage}
            onChange={(_, page) => setCurrentPage(page)}
            color="primary"
            size={isMobile ? "small" : "medium"}
            siblingCount={isMobile ? 0 : 1}
            boundaryCount={isMobile ? 1 : 1}
            sx={{
              '& .MuiPaginationItem-root': {
                borderRadius: 2,
                fontSize: { xs: '0.75rem', sm: '0.875rem' },
                minWidth: { xs: 28, sm: 32 },
                height: { xs: 28, sm: 32 },
              },
              '& .MuiPagination-ul': {
                gap: { xs: 0.25, sm: 0.5 }
              }
            }}
          />
        )}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            whiteSpace: { xs: 'normal', sm: 'nowrap' },
            textAlign: 'center',
            fontSize: { xs: '0.75rem', sm: '0.875rem' }
          }}
        >
          Showing {operations.length} of {totalOperations.toLocaleString()} operations
          {searchQuery && ` (filtered)`}
        </Typography>
      </Box>

          {/* Mobile Floating Action Buttons for Operations */}
          {isMobile && (
            <>
              {/* Bulk Delete FAB for Skipped Files on Mobile */}
              {mainTabValue === 0 && tabValue === 3 && statusCounts.skipped > 0 && (
                <MotionFab
                  color="error"
                  aria-label="delete all skipped"
                  onClick={() => setBulkDeleteDialogOpen(true)}
                  disabled={bulkDeleteLoading}
                  sx={{
                    position: 'fixed',
                    bottom: 24,
                    right: 88, // Position to the left of refresh button
                    zIndex: 1000,
                    background: 'linear-gradient(45deg, #ef4444 30%, #dc2626 90%)',
                    boxShadow: '0 8px 16px 0 rgba(239, 68, 68, 0.3)',
                    '&:hover': {
                      background: 'linear-gradient(45deg, #dc2626 30%, #b91c1c 90%)',
                      boxShadow: '0 12px 20px 0 rgba(239, 68, 68, 0.4)',
                    },
                    '&:disabled': {
                      background: 'rgba(239, 68, 68, 0.3)',
                    },
                  }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                >
                  {bulkDeleteLoading ? (
                    <CircularProgress size={24} sx={{ color: 'white' }} />
                  ) : (
                    <DeleteSweepIcon sx={{ fontSize: 24 }} />
                  )}
                </MotionFab>
              )}

              {/* Refresh FAB */}
              <MotionFab
                color="primary"
                aria-label="refresh"
                onClick={() => fetchFileOperations(true)}
                disabled={loading}
                sx={{
                  position: 'fixed',
                  bottom: 24,
                  right: 24,
                  zIndex: 1000,
                  background: 'linear-gradient(45deg, #6366F1 30%, #8B5CF6 90%)',
                  boxShadow: '0 8px 16px 0 rgba(99, 102, 241, 0.3)',
                  '&:hover': {
                    background: 'linear-gradient(45deg, #5B5FE8 30%, #7C3AED 90%)',
                    boxShadow: '0 12px 20px 0 rgba(99, 102, 241, 0.4)',
                  },
                  '&:disabled': {
                    background: 'rgba(99, 102, 241, 0.3)',
                  },
                }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                <RefreshIcon sx={{
                  fontSize: 24,
                  animation: loading ? 'spin 1s linear infinite' : 'none',
                  '@keyframes spin': {
                    '0%': { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }} />
              </MotionFab>
            </>
          )}
        </>
      )}

      {/* Database Tab Content */}
      {mainTabValue === 1 && (
        <DatabaseSearch />
      )}

      {/* ModifyDialog for file processing */}
      {modifyDialogOpen && (
        <ModifyDialog
          open={modifyDialogOpen}
          onClose={handleModifyDialogClose}
          currentFilePath={currentFileForProcessing}
          useManualSearch={tabValue === 2}
          onNavigateBack={() => {
          }}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog
        open={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 3,
            backgroundColor: theme.palette.background.paper,
            background: theme.palette.mode === 'dark'
              ? `linear-gradient(135deg, ${theme.palette.background.paper} 0%, rgba(239, 68, 68, 0.08) 100%)`
              : `linear-gradient(135deg, #ffffff 0%, #fef2f2 100%)`,
            border: theme.palette.mode === 'dark'
              ? `2px solid ${theme.palette.error.main}40`
              : `2px solid #fecaca`,
            boxShadow: theme.palette.mode === 'dark'
              ? '0 8px 32px rgba(0, 0, 0, 0.6)'
              : '0 8px 32px rgba(0, 0, 0, 0.15)',
            backdropFilter: 'blur(10px)',
          }
        }}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: theme.palette.mode === 'dark'
                ? 'rgba(0, 0, 0, 0.7)'
                : 'rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(4px)',
            }
          }
        }}
      >
        <DialogTitle sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          color: 'error.main',
          fontWeight: 600,
          backgroundColor: theme.palette.mode === 'dark'
            ? 'rgba(239, 68, 68, 0.15)'
            : '#fef2f2',
          borderBottom: theme.palette.mode === 'dark'
            ? `2px solid ${theme.palette.error.main}60`
            : `2px solid #fecaca`,
        }}>
          <DeleteSweepIcon />
          Delete All Skipped Files
        </DialogTitle>
        <DialogContent sx={{
          background: 'transparent',
        }}>
          <DialogContentText sx={{ mb: 2, color: 'text.primary' }}>
            Are you sure you want to delete all <strong>{statusCounts.skipped}</strong> skipped files from the database?
          </DialogContentText>
          <DialogContentText sx={{
            color: 'text.primary',
            fontSize: '0.875rem',
            bgcolor: theme.palette.mode === 'dark'
              ? alpha(theme.palette.background.default, 0.5)
              : '#f9fafb',
            p: 2,
            borderRadius: 2,
            borderLeft: theme.palette.mode === 'dark'
              ? `4px solid ${theme.palette.error.main}`
              : `4px solid #f87171`,
            backdropFilter: 'blur(10px)',
          }}>
            This action will permanently remove all skipped file records from the database.
            The original files will remain untouched in their source locations.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{
          p: 3,
          pt: 1,
          gap: 1,
          background: theme.palette.mode === 'dark'
            ? alpha(theme.palette.background.default, 0.3)
            : '#f9fafb',
          backdropFilter: 'blur(10px)',
        }}>
          <Button
            onClick={() => setBulkDeleteDialogOpen(false)}
            disabled={bulkDeleteLoading}
            sx={{ textTransform: 'none' }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleBulkDeleteSkippedFiles}
            color="error"
            variant="contained"
            disabled={bulkDeleteLoading}
            startIcon={bulkDeleteLoading ? <CircularProgress size={16} /> : <DeleteSweepIcon />}
            sx={{
              textTransform: 'none',
              fontWeight: 600,
              borderRadius: 2,
              ...(theme.palette.mode === 'light' && {
                bgcolor: '#ef4444',
                color: '#ffffff',
                border: 'none',
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: '#dc2626',
                  border: 'none',
                  boxShadow: 'none',
                },
                '&:disabled': {
                  bgcolor: alpha('#ef4444', 0.3),
                  color: alpha('#ffffff', 0.7),
                  border: 'none',
                  boxShadow: 'none',
                },
              })
            }}
          >
            {bulkDeleteLoading ? 'Deleting...' : 'Delete All'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export { FileOperations };
export default FileOperations;
