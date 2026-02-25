import axios from 'axios';

export interface MediaFileInfo {
  name: string;
  path: string;
  fullPath: string;
  sourcePath?: string;
  destinationPath?: string;
  size?: string;
  modified?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  quality?: string;
}

export async function fetchMediaFiles(tmdbId: number, mediaType?: 'movie' | 'tv'): Promise<MediaFileInfo[]> {
  const params = new URLSearchParams();
  params.append('tmdbId', tmdbId.toString());
  if (mediaType) params.append('mediaType', mediaType);

  const response = await axios.get(`/api/media-files?${params.toString()}`);
  return response.data || [];
}
