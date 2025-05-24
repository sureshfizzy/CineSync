import { useEffect, useState, useRef } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import FileActionMenu from '../FileBrowser/FileActionMenu';
import { MediaDetailsData } from '../../types/MediaTypes';

interface MovieFileActionsProps {
  data: MediaDetailsData;
  folderName: string;
  currentPath: string;
  placement: 'belowTitle' | 'belowDescription';
  fileInfo?: any;
}

// Module-level cache to prevent duplicate fetches
const globalRequestCache = new Set<string>();

const MovieFileActions: React.FC<MovieFileActionsProps> = ({ data, folderName, currentPath, placement, fileInfo: fileInfoProp }) => {
  const [fileInfo, setFileInfo] = useState<any>(fileInfoProp || null);
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

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
        const folderResponse = await fetch(`/api/files${folderPath}`, { headers });
        const files = await folderResponse.json();
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

  return (
    <Box
      sx={{
        mt: placement === 'belowTitle' ? { xs: 1, sm: 1, md: 0 } : 2,
        mb: placement === 'belowTitle' ? { xs: 2, sm: 2, md: 0 } : 2,
        display: 'flex',
        justifyContent: placement === 'belowTitle' ? 'center' : 'flex-start',
      }}
    >
      <FileActionMenu
        file={fileInfo}
        currentPath={`${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}`}
        onViewDetails={() => {}}
        onRename={() => {}}
        onError={() => {}}
        variant="buttons"
      />
    </Box>
  );
};

export default MovieFileActions; 