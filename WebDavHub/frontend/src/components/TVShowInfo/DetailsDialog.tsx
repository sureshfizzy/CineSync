import React from 'react';
import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, Divider, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { motion, AnimatePresence } from 'framer-motion';

interface DetailsDialogProps {
  open: boolean;
  onClose: () => void;
  selectedFile: any;
  detailsData: any;
}

const DetailsDialog: React.FC<DetailsDialogProps> = ({ open, onClose, selectedFile, detailsData }) => {
  const theme = useTheme();
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };
  function getFileIcon() {
    // Simple icon logic (can be improved)
    return null;
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: 3, boxShadow: theme => theme.palette.mode === 'light' ? '0 8px 32px 0 rgba(60,60,60,0.18), 0 1.5px 6px 0 rgba(0,0,0,0.10)' : theme.shadows[6] } }}>
      <DialogTitle
        sx={{
          fontWeight: 700,
          fontSize: '1.3rem',
          background: theme.palette.background.paper,
          borderBottom: `1px solid ${theme.palette.divider}`,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          p: 2.5,
          pr: 5
        }}
      >
        Details
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 12,
            top: 12,
            color: theme.palette.grey[500],
          }}
          size="large"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <AnimatePresence>
        {open && (
          <motion.div
            key="dialog-content"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            <DialogContent
              dividers={true}
              sx={{
                background: theme.palette.background.default,
                p: 3,
                borderBottomLeftRadius: 12,
                borderBottomRightRadius: 12,
                minWidth: 350,
                maxWidth: 600,
              }}
            >
              {detailsData && (
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    {getFileIcon()}
                    <Typography sx={{ ml: 2, fontWeight: 700, fontSize: '1.15rem', wordBreak: 'break-all', whiteSpace: 'normal' }}>{selectedFile?.name}</Typography>
                  </Box>
                  <Divider sx={{ mb: 2 }} />
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
                    <Typography variant="body2"><b>Type:</b> {selectedFile?.name ? (selectedFile.name.split('.').pop()?.toUpperCase() || 'File') : 'File'}</Typography>
                    <Typography variant="body2"><b>Size:</b> {detailsData?.size || selectedFile?.size || '--'}</Typography>
                    <Typography variant="body2"><b>Modified:</b> {formatDate(selectedFile?.modified)}</Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                      <b>WebDAV Path:</b> <span style={{ fontFamily: 'monospace' }}>
                        {detailsData?.webdavPath || (selectedFile?.path ? `Home/${selectedFile?.path.split('/').pop()}` : '--')}
                      </span>
                    </Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                      <b>Source Path:</b> <span style={{ fontFamily: 'monospace' }}>
                        {detailsData?.sourcePath || selectedFile?.path || '--'}
                      </span>
                    </Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>
                      <b>Full Path:</b> <span style={{ fontFamily: 'monospace' }}>
                        {detailsData?.fullPath || '--'}
                      </span>
                    </Typography>
                  </Box>
                </Box>
              )}
            </DialogContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
};

export default DetailsDialog;