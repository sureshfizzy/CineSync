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
  onError?: (error: string) => void;
  onNavigateBack?: () => void;
}

// Module-level cache to prevent duplicate fetches
const globalRequestCache = new Set<string>();

const MovieFileActions: React.FC<MovieFileActionsProps> = ({
  folderName,
  currentPath,
  placement,
  fileInfo: fileInfoProp,
  onError,
  onNavigateBack
}) => {
  const [fileInfo, setFileInfo] = useState<any>(fileInfoProp || null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const filePath = `${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}${folderName ? `/${folderName}` : ''}`;

  useEffect(() => {
    if (fileInfoProp) {
      // Handle both single file and array of files - for this component we just need one file
      const singleFile = Array.isArray(fileInfoProp) ? fileInfoProp[0] : fileInfoProp;
      setFileInfo(singleFile);
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
        const folderResponse = await axios.get(`/api/files${folderPath}`, { headers });
        const files = folderResponse.data;
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'];
        const mediaFile = files.find((file: any) => file.type === 'file' && videoExtensions.some((ext: string) => file.name.toLowerCase().endsWith(ext)));
        if (mediaFile) {
          // Ensure the file has all required properties
          setFileInfo({
            ...mediaFile,
            type: 'file' as const,
            fullPath: mediaFile.fullPath || `${folderPath}/${mediaFile.name}`,
            sourcePath: mediaFile.sourcePath || mediaFile.path || `${folderPath}/${mediaFile.name}`,
            webdavPath: mediaFile.webdavPath || `${folderPath}/${mediaFile.name}`,
            size: mediaFile.size || '0 B',
            modified: mediaFile.modified || new Date().toISOString()
          });
        }
      } catch (e) {
        setFileInfo(null);
      }
    }
    fetchFile();
  }, [folderName, currentPath, fileInfoProp]);

  if (!fileInfo) return null;

  // Placement logic: render on all screen sizes for belowDescription
  if (placement === 'belowTitle' && isDesktop) return null;

  const handleError = (error: string) => {
    onError?.(error);
  };

  const handleRename = () => window.location.reload();
  const handleModify = () => setModifyDialogOpen(true);
  const handleModifyClose = () => setModifyDialogOpen(false);



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
            name: folderName || 'Unknown Folder',
            type: 'directory' as const,
            fullPath: filePath,
            sourcePath: filePath,
            webdavPath: filePath,
            path: filePath,
            size: '0 B',
            modified: new Date().toISOString()
          }}
          currentPath={currentPath}
          onViewDetails={() => {}}
          onRename={handleRename}
          onModify={handleModify}
          onError={handleError}
          onNavigateBack={onNavigateBack}
          variant="buttons"
        />
        {modifyDialogOpen && (
          <ModifyDialog
            open={modifyDialogOpen}
            onClose={handleModifyClose}
            onNavigateBack={onNavigateBack}
            currentFilePath={fileInfo.fullPath || fileInfo.sourcePath || fullFilePath}
          />
        )}
      </>
    </Box>
  );
};

export default MovieFileActions;