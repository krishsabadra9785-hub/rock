import { useCallback, useEffect, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import type { Order } from '../../domain/types';
import { friendlyError } from '../../services/errors';
import { queryOrders, type OrderQuery } from '../../services/orders';

/** Paginated orders for a query; reloads when the query key changes. */
export function useOrderPages(q: OrderQuery | null, key: string) {
  const [rows, setRows] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    async (after: QueryDocumentSnapshot | null) => {
      if (!q) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const page = await queryOrders(q, after);
        setRows((r) => (after ? [...r, ...page.orders] : page.orders));
        setCursor(page.cursor);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => {
    setRows([]);
    void load(null);
  }, [load]);
  return { rows, loading, error, hasMore: !!cursor, loadMore: () => void load(cursor), reload: () => void load(null) };
}
