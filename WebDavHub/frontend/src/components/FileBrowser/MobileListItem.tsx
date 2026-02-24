import React from 'react';
import { Box, Typography, Checkbox, Chip, useTheme, alpha } from '@mui/material';
import { getArrBadgeData, getFileIcon, getQualityTone } from './fileUtils.tsx';
import { MobileListItemProps } from './types';
import { useBulkSelection } from '../../contexts/BulkSelectionContext';

const MobileListItem: React.FC<MobileListItemProps> = ({ file, onItemClick, formatDate, menu, showArrBadges }) => {
  const theme = useTheme();
  const { isSelectionMode, isSelected, toggleSelection } = useBulkSelection();

  const handleClick = () => {
    if (isSelectionMode) {
      toggleSelection(file);
    } else {
      onItemClick();
    }
  };

  return (
    <Box
      data-file-name={file.name}
      onClick={handleClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        p: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        cursor: isSelectionMode ? 'pointer' : (file.type === 'directory' ? 'pointer' : 'default'),
        '&:active': {
          bgcolor: 'action.selected',
        },
        bgcolor: isSelected(file) ? theme.palette.primary.main + '10' : 'background.paper',
        borderLeft: isSelected(file) ? `4px solid ${theme.palette.primary.main}` : '4px solid transparent',
        '&:hover': {
          bgcolor: isSelectionMode ? theme.palette.action.hover : 'action.hover',
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
      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1 }}>
        {isSelectionMode && (
          <Box sx={{ mr: 2 }}>
            <Checkbox
              checked={isSelected(file)}
              onChange={(e) => {
                e.stopPropagation();
                toggleSelection(file);
              }}
              onClick={(e) => e.stopPropagation()}
              size="small"
            />
          </Box>
        )}
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
          {showArrBadges && (() => {
            const arrBadges = getArrBadgeData(file);
            const statusColor = arrBadges.statusTone === 'success'
              ? theme.palette.success.main
              : arrBadges.statusTone === 'warning'
              ? theme.palette.warning.main
              : arrBadges.statusTone === 'info'
              ? theme.palette.info.main
              : arrBadges.statusTone === 'error'
              ? theme.palette.error.main
              : theme.palette.text.secondary;
            const qualityTone = getQualityTone(arrBadges.quality);
            const qualityColor = qualityTone === 'warning'
              ? theme.palette.warning.main
              : qualityTone === 'info'
              ? theme.palette.info.main
              : qualityTone === 'success'
              ? theme.palette.success.main
              : theme.palette.text.secondary;

            return (
              <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {arrBadges.quality && (
                  <Chip
                    size="small"
                    label={arrBadges.quality}
                    sx={{
                      height: 18,
                      fontSize: '0.65rem',
                      bgcolor: alpha(qualityColor, 0.12),
                      color: qualityColor,
                    }}
                  />
                )}
                {arrBadges.monitored && (
                  <Chip
                    size="small"
                    label="Monitored"
                    sx={{
                      height: 18,
                      fontSize: '0.65rem',
                      bgcolor: alpha(theme.palette.info.main, 0.1),
                      color: theme.palette.info.main,
                    }}
                  />
                )}
                {arrBadges.statusLabel && (
                  <Chip
                    size="small"
                    label={arrBadges.statusLabel}
                    sx={{
                      height: 18,
                      fontSize: '0.65rem',
                      bgcolor: alpha(statusColor, 0.12),
                      color: statusColor,
                    }}
                  />
                )}
              </Box>
            );
          })()}

        </Box>
      </Box>
      {!isSelectionMode && menu}
    </Box>
  );
};

export default MobileListItem; 