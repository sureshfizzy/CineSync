// Type definitions for FileBrowser

export interface FileItem {
  name: string;
  type: 'file' | 'directory';
  size?: string;
  modified?: string;
  path?: string;
  webdavPath?: string;
  sourcePath?: string;
  fullPath?: string;
  hasSeasonFolders?: boolean;
  isSeasonFolder?: boolean;
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  isSourceRoot?: boolean;
  isSourceFile?: boolean;
  isMediaFile?: boolean;
  processingStatus?: string;
  seasonNumber?: number | null;
  lastProcessedAt?: number | null;
}

export interface MobileListItemProps {
  file: FileItem;
  onItemClick: () => void;
  onMenuClick?: (event: React.MouseEvent<HTMLElement>) => void;
  formatDate: (date?: string) => string;
  menu?: React.ReactNode;
} 