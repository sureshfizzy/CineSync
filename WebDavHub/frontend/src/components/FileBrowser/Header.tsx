import React from 'react';
import { Box, Breadcrumbs, IconButton, Link, TextField, Tooltip, useMediaQuery, useTheme, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import { NavigateBefore as UpIcon, Refresh as RefreshIcon, ViewList as ViewListIcon, GridView as GridViewIcon, Close as CloseIcon, Search as SearchIcon, Sort as SortIcon, SortByAlpha as SortByAlphaIcon, Schedule as ScheduleIcon, Storage as StorageIcon } from '@mui/icons-material';
import MobileBreadcrumbs from './MobileBreadcrumbs';
import { SortOption } from './types';

interface HeaderProps {
  currentPath: string;
  search: string;
  view: 'list' | 'poster';
  sortOption: SortOption;
  onPathClick: (path: string) => void;
  onUpClick: () => void;
  onSearchChange: (value: string) => void;
  onViewChange: (view: 'list' | 'poster') => void;
  onSortChange: (sortOption: SortOption) => void;
  onRefresh: () => void;
}

export default function Header({
  currentPath,
  search,
  view,
  sortOption,
  onPathClick,
  onUpClick,
  onSearchChange,
  onViewChange,
  onSortChange,
  onRefresh,
}: HeaderProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Sort menu state
  const [sortAnchorEl, setSortAnchorEl] = React.useState<null | HTMLElement>(null);
  const sortMenuOpen = Boolean(sortAnchorEl);

  const handleSortClick = (event: React.MouseEvent<HTMLElement>) => {
    setSortAnchorEl(event.currentTarget);
  };

  const handleSortClose = () => {
    setSortAnchorEl(null);
  };

  const handleSortSelect = (option: SortOption) => {
    onSortChange(option);
    handleSortClose();
  };

  const getSortLabel = (option: SortOption): string => {
    switch (option) {
      case 'name-asc': return 'Name (A-Z)';
      case 'name-desc': return 'Name (Z-A)';
      case 'modified-desc': return 'Modified (Newest)';
      case 'modified-asc': return 'Modified (Oldest)';
      case 'size-desc': return 'Size (Largest)';
      case 'size-asc': return 'Size (Smallest)';
      default: return 'Name (A-Z)';
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
                <Tooltip title={`Sort: ${getSortLabel(sortOption)}`}>
                  <IconButton
                    onClick={handleSortClick}
                    color="default"
                  >
                    <SortIcon />
                  </IconButton>
                </Tooltip>
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
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
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
            <Tooltip title={`Sort: ${getSortLabel(sortOption)}`}>
              <IconButton onClick={handleSortClick} color="default">
                <SortIcon />
              </IconButton>
            </Tooltip>
          </Box>

        </>
      )}

      {/* Sort Menu */}
      <Menu
        anchorEl={sortAnchorEl}
        open={sortMenuOpen}
        onClose={handleSortClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
      >
        <MenuItem onClick={() => handleSortSelect('name-asc')} selected={sortOption === 'name-asc'}>
          <ListItemIcon>
            <SortByAlphaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Name (A-Z)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortSelect('name-desc')} selected={sortOption === 'name-desc'}>
          <ListItemIcon>
            <SortByAlphaIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Name (Z-A)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortSelect('modified-desc')} selected={sortOption === 'modified-desc'}>
          <ListItemIcon>
            <ScheduleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Modified (Newest)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortSelect('modified-asc')} selected={sortOption === 'modified-asc'}>
          <ListItemIcon>
            <ScheduleIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Modified (Oldest)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortSelect('size-desc')} selected={sortOption === 'size-desc'}>
          <ListItemIcon>
            <StorageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Size (Largest)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleSortSelect('size-asc')} selected={sortOption === 'size-asc'}>
          <ListItemIcon>
            <StorageIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Size (Smallest)</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}