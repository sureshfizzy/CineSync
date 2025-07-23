// Utility helpers for TVShowInfo and subcomponents

// Extract episode number from filename using various patterns
export function extractEpisodeNumber(filename: string): number | undefined {
  let match = filename.match(/S(\d{1,2})E(\d{1,3})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  match = filename.match(/s(\d{2})e(\d{2,3})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  match = filename.match(/(\d{1,2})x(\d{2,3})/i);
  if (match) {
    const num = parseInt(match[2], 10);
    if (!isNaN(num)) return num;
  }
  match = filename.match(/E(?:p)?(\d{1,3})/i);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  match = filename.match(/[ ._\-](\d{2})[ ._\-]/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }
  return undefined;
}

// Format a date string for display
export function formatDate(dateStr?: string) {
  if (!dateStr) return '--';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

// Stub for getPosterUrl (should be passed from parent, but exported for import compatibility)
export function getPosterUrl(path: string | null, size?: string) {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size || 'w300'}${path}`;
} 