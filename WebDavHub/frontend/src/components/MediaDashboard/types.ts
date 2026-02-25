
export interface QualityProfile {
  id: number;
  name: string;
  mediaType: 'movie' | 'tv';
  qualities: string[];
  cutoff: string;
  upgradeAllowed: boolean;
}

export interface ArrItem {
  id: string;
  libraryItemId?: number;
  tmdbId: number;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  posterPath?: string;
  overview?: string;
  status: 'wanted' | 'searching' | 'downloading' | 'imported' | 'failed' | 'missing' | 'completed' | 'unavailable';
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episode?: string;
  episodeTitle?: string;
  airDate?: string;
}

export interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path?: string;
  backdrop_path?: string;
  release_date?: string;
  first_air_date?: string;
  media_type: 'movie' | 'tv';
  vote_average: number;
  genre_ids: number[];
}

export interface MediaSidebarFilter {
  type: 'all' | 'movies' | 'series' | 'wanted' | 'settings';
  searchOpen: boolean;
}

export type SortOption = 'title' | 'path' | 'size' | 'folder' | 'status' | 'added';
