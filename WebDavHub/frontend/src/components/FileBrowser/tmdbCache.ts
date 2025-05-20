import { TmdbResult } from '../api/tmdbApi';

const posterCache = new Map<string, TmdbResult>();
const STORAGE_KEY_PREFIX = 'tmdbPosterCache:';

function makeStorageKey(id: number | string, mediaType: string = ''): string {
  return `${STORAGE_KEY_PREFIX}${id}:${mediaType}`;
}

export function getPosterFromCache(id: number | string, mediaType: string = ''): TmdbResult | undefined {
  const key = `${id}:${mediaType}`;
  // 1. Check in-memory
  if (posterCache.has(key)) return posterCache.get(key);
  // 2. Check localStorage
  try {
    const storageKey = makeStorageKey(id, mediaType);
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as TmdbResult;
      posterCache.set(key, parsed); // populate in-memory for next time
      return parsed;
    }
  } catch {}
  return undefined;
}

export function setPosterInCache(id: number | string, mediaType: string = '', data: TmdbResult) {
  const key = `${id}:${mediaType}`;
  posterCache.set(key, data);
  try {
    const storageKey = makeStorageKey(id, mediaType);
    localStorage.setItem(storageKey, JSON.stringify(data));
  } catch {}
} 