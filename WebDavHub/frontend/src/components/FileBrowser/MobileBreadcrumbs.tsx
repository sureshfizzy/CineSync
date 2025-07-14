import React from 'react';
import { Box, Link, Typography } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';

interface MobileBreadcrumbsProps {
  currentPath: string;
  onPathClick: (path: string) => void;
}

const MobileBreadcrumbs: React.FC<MobileBreadcrumbsProps> = ({ currentPath, onPathClick }) => {
  const pathParts = currentPath.split('/').filter(Boolean);

  if (pathParts.length === 0) {
    return <Typography fontWeight={500}>Home</Typography>;
  }

  if (pathParts.length === 1) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, width: '100%' }}>
        <Link
          component="button"
          onClick={() => onPathClick('/')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            color: 'primary.main',
            textDecoration: 'none',
            mr: 1,
          }}
        >
          <ArrowBackIosNewIcon fontSize="small" sx={{ mr: 0.5 }} />
          Home
        </Link>
        <Typography sx={{ mx: 0.5, color: 'text.secondary', fontWeight: 500 }}>/</Typography>
        <Typography fontWeight={500} noWrap sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {pathParts[0]}
        </Typography>
      </Box>
    );
  }

  // Show back arrow, parent, '/' separator, and current folder
  const parentPath = '/' + pathParts.slice(0, -1).join('/') + '/';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, width: '100%' }}>
      <Link
        component="button"
        onClick={() => onPathClick(parentPath)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          color: 'primary.main',
          textDecoration: 'none',
          mr: 1,
        }}
      >
        <ArrowBackIosNewIcon fontSize="small" sx={{ mr: 0.5 }} />
        {pathParts[pathParts.length - 2]}
      </Link>
      <Typography sx={{ mx: 0.5, color: 'text.secondary', fontWeight: 500 }}>/</Typography>
      <Typography fontWeight={500} noWrap sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {pathParts[pathParts.length - 1]}
      </Typography>
    </Box>
  );
};

export default MobileBreadcrumbs; 