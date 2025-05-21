import { Box, Typography, Chip, Paper, useTheme, useMediaQuery } from '@mui/material';
import { motion } from 'framer-motion';
import { MediaDetailsData } from '../../types/MediaTypes';
import MovieFileActions from './MovieFileActions';

interface MovieHeaderProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  fileInfo: any;
  folderName: string;
  currentPath: string;
}

const MovieHeader: React.FC<MovieHeaderProps> = ({ data, getPosterUrl, fileInfo, folderName, currentPath }) => {
  const releaseYear = data.release_date?.slice(0, 4);
  const runtime = data.runtime;
  const director = data.credits?.crew.find((c: { job: string }) => c.job === 'Director');
  const writers = data.credits?.crew.filter((c: { job: string }) => ['Screenplay', 'Writer'].includes(c.job));
  const genres = data.genres || [];
  const country = data.production_countries?.[0]?.name;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 2, md: 4 }, alignItems: { xs: 'center', md: 'flex-start' } }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ 
          duration: isMobile ? 0.25 : 0.3,
          ease: [0.4, 0, 0.2, 1]
        }}
        style={{ 
          willChange: 'transform, opacity',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden'
        }}
      >
        <Paper elevation={4} sx={{ overflow: 'hidden', borderRadius: 3, minWidth: 240, maxWidth: 320, width: { xs: '60vw', md: 260 }, flexShrink: 0 }}>
          <img
            src={getPosterUrl(data.poster_path)}
            alt={data.title}
            style={{ width: '100%', height: 'auto', display: 'block' }}
          />
        </Paper>
      </motion.div>
      <Box sx={{ flex: 1, minWidth: 0 }}>
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
          <Typography
            variant="h3"
            fontWeight={700}
            gutterBottom
            sx={{ 
              mb: 1, 
              textAlign: { xs: 'center', sm: 'center', md: 'left' },
              fontSize: { xs: '1.8rem', sm: '2rem', md: '2.5rem' }
            }}
          >
            {data.title} {releaseYear && <span style={{ color: '#aaa', fontWeight: 400 }}>({releaseYear})</span>}
          </Typography>
          <MovieFileActions data={data} folderName={folderName} currentPath={currentPath} placement="belowTitle" fileInfo={fileInfo} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap', justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {genres.map((g: { id: number; name: string }) => (
              <Chip key={g.id} label={g.name} color="primary" variant="outlined" size={isMobile ? "small" : "medium"} />
            ))}
            {runtime && <Chip label={`${runtime} min`} color="secondary" variant="outlined" size={isMobile ? "small" : "medium"} />}
            {data.status && <Chip label={data.status} color="default" variant="outlined" size={isMobile ? "small" : "medium"} />}
            {country && <Chip label={country} color="default" variant="outlined" size={isMobile ? "small" : "medium"} />}
          </Box>
          {data.tagline && (
            <Typography 
              variant="h5" 
              color="text.secondary" 
              fontStyle="italic" 
              gutterBottom 
              sx={{ 
                mb: 1, 
                textAlign: { xs: 'center', sm: 'center', md: 'left' },
                fontSize: { xs: '1rem', sm: '1.1rem', md: '1.25rem' }
              }}
            >
              {data.tagline}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2, justifyContent: { xs: 'center', sm: 'center', md: 'flex-start' } }}>
            {director && <Typography sx={{ fontSize: { xs: '0.9rem', md: '1rem' } }}><b>Director:</b> {director.name}</Typography>}
            {writers && writers.length > 0 && (
              <Typography sx={{ fontSize: { xs: '0.9rem', md: '1rem' } }}><b>Screenplay:</b> {writers.map(w => w.name).join(', ')}</Typography>
            )}
          </Box>
          <Typography 
            variant="body1" 
            sx={{ 
              mb: 2, 
              textAlign: { xs: 'center', sm: 'center', md: 'left' },
              fontSize: { xs: '0.95rem', md: '1rem' },
              lineHeight: { xs: 1.5, md: 1.6 }
            }}
          >
            {data.overview}
          </Typography>
          <MovieFileActions data={data} folderName={folderName} currentPath={currentPath} placement="belowDescription" fileInfo={fileInfo} />
        </motion.div>
      </Box>
    </Box>
  );
};

export default MovieHeader; 