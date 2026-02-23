export type MediaType = 'tv' | 'movie';
export type MediaTypePreference = MediaType | 'default';

type ImportOperationType = 'movie' | 'tvshow' | 'other' | undefined;

const normalizeToken = (value?: string | null): string =>
  (value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export const isTvMediaType = (value?: string | null): boolean => {
  const token = normalizeToken(value);
  return token === 'tv' || token === 'tvshow' || token === 'tv show' || token === 'tvshows' || token === 'series';
};

export const normalizeMediaType = (value?: string | null, fallback: MediaType = 'movie'): MediaType => {
  if (isTvMediaType(value)) return 'tv';

  const token = normalizeToken(value);
  if (token === 'movie' || token === 'movies' || token === 'film') {
    return 'movie';
  }

  return fallback;
};

const TV_TEXT_PATTERN = /(?:season|episode|[s]\d{1,2}[e]\d{1,3}|\b\d{1,2}x\d{2}\b)/i;

export const isLikelyTvText = (text?: string | null): boolean => {
  if (!text) return false;
  return TV_TEXT_PATTERN.test(text);
};

export const inferMediaTypeFromText = (text?: string | null): MediaType =>
  isLikelyTvText(text) ? 'tv' : 'movie';

export const mediaTypeFromTmdb = (mediaType?: string | null, firstAirDate?: string | null): MediaType => {
  if (mediaType && mediaType.trim()) {
    return normalizeMediaType(mediaType);
  }

  return firstAirDate ? 'tv' : 'movie';
};

export const inferImportMediaType = ({
  explicitMediaType,
  operationType,
  filePath,
  season,
  episode,
  defaultMediaType = 'default'
}: {
  explicitMediaType?: MediaType;
  operationType?: ImportOperationType;
  filePath?: string;
  season?: number;
  episode?: number;
  defaultMediaType?: MediaTypePreference;
}): MediaType => {
  if (explicitMediaType) {
    return explicitMediaType;
  }

  if (operationType === 'tvshow') {
    return 'tv';
  }

  if (operationType === 'movie') {
    return 'movie';
  }

  if (typeof season === 'number' || typeof episode === 'number') {
    return 'tv';
  }

  if (defaultMediaType !== 'default') {
    return defaultMediaType;
  }

  return inferMediaTypeFromText(filePath);
};