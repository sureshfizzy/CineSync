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

export async function searchTmdb(query: string, year?: string, mediaType?: 'movie' | 'tv', maxRetries = 3): Promise<TmdbResult | null> {
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
      const res = await axios.get('/api/tmdb/search', { params });
      const results = res.data.results || [];
      if (results.length === 0) {
        console.log(`[TMDB] No results for query: ${query}`);
        return null;
      }

      const best = results[0];
      console.log(`[TMDB] Found match for '${query}':`, best);
      return {
        id: best.id,
        title: best.title || best.name,
        overview: best.overview,
        poster_path: best.poster_path,
        release_date: best.release_date || best.first_air_date,
        media_type: best.media_type,
      };
    } catch (err: any) {
      lastError = err;
      if (err.response && err.response.status === 429) {

        let retryAfter = 1000 * (2 ** attempt);
        const retryHeader = err.response.headers['retry-after'];
        if (retryHeader) {
          const retrySec = parseInt(retryHeader, 10);
          if (!isNaN(retrySec)) retryAfter = retrySec * 1000;
        }
        console.warn(`[TMDB] Rate limited (429). Retrying in ${retryAfter / 1000}s (attempt ${attempt + 1})...`);
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
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
} 