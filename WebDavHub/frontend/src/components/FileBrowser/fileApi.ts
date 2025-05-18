import axios from 'axios';
import { FileItem } from './types';

export async function fetchFiles(path: string): Promise<FileItem[]> {
  const response = await axios.get(`/api/files${path}`);
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