import axios from 'axios';
import { FileItem } from './types';

export async function fetchFiles(path: string, withHeaders?: boolean): Promise<any> {
  const response = await axios.get(`/api/files${path}`);
  if (withHeaders) {
    const hasAllowed = response.headers['x-has-allowed-extensions'] === 'true';
    return { data: response.data, hasAllowed };
  }
  return response.data;
}

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
  console.log('[getFileDetail] Requesting file details for:', path);
  const response = await axios.get(`/api/file-details?path=${encodeURIComponent(path)}`);
  return response.data;
} 