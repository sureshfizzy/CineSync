import { Box, IconButton, Tooltip } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import MovieHeader from './MovieHeader';
import CastList from './CastList';
import MediaPathInfo from '../FileBrowser/MediaPathInfo';
import { MovieInfoProps } from './types';

export default function MovieInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: MovieInfoProps) {
  const [fileInfo, setFileInfo] = useState<any>(null);
  const navigate = useNavigate();
  useEffect(() => {
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
  }, [folderName, currentPath]);

  return (
    <Box sx={{ position: 'relative' }}>
      <IconButton
        onClick={() => navigate(-1)}
        sx={{
          position: 'absolute',
          top: { xs: -24, md: 'calc(-47px)' },
          left: { xs: -8, md: 'calc(-47px)' },
          zIndex: 10,
          bgcolor: 'background.paper',
          color: 'primary.main',
          boxShadow: 2,
          '&:hover': { bgcolor: 'primary.main', color: 'background.paper' },
          borderRadius: '50%',
          width: 44,
          height: 44,
        }}
        size="large"
        aria-label="Back"
      >
        <ArrowBackIosNewIcon fontSize="medium" />
      </IconButton>
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <MovieHeader data={data} getPosterUrl={getPosterUrl} fileInfo={fileInfo} folderName={folderName} currentPath={currentPath} />
          </Box>
        </Box>
        <MediaPathInfo folderName={folderName} currentPath={currentPath} mediaType={mediaType} />
        <CastList data={data} getPosterUrl={getPosterUrl} />
      </Box>
    </Box>
  );
} 