// Utility functions for FileBrowser
import { FolderOpen as FolderOpenIcon, InsertDriveFile as FileIcon, Image as ImageIcon, Movie as MovieIcon, Description as DescriptionIcon } from '@mui/icons-material';
import { FileItem, SortOption } from './types';

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

// Bytes to human readable string
export function formatBytes(bytes?: number | string): string {
  if (bytes === undefined || bytes === null) return '--';
  const n = typeof bytes === 'string' ? parseFloat(bytes) : bytes;
  if (isNaN(n) || n < 0) return '--';
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  const gb = mb / 1024;
  if (gb < 1024) return `${gb.toFixed(2)} GB`;
  const tb = gb / 1024;
  return `${tb.toFixed(2)} TB`;
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

// Helper function to parse file size string to bytes for comparison
function parseSizeToBytes(sizeStr?: string): number {
  if (!sizeStr || sizeStr === '--') return 0;

  const units: Record<string, number> = {
    'B': 1,
    'KB': 1024,
    'MB': 1024 * 1024,
    'GB': 1024 * 1024 * 1024,
    'TB': 1024 * 1024 * 1024 * 1024,
  };

  const match = sizeStr.match(/^([\d.]+)\s*([A-Z]+)$/i);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  return value * (units[unit] || 1);
}

// Sort files with directories first, then by specified criteria
export function sortFiles(files: FileItem[], sortOption: SortOption): FileItem[] {
  return [...files].sort((a, b) => {
    // Always keep directories first
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;

    // Both are same type, sort by specified criteria
    switch (sortOption) {
      case 'name-asc':
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case 'name-desc':
        return b.name.toLowerCase().localeCompare(a.name.toLowerCase());
      case 'modified-desc':
        if (!a.modified && !b.modified) return 0;
        if (!a.modified) return 1;
        if (!b.modified) return -1;
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      case 'modified-asc':
        if (!a.modified && !b.modified) return 0;
        if (!a.modified) return 1;
        if (!b.modified) return -1;
        return new Date(a.modified).getTime() - new Date(b.modified).getTime();
      case 'size-desc':
        return parseSizeToBytes(b.size) - parseSizeToBytes(a.size);
      case 'size-asc':
        return parseSizeToBytes(a.size) - parseSizeToBytes(b.size);
      default:
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    }
  });
}

// Filter files by starting letter
export function filterFilesByLetter(files: FileItem[], letter: string | null): FileItem[] {
  if (!letter) return files;

  const isNumeric = letter === '#';
  const lowerLetter = letter.toLowerCase();

  return files.filter(file => {
    const firstChar = file.name.charAt(0);
    return isNumeric
      ? /^[0-9]/.test(firstChar)
      : firstChar.toLowerCase() === lowerLetter;
  });
}

// Scroll to first file starting with specified letter (kept for potential future use)
export function scrollToLetter(letter: string, files: FileItem[]) {
  const targetIndex = files.findIndex(file => {
    if (letter === '#') {
      return /^[0-9]/.test(file.name);
    }
    return file.name.toLowerCase().startsWith(letter.toLowerCase());
  });

  if (targetIndex !== -1) {
    // Create a unique identifier for the file row
    const fileElement = document.querySelector(`[data-file-name="${CSS.escape(files[targetIndex].name)}"]`);
    if (fileElement) {
      fileElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      // Add a brief highlight effect
      fileElement.classList.add('alphabet-highlight');
      setTimeout(() => {
        fileElement.classList.remove('alphabet-highlight');
      }, 2000);
    }
  }
}