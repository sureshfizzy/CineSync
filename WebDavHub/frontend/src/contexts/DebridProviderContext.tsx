import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type DebridProviderId = 'realdebrid' | 'torbox';

const STORAGE_KEY = 'debrid_provider';

const DebridContext = createContext<
  | {
      provider: DebridProviderId;
      setProvider: (p: DebridProviderId) => void;
    }
  | undefined
>(undefined);

export function getStoredDebridProvider(): DebridProviderId {
  const raw = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
  return raw === 'torbox' ? 'torbox' : 'realdebrid';
}

export function setStoredDebridProvider(provider: DebridProviderId) {
  localStorage.setItem(STORAGE_KEY, provider);
  window.dispatchEvent(new CustomEvent('debrid-provider-change', { detail: { provider } }));
}

export function DebridProvider({ children }: { children: ReactNode }) {
  const [provider, setProviderState] = useState<DebridProviderId>(() => {
    try {
      return getStoredDebridProvider();
    } catch {
      return 'realdebrid';
    }
  });

  const setProvider = useCallback((p: DebridProviderId) => {
    setProviderState(p);
    try {
      setStoredDebridProvider(p);
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ provider?: string }>;
      const next = (ce?.detail?.provider || getStoredDebridProvider()) as DebridProviderId;
      setProviderState(next === 'torbox' ? 'torbox' : 'realdebrid');
    };
    window.addEventListener('debrid-provider-change', handler);
    return () => window.removeEventListener('debrid-provider-change', handler);
  }, []);

  return (
    <DebridContext.Provider value={{ provider, setProvider }}>{children}</DebridContext.Provider>
  );
}

export function useDebridProvider(): [DebridProviderId, (p: DebridProviderId) => void] {
  const ctx = useContext(DebridContext);
  if (!ctx) {
    throw new Error('useDebridProvider must be used within DebridProvider');
  }
  return [ctx.provider, ctx.setProvider];
}
