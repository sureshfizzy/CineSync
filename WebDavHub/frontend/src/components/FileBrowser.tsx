import { useEffect, useState } from 'react';
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
  Info as InfoIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenInNewIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { format, parseISO } from 'date-fns';
import axios from 'axios';

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  path?: string;
  webdavPath?: string;
  sourcePath?: string;
  fullPath?: string;
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

export default function FileBrowser() {
  const navigate = useNavigate();
  const params = useParams();
  // Get the wildcard path from the URL (e.g., /files/path/to/folder)
  const urlPath = params['*'] || '';
  const currentPath = '/' + urlPath;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuFile, setMenuFile] = useState<FileItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsData, setDetailsData] = useState<FileItem | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

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

  const handleRefresh = () => {
    fetchFiles(currentPath);
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
    const webdavPath = `/Movies${currentPath}/${menuFile.name}`;
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

  const handleOpen = () => {
    // Implement open logic if needed
    handleMenuClose();
  };

  const handleDelete = () => {
    // Implement delete logic if needed
    handleMenuClose();
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
        <Tooltip title="Up">
          <span>
            <IconButton onClick={handleUpClick} disabled={currentPath === '/'}>
              <UpIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Breadcrumbs sx={{ flexGrow: 1, ml: 2, fontSize: { xs: '1rem', sm: '1.1rem' } }}>
          <Link
            component="button"
            variant="body1"
            onClick={() => handlePathClick('/')}
            sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
          >
            Home
          </Link>
          {breadcrumbs}
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="List view"><IconButton onClick={() => setView('list')} color={view === 'list' ? 'primary' : 'default'}><ViewListIcon /></IconButton></Tooltip>
          <Tooltip title="Grid view"><IconButton onClick={() => setView('grid')} color={view === 'grid' ? 'primary' : 'default'}><GridViewIcon /></IconButton></Tooltip>
          <Tooltip title="Refresh"><Button variant="contained" startIcon={<RefreshIcon />} onClick={handleRefresh} sx={{ ml: 1, minWidth: isMobile ? 36 : 100, px: isMobile ? 1 : 2 }}>{!isMobile && 'Refresh'}</Button></Tooltip>
        </Box>
      </Box>

      {view === 'list' ? (
        <TableContainer component={Paper} sx={{
          width: '100%',
          maxWidth: '100vw',
          overflowX: 'auto',
          boxShadow: 3,
          borderRadius: { xs: 1, sm: 3 },
          p: { xs: 0, sm: 0 },
        }}>
          <Table size={isMobile ? 'small' : 'medium'} sx={{
            tableLayout: 'auto',
            minWidth: 0,
            width: '100%',
            '& td, & th': {
              px: { xs: 1, sm: 2 },
              py: { xs: 0.5, sm: 1.5 },
              fontSize: { xs: '0.95rem', sm: '1.05rem' },
              wordBreak: 'break-word',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              maxWidth: { xs: 120, sm: 'none' },
            },
          }}>
            <TableHead>
              <TableRow sx={{ background: theme.palette.action.hover }}>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Size</TableCell>
                {!isMobile && <TableCell sx={{ fontWeight: 700 }}>Modified</TableCell>}
                <TableCell align="right" sx={{ width: 48 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {files.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isMobile ? 3 : 4} align="center">
                    <Typography color="text.secondary" sx={{ py: 4 }}>
                      This folder is empty.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                files.map((file) => (
                  <TableRow
                    key={file.name}
                    hover
                    onClick={() => {
                      if (file.type === 'directory') {
                        handlePathClick(joinPaths(currentPath, file.name));
                      }
                    }}
                    sx={{ cursor: file.type === 'directory' ? 'pointer' : 'default', transition: 'background 0.2s', '&:hover': { background: theme.palette.action.selected } }}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        {getFileIcon(file.name, file.type)}
                        <Typography 
                          sx={{ 
                            ml: 1, 
                            fontWeight: 500, 
                            fontSize: { xs: '1rem', sm: '1.1rem' }, 
                            wordBreak: 'break-all', 
                            whiteSpace: 'normal',
                            lineHeight: 1.2,
                            maxWidth: { xs: 120, sm: 320 },
                          }}
                        >
                          {file.name}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{file.type === 'directory' ? '--' : file.size}</TableCell>
                    {!isMobile && <TableCell>{formatDate(file.modified)}</TableCell>}
                    <TableCell align="right">
                      <IconButton size="small" onClick={e => { e.stopPropagation(); handleMenuOpen(e, file); }}>
                        <MoreVertIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr', md: '1fr 1fr 1fr 1fr' }, gap: 2 }}>
          {files.length === 0 ? (
            <Box sx={{ gridColumn: '1/-1', textAlign: 'center', py: 6 }}>
              <Typography color="text.secondary">
                This folder is empty.
              </Typography>
            </Box>
          ) : (
            files.map((file) => (
              <Paper key={file.name} sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: file.type === 'directory' ? 'pointer' : 'default', transition: 'box-shadow 0.2s', boxShadow: 1, '&:hover': { boxShadow: 4, background: theme.palette.action.selected } }} onClick={() => file.type === 'directory' && handlePathClick(joinPaths(currentPath, file.name))}>
                {getFileIcon(file.name, file.type)}
                <Typography sx={{ mt: 1, fontWeight: 500, textAlign: 'center', fontSize: { xs: '0.95rem', sm: '1.05rem' }, wordBreak: 'break-all' }}>{file.name}</Typography>
                <Typography variant="caption" color="text.secondary">{file.type === 'directory' ? '--' : file.size}</Typography>
                <Typography variant="caption" color="text.secondary">{formatDate(file.modified)}</Typography>
                <IconButton size="small" sx={{ mt: 1 }} onClick={e => { e.stopPropagation(); handleMenuOpen(e, file); }}>
                  <MoreVertIcon />
                </IconButton>
              </Paper>
            ))
          )}
        </Box>
      )}

      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
        <MenuItem onClick={handleOpen}><OpenInNewIcon fontSize="small" sx={{ mr: 1 }} />Open</MenuItem>
        <MenuItem onClick={handleViewDetails}><InfoIcon fontSize="small" sx={{ mr: 1 }} />View Details</MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={handleDelete} sx={{ color: theme.palette.error.main }}><DeleteIcon fontSize="small" sx={{ mr: 1 }} />Delete</MenuItem>
      </Menu>

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
    </Box>
  );
} 