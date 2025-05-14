import { Box, Typography, Chip, Paper, Avatar } from '@mui/material';
import { MediaDetailsData } from '../types/MediaTypes';
import MediaPathInfo from './MediaPathInfo';
import FileActionMenu from './FileActionMenu';
import axios from 'axios';
import { useEffect, useState } from 'react';

interface MovieInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
}

export default function MovieInfo({ data, getPosterUrl, folderName, currentPath, mediaType }: MovieInfoProps) {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
  const cast = (data.credits?.cast || []).slice(0, 8);
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;

  // Fetch movie file info for FileActionMenu
  const [fileInfo, setFileInfo] = useState<any>(null);
  useEffect(() => {
    async function fetchFile() {
      try {
        const normalizedPath = currentPath.replace(/\/+/g, '/').replace(/\/$/, '');
        const folderPath = `${normalizedPath}/${folderName}`;
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
  }, [folderName, currentPath]);

  return (
    <Box sx={{ width: '100%' }}>
      {/* Movie Details */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
        <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
          <img
            src={getPosterUrl(data.poster_path)}
            alt={data.title}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Paper>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            variant="h3"
            fontWeight={700}
            gutterBottom
            sx={{ mb: 1, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}
          >
            {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
          </Typography>
          {/* File actions as buttons - show below title on mobile/tablet, after description on desktop */}
          {fileInfo && (
            <Box
              sx={{
                mt: { xs: 1, sm: 1, md: 0 },
                mb: { xs: 2, sm: 2, md: 0 },
                display: { xs: 'flex', sm: 'flex', md: 'none' },
                justifyContent: 'center',
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
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {genres.map((g: { id: number; name: string }) => (
              <Chip key={g.id} label={g.name} color="primary" variant="outlined" />
            ))}
            {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" />}
            {data.status && <Chip label={data.status} color="default" variant="outlined" />}
            {country && <Chip label={country} color="default" variant="outlined" />}
          </Box>
          {data.tagline && (
            <Typography variant="h5" color="text.secondary" fontStyle="italic" gutterBottom sx={{ mb: 1, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}>
              {data.tagline}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {director && <Typography><b>Director:</b> {director.name}</Typography>}
            {writers && writers.length > 0 && (
              <Typography><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>
            )}
          </Box>
          <Typography variant="body1" sx={{ mb: 2, textAlign: { xs: 'center', sm: 'center', md: 'left' } }}>{data.overview}</Typography>
          {/* File actions as buttons - show after description on desktop only */}
          {fileInfo && (
            <Box
              sx={{
                mt: 2,
                mb: 2,
                display: { xs: 'none', sm: 'none', md: 'flex' },
                justifyContent: 'flex-start',
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
          )}
        </Box>
      </Box>

      {/* Media File Information Section */}
      <MediaPathInfo 
        folderName={folderName}
        currentPath={currentPath}
        mediaType={mediaType}
      />

      {/* Cast Section */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Cast</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', overflowX: 'auto', pb: 1 }}>
          {cast.map((actor: { id: number; name: string; character: string; profile_path: string | null }) => (
            <Box key={actor.id} sx={{ textAlign: 'center', width: 100 }}>
              <Avatar
                src={getPosterUrl(actor.profile_path, 'w185')}
                alt={actor.name}
                sx={{ width: 80, height: 80, mx: 'auto', mb: 1 }}
              />
              <Typography variant="body2" fontWeight={600}>{actor.name}</Typography>
              <Typography variant="caption" color="text.secondary">{actor.character}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
} 