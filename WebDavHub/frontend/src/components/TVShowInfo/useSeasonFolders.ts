import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import { SeasonFolderInfo, MediaDetailsData } from './types';
import { useSymlinkCreatedListener } from '../../hooks/useMediaHubUpdates';

interface UseSeasonFoldersProps {
  data: MediaDetailsData;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
  setSnackbar: (snackbar: { open: boolean, message: string, severity: 'success' | 'error' }) => void;
}

export default function useSeasonFolders({ data, folderName, currentPath, mediaType, setSnackbar }: UseSeasonFoldersProps) {
  const [seasonFolders, setSeasonFolders] = useState<SeasonFolderInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [errorFiles, setErrorFiles] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [videoPlayerOpen, setVideoPlayerOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [detailsData, setDetailsData] = useState<any>(null);
  const [renameValue, setRenameValue] = useState('');
  const lastRequestKeyRef = useRef<string | null>(null);

  async function fetchSeasonFolders() {
    setLoadingFiles(true);
    setErrorFiles(null);
    try {
      const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
      const showFolderPath = `${normalizedPath}/${folderName}`;
      async function collectVideoFiles(path: string): Promise<{ file: any; relPath: string }[]> {
        const res = await axios.get(`/api/files${path}`);
        const items: any[] = res.data;
        let result: { file: any; relPath: string }[] = [];
        for (const item of items) {
          if (item.type === 'directory') {
            result = result.concat(await collectVideoFiles(`${path}/${item.name}`));
          } else if (
            item.type === 'file' &&
            ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm', '.ts', '.m2ts', '.mts', '.strm']
              .some(ext => item.name.toLowerCase().endsWith(ext))
          ) {
            result.push({ file: item, relPath: `${path}/${item.name}` });
          }
        }
        return result;
      }
      const allVideoFiles = await collectVideoFiles(showFolderPath);
      const seasonMap: { [seasonNum: number]: any[] } = {};
      for (const { file } of allVideoFiles) {
        let seasonNum: number | undefined = file.seasonNumber;
        let episodeNum: number | undefined = file.episodeNumber;

        if (seasonNum === undefined || seasonNum === null) {
          let match = file.name.match(/S(\d{1,2})\.?E(\d{1,2})/i) || file.name.match(/s(\d{2})\.?e(\d{2})/i);
          if (match) {
            seasonNum = parseInt(match[1], 10);
            episodeNum = parseInt(match[2], 10);
          } else {
            match = file.name.match(/(\d{1,2})x(\d{2})/i);
            if (match) {
              seasonNum = parseInt(match[1], 10);
              episodeNum = parseInt(match[2], 10);
            }
          }
        }

        if (seasonNum === undefined || seasonNum === null) {
          seasonNum = 0;
        }
        if (!seasonMap[seasonNum]) seasonMap[seasonNum] = [];
        seasonMap[seasonNum].push({
          name: file.name,
          size: file.size || file.fileSize || file.filesize || '--',
          quality: file.quality || file.Quality || file.qualityProfile || '',
          modified: file.modified || '--',
          path: (file.path as string) || '',
          episodeNumber: episodeNum || file.episodeNumber
        });
      }
      const seasonFoldersData: SeasonFolderInfo[] = Object.entries(seasonMap)
        .filter(([seasonNum, episodes]) => parseInt(seasonNum) > 0 && episodes.length > 0)
        .map(([seasonNum, episodes]) => ({
          folderName: `Season ${seasonNum}`,
          seasonNumber: parseInt(seasonNum),
          episodes: (episodes as any[]).sort((a, b) => (a.episodeNumber || 0) - (b.episodeNumber || 0))
        }));
      setSeasonFolders(seasonFoldersData);
    } catch (err) {
      setErrorFiles('Failed to fetch episode file information');
    } finally {
      setLoadingFiles(false);
    }
  }

  useEffect(() => {
    if (mediaType === 'tv' && folderName) {
      const requestKey = `${folderName}|${currentPath}|${mediaType}`;
      if (lastRequestKeyRef.current === requestKey) {
        return;
      }
      lastRequestKeyRef.current = requestKey;
      fetchSeasonFolders();
    }
    // eslint-disable-next-line
  }, [folderName, currentPath, mediaType, data.seasons, data.id]);

  useSymlinkCreatedListener((data) => {
    if (mediaType === 'tv' && (
      data.media_name === folderName ||
      data.show_name === folderName ||
      (data.destination_file && currentPath && folderName &&
       data.destination_file.includes(`${currentPath}/${folderName}`))
    )) {
      fetchSeasonFolders();
    }
  }, [mediaType, folderName, currentPath, fetchSeasonFolders]);

  // Handlers for FileActionMenu
  const handleViewDetails = async (file: any, details: any) => {
    setSelectedFile(file);
    setDetailsDialogOpen(true);
    setDetailsData({ loading: true });
    try {
      const res = await axios.post('/api/readlink', { path: file.path });
      const webdavPath = details?.webdavPath || `Home${currentPath.replace(/\/+/g, '/').replace(/\/$/, '')}/${folderName}/${file.name}`;

      // Use database file size if available from readlink response
      let fileSize = file.size;
      if (res.data.foundInDB && res.data.formattedSize) {
        fileSize = res.data.formattedSize;
      }

      setDetailsData({
        ...details,
        webdavPath,
        sourcePath: res.data.realPath || res.data.absPath || file.path,
        fullPath: res.data.absPath || file.path,
        size: fileSize,
        quality: file.quality || file.Quality || file.qualityProfile || ''
      });
    } catch (err) {
      setDetailsData({ ...details, error: 'Failed to resolve file path' });
    }
  };
  const handleRename = (file: any) => {
    setSelectedFile(file);
    setRenameValue(file.name);
    setRenameDialogOpen(true);
  };
  const handleDeleted = () => {
    setSelectedFile(null);
    setSnackbar({ open: true, message: 'File deleted', severity: 'success' });
    fetchSeasonFolders();
  };
  const handleError = (msg: string) => {
    setSnackbar({ open: true, message: msg, severity: 'error' });
  };
  const handleRenameConfirm = async () => {
    if (!selectedFile || !renameValue) return;
    try {
      await axios.post('/api/rename', {
        oldPath: selectedFile.path,
        newName: renameValue
      });
      setRenameDialogOpen(false);
      setSnackbar({ open: true, message: 'File renamed', severity: 'success' });
      fetchSeasonFolders();
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.response?.data || 'Rename failed', severity: 'error' });
    }
  };
  const handleDeleteConfirm = async () => {
    if (!selectedFile) return;
    try {
      await axios.post('/api/delete', { path: selectedFile.path });
      setDeleteDialogOpen(false);
      setSnackbar({ open: true, message: 'File deleted', severity: 'success' });
      fetchSeasonFolders();
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.response?.data || 'Delete failed', severity: 'error' });
    }
  };

  return {
    seasonFolders,
    loadingFiles,
    errorFiles,
    fetchSeasonFolders,
    handleViewDetails,
    handleRename,
    handleDeleted,
    handleError,
    handleRenameConfirm,
    handleDeleteConfirm,
    renameDialogOpen,
    setRenameDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    detailsDialogOpen,
    setDetailsDialogOpen,
    selectedFile,
    setSelectedFile,
    detailsData,
    setDetailsData,
    renameValue,
    setRenameValue,
    videoPlayerOpen,
    setVideoPlayerOpen,
  };
}