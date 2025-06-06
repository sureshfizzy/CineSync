import axios from 'axios';

export interface TmdbResult {
  id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  media_type?: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeTmdbCacheKey(query: string, year?: string, mediaType?: string) {
  return [query.trim().toLowerCase(), year || '', mediaType || ''].join('|');
}

export async function searchTmdb(query: string, year?: string, mediaType?: 'movie' | 'tv', maxRetries = 3, skipCache = false): Promise<TmdbResult | null> {
  // If query is a TMDB ID (all digits), try cache first (unless skipCache is true)
  if (/^\d+$/.test(query)) {
    const cacheKey = `id:${query}:${mediaType || ''}`;

    // Only check cache if skipCache is false
    if (!skipCache) {
      try {
        const cacheRes = await axios.get('/api/tmdb-cache', { params: { query: cacheKey } });
        if (cacheRes.data) {
          const cached = cacheRes.data;
          if (cached && typeof cached === 'object' && 'id' in cached) {
            return cached as TmdbResult;
          }
          if (typeof cached === 'string') {
            try {
              const parsed = JSON.parse(cached);
              if (parsed && typeof parsed === 'object' && 'id' in parsed) {
                return parsed as TmdbResult;
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (err.response && err.response.status !== 404) {
          console.warn('[TMDB] Cache error:', err);
        }
      }
    }

    // Fetch from details endpoint
    try {
      const params: any = { id: query, mediaType };
      if (skipCache) params.skipCache = 'true';
      const res = await axios.get('/api/tmdb/details', { params });
      const data = res.data;
      if (data && typeof data === 'object' && 'id' in data) {
        // Determine media_type: use response data if available, otherwise fall back to the parameter we sent
        let finalMediaType = data.media_type;
        if (!finalMediaType || (finalMediaType !== 'movie' && finalMediaType !== 'tv')) {
          if (mediaType === 'movie' || mediaType === 'tv') {
            finalMediaType = mediaType;
          } else if (data.first_air_date || data.name) {
            finalMediaType = 'tv';
          } else {
            finalMediaType = 'movie';
          }
        }

        const resultObj = {
          id: data.id,
          title: finalMediaType === 'movie' ? data.title : (data.name || data.title),
          overview: data.overview,
          poster_path: data.poster_path,
          release_date: data.release_date || data.first_air_date,
          media_type: finalMediaType,
        };

        // Only cache if skipCache is false and we have a valid media_type
        if (!skipCache && (finalMediaType === 'movie' || finalMediaType === 'tv')) {
          try {
            await axios.post('/api/tmdb-cache', { query: cacheKey, result: JSON.stringify(resultObj) });
          } catch (cacheErr) {
            console.warn('[TMDB] Failed to cache ID result:', cacheErr);
          }
        }

        return resultObj;
      }
    } catch (err) {
      console.error('[TMDB] Error fetching details by ID:', err);
      return null;
    }
  }

  // Use a stable cache key
  const cacheKey = makeTmdbCacheKey(query, year, mediaType);

  if (!skipCache) {
    try {
      const cacheRes = await axios.get('/api/tmdb-cache', { params: { query: cacheKey } });
      if (cacheRes.data) {
        const cached = cacheRes.data;
        if (cached && typeof cached === 'object' && 'id' in cached) {
          return cached as TmdbResult;
        }

        if (typeof cached === 'string') {
          try {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed === 'object' && 'id' in parsed) {
              return parsed as TmdbResult;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.response && err.response.status !== 404) {
        console.warn('[TMDB] Cache error:', err);
      }
    }
  }

  // 2. If not found, call TMDB API
  let attempt = 0;
  let lastError: any = null;
  while (attempt < maxRetries) {
    try {
      const params: any = {
        query,
        include_adult: false,
      };
      if (year) params.year = year;
      if (mediaType) params.mediaType = mediaType;
      if (skipCache) params.skipCache = 'true';
      const res = await axios.get('/api/tmdb/search', { params });
      const results = res.data.results || [];
      if (results.length === 0) {
        return null;
      }

      const best = results[0];

      // Ensure we have a valid media_type
      let finalMediaType = best.media_type;
      if (!finalMediaType || (finalMediaType !== 'movie' && finalMediaType !== 'tv')) {
        if (mediaType === 'movie' || mediaType === 'tv') {
          finalMediaType = mediaType;
        } else if (best.first_air_date || best.name) {
          finalMediaType = 'tv';
        } else {
          finalMediaType = 'movie';
        }
      }

      const resultObj: TmdbResult = {
        id: best.id,
        title: best.title || best.name,
        overview: best.overview,
        poster_path: best.poster_path,
        release_date: best.release_date || best.first_air_date,
        media_type: finalMediaType,
      };

      if (!skipCache && resultObj && resultObj.id && (finalMediaType === 'movie' || finalMediaType === 'tv')) {
        try {
          await axios.post('/api/tmdb-cache', { query: cacheKey, result: JSON.stringify(resultObj) });
        } catch (cacheErr) {
          console.warn('[TMDB] Failed to cache result:', cacheErr);
        }
      }
      return resultObj;
    } catch (err: any) {
      lastError = err;
      if (err.response && err.response.status === 429) {
        let retryAfter = 1000 * (2 ** attempt);
        const retryHeader = err.response.headers['retry-after'];
        if (retryHeader) {
          const retrySec = parseInt(retryHeader, 10);
          if (!isNaN(retrySec)) retryAfter = retrySec * 1000;
        }
        await sleep(retryAfter);
        attempt++;
        continue;
      } else {
        console.error('[TMDB] Error searching TMDb:', err);
        break;
      }
    }
  }
  if (lastError) {
    console.error('[TMDB] Failed after retries:', lastError);
  }
  return null;
}

export function getTmdbPosterUrl(posterPath: string | null, size: string = 'w342'): string | null {
  if (!posterPath) return null;

  return `/api/image-cache?poster=${encodeURIComponent(posterPath)}&size=${size}`;
}

// Direct TMDB URL function (fallback)
export function getTmdbPosterUrlDirect(posterPath: string | null, size: string = 'w342'): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}