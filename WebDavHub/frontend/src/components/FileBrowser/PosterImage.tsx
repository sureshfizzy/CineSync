import React, { useState, useEffect } from 'react';
import { getMediaCoverPosterUrl, getTmdbPosterUrl } from '../api/tmdbApi';

interface PosterImageProps {
  tmdbId?: string | number | null;
  posterPath?: string | null;
  size?: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  onLoad?: () => void;
  onError?: () => void;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  mediaType?: string;
}

export default function PosterImage({
  tmdbId,
  posterPath,
  size = 'w342',
  alt,
  className,
  style,
  onLoad,
  onError,
  loading,
  decoding,
  mediaType
}: PosterImageProps) {
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [hasTriedMediaCover, setHasTriedMediaCover] = useState(false);

  useEffect(() => {
    setHasTriedMediaCover(false);
    if (tmdbId) {
      const mediaCoverUrl = getMediaCoverPosterUrl(tmdbId);
      if (mediaCoverUrl) {
        setCurrentSrc(mediaCoverUrl);
        return;
      }
    }

    if (posterPath) {
      const tmdbUrl = getTmdbPosterUrl(posterPath, size);
      if (tmdbUrl) {
        setCurrentSrc(tmdbUrl);
        setHasTriedMediaCover(true);
        return;
      }
    }

    setCurrentSrc('');
    setHasTriedMediaCover(true);
  }, [tmdbId, posterPath, size, mediaType]);

  const handleError = () => {
    if (!hasTriedMediaCover && posterPath) {
      const tmdbUrl = getTmdbPosterUrl(posterPath, size);
      if (tmdbUrl) {
        setCurrentSrc(tmdbUrl);
        setHasTriedMediaCover(true);
        return;
      }
    }

    if (onError) {
      onError();
    }
  };

  const handleLoad = () => {
    if (onLoad) {
      onLoad();
    }
  };

  if (!currentSrc) {
    return null;
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      style={style}
      onLoad={handleLoad}
      onError={handleError}
      loading={loading}
      decoding={decoding}
    />
  );
}
