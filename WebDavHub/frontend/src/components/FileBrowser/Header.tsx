import {
  Box,
  Breadcrumbs,
  IconButton,
  Link,
  TextField,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  NavigateBefore as UpIcon,
  Refresh as RefreshIcon,
  ViewList as ViewListIcon,
  GridView as GridViewIcon,
  Close as CloseIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import MobileBreadcrumbs from './MobileBreadcrumbs';

interface HeaderProps {
  currentPath: string;
  search: string;
  view: 'list' | 'poster';
  onPathClick: (path: string) => void;
  onUpClick: () => void;
  onSearchChange: (value: string) => void;
  onViewChange: (view: 'list' | 'poster') => void;
  onRefresh: () => void;
}

export default function Header({
  currentPath,
  search,
  view,
  onPathClick,
  onUpClick,
  onSearchChange,
  onViewChange,
  onRefresh,
}: HeaderProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const pathParts = currentPath.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, index) => {
    const path = '/' + pathParts.slice(0, index + 1).join('/') + '/';
    return (
      <Link
        key={path}
        component="button"
        variant="body1"
        onClick={() => onPathClick(path)}
        sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
      >
        {part}
      </Link>
    );
  });

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        {isMobile ? (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center',
            width: '100%',
            minWidth: 0,
            px: 1
          }}>
            <MobileBreadcrumbs currentPath={currentPath} onPathClick={onPathClick} />
          </Box>
        ) : (
          <>
            <Tooltip title="Up">
              <span>
                <IconButton onClick={onUpClick} disabled={currentPath === '/'}>
                  <UpIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Breadcrumbs sx={{ flexGrow: 1 }} separator=" / ">
              <Link
                component="button"
                variant="body1"
                onClick={() => onPathClick('/')}
                sx={{ textDecoration: 'none', fontSize: { xs: '1rem', sm: '1.1rem' } }}
              >
                Home
              </Link>
              {breadcrumbs}
            </Breadcrumbs>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ minWidth: 220, maxWidth: 320 }}>
                <TextField
                  value={search}
                  onChange={e => onSearchChange(e.target.value)}
                  placeholder="Search files and folders..."
                  size="small"
                  variant="outlined"
                  fullWidth
                  InputProps={{
                    startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
                    endAdornment: search && (
                      <IconButton size="small" onClick={() => onSearchChange('')}>
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
                    onClick={() => onViewChange('poster')} 
                    color={view === 'poster' ? 'primary' : 'default'}
                  >
                    <GridViewIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="List view">
                  <IconButton 
                    onClick={() => onViewChange('list')} 
                    color={view === 'list' ? 'primary' : 'default'}
                  >
                    <ViewListIcon />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Refresh">
                  <IconButton onClick={onRefresh} color="primary">
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
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search files and folders..."
            size="small"
            variant="outlined"
            fullWidth
            InputProps={{
              startAdornment: <SearchIcon sx={{ color: 'text.secondary', mr: 1 }} />,
              endAdornment: search && (
                <IconButton size="small" onClick={() => onSearchChange('')}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              ),
              sx: { borderRadius: 2, background: theme.palette.background.paper }
            }}
          />
        </Box>
      )}
    </>
  );
} 