import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Breadcrumbs,
  Button,
  IconButton,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  CircularProgress,
  Menu,
  MenuItem,
  useMediaQuery,
  useTheme,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  TextField,
} from '@mui/material';
import {
  FolderOpen as FolderOpenIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  Movie as MovieIcon,
  Description as DescriptionIcon,
  NavigateBefore as UpIcon,
  Refresh as RefreshIcon,
  MoreVert as MoreVertIcon,
  ViewList as ViewListIcon,
  GridView as GridViewIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  Download as DownloadIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { format, parseISO } from 'date-fns';
import axios from 'axios';
import { useLayoutContext } from './Layout';
import VideoPlayerDialog from './VideoPlayerDialog';
import { searchTmdb, getTmdbPosterUrl, TmdbResult } from './tmdbApi';
import Skeleton from '@mui/material/Skeleton';
import { useAuth } from '../contexts/AuthContext';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  path?: string;
  webdavPath?: string;
  sourcePath?: string;
  fullPath?: string;
  isSeasonFolder?: boolean;
  hasSeasonFolders?: boolean;
}

interface MobileListItemProps {
  file: FileItem;
  onItemClick: () => void;
  onMenuClick: (event: React.MouseEvent<HTMLElement>) => void;
  formatDate: (date?: string) => string;
}

function MobileListItem({ file, onItemClick, onMenuClick, formatDate }: MobileListItemProps) {
  return (
    <Box
      onClick={onItemClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: file.type === 'directory' ? 'pointer' : 'default',
        '&:active': {
          bgcolor: 'action.selected',
        },
        bgcolor: 'background.paper',
        '&:hover': {
          bgcolor: 'action.hover',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
        <Box sx={{ mr: 2, display: 'flex', alignItems: 'center' }}>
          {getFileIcon(file.name, file.type)}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="body1"
            sx={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.type === 'directory' ? 'Folder' : `${file.size} • ${formatDate(file.modified)}`}
          </Typography>
        </Box>
      </Box>
      <IconButton 
        size="small" 
        onClick={onMenuClick}
        sx={{ 
          ml: 1,
          color: 'text.secondary',
          '&:hover': {
            color: 'text.primary',
            bgcolor: 'action.selected',
          },
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

function getFileIcon(name: string, type: string) {
  if (type === 'directory') return <FolderOpenIcon color="primary" />;
  const ext = name.split('.').pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext || "")) return <ImageIcon color="secondary" />;
  if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"].includes(ext || "")) return <MovieIcon color="action" />;
  if (["pdf", "doc", "docx", "txt", "md", "rtf"].includes(ext || "")) return <DescriptionIcon color="success" />;
  return <FileIcon color="disabled" />;
}

function joinPaths(...parts: string[]): string {
  // Joins path segments with a single slash, removes duplicate slashes
  return '/' + parts.map(p => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/') + '/';
}

// Add this new component for mobile breadcrumbs
function MobileBreadcrumbs({ currentPath, onPathClick }: { 
  currentPath: string;
  onPathClick: (path: string) => void;
}) {
  const pathParts = currentPath.split('/').filter(Boolean);
  const showBackOnly = pathParts.length > 2;

  if (showBackOnly) {
    // Show only current folder with back button
    return (
      <Box sx={{ 
        display: 'flex', 
        alignItems: 'center',
        minWidth: 0,
        width: '100%'
      }}>
        <Link
          component="button"
          variant="body1"
          onClick={() => {
            const parentPath = '/' + pathParts.slice(0, -1).join('/') + '/';
            onPathClick(parentPath);
          }}
          sx={{ 
            textDecoration: 'none',
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            mr: 1
          }}
        >
          <UpIcon sx={{ fontSize: 20 }} />
          {pathParts[pathParts.length - 2]}
        </Link>
        <Typography
          sx={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0
          }}
        >
          {pathParts[pathParts.length - 1]}
        </Typography>
      </Box>
    );
  }

  // Show full breadcrumbs for shorter paths
  return (
    <Breadcrumbs
      sx={{
        minWidth: 0,
        width: '100%',
        '& .MuiBreadcrumbs-ol': {
          flexWrap: 'nowrap',
          width: '100%',
        },
        '& .MuiBreadcrumbs-li': {
          minWidth: 0,
        }
      }}
    >
      <Link
        component="button"
        variant="body1"
        onClick={() => onPathClick('/')}
        sx={{ 
          textDecoration: 'none',
          fontSize: '1rem',
          fontWeight: 500,
          whiteSpace: 'nowrap'
        }}
      >
        Home
      </Link>
      {pathParts.map((part, index) => {
        const path = '/' + pathParts.slice(0, index + 1).join('/') + '/';
        return (
          <Typography
            key={path}
            component="button"
            onClick={() => onPathClick(path)}
            sx={{
              border: 'none',
              background: 'none',
              padding: 0,
              fontSize: '1rem',
              fontWeight: index === pathParts.length - 1 ? 500 : 400,
              color: index === pathParts.length - 1 ? 'text.primary' : 'primary.main',
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              maxWidth: '120px',
              textAlign: 'left',
              '&:hover': {
                textDecoration: index === pathParts.length - 1 ? 'none' : 'underline'
              }
            }}
          >
            {part}
          </Typography>
        );
      })}
    </Breadcrumbs>
  );
}

const TMDB_CONCURRENCY_LIMIT = 4;

export default function FileBrowser() {
  const navigate = useNavigate();
  const params = useParams();
  const { view, setView, handleRefresh } = useLayoutContext();
  // Get the wildcard path from the URL (e.g., /files/path/to/folder)
  const urlPath = params['*'] || '';
  const currentPath = '/' + urlPath;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuFile, setMenuFile] = useState<FileItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<FileItem | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [search, setSearch] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [videoPlayerOpen, setVideoPlayerOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoMimeType, setVideoMimeType] = useState('');
  const [tmdbData, setTmdbData] = useState<{ [key: string]: TmdbResult | null }>({});
  const tmdbFetchRef = useRef<{ [key: string]: boolean }>({});
  const allowedExtensions = (import.meta.env.VITE_ALLOWED_EXTENSIONS as string | undefined)?.split(',').map(ext => ext.trim().toLowerCase()).filter(Boolean) || [];
  const [folderHasAllowed, setFolderHasAllowed] = useState<{ [folder: string]: boolean }>({});
  const folderFetchRef = useRef<{ [folder: string]: boolean }>({});
  const [tvShowHasAllowed, setTvShowHasAllowed] = useState<{ [folder: string]: boolean }>({});
  const tvShowFetchRef = useRef<{ [folder: string]: boolean }>({});
  const [imgLoadedMap, setImgLoadedMap] = useState<{ [key: string]: boolean }>({});
  // TMDb lookup queue state
  const tmdbQueue = useRef<{ name: string; title: string; year?: string; mediaType?: 'movie' | 'tv' }[]>([]);
  const tmdbActive = useRef(0);
  const [tmdbQueueVersion, setTmdbQueueVersion] = useState(0); // force rerender/queue check
  const { isAuthenticated } = useAuth();

  // Helper to enqueue a TMDb lookup
  const enqueueTmdbLookup = useCallback((name: string, title: string, year: string | undefined, mediaType: 'movie' | 'tv' | undefined) => {
    tmdbQueue.current.push({ name, title, year, mediaType });
    setTmdbQueueVersion(v => v + 1); // trigger queue processing
  }, []);

  // TMDb queue processor
  useEffect(() => {
    if (tmdbActive.current >= TMDB_CONCURRENCY_LIMIT) return;
    if (tmdbQueue.current.length === 0) return;

    while (tmdbActive.current < TMDB_CONCURRENCY_LIMIT && tmdbQueue.current.length > 0) {
      const { name, title, year, mediaType } = tmdbQueue.current.shift()!;
      tmdbActive.current++;
      searchTmdb(title, year, mediaType).then(result => {
        setTmdbData(prev => ({ ...prev, [name]: result }));
      }).finally(() => {
        tmdbActive.current--;
        setTmdbQueueVersion(v => v + 1); // trigger next in queue
      });
    }
  }, [tmdbQueueVersion]);

  // Helper to check if a folder contains at least one allowed file
  function folderHasAllowedFile(folderName: string): boolean {
    // Find all files in the current folder
    return files.some(f => f.type === 'file' && f.name && f.name.startsWith(folderName) && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));
  }

  const fetchFiles = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`/api/files${path}`);
      setFiles(response.data);
    } catch (err) {
      setError('Failed to fetch files');
      console.error('Error fetching files:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles(currentPath);
  }, [currentPath]);

  const handlePathClick = (path: string) => {
    // Remove leading and trailing slashes for the URL
    const url = path.replace(/^\/+|\/+$/g, '');
    navigate(`/files/${url}`);
  };

  const handleUpClick = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const parentPath = '/' + parts.slice(0, -1).join('/') + '/';
    handlePathClick(parentPath);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, file: FileItem) => {
    setAnchorEl(event.currentTarget);
    setMenuFile(file);
  };
  const handleMenuClose = () => {
    setAnchorEl(null);
    setMenuFile(null);
  };

  const handleViewDetails = async () => {
    if (!menuFile) return;
    const webdavPath = `Home${currentPath}/${menuFile.name}`;
    const relPath = `${currentPath}/${menuFile.name}`;
    let realPath = '';
    let absPath = '';
    try {
      const res = await axios.post('/api/readlink', { path: relPath });
      realPath = res.data.realPath || '';
      absPath = res.data.absPath || '';
    } catch (e) {
      realPath = '';
      absPath = '';
    }
    setDetailsData({
      ...menuFile,
      webdavPath,
      fullPath: absPath,
      sourcePath: realPath,
    });
    setDetailsOpen(true);
    handleMenuClose();
  };
  const handleDetailsClose = () => setDetailsOpen(false);

  const handleOpen = async () => {
    if (!menuFile || menuFile.type === 'directory') {
      handleMenuClose();
      return;
    }
    // Build the file path
    const relPath = `${currentPath}/${menuFile.name}`;
    // Encode the path properly
    const encodedPath = encodeURIComponent(relPath.replace(/^\/+/, ''));
    // Guess file type
    const ext = menuFile.name.split('.').pop()?.toLowerCase();
    const isVideo = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext || '');
    const isPreviewable = [
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', // images
      'pdf', 'txt', 'md', 'rtf' // docs
    ].includes(ext || '');
    
    try {
      if (isVideo) {
        // For video files, use the streaming endpoint
        const streamUrl = `/api/stream/${encodedPath}`;
        setVideoUrl(streamUrl);
        setVideoTitle(menuFile.name);
        setVideoMimeType(getMimeType(ext || ''));
        setVideoPlayerOpen(true);
      } else if (isPreviewable) {
        const response = await axios.get(`/api/files/${encodedPath}`, {
          responseType: 'blob',
        });
        const blob = response.data;
        const blobUrl = window.URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener');
      } else {
        // fallback: download
        const response = await axios.get(`/api/files/${encodedPath}`, {
          responseType: 'blob',
        });
        const blob = response.data;
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', menuFile.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (err) {
      setError('Failed to open file');
      console.error('Error opening file:', err);
    }
    handleMenuClose();
  };

  const getMimeType = (ext: string): string => {
    const mimeTypes: { [key: string]: string } = {
      'mp4': 'video/mp4',
      'mkv': 'video/x-matroska',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'wmv': 'video/x-ms-wmv',
      'flv': 'video/x-flv',
      'webm': 'video/webm',
    };
    return mimeTypes[ext] || '';
  };

  const handleDownload = async () => {
    if (!menuFile || menuFile.type === 'directory') {
      handleMenuClose();
      return;
    }
    const relPath = `${currentPath}/${menuFile.name}`;
    const url = `/api/files${relPath}`;
    try {
      const response = await axios.get(url, {
        responseType: 'blob',
      });
      const blob = response.data;
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', menuFile.name);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to download file');
      console.error('Error downloading file:', err);
    }
    handleMenuClose();
  };

  const handleDelete = async () => {
    if (!fileToDelete) return;
    setDeleteError(null);
    const relPath = `${currentPath}/${fileToDelete.name}`;
    let absPath = '';
    try {
      const res = await axios.post('/api/readlink', { path: relPath });
      absPath = res.data.absPath || '';
    } catch (e) {
      setDeleteError('Failed to get file path');
      return;
    }

    if (!absPath) {
      setDeleteError('Could not determine file path');
      return;
    }

    try {
      const response = await axios.post('/api/delete', { path: relPath });
      await fetchFiles(currentPath);
      handleMenuClose();
      setDeleteConfirmOpen(false);
      setFileToDelete(null);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setDeleteError(error.response?.data || error.message);
      } else {
        setDeleteError('Failed to delete file');
      }
    }
  };

  const handleDeleteClick = () => {
    setDeleteError(null);
    setFileToDelete(menuFile);
    setDeleteConfirmOpen(true);
    handleMenuClose();
  };

  const handleDeleteConfirmClose = () => {
    setDeleteConfirmOpen(false);
    setDeleteError(null);
    setFileToDelete(null);
  };

  const handleRenameClick = () => {
    setRenameError(null);
    setRenameValue(menuFile?.name || '');
    setFileToRename(menuFile);
    setRenameDialogOpen(true);
    handleMenuClose();
  };

  const handleRenameDialogClose = () => {
    setRenameDialogOpen(false);
    setRenameError(null);
    setRenameValue('');
    setFileToRename(null);
    setRenameLoading(false);
  };

  const handleRenameSubmit = async () => {
    if (!fileToRename || !renameValue.trim() || renameValue === fileToRename.name) return;
    setRenameLoading(true);
    setRenameError(null);
    const relPath = `${currentPath}/${fileToRename.name}`;
    try {
      await axios.post('/api/rename', {
        oldPath: relPath,
        newName: renameValue.trim(),
      });
      await fetchFiles(currentPath);
      handleRenameDialogClose();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setRenameError(error.response?.data || error.message);
      } else {
        setRenameError('Failed to rename file');
      }
    } finally {
      setRenameLoading(false);
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, index) => {
    const path = '/' + pathParts.slice(0, index + 1).join('/') + '/';
    return (
      <Link
        key={path}
        component="button"
        variant="body1"
        onClick={() => handlePathClick(path)}
        sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
      >
        {part}
      </Link>
    );
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    try {
      return format(parseISO(dateStr), 'MMM d, yyyy, HH:mm');
    } catch {
      return dateStr;
    }
  };

  const filteredFiles = search.trim()
    ? files.filter(f => f.name.toLowerCase().includes(search.trim().toLowerCase()))
    : files;

  // Helper to parse title/year from folder name
  function parseTitleYearFromFolder(folderName: string): { title: string; year?: string } {
    // Try to extract year (e.g. Movie.Title.2023)
    const match = folderName.match(/(.+?)[. _\-\(\[]?(\d{4})[. _\-\)\]]?/);
    if (match) {
      return { title: match[1].replace(/[._-]/g, ' ').trim(), year: match[2] };
    }
    return { title: folderName.replace(/[._-]/g, ' ').trim() };
  }

  // For each folder in poster view, fetch its contents and check for allowed files
  useEffect(() => {
    if (view !== 'poster') return;
    filteredFiles.forEach(file => {
      if (
        file.type === 'directory' &&
        folderHasAllowed[file.name] === undefined &&
        !folderFetchRef.current[file.name]
      ) {
        folderFetchRef.current[file.name] = true;
        const folderApiPath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
        console.log(`[TMDB] Fetching contents for folder: ${folderApiPath}`);
        axios.get(`/api/files${folderApiPath}`)
          .then(res => {
            const hasAllowed = (res.data || []).some((f: any) =>
              f.type === 'file' && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
            );
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: hasAllowed }));
            if (hasAllowed) {
              console.log(`[TMDB] Folder '${file.name}' contains allowed files, will trigger TMDb search.`);
            } else {
              console.log(`[TMDB] Folder '${file.name}' does not contain allowed files.`);
            }
          })
          .catch(err => {
            setFolderHasAllowed(prev => ({ ...prev, [file.name]: false }));
            console.error(`[TMDB] Error fetching folder contents for '${file.name}':`, err);
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, view, currentPath, allowedExtensions]);

  // For folders with hasSeasonFolders, check all season subfolders for allowed files
  useEffect(() => {
    if (view !== 'poster') return;
    filteredFiles.forEach(file => {
      if (
        file.type === 'directory' &&
        file.hasSeasonFolders &&
        tvShowHasAllowed[file.name] === undefined &&
        !tvShowFetchRef.current[file.name]
      ) {
        tvShowFetchRef.current[file.name] = true;
        // Fetch the contents of the parent folder to get season subfolders
        const parentApiPath = currentPath.endsWith('/') ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
        console.log(`[TMDB] [TV] Fetching season folders for: ${parentApiPath}`);
        axios.get(`/api/files${parentApiPath}`)
          .then(res => {
            const seasonFolders = (res.data || []).filter((f: any) => f.type === 'directory' && f.isSeasonFolder);
            if (seasonFolders.length === 0) {
              setTvShowHasAllowed(prev => ({ ...prev, [file.name]: false }));
              console.log(`[TMDB] [TV] No season folders found in '${file.name}'.`);
              return;
            }
            // For each season folder, fetch its contents and check for allowed files
            let found = false;
            let checked = 0;
            seasonFolders.forEach((season: any) => {
              const seasonApiPath = `${parentApiPath}/${season.name}`;
              console.log(`[TMDB] [TV] Fetching contents for season: ${seasonApiPath}`);
              axios.get(`/api/files${seasonApiPath}`)
                .then(seasonRes => {
                  const hasAllowed = (seasonRes.data || []).some((f: any) =>
                    f.type === 'file' && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
                  );
                  if (hasAllowed) {
                    found = true;
                    setTvShowHasAllowed(prev => ({ ...prev, [file.name]: true }));
                    console.log(`[TMDB] [TV] Found allowed file in '${season.name}' for show '${file.name}'.`);
                  }
                  checked++;
                  if (checked === seasonFolders.length && !found) {
                    setTvShowHasAllowed(prev => ({ ...prev, [file.name]: false }));
                    console.log(`[TMDB] [TV] No allowed files found in any season for show '${file.name}'.`);
                  }
                })
                .catch(err => {
                  checked++;
                  if (checked === seasonFolders.length && !found) {
                    setTvShowHasAllowed(prev => ({ ...prev, [file.name]: false }));
                  }
                  console.error(`[TMDB] [TV] Error fetching season contents for '${season.name}' in show '${file.name}':`, err);
                });
            });
          })
          .catch(err => {
            setTvShowHasAllowed(prev => ({ ...prev, [file.name]: false }));
            console.error(`[TMDB] [TV] Error fetching season folders for '${file.name}':`, err);
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, view, currentPath, allowedExtensions]);

  // Instead of calling searchTmdb directly, enqueue lookups
  useEffect(() => {
    if (view !== 'poster') return;
    filteredFiles.forEach(file => {
      const isTvShow = file.hasSeasonFolders;
      const isSeasonFolder = file.isSeasonFolder;
      if (
        file.type === 'directory' &&
        !isSeasonFolder &&
        (
          (isTvShow && tvShowHasAllowed[file.name] && !tmdbData[file.name] && !tmdbFetchRef.current[file.name]) ||
          (!isTvShow && folderHasAllowed[file.name] && !tmdbData[file.name] && !tmdbFetchRef.current[file.name])
        )
      ) {
        const { title, year } = parseTitleYearFromFolder(file.name);
        tmdbFetchRef.current[file.name] = true;
        enqueueTmdbLookup(file.name, title, year, isTvShow ? 'tv' : undefined);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFiles, view, folderHasAllowed, tvShowHasAllowed]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Typography color="error" sx={{ mt: 2 }}>
        {error}
      </Typography>
    );
  }

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {isMobile ? (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center',
            width: '100%',
            minWidth: 0,
            px: 1
          }}>
            <MobileBreadcrumbs currentPath={currentPath} onPathClick={handlePathClick} />
          </Box>
        ) : (
          <>
            <Tooltip title="Up">
              <span>
                <IconButton onClick={handleUpClick} disabled={currentPath === '/'}>
                  <UpIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Breadcrumbs sx={{ flexGrow: 1, ml: 2 }}>
              <Link
                component="button"
                variant="body1"
                onClick={() => handlePathClick('/')}
                sx={{ textDecoration: 'none', fontSize: '1.1rem' }}
              >
                Home
              </Link>
              {breadcrumbs}
            </Breadcrumbs>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ minWidth: 220, maxWidth: 320 }}>
                <TextField
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search files and folders..."
                  size="small"
                  variant="outlined"
                  fullWidth
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
                    endAdornment: search && (
                      <IconButton size="small" onClick={() => setSearch('')}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    ),
                    sx: { borderRadius: 2, background: theme.palette.background.paper }
                  }}
                />
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title="Poster view">
                  <IconButton 
                    onClick={() => setView('poster')} 
                    color={view === 'poster' ? 'primary' : 'default'}
                  >
                    <GridViewIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="List view">
                  <IconButton 
                    onClick={() => setView('list')} 
                    color={view === 'list' ? 'primary' : 'default'}
                  >
                    <ViewListIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Refresh">
                  <IconButton onClick={handleRefresh} color="primary">
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </>
        )}
      </Box>

      {isMobile && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 1, maxWidth: 400 }}>
          <TextField
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files and folders..."
            size="small"
            variant="outlined"
            fullWidth
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
              endAdornment: search && (
                <IconButton size="small" onClick={() => setSearch('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              ),
              sx: { borderRadius: 2, background: theme.palette.background.paper }
            }}
          />
        </Box>
      )}

      {view === 'poster' ? (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            md: 'repeat(4, 1fr)',
            lg: 'repeat(5, 1fr)'
          },
          gap: 3,
          p: 1
        }}>
          {filteredFiles.length === 0 ? (
            <Box sx={{ gridColumn: '1/-1', textAlign: 'center', py: 6 }}>
              <Typography color="text.secondary">
                {search ? 'No files or folders match your search.' : 'This folder is empty.'}
              </Typography>
            </Box>
          ) : (
            filteredFiles.map((file) => {
              const tmdb = tmdbData[file.name];
              const isTvShow = file.hasSeasonFolders;
              const isSeasonFolder = file.isSeasonFolder;
              const showPoster = file.type === 'directory' && !isSeasonFolder && (
                (isTvShow && tvShowHasAllowed[file.name] && tmdb && tmdb.poster_path) ||
                (!isTvShow && folderHasAllowed[file.name] && tmdb && tmdb.poster_path)
              );
              const isLoadingPoster = file.type === 'directory' && !isSeasonFolder && (
                (isTvShow && tvShowHasAllowed[file.name] && !tmdb) ||
                (!isTvShow && folderHasAllowed[file.name] && !tmdb)
              );
              const loaded = imgLoadedMap[file.name] || false;
              return (
                <Paper
                  key={file.name}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: file.type === 'directory' ? 'pointer' : 'default',
                    transition: 'all 0.2s ease-in-out',
                    boxShadow: 2,
                    borderRadius: 3,
                    overflow: 'hidden',
                    position: 'relative',
                    '&:hover': {
                      transform: 'translateY(-4px)',
                      boxShadow: 6,
                      background: theme.palette.action.selected
                    }
                  }}
                  onClick={() => {
                    if (file.type === 'directory' && !isSeasonFolder && showPoster) {
                      const isTvShow = file.hasSeasonFolders;
                      const tmdbId = tmdb?.id;
                      navigate(`/media/${encodeURIComponent(file.name)}`, { state: { mediaType: isTvShow ? 'tv' : 'movie', tmdbId } });
                    } else if (file.type === 'directory') {
                      handlePathClick(joinPaths(currentPath, file.name));
                    }
                  }}
                >
                  <Box sx={{
                    width: '100%',
                    aspectRatio: '3/4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: theme.palette.background.default,
                    p: 2,
                    position: 'relative',
                  }}>
                    {isLoadingPoster ? (
                      <Skeleton variant="rectangular" width="100%" height="100%" animation="wave" sx={{ borderRadius: 2 }} />
                    ) : showPoster ? (
                      <img
                        src={getTmdbPosterUrl(tmdb.poster_path) || ''}
                        alt={tmdb.title || file.name}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          borderRadius: 8,
                          opacity: loaded ? 1 : 0,
                          transition: 'opacity 0.5s ease',
                        }}
                        onLoad={() => setImgLoadedMap(prev => ({ ...prev, [file.name]: true }))}
                      />
                    ) : (
                      getFileIcon(file.name, file.type)
                    )}
                  </Box>
                  <Box sx={{
                    width: '100%',
                    p: 2,
                    background: theme.palette.background.paper,
                    borderTop: `1px solid ${theme.palette.divider}`
                  }}>
                    <Typography
                      sx={{
                        fontWeight: 500,
                        textAlign: 'center',
                        fontSize: { xs: '0.9rem', sm: '1rem' },
                        wordBreak: 'break-all',
                        mb: 0.5,
                        lineHeight: 1.2,
                        maxHeight: '2.4em',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical'
                      }}
                    >
                      {file.type === 'directory' && tmdb && tmdb.title && (isTvShow || folderHasAllowed[file.name]) ? tmdb.title : file.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: 'block',
                        textAlign: 'center',
                        fontSize: '0.8rem'
                      }}
                    >
                      {file.type === 'directory' ? 'Folder' : file.size}
                    </Typography>
                    <IconButton
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        background: 'rgba(0, 0, 0, 0.1)',
                        '&:hover': {
                          background: 'rgba(0, 0, 0, 0.2)'
                        }
                      }}
                      onClick={e => { e.stopPropagation(); handleMenuOpen(e, file); }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Paper>
              );
            })
          )}
        </Box>
      ) : (
        <>
          {isMobile ? (
            <Paper 
              elevation={2}
              sx={{ 
                width: '100%',
                overflow: 'hidden',
                borderRadius: 2,
                bgcolor: 'background.default'
              }}
            >
              {filteredFiles.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography color="text.secondary">
                    {search ? 'No files or folders match your search.' : 'This folder is empty.'}
                  </Typography>
                </Box>
              ) : (
                filteredFiles.map((file) => (
                  <MobileListItem
                    key={file.name}
                    file={file}
                    formatDate={formatDate}
                    onItemClick={() => {
                      if (file.type === 'directory') {
                        handlePathClick(joinPaths(currentPath, file.name));
                      }
                    }}
                    onMenuClick={(e) => {
                      e.stopPropagation();
                      handleMenuOpen(e, file);
                    }}
                  />
                ))
              )}
            </Paper>
          ) : (
            <TableContainer component={Paper} sx={{
              width: '100%',
              maxWidth: '100vw',
              overflowX: 'auto',
              boxShadow: 3,
              borderRadius: 3,
            }}>
              <Table sx={{
                tableLayout: 'fixed',
                '& td, & th': {
                  px: 2,
                  py: 1.5,
                  '&:first-of-type': { width: '50%' },
                  '&:nth-of-type(2)': { width: '15%' },
                  '&:nth-of-type(3)': { width: '25%' },
                  '&:last-child': { width: '10%' },
                },
              }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Modified</TableCell>
                    <TableCell align="right"></TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredFiles.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        <Typography color="text.secondary" sx={{ py: 4 }}>
                          {search ? 'No files or folders match your search.' : 'This folder is empty.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredFiles.map((file) => (
                      <TableRow
                        key={file.name}
                        hover
                        onClick={() => {
                          if (file.type === 'directory') {
                            handlePathClick(joinPaths(currentPath, file.name));
                          }
                        }}
                        sx={{ 
                          cursor: file.type === 'directory' ? 'pointer' : 'default',
                          transition: 'background-color 0.2s',
                          '&:hover': { bgcolor: 'action.hover' }
                        }}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                            <Box sx={{ mr: 2, display: 'flex' }}>
                              {getFileIcon(file.name, file.type)}
                            </Box>
                            <Typography
                              sx={{
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {file.name}
                            </Typography>
                          </Box>
                        </TableCell>
                        <TableCell>{file.type === 'directory' ? '--' : file.size}</TableCell>
                        <TableCell>{formatDate(file.modified)}</TableCell>
                        <TableCell align="right">
                          <IconButton
                            size="small"
                            onClick={e => {
                              e.stopPropagation();
                              handleMenuOpen(e, file);
                            }}
                          >
                            <MoreVertIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          sx: {
            borderRadius: 3,
            boxShadow: 6,
            minWidth: 180,
            bgcolor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            mt: 1,
            p: 0.5,
          }
        }}
        MenuListProps={{
          sx: {
            p: 0,
          }
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {menuFile?.type === 'file' && (
          <MenuItem sx={{ py: 1.2, px: 2, fontSize: '1.05rem', borderRadius: 2, '&:hover': { bgcolor: theme.palette.action.hover } }} onClick={handleOpen}><PlayArrowIcon fontSize="small" sx={{ mr: 1 }} />Play</MenuItem>
        )}
        {menuFile?.type === 'file' && (
          <MenuItem sx={{ py: 1.2, px: 2, fontSize: '1.05rem', borderRadius: 2, '&:hover': { bgcolor: theme.palette.action.hover } }} onClick={handleDownload}><DownloadIcon fontSize="small" sx={{ mr: 1 }} />Download</MenuItem>
        )}
        <MenuItem sx={{ py: 1.2, px: 2, fontSize: '1.05rem', borderRadius: 2, '&:hover': { bgcolor: theme.palette.action.hover } }} onClick={handleRenameClick}><EditIcon fontSize="small" sx={{ mr: 1 }} />Rename</MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem sx={{ py: 1.2, px: 2, fontSize: '1.05rem', borderRadius: 2, color: theme.palette.error.main, '&:hover': { bgcolor: theme.palette.action.selected, color: theme.palette.error.dark } }} onClick={handleDeleteClick}><DeleteIcon fontSize="small" sx={{ mr: 1 }} />Delete</MenuItem>
      </Menu>

      <Dialog open={deleteConfirmOpen} onClose={handleDeleteConfirmClose} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle
          sx={{
            fontWeight: 700,
            fontSize: '1.3rem',
            background: theme.palette.background.paper,
            borderBottom: `1px solid ${theme.palette.divider}`,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            p: 2.5,
            pr: 5
          }}
        >
          Confirm Delete
          <IconButton
            aria-label="close"
            onClick={handleDeleteConfirmClose}
            sx={{
              position: 'absolute',
              right: 12,
              top: 12,
              color: theme.palette.grey[500],
            }}
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          sx={{
            background: theme.palette.background.default,
            p: 3,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
          }}
        >
          <Typography>
            Are you sure you want to delete {fileToDelete?.name} ? This action cannot be undone.
          </Typography>
          {deleteError && (
            <Typography color="error" sx={{ mt: 2 }}>
              {deleteError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2, background: theme.palette.background.paper }}>
          <Button onClick={handleDeleteConfirmClose} sx={{ mr: 1 }}>
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            disabled={!!deleteError}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailsOpen} onClose={handleDetailsClose} maxWidth="sm" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle
          sx={{
            fontWeight: 700,
            fontSize: '1.3rem',
            background: theme.palette.background.paper,
            borderBottom: `1px solid ${theme.palette.divider}`,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            p: 2.5,
            pr: 5
          }}
        >
          Details
          <IconButton
            aria-label="close"
            onClick={handleDetailsClose}
            sx={{
              position: 'absolute',
              right: 12,
              top: 12,
              color: theme.palette.grey[500],
            }}
            size="large"
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent
          dividers={true}
          sx={{
            background: theme.palette.background.default,
            p: 3,
            borderBottomLeftRadius: 12,
            borderBottomRightRadius: 12,
            minWidth: 350,
            maxWidth: 600,
          }}
        >
          {detailsData && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                {getFileIcon(detailsData.name, detailsData.type)}
                <Typography sx={{ ml: 2, fontWeight: 700, fontSize: '1.15rem', wordBreak: 'break-all', whiteSpace: 'normal' }}>{detailsData.name}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                <Typography variant="body2"><b>Type:</b> {detailsData.type === 'directory' ? 'Directory' : 'File'}</Typography>
                <Typography variant="body2"><b>Size:</b> {detailsData.type === 'directory' ? '--' : detailsData.size || '--'}</Typography>
                <Typography variant="body2"><b>Modified:</b> {formatDate(detailsData.modified)}</Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>WebDAV Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.webdavPath || '--'}</span></Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>Full Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.fullPath || '--'}</span></Typography>
                <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}><b>Source Path:</b> <span style={{ fontFamily: 'monospace' }}>{detailsData.sourcePath || '--'}</span></Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onClose={handleRenameDialogClose} maxWidth="xs" fullWidth TransitionProps={{ appear: true }}
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700, color: theme.palette.primary.main, background: theme.palette.background.paper, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
          Rename {fileToRename?.type === 'directory' ? 'Folder' : 'File'}
        </DialogTitle>
        <DialogContent sx={{ background: theme.palette.background.default, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
          <Box component="form" onSubmit={e => { e.preventDefault(); handleRenameSubmit(); }}>
            <Typography sx={{ mb: 2, color: theme.palette.text.primary }}>
              Enter a new name for <b>{fileToRename?.name}</b>:
            </Typography>
            <TextField
              autoFocus
              fullWidth
              variant="outlined"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              disabled={renameLoading}
              inputProps={{ maxLength: 255, style: { fontSize: '1.1rem' } }}
              sx={{ mb: 2, background: theme.palette.background.paper, borderRadius: 2 }}
              color="primary"
            />
            {renameError && <Typography color="error" sx={{ mb: 1 }}>{renameError}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions sx={{ background: theme.palette.background.paper, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
          <Button onClick={handleRenameDialogClose} disabled={renameLoading} color="inherit">Cancel</Button>
          <Button
            onClick={handleRenameSubmit}
            variant="contained"
            color="primary"
            disabled={renameLoading || !renameValue.trim() || renameValue === fileToRename?.name}
          >
            {renameLoading ? <CircularProgress size={22} color="inherit" /> : 'Rename'}
          </Button>
        </DialogActions>
      </Dialog>

      <VideoPlayerDialog
        open={videoPlayerOpen}
        onClose={() => setVideoPlayerOpen(false)}
        url={videoUrl}
        title={videoTitle}
        mimeType={videoMimeType}
      />
    </Box>
  );
} 