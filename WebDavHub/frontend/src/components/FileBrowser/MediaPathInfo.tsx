import { Box, Typography, Tooltip, Paper, CircularProgress, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { useEffect, useState, useRef } from 'react';
import axios from 'axios';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { isSubtitleFileName, isVideoFileName } from './fileUtils';

interface MediaPathInfoProps {
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
  selectedFile?: any;
  isParentLoading?: boolean;
  tmdbId?: string | number;
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
  fileType?: 'video' | 'subtitle';
  sourcePath?: string;
  destinationPath?: string;
  path?: string;
  seasonNumber?: number;
  episodeNumber?: number;
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

interface SubtitleInfo {
  name: string;
  size: string;
  modified: string;
  path: string;
}

export default function MediaPathInfo({ folderName, currentPath, mediaType, selectedFile, isParentLoading, tmdbId }: MediaPathInfoProps) {
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [subtitleFiles, setSubtitleFiles] = useState<SubtitleInfo[]>([]);
  const lastRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedFile && isVideoFileName(selectedFile.name) && (selectedFile.destinationPath || selectedFile.fullPath || selectedFile.path)) {
      setPathInfo({
        webdavPath: selectedFile.webdavPath || `Home${selectedFile.path || ''}`,
        fullPath: selectedFile.destinationPath || selectedFile.fullPath || selectedFile.path,
        sourcePath: selectedFile.sourcePath || selectedFile.destinationPath || selectedFile.fullPath || selectedFile.path,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        modified: selectedFile.modified
      });
      setLoading(false);
      setError(null);
    }

    const baseKey = tmdbId ? `tmdb:${tmdbId}` : `${currentPath}|${folderName}`;
    const requestKey = `${baseKey}|${mediaType}|${selectedFile?.name || 'auto'}`;
    if (lastRequestKeyRef.current === requestKey) {
      // Already requested, skip
      return;
    }
    lastRequestKeyRef.current = requestKey;

    const findMediaFile = async () => {
      try {
        setLoading(true);

        if (tmdbId) {
          const resp = await axios.get('/api/media-files', { params: { tmdbId, mediaType, fileType: 'all' } });
          const allFiles: FileItem[] = Array.isArray(resp.data) ? resp.data : [];
          const mediaFiles = allFiles.filter(file => file.fileType === 'video' || isVideoFileName(file.name));
          const subtitles = allFiles.filter(file => file.fileType === 'subtitle' || isSubtitleFileName(file.name));
          setSubtitleFiles(subtitles.map(file => ({
            name: file.name,
            size: file.size || '--',
            modified: file.modified || '--',
            path: file.sourcePath || file.destinationPath || file.path || ''
          })));

          if (mediaType === 'tv') {
            const seasonMap: { [seasonNum: number]: EpisodeInfo[] } = {};
            for (const file of mediaFiles) {
              const seasonNum = (file as any).seasonNumber || 0;
              if (!seasonMap[seasonNum]) seasonMap[seasonNum] = [];
              seasonMap[seasonNum].push({
                name: file.name,
                size: file.size || '--',
                modified: file.modified || '--',
                path: (file as any).path || ''
              });
            }

            const seasonsData: SeasonInfo[] = Object.entries(seasonMap)
              .filter(([seasonNum, episodes]) => parseInt(seasonNum) > 0 && episodes.length > 0)
              .map(([seasonNum, episodes]) => ({
                name: `Season ${seasonNum}`,
                episodes: episodes.sort((a, b) => {
                  const aEp = parseInt(a.name.match(/[Ee](\d+)/)?.[1] || '0');
                  const bEp = parseInt(b.name.match(/[Ee](\d+)/)?.[1] || '0');
                  return aEp - bEp;
                })
              }));

            setSeasons(seasonsData);
            setLoading(false);
            return;
          }

          const mediaFile = mediaFiles[0];
          if (mediaFile) {
            setPathInfo({
              webdavPath: `Home${(mediaFile as any).path || ''}`,
              fullPath: (mediaFile as any).destinationPath || (mediaFile as any).fullPath || (mediaFile as any).path,
              sourcePath: (mediaFile as any).sourcePath || (mediaFile as any).destinationPath || (mediaFile as any).fullPath || (mediaFile as any).path,
              fileName: mediaFile.name,
              fileSize: mediaFile.size,
              modified: mediaFile.modified
            });
          }
          setLoading(false);
          return;
        }

        // If we don't have a folder name (e.g., TMDB-ID based routes), avoid indefinite loading
        if (!folderName) {
          setLoading(false);
          setError(null);
          lastRequestKeyRef.current = null;
          return;
        }

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
              isVideoFileName(file.name)
            );

            const episodes: EpisodeInfo[] = [];
            for (const episode of episodeFiles) {
              const relPath = `${seasonPath}/${episode.name}`;

              episodes.push({
                name: episode.name,
                size: episode.size || '--',
                modified: episode.modified || '--',
                path: relPath
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
          // Movie logic - use selectedFile if provided, otherwise find first media file
          let mediaFile = selectedFile;

          if (!isParentLoading) {
            const folderResponse = await axios.get(`/api/files${folderPath}`);
            const files: FileItem[] = folderResponse.data;

            setSubtitleFiles(files
              .filter(file => file.type === 'file' && isSubtitleFileName(file.name))
              .map(file => ({
                name: file.name,
                size: file.size || '--',
                modified: file.modified || '--',
                path: file.sourcePath || file.destinationPath || file.path || `${folderPath}/${file.name}`
              })));

            if (!mediaFile || !isVideoFileName(mediaFile.name)) {
              mediaFile = files.find(file =>
                file.type === 'file' &&
                isVideoFileName(file.name)
              );
            }
          }

          if (!mediaFile || !isVideoFileName(mediaFile.name)) {
            lastRequestKeyRef.current = null;
            setLoading(false);
            return;
          }

          const relPath = `${folderPath}/${mediaFile.name}`;

          setPathInfo({
            webdavPath: `Home${relPath}`,
            fullPath: mediaFile.destinationPath || `${folderPath}/${mediaFile.name}`,
            sourcePath: mediaFile.sourcePath || `${folderPath}/${mediaFile.name}`,
            fileName: mediaFile.name,
            fileSize: mediaFile.size,
            modified: mediaFile.modified
          });
        }
      } catch (err) {
        setError('Failed to fetch media file information');
      } finally {
        setLoading(false);
      }
    };

    if (folderName) {
      findMediaFile();
    }
  }, [folderName, currentPath, mediaType, selectedFile, isParentLoading, tmdbId]);

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

  const renderInfoRow = (label: string, value?: string, tooltip = false) => {
    if (!value) return null;

    const content = (
      <Typography variant="body2" sx={{
        fontFamily: 'monospace',
        bgcolor: 'action.hover',
        p: 1,
        borderRadius: 1,
        overflow: tooltip ? 'hidden' : undefined,
        textOverflow: tooltip ? 'ellipsis' : undefined,
        whiteSpace: tooltip ? 'nowrap' : undefined
      }}>
        {value}
      </Typography>
    );

    return (
      <Box>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: 0.5
          }}>
          {label}
        </Typography>
        {tooltip ? <Tooltip title={value} placement="top">{content}</Tooltip> : content}
      </Box>
    );
  };

  if (mediaType === 'tv') {
    if (seasons.length === 0) {
      return (
        <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              textAlign: 'center'
            }}>
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
  if (!pathInfo && subtitleFiles.length === 0) return null;

  return (
    <Paper elevation={1} sx={{ mt: 3, p: 2, bgcolor: 'background.paper', borderRadius: 2 }}>
      {pathInfo && (
        <>
          <Typography variant="subtitle1" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
            Media File Information
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {renderInfoRow('File Name', pathInfo.fileName)}
            {renderInfoRow('File Size', pathInfo.fileSize)}
            {renderInfoRow('Last Modified', formatDate(pathInfo.modified))}
            {renderInfoRow('Source Path (Actual Location)', pathInfo.sourcePath, true)}
            {renderInfoRow('Full Path', pathInfo.fullPath, true)}
          </Box>
        </>
      )}

      {subtitleFiles.length > 0 && (
        <Box sx={{ mt: pathInfo ? 3 : 0 }}>
          <Typography variant="subtitle1" color="primary" sx={{ mb: 2, fontWeight: 600 }}>
            Subtitle Files
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {subtitleFiles.map((subtitle) => (
              <Box key={`${subtitle.path}-${subtitle.name}`} sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {subtitle.name}
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, color: 'text.secondary', mt: 0.5 }}>
                  <Typography variant="body2">{subtitle.size}</Typography>
                  <Typography variant="body2">-</Typography>
                  <Typography variant="body2">{formatDate(subtitle.modified)}</Typography>
                </Box>
                {subtitle.path && (
                  <Tooltip title={subtitle.path} placement="top">
                    <Typography variant="body2" sx={{
                      fontFamily: 'monospace',
                      mt: 0.75,
                      fontSize: '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {subtitle.path}
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}