import { matchesQuery, queryToToken } from '../domain/search';
import type { Order, Party } from '../domain/types';
import { queryOrders } from './orders';

export interface SearchResults {
  orders: Order[];
  parties: Party[];
}

/**
 * Global search: orders via the indexed searchTokens array (order no.,
 * vehicle, driver, phone, receipt no., party names, destination), and
 * parties from the already-loaded master list (name, code, phone, GSTIN).
 */
export async function globalSearch(q: string, parties: Party[]): Promise<SearchResults> {
  const token = queryToToken(q);
  const matchedParties = q.trim()
    ? parties.filter((p) => matchesQuery([p.name, p.code, p.phone, p.gstin], q)).slice(0, 20)
    : [];
  if (!token) return { orders: [], parties: matchedParties };
  const [confirmed, cancelled] = await Promise.all([
    queryOrders({ range: { from: null, to: null }, status: 'CONFIRMED', token, pageSize: 25 }),
    queryOrders({ range: { from: null, to: null }, status: 'CANCELLED', token, pageSize: 10 }),
  ]);
  return { orders: [...confirmed.orders, ...cancelled.orders], parties: matchedParties };
}
