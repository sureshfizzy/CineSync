import { Box, Card, CardContent, Typography, Avatar, IconButton, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Switch, Button, CircularProgress } from '@mui/material';
import { Movie as MovieIcon, Tv as TvIcon } from '@mui/icons-material';
import { useConfig } from '../../contexts/ConfigContext';

interface ConfigCardProps {
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string;
  posterUrl?: string;
  overview?: string;
  rootFolders: string[];
  config: {
    rootFolder: string;
    qualityProfile: string;
    monitorPolicy: string;
    seriesType?: string;
    seasonFolder: boolean;
  };
  onChange: (partial: Partial<ConfigCardProps['config']>) => void;
  onClose: () => void;
  onSubmit: () => void;
  submitting?: boolean;
}

export default function ArrConfigCard({ mediaType, title, year, posterUrl, overview, rootFolders, config, onChange, onClose, onSubmit, submitting }: ConfigCardProps) {
  const { config: runtime } = useConfig();
  const isTv = mediaType === 'tv';
  const destinationBase = runtime.destinationDir || '';
  return (
    <Card elevation={8} sx={{ borderRadius: 1, display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
      <CardContent sx={{ p: 0, flex: '1 1 auto', overflowY: 'auto' }}>
        {/* Title Row (sticky) */}
        <Box sx={{ position: 'sticky', top: 0, zIndex: 1, backgroundColor: 'background.paper', px: 2.5, py: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {title} {year && <Typography component="span" variant="body2" color="text.secondary">({year})</Typography>}
          </Typography>
          <IconButton size="small" onClick={onClose}>✕</IconButton>
        </Box>

        {/* Poster + Overview */}
        <Box sx={{ px: 2.5, pt: 2, pb: 2, display: 'flex', gap: 2 }}>
          <Avatar src={posterUrl} variant="rounded" sx={{ width: 96, height: 144 }}>
            {isTv ? <TvIcon /> : <MovieIcon />}
          </Avatar>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }}>
            {overview || ''}
          </Typography>
        </Box>

        {/* Form grid - arranged similar to *arr layout */}
        <Box sx={{ px: 2.5, pb: 2, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 1.5, columnGap: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Root Folder</Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>Root Folder</InputLabel>
            <Select
              value={config.rootFolder}
              label="Root Folder"
              onChange={(e) => onChange({ rootFolder: String(e.target.value) })}
              renderValue={(val) => {
                const v = String(val).replace(/\\/g, '/');
                const baseNoSlash = v.replace(/\/+$/, '');
                const titleText = `'${title}${year ? ` (${year})` : ''}'`;
                return (
                  <span style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%' }}>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        direction: 'rtl',
                        textAlign: 'left',
                        maxWidth: '100%',
                      }}
                    >
                      {baseNoSlash}
                    </span>
                    <span>/</span>
                    <span style={{ color: 'rgba(128,128,128,0.9)' }}>{titleText}</span>
                  </span>
                );
              }}
            >
              {rootFolders.map((p) => {
                const base = p;
                const sep = '/';
                const stripEnd = (s: string) => s.replace(/[\\/]+$/, '');
                const stripStart = (s: string) => s.replace(/^[\\/]+/, '');
                const value = destinationBase ? `${stripEnd(destinationBase)}${sep}${stripStart(base)}` : base;
                const normalized = value.replace(/\\/g, '/');
                const display = `${normalized}${normalized.endsWith('/') ? '' : '/'}${title}${year ? ` (${year})` : ''}`;
                return (
                  <MenuItem key={p} value={value}>{display}</MenuItem>
                );
              })}
            </Select>
          </FormControl>
          <Box />
          <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / span 2', mt: -0.5 }}>
            '{title}' subfolder will be created automatically at {config.rootFolder ? `${config.rootFolder}/${title}` : title}
          </Typography>

          {isTv && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Monitor</Typography>}
          {isTv && (
            <FormControl size="small" fullWidth>
              <InputLabel>Monitor</InputLabel>
              <Select value={config.monitorPolicy} label="Monitor" onChange={(e) => onChange({ monitorPolicy: String(e.target.value) })}>
                <MenuItem value="all">All Episodes</MenuItem>
                <MenuItem value="future">Future Episodes</MenuItem>
                <MenuItem value="missing">Missing Episodes</MenuItem>
                <MenuItem value="existing">Existing Episodes</MenuItem>
                <MenuItem value="first">First Season</MenuItem>
                <MenuItem value="latest">Latest Season</MenuItem>
                <MenuItem value="none">None</MenuItem>
              </Select>
            </FormControl>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Quality Profile</Typography>
          <FormControl size="small" fullWidth>
            <InputLabel>Quality Profile</InputLabel>
            <Select value={config.qualityProfile} label="Quality Profile" onChange={(e) => onChange({ qualityProfile: String(e.target.value) })}>
              <MenuItem value="HD-1080p">HD-1080p</MenuItem>
              <MenuItem value="HD-720p">HD-720p</MenuItem>
              <MenuItem value="4K">4K</MenuItem>
              <MenuItem value="Any">Any</MenuItem>
            </Select>
          </FormControl>

          {isTv && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Series Type</Typography>}
          {isTv && (
            <FormControl size="small" fullWidth>
              <InputLabel>Series Type</InputLabel>
              <Select value={config.seriesType} label="Series Type" onChange={(e) => onChange({ seriesType: String(e.target.value) })}>
                <MenuItem value="standard">Standard</MenuItem>
                <MenuItem value="anime">Anime</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
              </Select>
            </FormControl>
          )}
          {isTv && <Box />}
          {isTv && (
            <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / span 2', mt: -0.5 }}>
              Series type is used for renaming, parsing and searching
            </Typography>
          )}

          {isTv && <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Season Folder</Typography>}
          {isTv && (
            <FormControlLabel control={<Switch checked={!!config.seasonFolder} onChange={(e) => onChange({ seasonFolder: e.target.checked })} />} label="" />
          )}
        </Box>

      </CardContent>

      {/* Footer actions (fixed/sticky) */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', position: 'sticky', bottom: 0, backgroundColor: 'background.paper' }}>
          {isTv && (
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControlLabel control={<Switch size="small" />} label={<Typography variant="body2">Start search for missing episodes</Typography>} />
              <FormControlLabel control={<Switch size="small" />} label={<Typography variant="body2">Start search for cutoff unmet episodes</Typography>} />
            </Box>
          )}
          <Button variant="contained" onClick={onSubmit} disabled={submitting} startIcon={submitting ? <CircularProgress size={16} /> : undefined}>
            {submitting ? 'Adding...' : `Add ${title}`}
          </Button>
      </Box>
    </Card>
  );
}


