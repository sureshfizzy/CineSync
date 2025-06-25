import axios from 'axios';
import { FileItem } from './types';

interface FileResponse {
  data: FileItem[];
  tmdbId?: string;
  mediaType?: 'movie' | 'tv';
  hasAllowed: boolean;
  hasSeasonFolders: boolean;
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
  headers?: Record<string, string>;
}

export const fetchFiles = async (path: string, checkTmdb: boolean = false, page: number = 1, limit: number = 100, search?: string): Promise<FileResponse> => {
  const headers: Record<string, string> = {};
  if (checkTmdb) {
    headers['X-Check-Tmdb'] = 'true';
  }

  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('limit', limit.toString());
  if (search && search.trim()) {
    params.append('search', search.trim());
  }

  const response = await axios.get<FileItem[]>('/api/files' + path + '?' + params.toString(), { headers });

  return {
    data: response.data,
    tmdbId: response.headers['x-tmdb-id'],
    mediaType: response.headers['x-media-type'] as 'movie' | 'tv',
    hasAllowed: response.headers['x-has-allowed-extensions'] === 'true',
    hasSeasonFolders: response.headers['x-has-season-folders'] === 'true',
    totalCount: parseInt(response.headers['x-total-count'] || '0', 10),
    page: parseInt(response.headers['x-page'] || '1', 10),
    limit: parseInt(response.headers['x-limit'] || '100', 10),
    totalPages: parseInt(response.headers['x-total-pages'] || '1', 10),
    headers: response.headers as Record<string, string>
  };
};

export const fetchSourceFiles = async (path: string, sourceIndex?: number, page: number = 1, limit: number = 100, search?: string): Promise<FileResponse> => {
  const params = new URLSearchParams();
  params.append('page', page.toString());
  params.append('limit', limit.toString());

  if (sourceIndex !== undefined) {
    params.append('source', sourceIndex.toString());
  }

  if (search && search.trim()) {
    params.append('search', search.trim());
  }

  const response = await axios.get<FileItem[]>('/api/source-browse' + path + '?' + params.toString());

  return {
    data: response.data,
    totalCount: parseInt(response.headers['x-total-count'] || '0', 10),
    page: parseInt(response.headers['x-page'] || '1', 10),
    limit: parseInt(response.headers['x-limit'] || '100', 10),
    totalPages: parseInt(response.headers['x-total-pages'] || '1', 10),
    hasAllowed: false,
    hasSeasonFolders: false,
    headers: {
      ...response.headers as Record<string, string>,
      'x-source-directories': response.headers['x-source-directories'] || '',
      'x-source-index': response.headers['x-source-index'] || '0',
      'x-source-directory': response.headers['x-source-directory'] || ''
    }
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