import axios from 'axios';
import { FileItem } from './types';

interface FileResponse {
  data: FileItem[];
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  hasAllowed: boolean;
  hasSeasonFolders: boolean;
}

export const fetchFiles = async (path: string, checkTmdb: boolean = false): Promise<FileResponse> => {
  const headers: Record<string, string> = {};
  if (checkTmdb) {
    headers['X-Check-Tmdb'] = 'true';
  }

  const response = await axios.get<FileItem[]>('/api/files' + path, { headers });

  return {
    data: response.data,
    tmdbId: response.headers['x-tmdb-id'],
    mediaType: response.headers['x-media-type'] as 'movie' | 'tv',
    hasAllowed: response.headers['x-has-allowed-extensions'] === 'true',
    hasSeasonFolders: response.headers['x-has-season-folders'] === 'true'
  };
};

export const fetchTmdbInfo = async (path: string) => {
  try {
    const response = await axios.get(`/api/files${path}/.tmdb`, {
      headers: {
        'X-Raw-Response': 'true'
      }
    });
  return response.data;
  } catch (error) {
    console.error('Failed to fetch TMDB info:', error);
    return null;
}
};

export async function downloadFile(path: string, fileName: string): Promise<void> {
  const response = await axios.get(`/api/files${path}`, { responseType: 'blob' });
  const blob = response.data;
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function openFile(path: string, fileName: string, isPreviewable: boolean): Promise<void> {
  const response = await axios.get(`/api/files/${path}`, { responseType: 'blob' });
  const blob = response.data;
  const blobUrl = window.URL.createObjectURL(blob);
  if (isPreviewable) {
    window.open(blobUrl, '_blank', 'noopener');
  } else {
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

// Persistent file details API
export async function upsertFileDetail(detail: any) {
  await axios.post('/api/file-details', detail);
}

export async function deleteFileDetail(path: string) {
  await axios.delete(`/api/file-details?path=${encodeURIComponent(path)}`);
}

export async function getFileDetail(path: string) {
  const response = await axios.get(`/api/file-details?path=${encodeURIComponent(path)}`);
  return response.data;
}