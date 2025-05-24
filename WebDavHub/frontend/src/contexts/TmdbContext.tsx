import React, { createContext, useContext, useState, useCallback } from 'react';
import { TmdbResult } from '../components/api/tmdbApi';
import { getPosterFromCache, setPosterInCache } from '../components/FileBrowser/tmdbCache';

interface TmdbContextType {
  tmdbData: { [key: string]: TmdbResult | null };
  imgLoadedMap: { [key: string]: boolean };
  updateTmdbData: (key: string, data: TmdbResult | null) => void;
  setImageLoaded: (key: string, loaded: boolean) => void;
  getTmdbDataFromCache: (key: string, mediaType?: string) => TmdbResult | null;
}

const TmdbContext = createContext<TmdbContextType | null>(null);

export function TmdbProvider({ children }: { children: React.ReactNode }) {
  const [tmdbData, setTmdbData] = useState<{ [key: string]: TmdbResult | null }>({});
  const [imgLoadedMap, setImgLoadedMap] = useState<{ [key: string]: boolean }>({});

  const updateTmdbData = useCallback((key: string, data: TmdbResult | null) => {
    setTmdbData(prev => ({ ...prev, [key]: data }));
    if (data?.poster_path) {
      setImgLoadedMap(prev => ({ ...prev, [key]: true }));
    }
  }, []);

  const setImageLoaded = useCallback((key: string, loaded: boolean) => {
    setImgLoadedMap(prev => ({ ...prev, [key]: loaded }));
  }, []);

  const getTmdbDataFromCache = useCallback((key: string, mediaType?: string) => {
    // First check our in-memory state
    if (tmdbData[key]) return tmdbData[key];
    
    // Then check the IndexedDB cache
    const cached = getPosterFromCache(key, mediaType || '');
    if (cached) {
      updateTmdbData(key, cached);
      return cached;
    }
    
    return null;
  }, [tmdbData, updateTmdbData]);

  return (
    <TmdbContext.Provider value={{
      tmdbData,
      imgLoadedMap,
      updateTmdbData,
      setImageLoaded,
      getTmdbDataFromCache,
    }}>
      {children}
    </TmdbContext.Provider>
  );
}

export function useTmdb() {
  const context = useContext(TmdbContext);
  if (!context) {
    throw new Error('useTmdb must be used within a TmdbProvider');
  }
  return context;
} 