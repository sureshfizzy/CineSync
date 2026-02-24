import { Box, IconButton, useTheme, useMediaQuery } from '@mui/material';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import axios from 'axios';
import MovieHeader from './MovieHeader';
import CastList from './CastList';
import MediaPathInfo from '../FileBrowser/MediaPathInfo';
import { MovieInfoProps } from './types';

export default function MovieInfo({ data, getPosterUrl, folderName, currentPath, mediaType, onSearchMissing }: MovieInfoProps) {
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [selectedVersionIndex, setSelectedVersionIndex] = useState(0);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Detect if we're in ArrDashboard context
  const isArrDashboardContext = location.state?.returnPage === 1 && location.state?.returnSearch === '';

  // Handle both single file (legacy) and multiple files (new)
  const files = Array.isArray(fileInfo) ? fileInfo : (fileInfo ? [fileInfo] : []);
  const selectedFile = files[selectedVersionIndex] || files[0];

  // Reset selected version when fileInfo changes
  useEffect(() => {
    setSelectedVersionIndex(0);
  }, [fileInfo]);

  const handleNavigateBack = () => {
    navigate(-1);
  };

  useEffect(() => {
    async function fetchFiles() {
      try {
        setIsLoadingFiles(true);
        const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
        const folderPath = `${normalizedPath}/${folderName}`;
        const token = localStorage.getItem('cineSyncJWT');
        const headers: any = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const folderResponse = await axios.get(`/api/files${folderPath}`, { headers });
        const files = folderResponse.data;
        const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.ts', '.m2ts', '.mts', '.strm'];
        const mediaFiles = files.filter((file: any) => file.type === 'file' && videoExtensions.some((ext: string) => file.name.toLowerCase().endsWith(ext)));
        if (mediaFiles.length > 0) {
          // Ensure each file has all required properties for FileActionMenu
          const processedFiles = mediaFiles.map((file: any) => ({
            ...file,
            type: 'file' as const,
            fullPath: file.fullPath || `${folderPath}/${file.name}`,
            sourcePath: file.sourcePath || file.path || `${folderPath}/${file.name}`,
            webdavPath: file.webdavPath || `${folderPath}/${file.name}`,
            size: file.size ?? file.fileSize ?? file.filesize ?? '0 B',
            quality: file.quality ?? file.Quality ?? file.qualityProfile ?? '',
            modified: file.modified || new Date().toISOString()
          }));
          setFileInfo(processedFiles);
        }
      } catch (e) {
        setFileInfo(null);
      } finally {
        setIsLoadingFiles(false);
      }
    }
    fetchFiles();
  }, [folderName, currentPath]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: isMobile ? 0.2 : 0.3,
        ease: 'easeOut'
      }}
      style={{
        position: 'relative',
        willChange: 'opacity',
        transform: 'translateZ(0)',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden'
      }}
    >
      <IconButton
        onClick={() => navigate(-1)}
        sx={{
          position: 'absolute',
          top: { xs: -20, md: 'calc(-47px)' },
          left: { xs: -4, md: 'calc(-47px)' },
          zIndex: 10,
          bgcolor: 'background.paper',
          color: 'primary.main',
          boxShadow: 2,
          '&:hover': { bgcolor: 'primary.main', color: 'background.paper' },
          borderRadius: '50%',
          width: { xs: 36, md: 44 },
          height: { xs: 36, md: 44 },
        }}
        size={isMobile ? "medium" : "large"}
        aria-label="Back"
      >
        <ArrowBackIosNewIcon fontSize={isMobile ? "small" : "medium"} />
      </IconButton>
      <Box sx={{ width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: isMobile ? 10 : 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: isMobile ? 0.25 : 0.3,
            ease: [0.4, 0, 0.2, 1],
            delay: 0.1
          }}
          style={{
            willChange: 'opacity, transform',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Box sx={{ flex: 1 }}>
              <MovieHeader
                data={data}
                getPosterUrl={getPosterUrl}
                fileInfo={fileInfo}
                folderName={folderName}
                currentPath={currentPath}
                onNavigateBack={handleNavigateBack}
                selectedVersionIndex={selectedVersionIndex}
                onVersionChange={setSelectedVersionIndex}
                isArrDashboardContext={isArrDashboardContext}
                isLoadingFiles={isLoadingFiles}
                onSearchMissing={onSearchMissing}
              />
            </Box>
          </Box>
          <MediaPathInfo
            folderName={folderName}
            currentPath={currentPath}
            mediaType={mediaType}
            selectedFile={selectedFile}
            isParentLoading={isLoadingFiles}
          />
          <CastList data={data} getPosterUrl={getPosterUrl} />
        </motion.div>
      </Box>
    </motion.div>
  );
}
