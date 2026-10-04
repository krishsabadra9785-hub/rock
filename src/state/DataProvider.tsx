import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Party, PartyType } from '../domain/types';
import { subscribeAllParties } from '../services/parties';
import { friendlyError } from '../services/errors';

interface DataContextValue {
  parties: Party[];
  loading: boolean;
  error: string | null;
  byId: Map<string, Party>;
  ofType: (type: PartyType, opts?: { includeInactive?: boolean }) => Party[];
  nameOf: (id: string | null | undefined, fallback?: string) => string;
}

const DataContext = createContext<DataContextValue | null>(null);

/** Live master data (all parties) for the whole app — one listener, no per-row lookups. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeAllParties(
        (p) => {
          setParties(p);
          setLoading(false);
          setError(null);
        },
        (e) => {
          setError(friendlyError(e));
          setLoading(false);
        },
      ),
    [],
  );

  const value = useMemo<DataContextValue>(() => {
    const byId = new Map<string, Party>(parties.map((p): [string, Party] => [p.id, p]));
    return {
      parties,
      loading,
      error,
      byId,
      ofType: (type, opts) => parties.filter((p) => p.type === type && (opts?.includeInactive || p.active)),
      nameOf: (id, fallback = '—') => (id ? byId.get(id)?.name ?? fallback : fallback),
    };
  }, [parties, loading, error]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside DataProvider');
  return ctx;
}
