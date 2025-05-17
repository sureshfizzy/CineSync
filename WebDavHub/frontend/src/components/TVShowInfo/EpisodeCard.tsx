import React from 'react';
import { Paper, Box, Typography, IconButton } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FileActionMenu from '../FileBrowser/FileActionMenu';
import { EpisodeFileInfo, SeasonFolderInfo } from './types';

interface EpisodeCardProps {
  file: EpisodeFileInfo;
  ep: any;
  selectedSeasonFolder: SeasonFolderInfo;
  handleViewDetails: any;
  fetchSeasonFolders: any;
  handleDeleted: any;
  handleError: any;
  setVideoPlayerOpen: any;
  setSelectedFile: any;
}

const EpisodeCard: React.FC<EpisodeCardProps> = ({
  file,
  ep,
  selectedSeasonFolder,
  handleViewDetails,
  fetchSeasonFolders,
  handleDeleted,
  handleError,
  setVideoPlayerOpen,
  setSelectedFile,
}) => {
  return (
    <Paper elevation={2} sx={{ p: 0, borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: { xs: 'column', md: 'row' }, bgcolor: 'background.paper', boxShadow: theme => theme.palette.mode === 'light' ? '0 4px 24px rgba(0,0,0,0.10)' : 3, maxWidth: { xs: 340, md: 'none' }, mx: { xs: 'auto', md: 0 }, width: { xs: '100%', md: 'auto' } }}>
      {ep.still_path && (
        <Box
          sx={{ width: { xs: '100%', md: 180 }, minWidth: { xs: '100%', md: 120 }, flexShrink: 0, bgcolor: 'grey.900', position: 'relative', display: 'flex', alignItems: 'stretch', aspectRatio: { xs: '16/9', md: 'auto' }, maxHeight: { xs: 140, md: 'none' }, overflow: 'hidden', borderTopLeftRadius: { xs: 12, md: 20 }, borderTopRightRadius: { xs: 12, md: 0 }, borderBottomLeftRadius: { xs: 0, md: 20 }, cursor: 'pointer' }}
          onClick={() => {
            let relPath = file.path;
            const match = relPath.match(/([\/](Shows|Movies)[\/].*)$/i);
            if (match) {
              relPath = match[1].replace(/^\+|^\/+/, '');
            } else if (relPath.startsWith('/')) {
              relPath = relPath.replace(/^\/+/, '');
            }
            const encodedPath = encodeURIComponent(relPath);
            const streamUrl = `/api/stream/${encodedPath}`;
            setSelectedFile({ ...file, videoUrl: streamUrl });
            setVideoPlayerOpen(true);
          }}
        >
          <img
            src={`https://image.tmdb.org/t/p/w300${ep.still_path}`}
            alt={ep.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 0 }}
          />
          <IconButton
            aria-label="play"
            sx={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              bgcolor: 'rgba(0,0,0,0.6)',
              color: 'white',
              '&:hover': { bgcolor: 'primary.main' },
              width: 40,
              height: 40,
              zIndex: 2,
              pointerEvents: 'none',
            }}
          >
            <PlayArrowIcon sx={{ fontSize: 28 }} />
          </IconButton>
        </Box>
      )}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: { xs: 1.2, md: 3 }, justifyContent: 'center', minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'center', md: 'center' }, gap: 1, mb: 0.5, justifyContent: 'space-between', flexDirection: 'row', width: '100%' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: { xs: '0.98rem', md: '1.1rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ep.episode_number}. {ep.name}
            </Typography>
            {ep.runtime && <Typography variant="caption" color="text.secondary">{ep.runtime}m</Typography>}
            {ep.vote_average > 0 && (
              <Typography variant="caption" color="text.secondary">★ {ep.vote_average.toFixed(1)}</Typography>
            )}
            {ep.air_date && (
              <Typography variant="caption" color="text.secondary">{new Date(ep.air_date).toLocaleDateString()}</Typography>
            )}
          </Box>
          <FileActionMenu
            file={{ name: file.name, type: 'file', size: file.size, modified: file.modified, path: file.path, sourcePath: file.path }}
            currentPath={selectedSeasonFolder ? `${selectedSeasonFolder.folderName}`.replace(/^\/+/, '') : ''}
            onViewDetails={handleViewDetails}
            onRename={fetchSeasonFolders}
            onDeleted={handleDeleted}
            onError={handleError}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, minHeight: 30, maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', fontSize: { xs: '0.92rem', md: '1rem' } }}>{ep.overview}</Typography>
      </Box>
    </Paper>
  );
};

export default EpisodeCard; 