import { MediaDetailsData } from '../../types/MediaTypes';

export interface MovieInfoProps {
  data: MediaDetailsData;
  getPosterUrl: (path: string | null, size?: string) => string | undefined;
  folderName: string;
  currentPath: string;
  mediaType: 'movie' | 'tv';
  tmdbId?: string | number;
  onSearchMissing?: (title: string, type: 'movie' | 'tv') => void;
} 