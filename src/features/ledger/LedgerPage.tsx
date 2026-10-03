import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { PartySelect } from '../../components/PartySelect';
import { Button, EmptyState, ErrorNotice, Field, Figure, PageHeader, Panel, Skeleton, ButtonLink } from '../../components/ui';
import { describeRange } from '../../domain/dates';
import { formatCount, formatINR, formatQty } from '../../domain/format';
import type { Order } from '../../domain/types';
import { rangeFromSearch, useDateRange } from '../../hooks/useDateRange';
import { useRollup } from '../../hooks/useRollup';
import { friendlyError } from '../../services/errors';
import { queryAllOrders, type OrderQuery } from '../../services/orders';
import { useToast } from '../../state/ToastProvider';
import { downloadCsv } from '../../utils/download';
import { LEDGER_PARTY_TYPE, LEDGER_TITLES, ledgerColumns, type LedgerKind } from './columns';
import { useOrderPages } from './useOrderPages';

const KINDS: LedgerKind[] = ['orders', 'buyer', 'seller', 'commission', 'freight', 'paymentAgent'];

export function hasParty(o: Order, kind: LedgerKind): boolean {
  if (kind === 'commission') return !!o.commissionAgentId;
  if (kind === 'freight') return !!o.transporterId;
  if (kind === 'paymentAgent') return !!o.paymentAgentId;
  return true;
}

/** Drill-down target for dashboard figures: a filtered ledger of confirmed orders. */
export default function LedgerPage() {
  const { kind: raw } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const kind = KINDS.includes(raw as LedgerKind) ? (raw as LedgerKind) : null;
  const dr = useDateRange('THIS_MONTH', rangeFromSearch(params));
  const [partyId, setPartyId] = useState<string | null>(params.get('party'));
  const partyType = kind && kind !== 'orders' ? LEDGER_PARTY_TYPE[kind] : null;
  const q: OrderQuery | null = kind
    ? { range: dr.range, status: 'CONFIRMED', party: partyType && partyId ? { type: partyType, id: partyId } : null, pageSize: 100 }
    : null;
  const pages = useOrderPages(q, `${kind}|${dr.range.from}|${dr.range.to}|${partyId}`);
  const period = useRollup(dr.range);

  if (!kind) return <EmptyState title="Unknown ledger" action={<ButtonLink to="/">Dashboard</ButtonLink>} />;
  const rows = pages.rows.filter((o) => hasParty(o, kind));
  const t = period.data?.totals;
  const amount = t
    ? { orders: t.buyerGross, buyer: t.buyerGross, seller: t.seller, commission: t.commission, freight: t.freight, paymentAgent: t.paCharge }[kind]
    : undefined;
  const amountLabel = { orders: 'Selling (incl. GST)', buyer: 'Selling (incl. GST)', seller: 'Buying', commission: 'Commission', freight: 'Freight', paymentAgent: 'Agent charges' }[kind];

  const exportCsv = async () => {
    if (!q) return;
    try {
      const all = await queryAllOrders(q);
      downloadCsv(`rock-${kind}-${dr.range.from ?? 'all'}-${dr.range.to ?? 'now'}.csv`, all.orders.filter((o) => hasParty(o, kind)), ledgerColumns(kind));
      if (all.truncated) toast.info('Export limited to 5,000 orders. Narrow the date range for the rest.');
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  return (
    <div className="stack">
      <PageHeader back={{ to: '/', label: 'Dashboard' }} title={LEDGER_TITLES[kind]} sub={describeRange(dr.range)} actions={<Button icon="download" onClick={() => void exportCsv()}>Export CSV</Button>} />
      <DateFilter state={dr} />
      {partyType && (
        <div className="filters no-print">
          <Field label="Party" htmlFor="lg-party">
            <PartySelect id="lg-party" type={partyType} value={partyId} onChange={(id) => setPartyId(id)} allowNone noneLabel="All" includeInactive />
          </Field>
        </div>
      )}
      {!partyId && (
        <div className="figures compact">
          <Figure label={amountLabel} value={amount === undefined ? <Skeleton height={22} width={100} /> : formatINR(amount)} />
          <Figure label="Quantity" value={t ? formatQty(t.qtyKg) : <Skeleton height={22} width={80} />} />
          <Figure label="Orders" value={t ? formatCount(t.orders) : <Skeleton height={22} width={40} />} />
        </div>
      )}
      {period.error && <ErrorNotice error={period.error} />}
      <Panel bodyless>
        <DataTable
          rows={rows}
          columns={ledgerColumns(kind)}
          rowKey={(o) => o.id}
          loading={pages.loading}
          error={pages.error}
          onRetry={pages.reload}
          hasMore={pages.hasMore}
          loadingMore={pages.loading && pages.rows.length > 0}
          onLoadMore={pages.loadMore}
          empty={{ title: 'No orders in this period' }}
        />
      </Panel>
      {pages.hasMore && <p className="small muted">The totals row covers the rows shown. Figures above cover the whole period.</p>}
    </div>
  );
}
