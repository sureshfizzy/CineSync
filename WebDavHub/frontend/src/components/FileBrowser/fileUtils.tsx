// Utility functions for FileBrowser
import { FolderOpen as FolderOpenIcon, InsertDriveFile as FileIcon, Image as ImageIcon, Movie as MovieIcon, Description as DescriptionIcon } from '@mui/icons-material';

export function getFileIcon(name: string, type: string) {
  if (type === 'directory') return <FolderOpenIcon color="primary" />;
  const ext = name.split('.').pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext || "")) return <ImageIcon color="secondary" />;
  if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm"].includes(ext || "")) return <MovieIcon color="action" />;
  if (["pdf", "doc", "docx", "txt", "md", "rtf"].includes(ext || "")) return <DescriptionIcon color="success" />;
  return <FileIcon color="disabled" />;
}

export function joinPaths(...parts: string[]): string {
  const normalizedParts = parts
    .map(part => part.replace(/^\/+/g, '').replace(/\/+$/g, ''))
    .filter(Boolean);
  if (normalizedParts.length === 0) return '/';
  return '/' + normalizedParts.join('/') + '/';
}

export function formatDate(dateStr?: string) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

export function parseTitleYearFromFolder(folderName: string): { title: string; year?: string } {
  const match = folderName.match(/(.+?)\s*\((\d{4})\)$/);
  if (match) {
    return { title: match[1], year: match[2] };
  }
  return { title: folderName };
}

export function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
    'bmp': 'image/bmp', 'svg': 'image/svg+xml', 'webp': 'image/webp',
    'mp4': 'video/mp4', 'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo',
    'mov': 'video/quicktime', 'wmv': 'video/x-ms-wmv', 'flv': 'video/x-flv', 'webm': 'video/webm',
    'pdf': 'application/pdf', 'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain', 'md': 'text/markdown', 'rtf': 'application/rtf',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
} 