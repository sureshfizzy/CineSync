import { Box, Typography, Tooltip, Paper, CircularProgress, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { useEffect, useState } from 'react';
import axios from 'axios';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface MediaPathInfoProps {
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

interface PathInfo {
  webdavPath?: string;
  fullPath?: string;
  sourcePath?: string;
  fileName?: string;
  fileSize?: string;
  modified?: string;
}

interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  isSeasonFolder?: boolean;
}

interface SeasonInfo {
  name: string;
  episodes: EpisodeInfo[];
}

interface EpisodeInfo {
  name: string;
  size: string;
  modified: string;
  path: string;
}

export default function MediaPathInfo({ folderName, currentPath, mediaType }: MediaPathInfoProps) {
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);

  useEffect(() => {
    const findMediaFile = async () => {
      try {
        setLoading(true);
        // Remove any double slashes and ensure proper path format
        const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
        const folderPath = `${normalizedPath}/${folderName}`;

        if (mediaType === 'tv') {
          // Get the TV show folder contents (seasons)
          const folderResponse = await axios.get(`/api/files${folderPath}`);
          const files: FileItem[] = folderResponse.data;
          
          // Filter season folders
          const seasonFolders = files.filter(file => 
            file.type === 'directory' && file.isSeasonFolder
          ).sort((a, b) => {
            const aNum = parseInt(a.name.match(/\d+/)?.[0] || '0');
            const bNum = parseInt(b.name.match(/\d+/)?.[0] || '0');
            return aNum - bNum;
          });

          // Get episodes for each season
          const seasonsData: SeasonInfo[] = [];
          for (const season of seasonFolders) {
            const seasonPath = `${folderPath}/${season.name}`;
            const seasonResponse = await axios.get(`/api/files${seasonPath}`);
            const episodeFiles = seasonResponse.data.filter((file: FileItem) => 
              file.type === 'file' && 
              ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'].some(ext => 
                file.name.toLowerCase().endsWith(ext)
              )
            );

            const episodes: EpisodeInfo[] = [];
            for (const episode of episodeFiles) {
              const relPath = `${seasonPath}/${episode.name}`;
              const pathInfo = await axios.post('/api/readlink', { path: relPath });
              episodes.push({
                name: episode.name,
                size: episode.size || '--',
                modified: episode.modified || '--',
                path: pathInfo.data.realPath || pathInfo.data.absPath || relPath
              });
            }

            seasonsData.push({
              name: season.name,
              episodes: episodes.sort((a, b) => {
                const aEp = parseInt(a.name.match(/[Ee](\d+)/)?.[1] || '0');
                const bEp = parseInt(b.name.match(/[Ee](\d+)/)?.[1] || '0');
                return aEp - bEp;
              })
            });
          }
          setSeasons(seasonsData);
        } else {
          // Existing movie logic
          const folderResponse = await axios.get(`/api/files${folderPath}`);
          const files: FileItem[] = folderResponse.data;

          const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v'];
          const mediaFile = files.find(file => 
            file.type === 'file' && 
            videoExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
          );

          if (!mediaFile) {
            throw new Error('No media file found in folder');
          }

          const relPath = `${folderPath}/${mediaFile.name}`;
          const res = await axios.post('/api/readlink', { path: relPath });
          setPathInfo({
            webdavPath: `Home${relPath}`,
            fullPath: res.data.absPath || '',
            sourcePath: res.data.realPath || res.data.absPath || '',
            fileName: mediaFile.name,
            fileSize: mediaFile.size,
            modified: mediaFile.modified
          });
        }
      } catch (err) {
        setError('Failed to fetch media file information');
        console.error('Error fetching media file info:', err);
      } finally {
        setLoading(false);
      }
    };

    if (folderName) {
      findMediaFile();
    }
  }, [folderName, currentPath, mediaType]);

  if (loading) {
    return (
      <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return null;
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  if (mediaType === 'tv') {
    if (seasons.length === 0) {
      return (
        <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
          <Typography variant="body1" color="text.secondary" sx={{ textAlign: 'center' }}>
            No season information available.
          </Typography>
        </Paper>
      );
    }

    return (
      <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
        <Typography variant="subtitle1" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
          TV Show Information
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {seasons.map((season, index) => (
            <Accordion key={season.name} defaultExpanded={index === 0}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {season.name} ({season.episodes.length} episodes)
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {season.episodes.map((episode) => (
                    <Box key={episode.name} sx={{ 
                      bgcolor: 'action.hover',
                      p: 1.5,
                      borderRadius: 1,
                      '&:hover': { bgcolor: 'action.selected' }
                    }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                        {episode.name}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary', fontSize: '0.875rem' }}>
                        <Typography variant="body2">{episode.size}</Typography>
                        <Typography variant="body2">•</Typography>
                        <Typography variant="body2">{formatDate(episode.modified)}</Typography>
                      </Box>
                      <Tooltip title={episode.path} placement="top">
                        <Typography variant="body2" sx={{
                          fontFamily: 'monospace',
                          mt: 1,
                          fontSize: '0.8rem',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {episode.path}
                        </Typography>
                      </Tooltip>
                    </Box>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      </Paper>
    );
  }

  // Movie view (existing code)
  if (!pathInfo) return null;

  return (
    <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
      <Typography variant="subtitle1" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
        Media File Information
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            File Name
          </Typography>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            bgcolor: 'action.hover',
            p: 1,
            borderRadius: 1
          }}>
            {pathInfo.fileName}
          </Typography>
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            File Size
          </Typography>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            bgcolor: 'action.hover',
            p: 1,
            borderRadius: 1
          }}>
            {pathInfo.fileSize}
          </Typography>
        </Box>

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            Last Modified
          </Typography>
          <Typography variant="body2" sx={{
            fontFamily: 'monospace',
            bgcolor: 'action.hover',
            p: 1,
            borderRadius: 1
          }}>
            {formatDate(pathInfo.modified)}
          </Typography>
        </Box>
        
        {pathInfo.sourcePath && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Source Path
            </Typography>
            <Tooltip title={pathInfo.sourcePath} placement="top">
              <Typography variant="body2" sx={{
                fontFamily: 'monospace',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {pathInfo.sourcePath}
              </Typography>
            </Tooltip>
          </Box>
        )}
        
        {pathInfo.fullPath && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Full Path
            </Typography>
            <Tooltip title={pathInfo.fullPath} placement="top">
              <Typography variant="body2" sx={{
                fontFamily: 'monospace',
                bgcolor: 'action.hover',
                p: 1,
                borderRadius: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
                {pathInfo.fullPath}
              </Typography>
            </Tooltip>
          </Box>
        )}
      </Box>
    </Paper>
  );
} 