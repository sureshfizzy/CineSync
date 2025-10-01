import React, { useState } from 'react';
import { Box, Typography, Paper, Collapse, IconButton, alpha, useTheme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { MediaDetailsData, SeasonFolderInfo } from './types';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchEpisodesFromTmdb } from '../api/tmdbApi';

interface SeasonListProps {
  data: MediaDetailsData;
  seasonFolders: SeasonFolderInfo[];
  setSeasonDialogOpen: (open: boolean) => void;
  setSelectedSeason: (season: any) => void;
  setSelectedSeasonFolder: (folder: SeasonFolderInfo | null) => void;
  isArrDashboardContext?: boolean;
}

const SeasonList: React.FC<SeasonListProps> = ({
  data,
  seasonFolders,
  setSeasonDialogOpen,
  setSelectedSeason,
  setSelectedSeasonFolder,
  isArrDashboardContext = false,
}) => {
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [episodesData, setEpisodesData] = useState<Map<number, any[]>>(new Map());
  const [loadingEpisodes, setLoadingEpisodes] = useState<Set<number>>(new Set());
  const theme = useTheme();

  // Function to fetch episodes for a season
  const fetchEpisodesForSeason = async (seasonNumber: number) => {
    if (episodesData.has(seasonNumber) || loadingEpisodes.has(seasonNumber)) {
      return;
    }

    setLoadingEpisodes(prev => new Set(prev).add(seasonNumber));
    
    try {
      const episodes = await fetchEpisodesFromTmdb(data.id.toString(), seasonNumber);
      setEpisodesData(prev => new Map(prev).set(seasonNumber, episodes));
    } catch (error) {
      console.error('Failed to fetch episodes for season', seasonNumber, error);
    } finally {
      setLoadingEpisodes(prev => {
        const newSet = new Set(prev);
        newSet.delete(seasonNumber);
        return newSet;
      });
    }
  };

  // Function to toggle season expansion
  const toggleSeasonExpansion = (seasonNumber: number) => {
    if (!isArrDashboardContext) return;
    
    const newExpanded = new Set(expandedSeasons);
    if (newExpanded.has(seasonNumber)) {
      newExpanded.delete(seasonNumber);
    } else {
      newExpanded.add(seasonNumber);
      fetchEpisodesForSeason(seasonNumber);
    }
    setExpandedSeasons(newExpanded);
  };

  // Function to check if episode is available
  const isEpisodeAvailable = (seasonNumber: number, episodeNumber: number) => {
    const folder = seasonFolders.find(f => f.seasonNumber === seasonNumber);
    if (!folder) return false;
    return folder.episodes.some(ep => ep.episodeNumber === episodeNumber);
  };
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
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 15 }}
                    transition={{ 
                      duration: 0.3,
                      ease: [0.4, 0, 0.2, 1],
                      delay: idx * 0.05,
                      opacity: { duration: 0.2 },
                      y: { duration: 0.3 }
                    }}
                    style={{ 
                      width: '100%',
                      willChange: 'opacity, transform'
                    }}
                  >
                    <Paper 
                      elevation={2} 
                      sx={{ 
                        p: 2, 
                        borderRadius: 2, 
                        cursor: (folder && !isArrDashboardContext) ? 'pointer' : 'default', 
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', 
                        '&:hover': { 
                          boxShadow: 6, 
                          bgcolor: 'action.hover',
                          transform: (folder && !isArrDashboardContext) ? 'translateY(-2px)' : 'none'
                        } 
                      }}
                      onClick={() => {
                        if (folder && !isArrDashboardContext) {
                          setSelectedSeason(season);
                          setSelectedSeasonFolder(folder);
                          setSeasonDialogOpen(true);
                        } else if (isArrDashboardContext) {
                          toggleSeasonExpansion(season.season_number);
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
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Typography variant="h6">{season.name}</Typography>
                            {isArrDashboardContext && (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSeasonExpansion(season.season_number);
                                }}
                                sx={{
                                  transform: expandedSeasons.has(season.season_number) ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.2s ease-in-out'
                                }}
                              >
                                <ExpandMoreIcon />
                              </IconButton>
                            )}
                          </Box>
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

                    {/* Episode List - Only show in ArrDashboard context when expanded */}
                    {isArrDashboardContext && (
                      <Collapse in={expandedSeasons.has(season.season_number)}>
                        <Box sx={{ mt: 2, ml: 2 }}>
                          {loadingEpisodes.has(season.season_number) ? (
                            <Box sx={{ p: 2, textAlign: 'center' }}>
                              <Typography variant="body2" color="text.secondary">
                                Loading episodes...
                              </Typography>
                            </Box>
                          ) : (
                            <Box sx={{ 
                              bgcolor: alpha(theme.palette.background.paper, 0.5),
                              borderRadius: 2,
                              p: 2,
                              border: '1px solid',
                              borderColor: alpha(theme.palette.divider, 0.2)
                            }}>
                              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                                Episodes
                              </Typography>
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {episodesData.get(season.season_number)?.map((episode: any) => {
                                  const isAvailable = isEpisodeAvailable(season.season_number, episode.episode_number);
                                  return (
                                    <Box
                                      key={episode.id}
                                      sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        p: 1.5,
                                        borderRadius: 1,
                                        bgcolor: alpha(theme.palette.background.paper, 0.3),
                                        border: '1px solid',
                                        borderColor: alpha(theme.palette.divider, 0.1),
                                        transition: 'all 0.2s ease',
                                        '&:hover': {
                                          bgcolor: alpha(theme.palette.background.paper, 0.6),
                                          transform: 'translateX(4px)'
                                        }
                                      }}
                                    >
                                      {/* Availability Dot */}
                                      <Box
                                        sx={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          bgcolor: isAvailable ? 'success.main' : 'warning.main',
                                          boxShadow: isAvailable 
                                            ? '0 0 8px rgba(76, 175, 80, 0.4)' 
                                            : '0 0 8px rgba(255, 152, 0, 0.4)',
                                          flexShrink: 0
                                        }}
                                      />
                                      
                                      {/* Episode Number */}
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontWeight: 600,
                                          minWidth: '40px',
                                          color: 'text.secondary'
                                        }}
                                      >
                                        E{episode.episode_number}
                                      </Typography>
                                      
                                      {/* Episode Title */}
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          flex: 1,
                                          fontWeight: isAvailable ? 500 : 400,
                                          color: isAvailable ? 'text.primary' : 'text.secondary'
                                        }}
                                      >
                                        {episode.name || `Episode ${episode.episode_number}`}
                                      </Typography>
                                      
                                      {/* Air Date */}
                                      {episode.air_date && (
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            color: 'text.secondary',
                                            minWidth: '80px',
                                            textAlign: 'right'
                                          }}
                                        >
                                          {new Date(episode.air_date).toLocaleDateString()}
                                        </Typography>
                                      )}
                                    </Box>
                                  );
                                })}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    )}
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