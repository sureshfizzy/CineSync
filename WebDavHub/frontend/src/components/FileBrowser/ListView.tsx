import { useState, useCallback } from 'react';
import { Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography, useTheme, useMediaQuery, Checkbox } from '@mui/material';
import { FileItem } from './types';
import { getFileIcon } from './fileUtils';
import FileActionMenu from './FileActionMenu';
import MobileListItem from './MobileListItem';
import { useBulkSelection } from '../../contexts/BulkSelectionContext';
import BulkActionsBar from './BulkActionsBar';
import BulkMoveDialog from './BulkMoveDialog';
import BulkDeleteDialog from './BulkDeleteDialog';
import { moveFile } from './fileApi';
import axios from 'axios';

interface ListViewProps {
  files: FileItem[];
  currentPath: string;
  formatDate: (date?: string) => string;
  onItemClick: (file: FileItem) => void;
  onViewDetails: (file: FileItem, details: any) => void;
  onRename: () => void;
  onDeleted: () => void;
  onError: (error: string) => void;
  onNavigateBack?: () => void;
}

export default function ListView({
  files,
  currentPath,
  formatDate,
  onItemClick,
  onViewDetails,
  onRename,
  onDeleted,
  onError,
  onNavigateBack,
}: ListViewProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // Use bulk selection
  const { 
    isSelectionMode, 
    selectedItems, 
    toggleSelection, 
    selectAll, 
    isSelected, 
    getSelectedItems,
    exitSelectionMode
  } = useBulkSelection();
  
  // Bulk action states
  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  
  // Bulk action handlers
  const handleBulkMove = useCallback(() => {
    setBulkMoveDialogOpen(true);
  }, []);

  const handleBulkDelete = useCallback(() => {
    setBulkDeleteDialogOpen(true);
  }, []);

  const handleBulkMoveSubmit = useCallback(async (targetPath: string) => {
    setBulkLoading(true);
    try {
      const selected = getSelectedItems(files);
      for (const item of selected) {
        const sourcePath = item.fullPath || item.sourcePath || `${currentPath}/${item.name}`.replace(/\/+/g, '/');
        await moveFile(sourcePath, targetPath);
      }
      setBulkMoveDialogOpen(false);
      exitSelectionMode();
      if (onDeleted) onDeleted();
    } catch (error) {
      console.error('Bulk move failed:', error);
      onError('Failed to move selected items');
    } finally {
      setBulkLoading(false);
    }
  }, [getSelectedItems, files, currentPath, exitSelectionMode, onDeleted, onError]);

  const handleBulkDeleteSubmit = useCallback(async () => {
    setBulkLoading(true);
    try {
      const selected = getSelectedItems(files);
      for (const item of selected) {
        const sourcePath = item.fullPath || item.sourcePath || `${currentPath}/${item.name}`.replace(/\/+/g, '/');
        await axios.post('/api/delete', { path: sourcePath });
      }
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
      if (onDeleted) onDeleted();
    } catch (error) {
      console.error('Bulk delete failed:', error);
      onError('Failed to delete selected items');
    } finally {
      setBulkLoading(false);
    }
  }, [getSelectedItems, files, currentPath, exitSelectionMode, onDeleted, onError]);

  if (files.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">
          This folder is empty.
        </Typography>
      </Box>
    );
  }

  if (isMobile) {
    return (
      <Box>
        <Paper
          elevation={3}
          sx={{
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          {files.map((file) => (
            <MobileListItem
              key={file.name}
              file={file}
              onItemClick={() => {
                if (isSelectionMode) {
                  toggleSelection(file);
                } else {
                  onItemClick(file);
                }
              }}
              formatDate={formatDate}
              menu={
                <FileActionMenu
                  file={file}
                  currentPath={currentPath}
                  onViewDetails={onViewDetails}
                  onRename={onRename}
                  onDeleted={onDeleted}
                  onError={onError}
                  onNavigateBack={onNavigateBack}
                />
              }
            />
          ))}
        </Paper>
        
        {/* Bulk Actions for Mobile */}
        <BulkActionsBar
          selectedItems={getSelectedItems(files)}
          onClose={exitSelectionMode}
          onMove={handleBulkMove}
          onDelete={handleBulkDelete}
          onSelectAll={() => selectAll(files)}
          isVisible={isSelectionMode && selectedItems.size > 0}
        />

        <BulkMoveDialog
          open={bulkMoveDialogOpen}
          onClose={() => setBulkMoveDialogOpen(false)}
          onMove={handleBulkMoveSubmit}
          selectedItems={getSelectedItems(files)}
          loading={bulkLoading}
        />

        <BulkDeleteDialog
          open={bulkDeleteDialogOpen}
          onClose={() => setBulkDeleteDialogOpen(false)}
          onDelete={handleBulkDeleteSubmit}
          selectedItems={getSelectedItems(files)}
          loading={bulkLoading}
        />
      </Box>
    );
  }

  return (
    <Box>
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
            ...(isSelectionMode ? {
              '&:first-of-type': { width: '60px' },
              '&:nth-of-type(2)': { width: 'calc(50% - 30px)' },
              '&:nth-of-type(3)': { width: '15%' },
              '&:nth-of-type(4)': { width: '25%' },
              '&:last-child': { width: '10%' },
            } : {
              '&:first-of-type': { width: '50%' },
              '&:nth-of-type(2)': { width: '15%' },
              '&:nth-of-type(3)': { width: '25%' },
              '&:last-child': { width: '10%' },
            }),
          },
        }}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              {isSelectionMode && (
                <TableCell padding="checkbox" sx={{ width: '60px', minWidth: '60px' }}>
                </TableCell>
              )}
              <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Modified</TableCell>
              <TableCell align="right"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {files.map((file) => (
              <TableRow
                key={file.name}
                data-file-name={file.name}
                hover
                onClick={() => {
                  if (isSelectionMode) {
                    toggleSelection(file);
                  } else {
                    onItemClick(file);
                  }
                }}
                sx={{
                  cursor: isSelectionMode ? 'pointer' : (file.type === 'directory' ? 'pointer' : 'default'),
                  transition: 'background-color 0.2s',
                  bgcolor: isSelected(file) ? theme.palette.primary.main + '10' : 'transparent',
                  borderLeft: isSelected(file) ? `4px solid ${theme.palette.primary.main}` : '4px solid transparent',
                  '&:hover': { 
                    bgcolor: isSelectionMode ? theme.palette.action.hover : 'action.hover' 
                  },
                  '&.alphabet-highlight': {
                    backgroundColor: theme.palette.primary.main + '20',
                    animation: 'pulse 2s ease-in-out',
                  },
                  '@keyframes pulse': {
                    '0%': { backgroundColor: theme.palette.primary.main + '40' },
                    '50%': { backgroundColor: theme.palette.primary.main + '20' },
                    '100%': { backgroundColor: 'transparent' },
                  }
                }}
              >
                {isSelectionMode && (
                  <TableCell padding="checkbox" sx={{ width: '60px', minWidth: '60px' }}>
                    <Checkbox
                      checked={isSelected(file)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleSelection(file);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      size="small"
                    />
                  </TableCell>
                )}
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
                <TableCell align="right" onClick={e => e.stopPropagation()}>
                  <FileActionMenu
                    file={file}
                    currentPath={currentPath}
                    onViewDetails={onViewDetails}
                    onRename={onRename}
                    onDeleted={onDeleted}
                    onError={onError}
                    onNavigateBack={onNavigateBack}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      
      {/* Bulk Actions */}
      <BulkActionsBar
        selectedItems={getSelectedItems(files)}
        onClose={exitSelectionMode}
        onMove={handleBulkMove}
        onDelete={handleBulkDelete}
        onSelectAll={() => selectAll(files)}
        isVisible={isSelectionMode && selectedItems.size > 0}
      />

      <BulkMoveDialog
        open={bulkMoveDialogOpen}
        onClose={() => setBulkMoveDialogOpen(false)}
        onMove={handleBulkMoveSubmit}
        selectedItems={getSelectedItems(files)}
        loading={bulkLoading}
      />

      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onClose={() => setBulkDeleteDialogOpen(false)}
        onDelete={handleBulkDeleteSubmit}
        selectedItems={getSelectedItems(files)}
        loading={bulkLoading}
      />
    </Box>
  );
} 