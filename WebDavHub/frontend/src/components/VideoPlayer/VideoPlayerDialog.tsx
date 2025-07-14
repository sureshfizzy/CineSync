import React, { useMemo } from 'react';
import { Dialog, DialogContent, useMediaQuery, useTheme } from '@mui/material';
import VideoPlayer from './VideoPlayer';

interface VideoPlayerDialogProps {
  open: boolean;
  onClose: () => void;
  url: string;
  mimeType?: string;
  title?: string;
}

const VideoPlayerDialog: React.FC<VideoPlayerDialogProps> = ({
  open,
  onClose,
  url,
  mimeType,
  title,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  // For mobile, we'll handle the title in the VideoPlayer component
  const dialogTitle = useMemo(() => (isMobile ? '' : title), [isMobile, title]);

  return (
    <Dialog
      fullScreen
      open={open}
      onClose={onClose}
      sx={{
        '& .MuiDialog-paper': {
          bgcolor: '#000',
          margin: 0,
          maxHeight: '100%',
          maxWidth: '100%',
          borderRadius: 0,
        },
      }}
      title={dialogTitle}
      disableEscapeKeyDown={isMobile}
      disableScrollLock={true}
    >
      <DialogContent 
        sx={{ 
          p: 0, 
          height: '100%', 
          overflow: 'hidden',
          '&.MuiDialogContent-root': {
            padding: 0,
          }
        }}
      >
        <VideoPlayer 
          url={url} 
          mimeType={mimeType} 
          title={title} 
          onClose={onClose} 
          isInDialog={true}
        />
      </DialogContent>
    </Dialog>
  );
};

export default VideoPlayerDialog; 