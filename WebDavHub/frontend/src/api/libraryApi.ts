import axios from 'axios';

export interface LibraryItem {
  id: number;
  tmdb_id: number;
  title: string;
  year?: number;
  media_type: 'movie' | 'tv';
  root_folder: string;
  quality_profile: string;
  monitor_policy: string;
  series_type?: string;
  season_folder?: boolean;
  tags: string;
  status: 'wanted' | 'downloading' | 'completed' | 'unavailable' | 'missing' | 'imported';
  added_at: number;
  updated_at: number;
  poster_path?: string;
  overview?: string;
  quality?: string;
  destination_path?: string;
}

export interface PagedResponse<T> {
  success: boolean;
  data: T[];
  count: number;
  total_count?: number;
}

export type LibraryResponse = PagedResponse<LibraryItem>;

// Wanted episodes returned by /api/library/wanted
export interface WantedEpisode {
  id: string;
  tmdbId: number;
  title: string;
  year?: number;
  mediaType: 'tv';
  rootFolder: string;
  qualityProfile: string;
  seasonNumber: number;
  episodeNumber: number;
  episode: string;
  episodeTitle: string;
  airDate?: string;
}

export type WantedEpisodeResponse = PagedResponse<WantedEpisode>;

// Wanted movies returned by /api/library/wanted/movies
export interface WantedMovie {
  id: string;
  tmdbId: number;
  title: string;
  year?: number;
  mediaType: 'movie';
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type WantedMovieResponse = PagedResponse<WantedMovie>;

export interface AddMovieRequest {
  tmdbId: number;
  title: string;
  year?: number;
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  tags: string[];
}

export interface AddSeriesRequest {
  tmdbId: number;
  title: string;
  year?: number;
  rootFolder: string;
  qualityProfile: string;
  monitorPolicy: string;
  seriesType: string;
  seasonFolder: boolean;
  tags: string[];
}

export const libraryApi = {
  // Get movies from DB
  async getLibraryMovies(limit = 100, offset = 0, query?: string, missingOnly?: boolean): Promise<LibraryResponse> {
    const response = await axios.get('/api/library/movie', {
      params: { limit, offset, ...(query ? { query } : {}), ...(missingOnly ? { status: 'missing' } : {}) },
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    return response.data;
  },

  // Get TV series from DB
  async getLibraryTv(limit = 100, offset = 0, query?: string): Promise<LibraryResponse> {
    const response = await axios.get('/api/library/tv', {
      params: { limit, offset, ...(query ? { query } : {}) },
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    return response.data;
  },

  // Get library items
  async getLibrary(mediaType?: 'movie' | 'tv', status?: string): Promise<LibraryResponse> {
    const params = new URLSearchParams();
    if (mediaType) params.append('type', mediaType);
    if (status) params.append('status', status);
    
    const response = await axios.get(`/api/library?${params.toString()}`);
    return response.data;
  },

  // Get wanted TV episodes directly from DB for Wanted UI
  async getWantedEpisodes(limit = 100, offset = 0, resolution?: '2160p' | '1080p' | '720p' | '480p'): Promise<WantedEpisodeResponse> {
    const params: Record<string, string | number> = { limit, offset };
    if (resolution) params.resolution = resolution;

    const response = await axios.get('/api/library/wanted', {
      params,
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    return response.data;
  },

  // Get wanted movies
  async getWantedMovies(limit = 100, offset = 0, resolution?: '2160p' | '1080p' | '720p' | '480p'): Promise<WantedMovieResponse> {
    const params: Record<string, string | number> = { variant: 'movies', limit, offset };
    if (resolution) params.resolution = resolution;

    const response = await axios.get('/api/library/wanted', {
      params,
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
    });
    return response.data;
  },

  // Add a movie to the library
  async addMovie(data: AddMovieRequest): Promise<{ success: boolean; message: string }> {
    const response = await axios.post('/api/library/movie', data);
    return response.data;
  },

  // Add a series to the library
  async addSeries(data: AddSeriesRequest): Promise<{ success: boolean; message: string }> {
    const response = await axios.post('/api/library/series', data);
    return response.data;
  },

  // Update a library item
  async updateItem(id: number, data: { status?: string }): Promise<{ success: boolean; message: string }> {
    const response = await axios.put(`/api/library/${id}`, data);
    return response.data;
  },

  // Delete a library item
  async deleteItem(id: number): Promise<{ success: boolean; message: string }> {
    const response = await axios.delete(`/api/library/${id}`);
    return response.data;
  }
};