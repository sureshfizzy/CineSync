import { TmdbResult } from '../api/tmdbApi';

const DB_NAME = 'tmdbCacheDB';
const DB_VERSION = 2;
const STORE_NAME = 'tmdbObjectStore';
const MAX_CACHE_ITEMS = 1000; // Max items to keep in IndexedDB
const EVICTION_CHUNK_SIZE = 100; // Number of items to evict when limit is reached

// Cache version for handling updates
const CACHE_VERSION = 2;

// In-memory LRU cache
const memoryCache = new Map<string, TmdbResult>();

let dbPromise: Promise<IDBDatabase> | null = null;

// Error handling utility with typed error interface
interface CacheError extends Error {
  context: string;
  originalError?: any;
}

const createCacheError = (message: string, context: string, originalError?: any): CacheError => {
  const error = new Error(message) as CacheError;
  error.context = context;
  error.originalError = originalError;
  // Silent error handling for TMDB cache
  return error;
};

// Database initialization with better error handling
function getDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        // IndexedDB not available, using mock DB
        return resolve(createMockDB());
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(createCacheError('Failed to open database', 'DB Init', request.error));
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
        }
      };
    });
  }
  return dbPromise;
}

// Mock DB for environments without IndexedDB
function createMockDB(): IDBDatabase {
  return {
    close: () => {},
    transaction: () => ({
      objectStore: () => ({
        get: () => ({}),
        put: () => ({}),
        delete: () => ({}),
        clear: () => ({}),
        count: () => ({ onsuccess: (e: any) => { if(e.target) e.target.result = 0; } })
      }),
      abort: () => {},
      commit: () => {}
    })
  } as unknown as IDBDatabase;
}

// Cache key utilities
export function generateCacheKey(id: string | number, mediaType: string = ''): string {
  return `v${CACHE_VERSION}:${id}:${mediaType}`;
}

// Cache operations
export function invalidateCache(oldId: string | number, mediaType: string = ''): void {
  const oldKey = generateCacheKey(oldId, mediaType);
  memoryCache.delete(oldKey);

  getDB().then(db => {
    if (typeof db.transaction !== 'function') return;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(oldKey);
  }).catch(error => {
    throw createCacheError('Failed to invalidate cache', 'Cache Invalidation', error);
  });
}

// Optimized cache read with better error handling
export function getPosterFromCache(id: number | string, mediaType: string = ''): TmdbResult | undefined {
  if (!id) return undefined;

  const cacheKey = generateCacheKey(id, mediaType);
  const cachedData = memoryCache.get(cacheKey);

  if (cachedData) {
    updateLastAccessed(cacheKey).catch(() => {});
    return cachedData;
  }

  // Asynchronously populate memory cache from IndexedDB
  loadFromIndexedDB(cacheKey).catch(() => {});
  return undefined;
}

// Helper function to update last accessed time
async function updateLastAccessed(cacheKey: string): Promise<void> {
  const db = await getDB();
  if (typeof db.transaction !== 'function') return;

  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const request = store.get(cacheKey);
  request.onsuccess = () => {
    const item = request.result;
    if (item) {
      item.lastAccessed = Date.now();
      store.put(item);
    }
  };
}

// Helper function to load from IndexedDB
async function loadFromIndexedDB(cacheKey: string): Promise<void> {
  const db = await getDB();
  if (typeof db.transaction !== 'function') return;

  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const request = store.get(cacheKey);
  request.onsuccess = () => {
    const item = request.result;
    if (item?.data) {
      if (!item.cacheKey.startsWith(`v${CACHE_VERSION}:`)) {
        store.delete(cacheKey);
        return;
      }
      item.lastAccessed = Date.now();
      store.put(item).onsuccess = () => {
        memoryCache.set(cacheKey, item.data);
      };
    }
  };
}

// Optimized cache write with better validation
export async function setPosterInCache(id: number | string, mediaType: string = '', data: TmdbResult): Promise<void> {
  if (!id || !data || !isValidTmdbResult(data)) {
    throw createCacheError('Invalid data or ID provided', 'Cache Write');
  }

  const cacheKey = generateCacheKey(id, mediaType);
  memoryCache.set(cacheKey, data);

  try {
    const db = await getDB();
    if (typeof db.transaction !== 'function') {
      memoryCache.delete(cacheKey);
      return;
    }

    await writeToIndexedDB(cacheKey, data);
    await evictOldItems();
  } catch (error) {
    console.error('Failed to write to cache:', error);
    memoryCache.delete(cacheKey);
    throw createCacheError('Failed to write to cache', 'Cache Write', error);
  }
}

// Helper function to validate TMDB result
function isValidTmdbResult(data: any): data is TmdbResult {
  return (
    typeof data === 'object' &&
    'id' in data &&
    'media_type' in data &&
    (data.media_type === 'movie' || data.media_type === 'tv')
  );
}

// Helper function to write to IndexedDB
async function writeToIndexedDB(cacheKey: string, data: TmdbResult): Promise<void> {
  const db = await getDB();
  if (typeof db.transaction !== 'function') return;

  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.put({
      cacheKey,
      data,
      lastAccessed: Date.now(),
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });
}

// Efficient cache eviction
async function evictOldItems(): Promise<void> {
  try {
    const db = await getDB();
    if (typeof db.transaction !== 'function') return;

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('lastAccessed');

    const count = await getStoreCount(store);
    if (count <= MAX_CACHE_ITEMS) return;

    const itemsToEvict = count - (MAX_CACHE_ITEMS - EVICTION_CHUNK_SIZE);
    await evictItems(index, itemsToEvict);
  } catch (error) {
    console.error('Failed to evict old items:', error);
    throw createCacheError('Failed to evict old items', 'Cache Eviction', error);
  }
}

// Helper function to get store count
function getStoreCount(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Helper function to evict items
function evictItems(index: IDBIndex, itemsToEvict: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursorRequest = index.openCursor(null, 'next');
    let evictedCount = 0;

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor && evictedCount < itemsToEvict) {
        const key = cursor.primaryKey as string;
        cursor.delete();
        memoryCache.delete(key);
        evictedCount++;
        cursor.continue();
      } else {
        resolve();
      }
    };

    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

// Clear entire cache
export async function clearTmdbCache(): Promise<void> {
  memoryCache.clear();

  try {
    const db = await getDB();
    if (typeof db.transaction !== 'function') return;

    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to clear cache:', error);
    throw createCacheError('Failed to clear cache', 'Cache Clear', error);
  }
}

// Initialize DB connection on script load
getDB().catch(() => {
  // Silent error handling for initial DB connection
});