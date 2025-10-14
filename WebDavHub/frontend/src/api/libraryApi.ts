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
  status: 'wanted' | 'downloading' | 'completed' | 'unavailable';
  added_at: number;
  updated_at: number;
}

export interface LibraryResponse {
  success: boolean;
  data: LibraryItem[];
  count: number;
}

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
  // Get all library items
  async getLibrary(mediaType?: 'movie' | 'tv', status?: string): Promise<LibraryResponse> {
    const params = new URLSearchParams();
    if (mediaType) params.append('type', mediaType);
    if (status) params.append('status', status);
    
    const response = await axios.get(`/api/library?${params.toString()}`);
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


