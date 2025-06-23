import { useEffect, useState, useRef } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import axios from 'axios';
import FileActionMenu from '../FileBrowser/FileActionMenu';
import { MediaDetailsData } from './types';
import ModifyDialog from '../FileBrowser/ModifyDialog/ModifyDialog';

interface ShowFileActionsProps {
  data: MediaDetailsData;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
  placement: 'belowTitle' | 'belowDescription';
  fileInfo?: any;
  onRename?: (file: any) => void;
  onError?: (error: string) => void;
  refreshTrigger?: number; // Add refresh trigger prop
  onNavigateBack?: () => void;
}

const ShowFileActions: React.FC<ShowFileActionsProps> = ({
  folderName,
  currentPath,
  mediaType,
  placement,
  fileInfo: fileInfoProp,
  onRename,
  onError,
  refreshTrigger,
  onNavigateBack
}) => {
  const [fileInfo, setFileInfo] = useState<any>(fileInfoProp || null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const filePath = `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}${folderName ? `/${folderName}` : ''}`;
  const lastFetchRef = useRef<string>('');

  useEffect(() => {
    if (fileInfoProp) {
      setFileInfo(fileInfoProp);
      return;
    }

    // Create a unique request key that includes refreshTrigger to force refresh when needed
    const requestKey = `${folderName}|${currentPath}|${refreshTrigger || 0}`;

    // Skip if this exact request was already made
    if (lastFetchRef.current === requestKey) {
      return;
    }

    lastFetchRef.current = requestKey;

    async function fetchFile() {
      try {
        const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
        const folderPath = `${normalizedPath}/${folderName}`;
        const token = localStorage.getItem('cineSyncJWT');
        const headers: any = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const folderResponse = await axios.get(`/api/files${folderPath}`);
        const files = folderResponse.data;
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'];
        const mediaFile = files.find((file: any) => file.type === 'file' && videoExtensions.some((ext: string) => file.name.toLowerCase().endsWith(ext)));
        if (mediaFile) {
          setFileInfo({ ...mediaFile, type: 'file' });
        } else {
          // If no video file found, use the folder itself for actions
          setFileInfo({ name: folderName, type: 'directory' });
        }
      } catch (e) {
        // If no specific file found, use the folder itself for actions
        setFileInfo({ name: folderName, type: 'directory' });
      }
    }
    fetchFile();
  }, [folderName, currentPath, fileInfoProp, refreshTrigger]);

  if (!fileInfo) return null;

  // Placement logic: only render if matches current screen size
  if (placement === 'belowTitle' && isDesktop) return null;
  if (placement === 'belowDescription' && !isDesktop) return null;

  const handleError = (error: string) => {
    onError?.(error);
  };

  const handleRename = () => {
    // Trigger refresh instead of full page reload
    onRename?.(fileInfo);
  };
  const handleModify = () => setModifyDialogOpen(true);
  const handleModifyClose = () => setModifyDialogOpen(false);

  return (
    <Box
      sx={{
        mt: placement === 'belowTitle' ? { xs: 1, sm: 1, md: 0 } : 2,
        mb: placement === 'belowTitle' ? { xs: 2, sm: 2, md: 0 } : 2,
        display: 'flex',
        justifyContent: placement === 'belowTitle' ? 'center' : 'flex-start',
      }}
    >
      <>
        <FileActionMenu
          file={{
            ...fileInfo,
            fullPath: filePath,
            sourcePath: filePath,
          }}
          currentPath={filePath}
          onViewDetails={() => {}}
          onRename={handleRename}
          onModify={handleModify}
          onError={handleError}
          onNavigateBack={onNavigateBack}
          variant="buttons"
        />
        <ModifyDialog
          open={modifyDialogOpen}
          onClose={handleModifyClose}
          onNavigateBack={onNavigateBack}
          currentFilePath={filePath}
          mediaType={mediaType}
          useBatchApply={true}
        />
      </>
    </Box>
  );
};

export default ShowFileActions;
