import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import MovieHeader from './MovieHeader';
import CastList from './CastList';
import MediaPathInfo from '../FileBrowser/MediaPathInfo';
import { MovieInfoProps } from './types';

export default function MovieInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: MovieInfoProps) {
  const [fileInfo, setFileInfo] = useState<any>(null);
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
    <Box sx={{ width: '100%' }}>
      <MovieHeader data={data} getPosterUrl={getPosterUrl} fileInfo={fileInfo} folderName={folderName} currentPath={currentPath} />
      <MediaPathInfo folderName={folderName} currentPath={currentPath} mediaType={mediaType} />
      <CastList data={data} getPosterUrl={getPosterUrl} />
    </Box>
  );
} 