import axios from 'axios';

export interface TmdbResult {
  id: number;
  title: string;
  name?: string; // For TV shows
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string; // For TV shows
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
    // Normalize media type to lowercase for cache key consistency
    const normalizedMediaType = (mediaType || '').toLowerCase();
    const cacheKey = `id:${query}:${normalizedMediaType}`;

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
      const params: any = { id: query, mediaType: normalizedMediaType };
      if (skipCache) params.skipCache = 'true';
      const res = await axios.get('/api/tmdb/details', {
        params,
        timeout: 6000 // 6 second timeout to match backend processing time
      });
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

        const resultObj: TmdbResult = {
          id: data.id,
          title: finalMediaType === 'movie' ? data.title : (data.name || data.title),
          name: data.name,
          overview: data.overview,
          poster_path: data.poster_path,
          backdrop_path: data.backdrop_path,
          release_date: data.release_date,
          first_air_date: data.first_air_date,
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
    } catch (err: any) {
      if (err.response) {
        console.error(`[TMDB] Details fetch by ID failed - HTTP ${err.response.status}: ID '${query}' not found for media type '${mediaType || 'auto'}'`);
      } else {
        console.error('[TMDB] Details fetch by ID failed - Network error:', err);
      }
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
      const res = await axios.get('/api/tmdb/search', {
        params,
        timeout: 3000 // 3 second timeout for search endpoint
      });
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
        name: best.name,
        overview: best.overview,
        poster_path: best.poster_path,
        backdrop_path: best.backdrop_path,
        release_date: best.release_date,
        first_air_date: best.first_air_date,
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
      const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');

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
      } else if (isTimeout && attempt < maxRetries - 1) {
        console.warn(`[TMDB] Timeout on attempt ${attempt + 1}, retrying...`);
        await sleep(25);
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

  const token = localStorage.getItem('cineSyncJWT');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';

  return `/api/image-cache?poster=${encodeURIComponent(posterPath)}&size=${size}${tokenParam}`;
}

export function getTmdbBackdropUrl(backdropPath: string | null, size: string = 'w1280'): string | null {
  if (!backdropPath) return null;

  const token = localStorage.getItem('cineSyncJWT');
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';

  return `/api/image-cache?poster=${encodeURIComponent(backdropPath)}&size=${size}${tokenParam}`;
}

// Get MediaCover poster URL (Radarr/Sonarr local images)
export function getMediaCoverPosterUrl(tmdbId: string | number): string | null {
  if (!tmdbId) return null;
  return `/api/mediacover/${tmdbId}/poster.jpg`;
}

// Get MediaCover fanart URL (Radarr/Sonarr local images)
export function getMediaCoverFanartUrl(tmdbId: string | number): string | null {
  if (!tmdbId) return null;
  return `/api/mediacover/${tmdbId}/fanart.jpg`;
}

// Get poster URL with MediaCover priority, TMDB fallback
export function getPosterUrlWithFallback(tmdbId: string | number | null, posterPath: string | null, size: string = 'w342'): string | null {
  // First try MediaCover if we have a TMDB ID
  if (tmdbId) {
    return getMediaCoverPosterUrl(tmdbId);
  }

  // Fallback to TMDB poster
  if (posterPath) {
    return getTmdbPosterUrl(posterPath, size);
  }

  return null;
}

// Direct TMDB URL function (fallback)
export function getTmdbPosterUrlDirect(posterPath: string | null, size: string = 'w342'): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// Get TMDB poster URL for seasons
export function getTmdbSeasonPosterUrl(posterPath: string | null, size: string = 'w300'): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

// Get TMDB still URL for episodes
export function getTmdbEpisodeStillUrl(stillPath: string | null, size: string = 'w300'): string | null {
  if (!stillPath) return null;
  return `https://image.tmdb.org/t/p/${size}${stillPath}`;
}

// Format runtime in minutes to human-readable format
export function formatRuntime(runtime?: number): string | null {
  if (!runtime) return null;
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Fetch category content for category folders
export async function fetchCategoryContent(category: string): Promise<TmdbResult[] | null> {
  try {
    const res = await axios.get('/api/tmdb/category-content', {
      params: { category },
      timeout: 5000
    });

    return res.data.results || [];
  } catch (error) {
    console.error('Error fetching category content:', error);
    return null;
  }
}

// Season and Episode interfaces
interface SeasonOption {
  id: number;
  season_number: number;
  name: string;
  overview?: string;
  poster_path?: string;
  air_date?: string;
  episode_count: number;
}

interface EpisodeOption {
  id: number;
  episode_number: number;
  name: string;
  overview?: string;
  still_path?: string;
  air_date?: string;
  runtime?: number;
  vote_average?: number;
}

// Fetch seasons from TMDB for a TV show
export async function fetchSeasonsFromTmdb(tmdbId: string): Promise<SeasonOption[]> {
  console.log('Fetching seasons from TMDB for ID:', tmdbId);

  const response = await fetch(`/api/tmdb/details?id=${tmdbId}&mediaType=tv`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
    }
  });

  console.log('TMDB seasons response status:', response.status);

  if (!response.ok) {
    console.log('TMDB seasons request failed with status:', response.status);
    throw new Error(`Failed to fetch seasons: ${response.status}`);
  }

  const data = await response.json();
  console.log('TMDB seasons data:', data);

  if (data.seasons) {
    const validSeasons = data.seasons.filter((s: any) => s.season_number > 0);
    console.log('Valid seasons found:', validSeasons.length);
    return validSeasons;
  } else {
    console.log('No seasons found in TMDB data');
    return [];
  }
}

// Fetch episodes from TMDB for a specific season
export async function fetchEpisodesFromTmdb(tmdbId: string, seasonNumber: number): Promise<EpisodeOption[]> {
  console.log('Fetching episodes from TMDB for ID:', tmdbId, 'Season:', seasonNumber);

  const response = await fetch(`/api/tmdb/details?id=${tmdbId}&mediaType=tv&seasonNumber=${seasonNumber}`, {
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('cineSyncJWT')}`
    }
  });

  console.log('TMDB episodes response status:', response.status);

  if (!response.ok) {
    console.log('TMDB episodes request failed with status:', response.status);
    throw new Error(`Failed to fetch episodes: ${response.status}`);
  }

  const data = await response.json();
  console.log('TMDB episodes data:', data);

  if (data.seasons && data.seasons.length > 0) {
    const season = data.seasons.find((s: any) => s.season_number === seasonNumber);
    if (season && season.episodes) {
      console.log('Episodes found:', season.episodes.length);
      return season.episodes;
    } else {
      console.log('No episodes found for season', seasonNumber);
      return [];
    }
  } else {
    console.log('No seasons data found in TMDB response');
    return [];
  }
}