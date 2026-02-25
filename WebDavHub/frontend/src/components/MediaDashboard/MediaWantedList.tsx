import { useMemo, useState } from 'react';
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Checkbox, IconButton, Paper, Stack, Tooltip, alpha, useTheme } from '@mui/material';
import { Search as SearchIcon, Delete as DeleteIcon, WarningAmber as WarningAmberIcon, CheckCircle as CheckCircleIcon, Error as ErrorIcon, CloudDownload as CloudDownloadIcon, BookmarkBorder as BookmarkBorderIcon } from '@mui/icons-material';
import { ArrItem } from './types';

interface MediaWantedListProps {
  items: ArrItem[];
  variant?: 'series' | 'movies';
  onSearch?: (item: ArrItem) => void;
  onDelete?: (item: ArrItem) => void;
}

export default function MediaWantedList({ items, variant = 'series', onSearch, onDelete }: MediaWantedListProps) {
  const theme = useTheme();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedItems = useMemo(() => items.filter((item) => selected.has(item.id)), [items, selected]);
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  const getUniqueItems = (list: ArrItem[]) => {
    const seen = new Set<string | number>();
    return list.filter((item) => {
      const key = item.libraryItemId ?? item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelected(new Set(items.map((item) => item.id)));
    } else {
      setSelected(new Set());
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSearchAll = () => {
    if (!onSearch) return;
    getUniqueItems(items).forEach((item) => onSearch(item));
  };

  const handleSearchSelected = () => {
    if (!onSearch) return;
    getUniqueItems(selectedItems).forEach((item) => onSearch(item));
  };

  const handleDeleteSelected = () => {
    if (!onDelete) return;
    getUniqueItems(selectedItems).forEach((item) => onDelete(item));
  };

  const statusMeta = (status: ArrItem['status']) => {
    switch (status) {
      case 'missing':
        return { label: 'Missing', color: theme.palette.warning.main, icon: <WarningAmberIcon fontSize="small" /> };
      case 'wanted':
        return { label: 'Wanted', color: theme.palette.warning.main, icon: <WarningAmberIcon fontSize="small" /> };
      case 'searching':
        return { label: 'Searching', color: theme.palette.info.main, icon: <SearchIcon fontSize="small" /> };
      case 'downloading':
        return { label: 'Downloading', color: theme.palette.info.main, icon: <CloudDownloadIcon fontSize="small" /> };
      case 'imported':
        return { label: 'Imported', color: theme.palette.success.main, icon: <CheckCircleIcon fontSize="small" /> };
      case 'completed':
        return { label: 'Completed', color: theme.palette.success.main, icon: <CheckCircleIcon fontSize="small" /> };
      case 'unavailable':
        return { label: 'Unavailable', color: theme.palette.text.secondary, icon: <ErrorIcon fontSize="small" /> };
      case 'failed':
        return { label: 'Failed', color: theme.palette.error.main, icon: <ErrorIcon fontSize="small" /> };
      default:
        return { label: status, color: theme.palette.text.secondary, icon: <WarningAmberIcon fontSize="small" /> };
    }
  };

  const formatAirDate = (value?: string, year?: number) => {
    if (value) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      }
    }
    if (year) return year.toString();
    return '--';
  };

  const formatAddedDate = (value?: string) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  if (items.length === 0) {
    const title = variant === 'series' ? 'No missing series' : 'No missing movies';
    const subtitle = variant === 'series'
      ? 'Missing episodes will appear here once a series is monitored.'
      : 'Missing movies will appear here once a movie is monitored.';

    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {subtitle}
        </Typography>
      </Box>
    );
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box
        sx={{
          px: 2,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.paper, 0.6)
        }}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Tooltip title="Search all">
              <span>
                <IconButton size="small" onClick={handleSearchAll} disabled={!onSearch}>
                  <SearchIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              Search All
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Tooltip title={selectedItems.length ? 'Unmonitor selected' : 'Select items first'}>
              <span>
                <IconButton size="small" disabled={!selectedItems.length}>
                  <BookmarkBorderIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Typography variant="caption" color="text.secondary">
              Unmonitor Selected
            </Typography>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center">
          <Tooltip title="Search selected">
            <span>
              <IconButton size="small" onClick={handleSearchSelected} disabled={!onSearch || !selectedItems.length}>
                <SearchIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Remove selected">
            <span>
              <IconButton size="small" onClick={handleDeleteSelected} disabled={!onDelete || !selectedItems.length}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: theme.palette.mode === 'light'
                  ? alpha(theme.palette.primary.main, 0.08)
                  : alpha(theme.palette.primary.main, 0.2)
              }}
            >
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  checked={allSelected}
                  indeterminate={selectedItems.length > 0 && !allSelected}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </TableCell>
              {variant === 'series' ? (
                <>
                  <TableCell sx={{ fontWeight: 600 }}>Series Title</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Episode</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Episode Title</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Air Date</TableCell>
                </>
              ) : (
                <>
                  <TableCell sx={{ fontWeight: 600 }}>Movie Title</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Year</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Quality</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Added</TableCell>
                </>
              )}
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => {
              const meta = statusMeta(item.status);
              return (
                <TableRow
                  key={item.id}
                  hover
                  sx={{
                    '&:hover': {
                      bgcolor: alpha(theme.palette.action.hover, 0.35)
                    }
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                    />
                  </TableCell>
                  {variant === 'series' ? (
                    <>
                      <TableCell>
                        <Stack spacing={0.3}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {item.title}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.episode ?? '--'}</TableCell>
                      <TableCell sx={{ maxWidth: 420 }}>
                        <Typography variant="body2" noWrap>
                          {item.episodeTitle ?? '--'}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatAirDate(item.airDate, item.year)}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>
                        <Stack spacing={0.3}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {item.title}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>{item.year ?? '--'}</TableCell>
                      <TableCell>{item.qualityProfile || '--'}</TableCell>
                      <TableCell>{formatAddedDate(item.createdAt)}</TableCell>
                    </>
                  )}
                  <TableCell>
                    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: meta.color }}>
                      {meta.icon}
                      <Typography variant="caption" sx={{ color: meta.color, fontWeight: 600 }}>
                        {meta.label}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Search">
                        <span>
                          <IconButton size="small" onClick={() => onSearch?.(item)} disabled={!onSearch}>
                            <SearchIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <span>
                          <IconButton size="small" onClick={() => onDelete?.(item)} disabled={!onDelete}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
