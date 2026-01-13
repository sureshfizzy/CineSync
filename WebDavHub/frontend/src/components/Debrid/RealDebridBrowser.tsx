import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, IconButton, InputBase, Tooltip, Chip, CircularProgress, Pagination, Skeleton, alpha, useTheme, Menu, MenuItem, ListItemIcon, ListItemText, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, Snackbar, Alert } from '@mui/material';
import { motion } from 'framer-motion';
import { Search as SearchIcon, Refresh as RefreshIcon, CloudDownload, PlayArrow, Delete as DeleteIcon, RestartAlt, MoreVert, Schedule, Storage as StorageIcon, CheckCircle, Error as ErrorIcon, HourglassEmpty, CloudSync, Pending, Warning, ContentCopy, OpenInNew, ArrowUpward, ArrowDownward, Folder, Movie, Tv } from '@mui/icons-material';
import axios from 'axios';
import './RealDebridBrowser.css';

interface TorrentFile {
  name: string;
  path: string;
  fullPath: string;
  size: number;
  sizeFormatted: string;
  modified: string;
  status: string;
  files: number;
  id: string;
  link?: string;
}

interface StreamableFile {
  name: string;
  size: number;
  link: string;
}

type SortKey = 'name' | 'size' | 'modified' | 'status';
type SortDirection = 'asc' | 'desc';

interface SortOption {
  key: SortKey;
  direction: SortDirection;
}

const ITEMS_PER_PAGE = 100;

const getStatusConfig = (status: string) => {
  const statusLower = status?.toLowerCase() || '';
  
  switch (statusLower) {
    case 'downloaded':
    case 'completed':
      return { 
        icon: CheckCircle, 
        color: '#10b981', 
        label: 'Downloaded',
        bgColor: 'rgba(16, 185, 129, 0.1)',
      };
    case 'downloading':
      return { 
        icon: CloudSync, 
        color: '#3b82f6', 
        label: 'Downloading',
        bgColor: 'rgba(59, 130, 246, 0.1)',
      };
    case 'queued':
    case 'waiting_files_selection':
      return { 
        icon: HourglassEmpty, 
        color: '#f59e0b', 
        label: 'Queued',
        bgColor: 'rgba(245, 158, 11, 0.1)',
      };
    case 'error':
    case 'dead':
    case 'virus':
      return { 
        icon: ErrorIcon, 
        color: '#ef4444', 
        label: 'Error',
        bgColor: 'rgba(239, 68, 68, 0.1)',
      };
    case 'magnet_error':
      return { 
        icon: Warning, 
        color: '#f97316', 
        label: 'Magnet Error',
        bgColor: 'rgba(249, 115, 22, 0.1)',
      };
    case 'compressing':
    case 'uploading':
      return { 
        icon: CloudSync, 
        color: '#8b5cf6', 
        label: status.charAt(0).toUpperCase() + status.slice(1),
        bgColor: 'rgba(139, 92, 246, 0.1)',
      };
    default:
      return { 
        icon: Pending, 
        color: '#6b7280', 
        label: status || 'Unknown',
        bgColor: 'rgba(107, 114, 128, 0.1)',
      };
  }
};

// Detect if name is likely a TV show or movie
const getMediaType = (name: string) => {
  const isTvShow = /s\d{1,2}e\d{1,2}|season|episode|\d{1,2}x\d{2}/i.test(name);
  return isTvShow ? 'tv' : 'movie';
};

// Extract quality tag from name
const getQualityTag = (name: string): string | null => {
  const match = name.match(/\b(2160p|4K|UHD|1080p|720p|480p|REMUX|HDR|DV|Atmos)\b/i);
  return match ? match[1].toUpperCase() : null;
};

// Format bytes helper
const formatBytes = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format relative date
const formatRelativeDate = (dateStr: string): string => {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined });
};

// Format full date for tooltip
const formatFullDate = (dateStr: string): string => {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    weekday: 'short',
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Torrent row component
const TorrentRow: React.FC<{
  torrent: TorrentFile;
  index: number;
  onPlay: (torrent: TorrentFile) => void;
  onDelete: (torrent: TorrentFile) => void;
  onReinsert: (torrent: TorrentFile) => void;
  onCopyLink: (link: string) => void;
}> = ({ torrent, index, onPlay, onDelete, onReinsert, onCopyLink }) => {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  
  const statusConfig = getStatusConfig(torrent.status);
  const StatusIcon = statusConfig.icon;
  const mediaType = getMediaType(torrent.name);
  const MediaIcon = mediaType === 'tv' ? Tv : Movie;
  const qualityTag = getQualityTag(torrent.name);
  
  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };
  
  const handleMenuClose = () => {
    setAnchorEl(null);
  };
  
  const handleAction = (action: () => void) => {
    handleMenuClose();
    action();
  };
  
  const rowVariants = {
    hidden: { opacity: 0, x: -20 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        delay: index * 0.015,
        duration: 0.25,
        ease: "easeOut" as const,
      },
    },
  };
  
  const canPlay = torrent.status?.toLowerCase() === 'downloaded' || torrent.link;
  const canReinsert = ['error', 'dead', 'magnet_error', 'virus'].includes(torrent.status?.toLowerCase() || '');
  
  return (
    <motion.div
      variants={rowVariants}
      initial="hidden"
      animate="visible"
      className="rd-torrent-row"
    >
      {/* Media Type Icon */}
      <div className="rd-torrent-icon">
        <MediaIcon sx={{ fontSize: 24, color: mediaType === 'tv' ? '#a855f7' : '#ec4899' }} />
      </div>
      
      {/* Main Info */}
      <div className="rd-torrent-info">
        <Typography className="rd-torrent-name" title={torrent.name}>
          {torrent.name}
        </Typography>
        <div className="rd-torrent-meta">
          {/* Status Chip */}
          <Chip
            icon={<StatusIcon sx={{ fontSize: '14px !important' }} />}
            label={statusConfig.label}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: statusConfig.bgColor,
              color: statusConfig.color,
              border: `1px solid ${alpha(statusConfig.color, 0.3)}`,
              '& .MuiChip-icon': {
                color: statusConfig.color,
              },
            }}
          />
          
          {/* Size - shown inline on mobile */}
          <span className="rd-meta-item rd-meta-size">
            <StorageIcon sx={{ fontSize: 14 }} />
            {torrent.sizeFormatted || formatBytes(torrent.size)}
          </span>
          
          {/* Quality Tag */}
          {qualityTag && (
            <span className="rd-meta-item rd-meta-quality">{qualityTag}</span>
          )}
          
          {/* Files count */}
          {torrent.files > 1 && (
            <span className="rd-meta-item rd-meta-files">
              <Folder sx={{ fontSize: 14 }} />
              {torrent.files}
            </span>
          )}
        </div>
      </div>
      
      {/* Size */}
      <div className="rd-torrent-size">
        <StorageIcon sx={{ fontSize: 16 }} />
        <span>{torrent.sizeFormatted || formatBytes(torrent.size)}</span>
      </div>
      
      {/* Quality - Desktop Column */}
      <div className="rd-torrent-quality">
        {qualityTag ? (
          <span className="rd-quality-badge">{qualityTag}</span>
        ) : (
          <span className="rd-quality-na">--</span>
        )}
      </div>
      
      {/* Added Date */}
      <Tooltip title={formatFullDate(torrent.modified)} placement="top">
        <div className="rd-torrent-date">
          <Schedule sx={{ fontSize: 16 }} />
          <span>{formatRelativeDate(torrent.modified)}</span>
        </div>
      </Tooltip>
      
      {/* Quick Actions */}
      <div className="rd-torrent-actions">
        {canPlay && (
          <Tooltip title="Play / Stream">
            <IconButton 
              size="small" 
              onClick={() => onPlay(torrent)}
              className="rd-action-btn rd-play-btn"
            >
              <PlayArrow />
            </IconButton>
          </Tooltip>
        )}
        
        {canReinsert && (
          <Tooltip title="Reinsert Torrent">
            <IconButton 
              size="small" 
              onClick={() => onReinsert(torrent)}
              className="rd-action-btn rd-reinsert-btn"
            >
              <RestartAlt />
            </IconButton>
          </Tooltip>
        )}
        
        <Tooltip title="More Actions">
          <IconButton 
            size="small" 
            onClick={handleMenuClick}
            className="rd-action-btn"
          >
            <MoreVert />
          </IconButton>
        </Tooltip>
        
        <Menu
          anchorEl={anchorEl}
          open={menuOpen}
          onClose={handleMenuClose}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          PaperProps={{
            className: 'rd-menu',
          }}
        >
          {canPlay && (
            <MenuItem onClick={() => handleAction(() => onPlay(torrent))}>
              <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon>
              <ListItemText>Play / Stream</ListItemText>
            </MenuItem>
          )}
          {torrent.link && (
            <MenuItem onClick={() => handleAction(() => onCopyLink(torrent.link!))}>
              <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
              <ListItemText>Copy Link</ListItemText>
            </MenuItem>
          )}
          {torrent.link && (
            <MenuItem onClick={() => handleAction(() => window.open(torrent.link, '_blank'))}>
              <ListItemIcon><OpenInNew fontSize="small" /></ListItemIcon>
              <ListItemText>Open in Browser</ListItemText>
            </MenuItem>
          )}
          <MenuItem onClick={() => handleAction(() => onReinsert(torrent))}>
            <ListItemIcon><RestartAlt fontSize="small" /></ListItemIcon>
            <ListItemText>Reinsert / Repair</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleAction(() => onDelete(torrent))} sx={{ color: 'error.main' }}>
            <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        </Menu>
      </div>
    </motion.div>
  );
};

// Loading skeleton
const LoadingSkeleton: React.FC = () => (
  <Box className="rd-torrent-list">
    {[...Array(10)].map((_, i) => (
      <Box key={i} className="rd-torrent-row rd-skeleton">
        <Skeleton variant="circular" width={40} height={40} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Skeleton variant="text" width="70%" height={22} />
          <Skeleton variant="text" width="40%" height={18} />
        </Box>
        <Skeleton variant="text" width={80} height={20} />
        <Skeleton variant="text" width={70} height={20} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Skeleton variant="circular" width={32} height={32} />
          <Skeleton variant="circular" width={32} height={32} />
        </Box>
      </Box>
    ))}
  </Box>
);

// Empty state
const EmptyState: React.FC<{ search: string }> = ({ search }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="rd-empty-state"
  >
    <CloudDownload sx={{ fontSize: 80, opacity: 0.15, mb: 3 }} />
    <Typography variant="h5" sx={{ mb: 1, fontWeight: 700 }}>
      {search ? 'No results found' : 'No torrents yet'}
    </Typography>
    <Typography variant="body1" sx={{ opacity: 0.6, maxWidth: 400 }}>
      {search 
        ? `No torrents matching "${search}" were found in your Real-Debrid account.`
        : 'Your Real-Debrid torrents will appear here. Add some torrents to get started!'
      }
    </Typography>
  </motion.div>
);

export default function RealDebridBrowser() {
  const theme = useTheme();
  const [torrents, setTorrents] = useState<TorrentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [sortOption, setSortOption] = useState<SortOption>({ key: 'modified', direction: 'desc' });
  
  // Action states
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; torrent: TorrentFile | null }>({ open: false, torrent: null });
  const [reinsertDialog, setReinsertDialog] = useState<{ open: boolean; torrent: TorrentFile | null }>({ open: false, torrent: null });
  const [filePickerDialog, setFilePickerDialog] = useState<{ open: boolean; torrent: TorrentFile | null; files: StreamableFile[]; loading: boolean }>({ open: false, torrent: null, files: [], loading: false });
  const [actionLoading, setActionLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });
  
  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  
  // Load torrents - fetches ALL local data in a single request
  const loadTorrents = useCallback(async () => {
    setLoading(true);
    setError('');
    
    try {
      const res = await axios.get('/api/realdebrid/downloads');
      
      const allItems = res.data?.files || [];
      
      const mapped: TorrentFile[] = allItems.map((f: any) => ({
        name: f.name || f.filename || 'Unknown',
        path: f.path || `/torrents/${f.id}`,
        fullPath: f.path || `/torrents/${f.id}`,
        size: f.size || f.bytes || 0,
        sizeFormatted: formatBytes(f.size || f.bytes || 0),
        modified: f.modTime || f.added || f.created || new Date().toISOString(),
        status: f.status || 'downloaded',
        files: f.files || 0,
        id: f.id || f.path?.split('/').pop() || '',
        link: f.link || f.download || '',
      }));
      
      setTorrents(mapped);
      const calculatedPages = Math.max(1, Math.ceil(mapped.length / ITEMS_PER_PAGE));
      setTotalPages(calculatedPages);
      setPage(1);
      
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to load Real-Debrid torrents');
      setTorrents([]);
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Initial load
  useEffect(() => {
    loadTorrents();
  }, [loadTorrents]);
  
  // Filter, sort, and paginate torrents (client-side from prefetched data)
  const { displayedTorrents, filteredTotal } = useMemo(() => {
    let filtered = torrents;
    
    // Filter by search
    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      filtered = filtered.filter(t => t.name.toLowerCase().includes(searchLower));
    }
    
    // Sort
    filtered = [...filtered].sort((a, b) => {
      const dir = sortOption.direction === 'asc' ? 1 : -1;
      
      switch (sortOption.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'modified':
          return (new Date(a.modified).getTime() - new Date(b.modified).getTime()) * dir;
        case 'size':
          return (a.size - b.size) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        default:
          return 0;
      }
    });
    
    const filteredTotal = filtered.length;
    
    // Client-side pagination
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginated = filtered.slice(startIndex, endIndex);
    
    return { displayedTorrents: paginated, filteredTotal };
  }, [torrents, debouncedSearch, sortOption, page]);
  
  // Update total pages when filtered results change
  useEffect(() => {
    const newTotalPages = Math.max(1, Math.ceil(filteredTotal / ITEMS_PER_PAGE));
    setTotalPages(newTotalPages);
    // Reset to page 1 if current page exceeds new total
    if (page > newTotalPages) {
      setPage(1);
    }
  }, [filteredTotal, page]);
  
  // Action handlers
  const handlePlay = useCallback(async (torrent: TorrentFile) => {
    // Single file torrent - open directly if link available
    if (torrent.files <= 1 && torrent.link) {
      window.open(torrent.link, '_blank');
      return;
    }
    
    // Multi-file torrent or no link - fetch file list
    setFilePickerDialog({ open: true, torrent, files: [], loading: true });
    
    try {
      const res = await axios.get('/api/realdebrid/torrent-files', { params: { id: torrent.id } });
      const files: StreamableFile[] = (res.data?.files || []).filter((f: StreamableFile) => f.link);
      
      if (files.length === 0) {
        setFilePickerDialog({ open: false, torrent: null, files: [], loading: false });
        setSnackbar({ open: true, message: 'No playable links available for this torrent', severity: 'error' });
      } else if (files.length === 1) {
        // Only one playable file - open directly
        setFilePickerDialog({ open: false, torrent: null, files: [], loading: false });
        window.open(files[0].link, '_blank');
      } else {
        // Multiple files - show picker
        setFilePickerDialog({ open: true, torrent, files, loading: false });
      }
    } catch (e: any) {
      setFilePickerDialog({ open: false, torrent: null, files: [], loading: false });
      setSnackbar({ open: true, message: 'Failed to fetch file links', severity: 'error' });
    }
  }, []);
  
  const handleDelete = useCallback(async () => {
    if (!deleteDialog.torrent) return;
    
    setActionLoading(true);
    try {
      await axios.post('/api/realdebrid/repair/delete', {
        torrent_ids: [deleteDialog.torrent.id],
        delete_from_debrid: true,
      });
      
      setSnackbar({ open: true, message: 'Torrent deleted successfully', severity: 'success' });
      setDeleteDialog({ open: false, torrent: null });
      loadTorrents();
    } catch (e: any) {
      setSnackbar({ open: true, message: e.response?.data?.error || 'Failed to delete torrent', severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [deleteDialog.torrent, loadTorrents]);
  
  const handleReinsert = useCallback(async () => {
    if (!reinsertDialog.torrent) return;
    
    setActionLoading(true);
    try {
      await axios.post('/api/realdebrid/repair', {
        torrent_ids: [reinsertDialog.torrent.id],
      });
      
      setSnackbar({ open: true, message: 'Torrent reinsert initiated', severity: 'success' });
      setReinsertDialog({ open: false, torrent: null });
      // Refresh after a short delay to allow repair to process
      setTimeout(() => loadTorrents(), 2000);
    } catch (e: any) {
      setSnackbar({ open: true, message: e.response?.data?.error || 'Failed to reinsert torrent', severity: 'error' });
    } finally {
      setActionLoading(false);
    }
  }, [reinsertDialog.torrent, loadTorrents]);
  
  const handleCopyLink = useCallback((link: string) => {
    navigator.clipboard.writeText(link);
    setSnackbar({ open: true, message: 'Link copied to clipboard', severity: 'info' });
  }, []);
  
  const handleRefresh = useCallback(async () => {
    setSyncing(true);
    setError('');
    
    try {
      setSnackbar({ open: true, message: 'Syncing with Real-Debrid API...', severity: 'info' });
      await axios.post('/api/realdebrid/refresh-control', { action: 'force_refresh' }, { timeout: 300000 });
      setSnackbar({ open: true, message: 'Sync complete!', severity: 'success' });
      await loadTorrents();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Failed to sync with Real-Debrid');
      setSnackbar({ open: true, message: 'Failed to sync with Real-Debrid', severity: 'error' });
    } finally {
      setSyncing(false);
    }
  }, [loadTorrents]);
  
  const toggleSort = useCallback((key: SortKey) => {
    setSortOption(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  }, []);
  
  return (
    <Box className={`rd-browser ${theme.palette.mode}`}>
      {/* Header */}
      <motion.div 
        className="rd-header"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="rd-header-left">
          <div className="rd-logo">
            <CloudDownload sx={{ fontSize: 28 }} />
          </div>
          <div className="rd-header-text">
            <Typography variant="h5" className="rd-title">
              Real-Debrid Torrents
            </Typography>
            <Typography variant="body2" className="rd-subtitle">
              {torrents.length.toLocaleString()} torrents • Page {page} of {totalPages}
            </Typography>
          </div>
        </div>
        
        <div className="rd-header-right">
          {/* Search */}
          <div className="rd-search">
            <SearchIcon className="rd-search-icon" />
            <InputBase
              placeholder="Search torrents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rd-search-input"
            />
          </div>
          
          {/* Sort Buttons */}
          <div className="rd-sort-group">
            <Tooltip title={`Sort by Name (${sortOption.key === 'name' ? sortOption.direction : 'click to sort'})`}>
              <IconButton 
                onClick={() => toggleSort('name')}
                className={`rd-sort-btn ${sortOption.key === 'name' ? 'active' : ''}`}
              >
                <Typography variant="caption" sx={{ mr: 0.5, fontWeight: 600 }}>A-Z</Typography>
                {sortOption.key === 'name' && (sortOption.direction === 'asc' ? <ArrowUpward sx={{ fontSize: 14 }} /> : <ArrowDownward sx={{ fontSize: 14 }} />)}
              </IconButton>
            </Tooltip>
            <Tooltip title={`Sort by Date (${sortOption.key === 'modified' ? sortOption.direction : 'click to sort'})`}>
              <IconButton 
                onClick={() => toggleSort('modified')}
                className={`rd-sort-btn ${sortOption.key === 'modified' ? 'active' : ''}`}
              >
                <Schedule sx={{ fontSize: 18 }} />
                {sortOption.key === 'modified' && (sortOption.direction === 'asc' ? <ArrowUpward sx={{ fontSize: 14 }} /> : <ArrowDownward sx={{ fontSize: 14 }} />)}
              </IconButton>
            </Tooltip>
            <Tooltip title={`Sort by Size (${sortOption.key === 'size' ? sortOption.direction : 'click to sort'})`}>
              <IconButton 
                onClick={() => toggleSort('size')}
                className={`rd-sort-btn ${sortOption.key === 'size' ? 'active' : ''}`}
              >
                <StorageIcon sx={{ fontSize: 18 }} />
                {sortOption.key === 'size' && (sortOption.direction === 'asc' ? <ArrowUpward sx={{ fontSize: 14 }} /> : <ArrowDownward sx={{ fontSize: 14 }} />)}
              </IconButton>
            </Tooltip>
          </div>
          
          {/* Refresh */}
          <Tooltip title="Sync with Real-Debrid">
            <IconButton 
              onClick={handleRefresh} 
              className={`rd-refresh-btn ${(loading || syncing) ? 'rd-loading' : ''}`}
              disabled={loading || syncing}
            >
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </div>
      </motion.div>
      
      {/* Column Headers */}
      <div className="rd-list-header">
        <div className="rd-col-icon"></div>
        <div className="rd-col-name">NAME</div>
        <div className="rd-col-size">SIZE</div>
        <div className="rd-col-quality">QUALITY</div>
        <div className="rd-col-date">ADDED</div>
        <div className="rd-col-actions">ACTIONS</div>
      </div>
      
      {/* Content */}
      <div className="rd-content">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <Box className="rd-error">
            <ErrorIcon sx={{ fontSize: 48, color: 'error.main', mb: 2 }} />
            <Typography color="error" variant="h6">{error}</Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              onClick={handleRefresh} 
              sx={{ mt: 2 }}
              startIcon={<RefreshIcon />}
            >
              Retry
            </Button>
          </Box>
        ) : displayedTorrents.length === 0 ? (
          <EmptyState search={debouncedSearch} />
        ) : (
          <>
            <div className="rd-torrent-list">
              {displayedTorrents.map((torrent, index) => (
                <TorrentRow
                  key={torrent.id || torrent.name + index}
                  torrent={torrent}
                  index={index}
                  onPlay={handlePlay}
                  onDelete={(t) => setDeleteDialog({ open: true, torrent: t })}
                  onReinsert={(t) => setReinsertDialog({ open: true, torrent: t })}
                  onCopyLink={handleCopyLink}
                />
              ))}
            </div>
            
            {/* Pagination */}
            {totalPages > 1 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="rd-pagination"
              >
                <Pagination
                  count={totalPages}
                  page={page}
                  onChange={(_, value) => setPage(value)}
                  color="primary"
                  size="large"
                  showFirstButton
                  showLastButton
                />
              </motion.div>
            )}
          </>
        )}
      </div>
      
      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => !actionLoading && setDeleteDialog({ open: false, torrent: null })}
        PaperProps={{ className: 'rd-dialog' }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          <DeleteIcon sx={{ mr: 1, verticalAlign: 'middle', color: 'error.main' }} />
          Delete Torrent
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete "<strong>{deleteDialog.torrent?.name}</strong>"? 
            This will remove it from Real-Debrid and cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button 
            onClick={() => setDeleteDialog({ open: false, torrent: null })} 
            disabled={actionLoading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleDelete} 
            color="error" 
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : <DeleteIcon />}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Reinsert Confirmation Dialog */}
      <Dialog
        open={reinsertDialog.open}
        onClose={() => !actionLoading && setReinsertDialog({ open: false, torrent: null })}
        PaperProps={{ className: 'rd-dialog' }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          <RestartAlt sx={{ mr: 1, verticalAlign: 'middle', color: 'primary.main' }} />
          Reinsert Torrent
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will attempt to reinsert "<strong>{reinsertDialog.torrent?.name}</strong>" by re-adding 
            it to Real-Debrid. This is useful for fixing broken or dead torrents.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button 
            onClick={() => setReinsertDialog({ open: false, torrent: null })} 
            disabled={actionLoading}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleReinsert} 
            color="primary" 
            variant="contained"
            disabled={actionLoading}
            startIcon={actionLoading ? <CircularProgress size={16} /> : <RestartAlt />}
          >
            Reinsert
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* File Picker Dialog */}
      <Dialog
        open={filePickerDialog.open}
        onClose={() => !filePickerDialog.loading && setFilePickerDialog({ open: false, torrent: null, files: [], loading: false })}
        PaperProps={{ className: 'rd-dialog', sx: { minWidth: 500, maxWidth: 700 } }}
        maxWidth="md"
      >
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <PlayArrow sx={{ color: '#10b981' }} />
          Select File to Stream
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {filePickerDialog.loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
              <CircularProgress />
              <Typography sx={{ ml: 2, color: 'text.secondary' }}>Loading files...</Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
              {filePickerDialog.files.map((file, idx) => (
                <Box
                  key={idx}
                  onClick={() => {
                    window.open(file.link, '_blank');
                    setFilePickerDialog({ open: false, torrent: null, files: [], loading: false });
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    px: 3,
                    py: 1.5,
                    cursor: 'pointer',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <Movie sx={{ color: '#22d3ee', mr: 2, fontSize: 20 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {file.name.split('/').pop()}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {formatBytes(file.size)}
                    </Typography>
                  </Box>
                  <IconButton size="small" sx={{ color: '#10b981' }}>
                    <OpenInNew fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button 
            onClick={() => setFilePickerDialog({ open: false, torrent: null, files: [], loading: false })}
            disabled={filePickerDialog.loading}
          >
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar(s => ({ ...s, open: false }))} 
          severity={snackbar.severity}
          variant="filled"
          sx={{
            fontWeight: 600,
            ...(snackbar.severity === 'info' && {
              bgcolor: '#059669',
              color: '#fff',
            }),
            ...(snackbar.severity === 'success' && {
              bgcolor: '#10b981',
              color: '#fff',
            }),
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
