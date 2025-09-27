export interface ArrItem {
  id: string;
  tmdbId: number;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  posterPath?: string;
  overview?: string;
  status: 'wanted' | 'searching' | 'downloading' | 'imported' | 'failed';
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  tags?: string[];
  createdAt: string;
  updatedAt?: string;
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

export interface ArrSidebarFilter {
  type: 'all' | 'movies' | 'series' | 'wanted' | 'settings';
  searchOpen: boolean;
}

export type SortOption = 'title' | 'path' | 'size' | 'folder' | 'status' | 'added';
