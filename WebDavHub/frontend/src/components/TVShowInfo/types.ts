// Types for TVShowInfo and subcomponents

export interface MediaDetailsData {
  id: number;
  title: string;
  name?: string;
  poster_path: string | null;
  first_air_date?: string;
  last_air_date?: string;
  episode_run_time?: number[];
  original_language?: string;
  credits?: {
    crew: { job: string; name: string }[];
    cast: { id: number; name: string; character: string; profile_path: string | null }[];
  };
  genres?: { id: number; name: string }[];
  production_countries?: { name: string }[];
  status?: string;
  tagline?: string;
  overview?: string;
  seasons?: any[];
}

export interface SeasonFolderInfo {
  folderName: string;
  seasonNumber: number;
  episodes: EpisodeFileInfo[];
}

export interface EpisodeFileInfo {
  name: string;
  size: string;
  modified: string;
  path: string;
  episodeNumber?: number;
  quality?: string;
  metadata?: {
    still_path?: string;
    name?: string;
    runtime?: number;
    vote_average?: number;
    air_date?: string;
    overview?: string;
    episode_number?: number;
  };
} 