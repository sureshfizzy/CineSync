import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { MediaDetailsData, SeasonFolderInfo } from './types';
import { motion, AnimatePresence } from 'framer-motion';

interface SeasonListProps {
  data: MediaDetailsData;
  seasonFolders: SeasonFolderInfo[];
  setSeasonDialogOpen: (open: boolean) => void;
  setSelectedSeason: (season: any) => void;
  setSelectedSeasonFolder: (folder: SeasonFolderInfo | null) => void;
}

const SeasonList: React.FC<SeasonListProps> = ({
  data,
  seasonFolders,
  setSeasonDialogOpen,
  setSelectedSeason,
  setSelectedSeasonFolder,
}) => {
  return (
    <>
      {data.seasons && data.seasons.length > 0 && (
        <Box sx={{ mt: 4 }}>
          <Typography variant="h6" fontWeight={600} gutterBottom>Seasons</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <AnimatePresence>
              {data.seasons.filter(s => s.season_number > 0).map((season: any, idx: number) => {
                const folder = seasonFolders.find(f => f.seasonNumber === season.season_number);
                const availableCount = folder ? folder.episodes.length : 0;
                const totalCount = season.episode_count || (season.episodes ? season.episodes.length : 0);
                return (
                  <motion.div
                    key={season.id}
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 30 }}
                    transition={{ duration: 0.5, ease: 'easeOut', delay: idx * 0.08 }}
                    style={{ width: '100%' }}
                  >
                    <Paper elevation={2} sx={{ p: 2, borderRadius: 2, cursor: folder ? 'pointer' : 'default', transition: 'box-shadow 0.2s', '&:hover': { boxShadow: 6, bgcolor: 'action.hover' } }}
                      onClick={() => {
                        if (folder) {
                          setSelectedSeason(season);
                          setSelectedSeasonFolder(folder);
                          setSeasonDialogOpen(true);
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        {season.poster_path && (
                          <Box sx={{ width: 100, flexShrink: 0 }}>
                            <img
                              src={`https://image.tmdb.org/t/p/w185${season.poster_path}`}
                              alt={season.name}
                              style={{ width: '100%', height: 'auto', borderRadius: 8 }}
                            />
                          </Box>
                        )}
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="h6" sx={{ mb: 1 }}>{season.name}</Typography>
                          <Box sx={{ display: 'flex', gap: 2, mb: 1, alignItems: 'center' }}>
                            <Typography variant="body2" color="text.secondary">
                              <span style={{ color: availableCount > 0 ? '#22c55e' : undefined, fontWeight: 700 }}>{availableCount}</span>
                              <span style={{ color: 'inherit', fontWeight: 400 }}>/</span>
                              <span style={{ color: 'inherit', fontWeight: 400 }}>{totalCount}</span> Episodes
                            </Typography>
                            {season.air_date && (
                              <Typography variant="body2" color="text.secondary">
                                Air Date: {new Date(season.air_date).toLocaleDateString()}
                              </Typography>
                            )}
                          </Box>
                          {season.overview && (
                            <Typography variant="body2">{season.overview}</Typography>
                          )}
                        </Box>
                      </Box>
                    </Paper>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </Box>
        </Box>
      )}
    </>
  );
};

export default SeasonList; 