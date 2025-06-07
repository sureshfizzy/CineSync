import { useEffect, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import axios from 'axios';
import FileActionMenu from '../FileBrowser/FileActionMenu';
import { MediaDetailsData } from '../../types/MediaTypes';
import ModifyDialog from '../FileBrowser/ModifyDialog/ModifyDialog';

interface MovieFileActionsProps {
  data: MediaDetailsData;
  folderName: string;
  currentPath: string;
  placement: 'belowTitle' | 'belowDescription';
  fileInfo?: any;
  onRename?: (file: any) => void;
  onError?: (error: string) => void;
}

// Module-level cache to prevent duplicate fetches
const globalRequestCache = new Set<string>();

const MovieFileActions: React.FC<MovieFileActionsProps> = ({
  folderName,
  currentPath,
  placement,
  fileInfo: fileInfoProp,
  onRename,
  onError
}) => {
  const [fileInfo, setFileInfo] = useState<any>(fileInfoProp || null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const filePath = `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}${folderName ? `/${folderName}` : ''}`;

  useEffect(() => {
    if (fileInfoProp) {
      setFileInfo(fileInfoProp);
      return;
    }
    const requestKey = `${folderName}|${currentPath}`;
    if (globalRequestCache.has(requestKey)) {
      return;
    }
    globalRequestCache.add(requestKey);
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
        }
      } catch (e) {
        setFileInfo(null);
      }
    }
    fetchFile();
  }, [folderName, currentPath, fileInfoProp]);

  if (!fileInfo) return null;

  // Placement logic: only render if matches current screen size
  if (placement === 'belowTitle' && isDesktop) return null;
  if (placement === 'belowDescription' && !isDesktop) return null;

  const handleError = (error: string) => {
    onError?.(error);
  };

  const handleRename = () => window.location.reload();
  const handleModify = () => setModifyDialogOpen(true);
  const handleModifyClose = () => setModifyDialogOpen(false);

  const handleModifySubmit = async (selectedOption: string, selectedIds: Record<string, string>) => {
    try {
      const params = new URLSearchParams();

      if (selectedOption && selectedOption !== 'id') {
        params.append(selectedOption, 'true');
      }

      Object.entries(selectedIds).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });

      const fullFilePath = filePath.endsWith(fileInfo.name) ? filePath : `${filePath}/${fileInfo.name}`;
      const response = await axios.post(`/api/process-file?${params.toString()}`, {
        path: fileInfo.fullPath || fileInfo.sourcePath || fullFilePath
      });

      handleError(response.data.message || 'File processing completed');
      onRename?.(fileInfo);
    } catch (error: any) {
      handleError(`Failed to process file: ${error.response?.data?.error || error.message}`);
    }
  };

  const fullFilePath = filePath.endsWith(fileInfo.name) ? filePath : `${filePath}/${fileInfo.name}`;

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
            fullPath: fullFilePath,
            sourcePath: fullFilePath,
          }}
          currentPath={filePath}
          onViewDetails={() => {}}
          onRename={handleRename}
          onModify={handleModify}
          onError={handleError}
          variant="buttons"
        />
        <ModifyDialog
          open={modifyDialogOpen}
          onClose={handleModifyClose}
          onSubmit={handleModifySubmit}
          currentFilePath={fileInfo.fullPath || fileInfo.sourcePath || fullFilePath}
          mediaType="movie"
        />
      </>
    </Box>
  );
};

export default MovieFileActions;