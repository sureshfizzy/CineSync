import React from 'react';
import {
  Dialog,
  DialogContent,
  IconButton,
  AppBar,
  Toolbar,
  Typography,
  Box,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import VideoPlayer from './VideoPlayer';

interface VideoPlayerDialogProps {
  open: boolean;
  onClose: () => void;
  url: string;
  title: string;
  mimeType?: string;
}

const VideoPlayerDialog: React.FC<VideoPlayerDialogProps> = ({
  open,
  onClose,
  url,
  title,
  mimeType,
}) => {
  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDialog-paper': {
          bgcolor: '#000',
        },
      }}
    >
      <AppBar position="relative" color="transparent" sx={{ bgcolor: 'rgba(0, 0, 0, 0.85)' }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flex: 1, color: '#fff' }}>
            {title}
          </Typography>
          <IconButton
            edge="end"
            color="inherit"
            onClick={onClose}
            aria-label="close"
            sx={{ color: '#fff' }}
          >
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <DialogContent sx={{ p: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ width: '100%', height: '100%', maxHeight: 'calc(100vh - 64px)' }}>
          <VideoPlayer url={url} mimeType={mimeType} title={title} />
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default VideoPlayerDialog; 