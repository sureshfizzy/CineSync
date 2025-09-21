import React from 'react';
import { Box, Button, Typography, Chip, IconButton, useTheme, Tooltip, Fade, Slide, useMediaQuery } from '@mui/material';
import { Close as CloseIcon, DriveFileMove as MoveIcon, Delete as DeleteIcon, CheckCircle as SelectAllIcon } from '@mui/icons-material';
import { FileItem } from './types';

interface BulkActionsBarProps {
  selectedItems: FileItem[];
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  isVisible: boolean;
}

const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedItems,
  onClose,
  onMove,
  onDelete,
  onSelectAll,
  isVisible
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.between('sm', 'md'));

  if (!isVisible || selectedItems.length === 0) {
    return null;
  }

  const filesCount = selectedItems.filter(item => item.type === 'file').length;
  const foldersCount = selectedItems.filter(item => item.type === 'directory').length;

  return (
    <Fade in={isVisible} timeout={300}>
      <Box>
        <Slide direction="up" in={isVisible} timeout={300}>
          <Box
          sx={{
             position: 'fixed',
             bottom: 16,
             left: isMobile ? '0%' : (isTablet ? '20%' : '35%'),
             transform: 'translateX(-50%)',
             zIndex: 1300,
             bgcolor: theme.palette.background.paper,
             borderRadius: isMobile ? 2 : 3,
             boxShadow: theme.palette.mode === 'dark' 
               ? '0 8px 32px rgba(0,0,0,0.6)' 
               : '0 8px 32px rgba(0,0,0,0.2)',
             border: `1px solid ${theme.palette.divider}`,
             p: isMobile ? 1 : (isTablet ? 1.5 : 2),
             minWidth: isMobile ? 'auto' : (isTablet ? 500 : 400),
             maxWidth: isMobile ? 'calc(100vw - 16px)' : (isTablet ? '85vw' : '90vw'),
             width: isMobile ? 'calc(100vw - 16px)' : 'auto',
             mx: isMobile ? 1 : 0,
          }}
        >
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: isMobile ? 1 : (isTablet ? 1.5 : 2), 
              mb: isMobile ? 1.5 : (isTablet ? 1.5 : 2),
              flexDirection: isMobile ? 'column' : 'row'
            }}>
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: isMobile ? 0.5 : 1, 
                flex: 1,
                flexWrap: isMobile ? 'wrap' : 'nowrap',
                justifyContent: isMobile ? 'center' : 'flex-start'
              }}>
                <Typography variant={isMobile ? "body1" : (isTablet ? "h6" : "h6")} sx={{ fontWeight: 600 }}>
                  {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                </Typography>
                {filesCount > 0 && (
                  <Chip 
                    label={`${filesCount} file${filesCount !== 1 ? 's' : ''}`} 
                    size="small" 
                    color="primary" 
                    variant="outlined"
                    sx={{ fontSize: isMobile ? '0.7rem' : (isTablet ? '0.75rem' : '0.75rem') }}
                  />
                )}
                {foldersCount > 0 && (
                  <Chip 
                    label={`${foldersCount} folder${foldersCount !== 1 ? 's' : ''}`} 
                    size="small" 
                    color="secondary" 
                    variant="outlined"
                    sx={{ fontSize: isMobile ? '0.7rem' : (isTablet ? '0.75rem' : '0.75rem') }}
                  />
                )}
              </Box>
              <IconButton onClick={onClose} size="small" sx={{ 
                position: isMobile ? 'absolute' : 'relative',
                top: isMobile ? 8 : 'auto',
                right: isMobile ? 8 : 'auto'
              }}>
                <CloseIcon />
              </IconButton>
            </Box>

            <Box sx={{ 
              display: 'flex', 
              gap: isMobile ? 0.5 : (isTablet ? 0.75 : 1), 
              flexWrap: 'wrap',
              justifyContent: isMobile ? 'space-between' : (isTablet ? 'center' : 'flex-start'),
              width: '100%'
            }}>
              <Tooltip title="Select all items">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<SelectAllIcon />}
                  onClick={onSelectAll}
                  sx={{ 
                    minWidth: isMobile ? 60 : (isTablet ? 100 : 120),
                    fontSize: isMobile ? '0.7rem' : (isTablet ? '0.8rem' : '0.875rem'),
                    px: isMobile ? 0.5 : (isTablet ? 1.5 : 2),
                    flex: isMobile ? '1 1 auto' : 'none'
                  }}
                >
                  {isMobile ? 'All' : 'Select All'}
                </Button>
              </Tooltip>

              <Tooltip title="Move selected items">
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<MoveIcon />}
                  onClick={onMove}
                  sx={{ 
                    minWidth: isMobile ? 50 : (isTablet ? 80 : 100),
                    fontSize: isMobile ? '0.7rem' : (isTablet ? '0.8rem' : '0.875rem'),
                    px: isMobile ? 0.5 : (isTablet ? 1.5 : 2),
                    flex: isMobile ? '1 1 auto' : 'none'
                  }}
                >
                  Move
                </Button>
              </Tooltip>


              <Tooltip title="Delete selected items">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<DeleteIcon />}
                  onClick={onDelete}
                  sx={{ 
                    minWidth: isMobile ? 50 : (isTablet ? 80 : 100),
                    fontSize: isMobile ? '0.7rem' : (isTablet ? '0.8rem' : '0.875rem'),
                    px: isMobile ? 0.5 : (isTablet ? 1.5 : 2),
                    flex: isMobile ? '1 1 auto' : 'none',
                    borderColor: '#FF0000',
                    color: '#FF0000',
                    '&:hover': {
                      borderColor: '#FF0000',
                      bgcolor: 'rgba(255, 0, 0, 0.08)',
                    }
                  }}
                >
                  Delete
                </Button>
              </Tooltip>
            </Box>
          </Box>
        </Slide>
      </Box>
    </Fade>
  );
};

export default BulkActionsBar;
