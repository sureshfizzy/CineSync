import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, TextField, Card, CardContent, Chip, IconButton, CircularProgress, useTheme, useMediaQuery, alpha, Stack, Tooltip, InputAdornment, Collapse, FormControl, InputLabel, Select, MenuItem, Pagination, Grid, Button } from '@mui/material';
import { Search as SearchIcon, Clear as ClearIcon, GetApp as ExportIcon, Refresh as RefreshIcon, Movie as MovieIcon, Tv as TvIcon, Folder as FolderIcon, Storage as StorageIcon, TrendingUp as TrendingUpIcon, ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, ViewList as CompactViewIcon, ViewModule as CardViewIcon } from '@mui/icons-material';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';

const MotionCard = motion(Card);

interface DatabaseRecord {
  file_path: string;
  destination_path?: string;
  tmdb_id?: string;
  season_number?: string;
  reason?: string;
  file_size?: number;
}

interface DatabaseStats {
  totalRecords: number;
  processedFiles: number;
  skippedFiles: number;
  movies: number;
  tvShows: number;
  totalSize: number;
}

const DatabaseSearch: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('lg'));
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [records, setRecords] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [recordsPerPage] = useState(50);
  const [totalRecords, setTotalRecords] = useState(0);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [compactView, setCompactView] = useState(false);

  const fetchDatabaseRecords = useCallback(async () => {
    try {
      setLoading(true);
      const offset = (currentPage - 1) * recordsPerPage;
      const response = await axios.get('/api/database/search', {
        params: {
          query: searchQuery || '',
          type: filterType,
          limit: recordsPerPage,
          offset: offset,
        },
      });

      setRecords(response.data.records || []);
      setTotalRecords(response.data.total || 0);
      setStats(response.data.stats || null);
    } catch (error) {
      console.error('Failed to fetch database records:', error);
      setRecords([]);
      setTotalRecords(0);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filterType, currentPage, recordsPerPage]);

  const fetchDatabaseStats = useCallback(async () => {
    try {
      const response = await axios.get('/api/database/stats');
      setStats(response.data);
    } catch (error) {
      console.error('Failed to fetch database stats:', error);
    }
  }, []);

  useEffect(() => {
    fetchDatabaseStats();
  }, [fetchDatabaseStats]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCurrentPage(1);
      fetchDatabaseRecords();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, filterType]);

  useEffect(() => {
    fetchDatabaseRecords();
  }, [currentPage]);

  const totalPages = Math.ceil(totalRecords / recordsPerPage);

  const handleClearSearch = () => {
    setSearchQuery('');
    setFilterType('all');
    setCurrentPage(1);
  };

  const handleExport = async () => {
    try {
      const response = await axios.get('/api/database/export', {
        responseType: 'blob',
        params: {
          query: searchQuery || '',
          type: filterType,
        },
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `database_export_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export database:', error);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  };

  const getRecordType = (record: DatabaseRecord) => {
    if (record.reason) return 'skipped';
    if (record.tmdb_id && record.season_number) return 'tvshow';
    if (record.tmdb_id && !record.season_number) return 'movie';
    return 'other';
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'movie':
        return <MovieIcon sx={{ fontSize: 16, color: theme.palette.primary.main }} />;
      case 'tvshow':
        return <TvIcon sx={{ fontSize: 16, color: theme.palette.secondary.main }} />;
      case 'skipped':
        return <ClearIcon sx={{ fontSize: 16, color: theme.palette.warning.main }} />;
      default:
        return <FolderIcon sx={{ fontSize: 16, color: theme.palette.text.secondary }} />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'movie':
        return theme.palette.primary.main;
      case 'tvshow':
        return theme.palette.secondary.main;
      case 'skipped':
        return theme.palette.warning.main;
      default:
        return theme.palette.text.secondary;
    }
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 2 } }}>
      {/* Stats Cards */}
      {stats && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.primary.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StorageIcon sx={{ color: 'primary.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {stats.totalRecords.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Total Records
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>

          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <MovieIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {stats.movies.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Movies
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>

          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.secondary.main, 0.1)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.secondary.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TvIcon sx={{ color: 'secondary.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {stats.tvShows.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      TV Shows
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>

          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.1)} 0%, ${alpha(theme.palette.warning.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <ClearIcon sx={{ color: 'warning.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {stats.skippedFiles.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Skipped
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>

          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.info.main, 0.1)} 0%, ${alpha(theme.palette.info.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TrendingUpIcon sx={{ color: 'info.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {formatFileSize(stats.totalSize)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Total Size
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>

          <Grid
            size={{
              xs: 6,
              sm: 4,
              md: 2
            }}>
            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              sx={{
                background: `linear-gradient(135deg, ${alpha(theme.palette.success.main, 0.1)} 0%, ${alpha(theme.palette.success.main, 0.05)} 100%)`,
                border: `1px solid ${alpha(theme.palette.success.main, 0.2)}`,
              }}
            >
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StorageIcon sx={{ color: 'success.main', fontSize: 20 }} />
                  <Box>
                    <Typography variant="h6" sx={{ fontSize: '1.1rem', fontWeight: 600 }}>
                      {stats.processedFiles.toLocaleString()}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Processed
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>
        </Grid>
      )}
      {/* Search and Filter Controls */}
      <Card sx={{ mb: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: { xs: 2, sm: 2 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            {/* Search Bar */}
            <TextField
              placeholder="Search files, paths, TMDB IDs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery('')}>
                      <ClearIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                flex: { xs: 1, sm: 1 },
                maxWidth: { xs: '100%', sm: 400 },
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                },
              }}
            />

            {/* Filter Dropdown */}
            <FormControl sx={{ minWidth: { xs: '100%', sm: 150 } }}>
              <InputLabel>Filter</InputLabel>
              <Select
                value={filterType}
                label="Filter"
                onChange={(e) => setFilterType(e.target.value)}
                sx={{ borderRadius: 2 }}
              >
                <MenuItem value="all">All Records</MenuItem>
                <MenuItem value="movies">Movies</MenuItem>
                <MenuItem value="tvshows">TV Shows</MenuItem>
                <MenuItem value="processed">Processed</MenuItem>
                <MenuItem value="skipped">Skipped</MenuItem>
              </Select>
            </FormControl>

            {/* Action Buttons */}
            <Stack
              direction="row"
              spacing={1}
              justifyContent={{ xs: 'center', sm: 'flex-end' }}
              flexWrap="wrap"
              sx={{ gap: 1 }}
            >
              <Tooltip title={compactView ? "Card View" : "Compact View"}>
                <IconButton
                  onClick={() => setCompactView(!compactView)}
                  sx={{
                    bgcolor: compactView ? 'primary.main' : 'action.hover',
                    color: compactView ? 'primary.contrastText' : 'text.secondary',
                    '&:hover': {
                      bgcolor: compactView ? 'primary.dark' : 'action.selected'
                    },
                  }}
                >
                  {compactView ? <CardViewIcon /> : <CompactViewIcon />}
                </IconButton>
              </Tooltip>

              <Tooltip title="Refresh">
                <IconButton
                  onClick={fetchDatabaseRecords}
                  disabled={loading}
                  sx={{
                    bgcolor: 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>

              <Tooltip title="Export Results">
                <IconButton
                  onClick={handleExport}
                  sx={{
                    bgcolor: 'action.hover',
                    '&:hover': { bgcolor: 'action.selected' },
                  }}
                >
                  <ExportIcon />
                </IconButton>
              </Tooltip>

              {(searchQuery || filterType !== 'all') && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleClearSearch}
                  startIcon={<ClearIcon />}
                  sx={{
                    borderRadius: 2,
                    minWidth: { xs: 'auto', sm: 'auto' },
                    px: { xs: 1.5, sm: 2 }
                  }}
                >
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    Clear
                  </Box>
                  <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                    <ClearIcon sx={{ fontSize: 16 }} />
                  </Box>
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      {/* Results */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Results Summary */}
          <Box sx={{
            mb: 2,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: { xs: 1, sm: 0 }
          }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                textAlign: { xs: 'center', sm: 'left' },
                fontSize: { xs: '0.75rem', sm: '0.875rem' }
              }}
            >
              Showing {records.length} of {totalRecords.toLocaleString()} records
              {searchQuery && ` for "${searchQuery}"`}
            </Typography>

            {totalPages > 1 && (
              <Pagination
                count={totalPages}
                page={currentPage}
                onChange={(_, page) => setCurrentPage(page)}
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
          </Box>

          {/* Modern Card-Based Results */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: compactView ? 1 : 2 }}>
            <AnimatePresence>
              {records.map((record: DatabaseRecord, index: number) => {
                const recordType = getRecordType(record);
                const fileName = record.file_path.split(/[/\\]/).pop() || record.file_path;
                const isExpanded = expandedRows.has(record.file_path);

                return (
                  <MotionCard
                    key={record.file_path}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    sx={{
                      borderRadius: 3,
                      border: '1px solid',
                      borderColor: theme.palette.mode === 'light'
                        ? alpha(getTypeColor(recordType), 0.3)
                        : alpha(getTypeColor(recordType), 0.2),
                      bgcolor: 'background.paper',
                      overflow: 'hidden',
                      '&:hover': {
                        borderColor: theme.palette.mode === 'light'
                          ? alpha(getTypeColor(recordType), 0.5)
                          : alpha(getTypeColor(recordType), 0.4),
                        boxShadow: theme.palette.mode === 'light'
                          ? `0 4px 20px ${alpha(getTypeColor(recordType), 0.15)}`
                          : `0 4px 20px ${alpha(getTypeColor(recordType), 0.1)}`,
                        transform: 'translateY(-2px)',
                      },
                      transition: 'all 0.3s ease',
                    }}
                  >
                    <CardContent sx={{ p: compactView ? 2 : 3 }}>
                      {/* Header Row */}
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: compactView ? 1 : 2 }}>
                        {/* Type Icon */}
                        <Box
                          sx={{
                            p: compactView ? 1 : 1.5,
                            borderRadius: 2,
                            bgcolor: theme.palette.mode === 'light'
                              ? alpha(getTypeColor(recordType), 0.08)
                              : alpha(getTypeColor(recordType), 0.1),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {getTypeIcon(recordType)}
                        </Box>

                        {/* File Info */}
                        <Box sx={{ flex: 1, minWidth: 0, pr: 1 }}>
                          <Box sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            mb: 1,
                            flexWrap: 'wrap'
                          }}>
                            <Typography
                              variant="h6"
                              sx={{
                                fontWeight: 600,
                                fontSize: { xs: '1rem', sm: '1.1rem' },
                                wordBreak: 'break-word',
                                lineHeight: 1.3,
                                flex: '1 1 auto',
                                minWidth: 0
                              }}
                            >
                              {fileName}
                            </Typography>
                            {record.season_number && (
                              <Chip
                                label={`Season ${record.season_number}`}
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: '0.7rem',
                                  bgcolor: theme.palette.mode === 'light'
                                    ? alpha(theme.palette.secondary.main, 0.08)
                                    : alpha(theme.palette.secondary.main, 0.1),
                                  color: 'secondary.main',
                                  border: theme.palette.mode === 'light'
                                    ? `1px solid ${alpha(theme.palette.secondary.main, 0.2)}`
                                    : 'none',
                                  flexShrink: 0,
                                }}
                              />
                            )}
                          </Box>

                          {/* Status and TMDB */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Chip
                              label={record.reason || 'Processed'}
                              size="small"
                              sx={{
                                bgcolor: theme.palette.mode === 'light'
                                  ? alpha(getTypeColor(recordType), 0.08)
                                  : alpha(getTypeColor(recordType), 0.1),
                                color: getTypeColor(recordType),
                                fontWeight: 500,
                                fontSize: '0.7rem',
                                border: theme.palette.mode === 'light'
                                  ? `1px solid ${alpha(getTypeColor(recordType), 0.2)}`
                                  : 'none',
                              }}
                            />
                            {record.tmdb_id && (
                              <Chip
                                label={`TMDB: ${record.tmdb_id}`}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  borderColor: alpha(theme.palette.info.main, 0.3),
                                  color: 'info.main',
                                }}
                              />
                            )}
                            {record.file_size && (
                              <Chip
                                label={formatFileSize(record.file_size)}
                                size="small"
                                variant="outlined"
                                sx={{
                                  fontSize: '0.7rem',
                                  borderColor: alpha(theme.palette.text.secondary, 0.3),
                                  color: 'text.secondary',
                                }}
                              />
                            )}
                          </Box>
                        </Box>

                        {/* Expand Button */}
                        <Box sx={{ alignSelf: 'flex-start', flexShrink: 0 }}>
                          <IconButton
                            size="small"
                            onClick={() => {
                              const newExpanded = new Set(expandedRows);
                              if (isExpanded) {
                                newExpanded.delete(record.file_path);
                              } else {
                                newExpanded.add(record.file_path);
                              }
                              setExpandedRows(newExpanded);
                            }}
                            sx={{
                              bgcolor: theme.palette.mode === 'light'
                                ? alpha(theme.palette.primary.main, 0.08)
                                : alpha(theme.palette.primary.main, 0.1),
                              color: 'primary.main',
                              border: theme.palette.mode === 'light'
                                ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}`
                                : 'none',
                              width: 32,
                              height: 32,
                              '&:hover': {
                                bgcolor: theme.palette.mode === 'light'
                                  ? alpha(theme.palette.primary.main, 0.15)
                                  : alpha(theme.palette.primary.main, 0.2),
                              },
                            }}
                          >
                            {isExpanded ? <ExpandLessIcon sx={{ fontSize: 18 }} /> : <ExpandMoreIcon sx={{ fontSize: 18 }} />}
                          </IconButton>
                        </Box>
                      </Box>

                      {/* Path Preview */}
                      {!compactView && (
                        <Box sx={{ mb: isExpanded ? 2 : 0 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}
                          >
                            Source Path:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.8rem',
                              bgcolor: theme.palette.mode === 'light'
                                ? alpha(theme.palette.grey[100], 0.8)
                                : '#000000',
                              p: 1,
                              borderRadius: 1,
                              wordBreak: 'break-all',
                              maxHeight: isExpanded ? 'none' : '2.4em',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: isExpanded ? 'none' : 2,
                              WebkitBoxOrient: 'vertical',
                              transition: 'all 0.3s ease',
                              border: theme.palette.mode === 'light'
                                ? `1px solid ${alpha(theme.palette.grey[300], 0.8)}`
                                : `1px solid ${alpha(theme.palette.divider, 0.3)}`,
                            }}
                          >
                            {record.file_path}
                          </Typography>
                        </Box>
                      )}

                      {/* Expanded Content */}
                      <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                        <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                          {record.destination_path && (
                            <Box sx={{ mb: 2 }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}
                              >
                                Destination Path:
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontFamily: 'monospace',
                                  fontSize: '0.8rem',
                                  bgcolor: theme.palette.mode === 'light'
                                    ? alpha(theme.palette.success.main, 0.08)
                                    : '#000000',
                                  color: 'success.main',
                                  p: 1,
                                  borderRadius: 1,
                                  wordBreak: 'break-all',
                                  border: theme.palette.mode === 'light'
                                    ? `1px solid ${alpha(theme.palette.success.main, 0.2)}`
                                    : `1px solid ${alpha(theme.palette.success.main, 0.3)}`,
                                }}
                              >
                                {record.destination_path}
                              </Typography>
                            </Box>
                          )}

                          {record.reason && (
                            <Box sx={{ mb: 2 }}>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}
                              >
                                Reason:
                              </Typography>
                              <Typography
                                variant="body2"
                                sx={{
                                  bgcolor: theme.palette.mode === 'light'
                                    ? alpha(getTypeColor(recordType), 0.08)
                                    : '#000000',
                                  color: getTypeColor(recordType),
                                  p: 1,
                                  borderRadius: 1,
                                  fontSize: '0.9rem',
                                  border: theme.palette.mode === 'light'
                                    ? `1px solid ${alpha(getTypeColor(recordType), 0.2)}`
                                    : `1px solid ${alpha(getTypeColor(recordType), 0.3)}`,
                                }}
                              >
                                {record.reason}
                              </Typography>
                            </Box>
                          )}

                          {/* Additional Metadata */}
                          <Grid container spacing={2}>
                            {record.tmdb_id && (
                              <Grid
                                size={{
                                  xs: 6,
                                  sm: 4
                                }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                  TMDB ID:
                                </Typography>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  {record.tmdb_id}
                                </Typography>
                              </Grid>
                            )}

                            {record.season_number && (
                              <Grid
                                size={{
                                  xs: 6,
                                  sm: 4
                                }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                  Season:
                                </Typography>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  {record.season_number}
                                </Typography>
                              </Grid>
                            )}

                            {record.file_size && (
                              <Grid
                                size={{
                                  xs: 6,
                                  sm: 4
                                }}>
                                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                  File Size:
                                </Typography>
                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                  {formatFileSize(record.file_size)}
                                </Typography>
                              </Grid>
                            )}
                          </Grid>
                        </Box>
                      </Collapse>
                    </CardContent>
                  </MotionCard>
                );
              })}
            </AnimatePresence>
          </Box>

          {/* Bottom Pagination */}
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <Pagination
              count={totalPages}
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
          </Box>
        </>
      )}
    </Box>
  );
};

export default DatabaseSearch;
