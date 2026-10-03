import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { PartySelect } from '../../components/PartySelect';
import { ButtonLink, Field, PageHeader, Panel, Select, TextInput } from '../../components/ui';
import { orderSettlement } from '../../domain/payments';
import { queryToToken } from '../../domain/search';
import { PARTY_TYPES, type Order, type PartyType, type SettlementStatus } from '../../domain/types';
import { rangeFromSearch, useDateRange } from '../../hooks/useDateRange';
import { friendlyError } from '../../services/errors';
import { queryOrders } from '../../services/orders';
import { PARTY_LABELS } from '../../services/parties';
import { ledgerColumns } from '../ledger/columns';

export default function OrdersPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const dr = useDateRange('THIS_MONTH', rangeFromSearch(params));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState<'CONFIRMED' | 'CANCELLED'>('CONFIRMED');
  const [partyType, setPartyType] = useState<PartyType>('BUYER');
  const [partyId, setPartyId] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<SettlementStatus | ''>('');
  const [rows, setRows] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  const token = queryToToken(query);
  const q = useMemo(
    () => ({ range: dr.range, status, token, party: !token && partyId ? { type: partyType, id: partyId } : null, pageSize: 50 }),
    [dr.range, status, token, partyId, partyType],
  );

  const load = useCallback(
    async (after: QueryDocumentSnapshot | null) => {
      after ? setLoadingMore(true) : setLoading(true);
      setError(null);
      try {
        const page = await queryOrders(q, after);
        setRows((r) => (after ? [...r, ...page.orders] : page.orders));
        setCursor(page.cursor);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [q],
  );
  useEffect(() => {
    setRows([]);
    void load(null);
  }, [load]);

  // Filters Firestore can't combine with the main query are applied here.
  const visible = rows.filter((o) => {
    if (token && partyId) {
      const field = { BUYER: o.buyerId, SELLER: o.sellerId, COMMISSION_AGENT: o.commissionAgentId, TRANSPORTER: o.transporterId, PAYMENT_AGENT: o.paymentAgentId }[partyType];
      if (field !== partyId) return false;
    }
    if (payStatus && orderSettlement(o, 'buyer').status !== payStatus) return false;
    return true;
  });

  return (
    <div className="stack">
      <PageHeader title="Orders" actions={<ButtonLink to="/orders/new" variant="primary" icon="plus">Create order</ButtonLink>} />
      <DateFilter state={dr} />
      <div className="filters no-print">
        <Field label="Search" htmlFor="o-q" hint="Order no., vehicle, driver, phone, receipt, party, destination">
          <TextInput id="o-q" type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. MH12AB1234" />
        </Field>
        <Field label="Party type" htmlFor="o-pt">
          <Select id="o-pt" value={partyType} onChange={(e) => { setPartyType(e.target.value as PartyType); setPartyId(null); }}>
            {PARTY_TYPES.map((t) => (
              <option key={t} value={t}>{PARTY_LABELS[t].singular}</option>
            ))}
          </Select>
        </Field>
        <Field label={PARTY_LABELS[partyType].singular} htmlFor="o-party">
          <PartySelect id="o-party" type={partyType} value={partyId} onChange={(id) => setPartyId(id)} allowNone noneLabel="All" includeInactive />
        </Field>
        <Field label="Buyer payment" htmlFor="o-ps">
          <Select id="o-ps" value={payStatus} onChange={(e) => setPayStatus(e.target.value as SettlementStatus | '')}>
            <option value="">Any</option>
            <option value="UNPAID">Unpaid</option>
            <option value="PARTIAL">Part paid</option>
            <option value="PAID">Paid</option>
            <option value="OVERPAID">Overpaid</option>
          </Select>
        </Field>
        <Field label="Status" htmlFor="o-st">
          <Select id="o-st" value={status} onChange={(e) => setStatus(e.target.value as 'CONFIRMED' | 'CANCELLED')}>
            <option value="CONFIRMED">Confirmed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </Field>
      </div>
      <Panel bodyless>
        <DataTable
          rows={visible}
          columns={ledgerColumns('orders')}
          rowKey={(o) => o.id}
          loading={loading}
          error={error}
          onRetry={() => void load(null)}
          hasMore={!!cursor}
          loadingMore={loadingMore}
          onLoadMore={() => void load(cursor)}
          onRowClick={(o) => navigate(`/orders/${o.id}`)}
          empty={{ title: 'No orders found', body: 'Try a wider date range or clear the search.', action: <ButtonLink to="/orders/new" variant="primary">Create order</ButtonLink> }}
        />
      </Panel>
    </div>
  );
}
