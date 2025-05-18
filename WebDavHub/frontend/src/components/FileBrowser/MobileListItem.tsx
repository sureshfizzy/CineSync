import React from 'react';
import { Box, Typography } from '@mui/material';
import { getFileIcon } from './fileUtils.tsx';
import { MobileListItemProps } from './types';

const MobileListItem: React.FC<MobileListItemProps> = ({ file, onItemClick, formatDate, menu }) => {
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
      {menu}
    </Box>
  );
};

export default MobileListItem; 