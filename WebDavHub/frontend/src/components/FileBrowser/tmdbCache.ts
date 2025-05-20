import { TmdbResult } from '../api/tmdbApi';

const posterCache = new Map<string, TmdbResult>();
const STORAGE_KEY_PREFIX = 'tmdbPosterCache:';

function makeStorageKey(id: number | string, mediaType: string = ''): string {
  return `${STORAGE_KEY_PREFIX}${id}:${mediaType}`;
}

export function getPosterFromCache(id: number | string, mediaType: string = ''): TmdbResult | undefined {
  if (!id) return undefined;
  
  const key = `${id}:${mediaType}`;
  // 1. Check in-memory
  if (posterCache.has(key)) return posterCache.get(key);
  
  // 2. Check localStorage
  try {
    const storageKey = makeStorageKey(id, mediaType);
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as TmdbResult;
        if (parsed && typeof parsed === 'object' && 'id' in parsed) {
          posterCache.set(key, parsed); // populate in-memory for next time
          return parsed;
        }
      } catch (parseError) {
        console.warn('[TMDB Cache] Failed to parse cached data:', parseError);
        // Clean up invalid cache entry
        localStorage.removeItem(storageKey);
      }
    }
  } catch (storageError) {
    console.warn('[TMDB Cache] Storage error:', storageError);
  }
  return undefined;
}

export function setPosterInCache(id: number | string, mediaType: string = '', data: TmdbResult) {
  if (!id || !data) return;
  
  const key = `${id}:${mediaType}`;
  posterCache.set(key, data);
  
  try {
    const storageKey = makeStorageKey(id, mediaType);
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch (storageError) {
    // If storage is full, try to clear some old entries
    try {
      const keys = Object.keys(localStorage);
      const tmdbKeys = keys.filter(k => k.startsWith(STORAGE_KEY_PREFIX));
      if (tmdbKeys.length > 100) { // If we have more than 100 cached items
        // Remove oldest 20 entries
        tmdbKeys.slice(0, 20).forEach(k => localStorage.removeItem(k));
        // Try storing again with the same storageKey
        const retryStorageKey = makeStorageKey(id, mediaType);
        localStorage.setItem(retryStorageKey, JSON.stringify(data));
      }
    } catch (cleanupError) {
      console.warn('[TMDB Cache] Failed to cleanup storage:', cleanupError);
    }
  }
}

export function clearTmdbCache() {
  posterCache.clear();
  try {
    const keys = Object.keys(localStorage);
    keys.filter(k => k.startsWith(STORAGE_KEY_PREFIX))
       .forEach(k => localStorage.removeItem(k));
  } catch (error) {
    console.warn('[TMDB Cache] Failed to clear storage:', error);
  }
} 