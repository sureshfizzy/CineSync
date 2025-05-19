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
}

export interface MobileListItemProps {
  file: FileItem;
  onItemClick: () => void;
  onMenuClick?: (event: React.MouseEvent<HTMLElement>) => void;
  formatDate: (date?: string) => string;
  menu?: React.ReactNode;
} 