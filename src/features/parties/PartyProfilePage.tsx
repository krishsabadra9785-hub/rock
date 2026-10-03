import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { SummaryBand } from '../../components/SummaryBand';
import { Badge, Button, ButtonLink, ConfirmDialog, EmptyState, ErrorNotice, PageHeader, Panel, SkeletonRows, Tabs } from '../../components/ui';
import { describeRange } from '../../domain/dates';
import { formatDate, formatDateTime, formatINR, formatPercent, formatRate, paiseToPlain } from '../../domain/format';
import { CATEGORY_META, METHOD_LABELS, PARTY_TO_CATEGORY } from '../../domain/payments';
import { can } from '../../domain/permissions';
import { RATE_META, RATE_TYPES_BY_PARTY } from '../../domain/rates';
import { partySummary } from '../../domain/rollups';
import type { Order, Payment, PartyType, RateType } from '../../domain/types';
import { useAsync } from '../../hooks/useAsync';
import { useDateRange } from '../../hooks/useDateRange';
import { useRollup } from '../../hooks/useRollup';
import { friendlyError } from '../../services/errors';
import { queryAllOrders, queryOrders } from '../../services/orders';
import { PARTY_LABELS, listRateHistory, setPartyActive } from '../../services/parties';
import { queryPayments } from '../../services/payments';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';
import { downloadCsv, safeFileName } from '../../utils/download';
import { ledgerColumns, PARTY_LEDGER, type Column } from '../ledger/columns';
import { PaymentFormDialog } from '../payments/PaymentFormDialog';
import { ChangeRateDialog } from './ChangeRateDialog';
import { PartyFormDialog } from './PartyFormDialog';

type Tab = 'orders' | 'payments' | 'rates';

const paymentColumns: Column<Payment>[] = [
  { id: 'date', header: 'Date', text: (p) => formatDate(p.date), csv: (p) => p.date, sortValue: (p) => p.date },
  { id: 'type', header: 'Type', text: (p) => CATEGORY_META[p.category].label, csv: (p) => CATEGORY_META[p.category].label },
  { id: 'order', header: 'Order', text: (p) => p.orderNumber ?? 'On account', csv: (p) => p.orderNumber ?? '', link: (p) => (p.orderId ? `/orders/${p.orderId}` : null) },
  { id: 'method', header: 'Method', text: (p) => METHOD_LABELS[p.method], csv: (p) => p.method },
  { id: 'ref', header: 'Reference', text: (p) => p.reference || '—', csv: (p) => p.reference },
  { id: 'status', header: 'Status', text: (p) => (p.status === 'VOID' ? `Void: ${p.voidReason ?? ''}` : 'Active'), csv: (p) => p.status },
  { id: 'amount', header: 'Amount', align: 'right', text: (p) => formatINR(p.amount), csv: (p) => paiseToPlain(p.amount), sum: (p) => (p.status === 'ACTIVE' ? p.amount : 0), sumKind: 'inr', sortValue: (p) => p.amount },
];

export default function PartyProfilePage({ type }: { type: PartyType }) {
  const { id = '' } = useParams();
  const { byId, loading: partiesLoading, nameOf } = useData();
  const { profile } = useSession();
  const toast = useToast();
  const party = byId.get(id);
  const labels = PARTY_LABELS[type];
  const ledgerKind = PARTY_LEDGER[type];
  const dr = useDateRange('THIS_FY');
  const period = useRollup(dr.range);
  const lifetime = useRollup({ from: null, to: null });
  const [tab, setTab] = useState<Tab>('orders');
  const [editing, setEditing] = useState(false);
  const [rateDialog, setRateDialog] = useState<RateType | null>(null);
  const [paying, setPaying] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [busy, setBusy] = useState(false);

  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const loadOrders = useCallback(
    async (after: QueryDocumentSnapshot | null) => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const page = await queryOrders({ range: dr.range, status: 'CONFIRMED', party: { type, id }, pageSize: 50 }, after);
        setOrders((o) => (after ? [...o, ...page.orders] : page.orders));
        setCursor(page.cursor);
      } catch (e) {
        setOrdersError(friendlyError(e));
      } finally {
        setOrdersLoading(false);
      }
    },
    [dr.range, type, id],
  );
  useEffect(() => {
    void loadOrders(null);
  }, [loadOrders]);

  const payments = useAsync(() => queryPayments({ range: dr.range, partyId: id, pageSize: 200 }), [id, dr.range.from, dr.range.to]);
  const history = useAsync(() => listRateHistory(id), [id, party?.updatedAt?.getTime()]);

  if (partiesLoading) return <SkeletonRows rows={6} />;
  if (!party || party.type !== type) return <EmptyState title={`${labels.singular} not found`} action={<ButtonLink to={`/${labels.path}`}>Back to {labels.plural.toLowerCase()}</ButtonLink>} />;

  const periodSummary = period.data ? partySummary(period.data, type, id) : undefined;
  const lifetimeSummary = lifetime.data ? partySummary(lifetime.data, type, id) : undefined;
  const periodLabel = dr.preset === 'ALL_TIME' ? 'All time' : `Period (${describeRange(dr.range)})`;
  const canWrite = can(profile?.role, 'party.write');

  const exportLedger = async () => {
    try {
      const all = await queryAllOrders({ range: dr.range, status: 'CONFIRMED', party: { type, id } });
      downloadCsv(`${safeFileName(party.name)}-ledger.csv`, all.orders, ledgerColumns(ledgerKind));
      if (all.truncated) toast.info('Export limited to the first 5,000 orders. Narrow the date range for the rest.');
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };
  const toggleActive = async () => {
    setBusy(true);
    try {
      await setPartyActive(party, !party.active);
      toast.success(party.active ? `${party.name} deactivated` : `${party.name} reactivated`);
      setToggling(false);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        back={{ to: `/${labels.path}`, label: labels.plural }}
        title={
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {party.name} <Badge>{party.code}</Badge> {!party.active && <Badge tone="warn">Inactive</Badge>}
          </span>
        }
        sub={[party.phone, party.address].filter(Boolean).join(', ') || labels.singular}
        actions={
          <>
            {can(profile?.role, 'payment.create') && <Button icon="wallet" onClick={() => setPaying(true)}>Record payment</Button>}
            {canWrite && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
            {canWrite && <Button onClick={() => setToggling(true)}>{party.active ? 'Deactivate' : 'Reactivate'}</Button>}
          </>
        }
      />

      <div className="grid-2">
        <Panel title="Current rates">
          <dl className="kv">
            {RATE_TYPES_BY_PARTY[type].map((rt) => (
              <div key={rt} style={{ display: 'contents' }}>
                <dt>{RATE_META[rt].label}</dt>
                <dd>
                  <strong>{RATE_META[rt].unit === 'BASIS_POINTS' ? formatPercent(party.rates[rt]) : formatRate(party.rates[rt])}</strong>{' '}
                  {can(profile?.role, 'rate.change') && (
                    <Button size="sm" variant="ghost" onClick={() => setRateDialog(rt)}>Change</Button>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p className="small muted" style={{ marginTop: 10 }}>New orders are pre-filled with these. Past orders keep their own rates.</p>
        </Panel>
        <Panel title="Profile">
          <dl className="kv">
            <dt>ID</dt><dd>{party.code}</dd>
            <dt>Phone</dt><dd>{party.phone ? <a href={`tel:${party.phone}`}>{party.phone}</a> : '—'}</dd>
            <dt>Address</dt><dd>{party.address || '—'}</dd>
            {(type === 'BUYER' || type === 'SELLER') && <><dt>GSTIN</dt><dd>{party.gstin || '—'}</dd></>}
            {(type === 'BUYER' || type === 'SELLER') && <><dt>Default agent</dt><dd>{nameOf(party.defaults.commissionAgentId, 'None')}</dd></>}
            {(type === 'BUYER' || type === 'SELLER') && <><dt>Default transporter</dt><dd>{nameOf(party.defaults.transporterId, 'None')}</dd></>}
            {type === 'BUYER' && <><dt>Payment agent</dt><dd>{nameOf(party.defaults.paymentAgentId, 'Business default')}</dd></>}
            <dt>Created</dt><dd>{formatDateTime(party.createdAt)}</dd>
            <dt>Updated</dt><dd>{formatDateTime(party.updatedAt)}</dd>
          </dl>
          {party.notes && <p className="small" style={{ marginTop: 10 }}>{party.notes}</p>}
        </Panel>
      </div>

      <DateFilter state={dr} />
      {period.error && <ErrorNotice error={period.error} onRetry={period.reload} />}

      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'orders', label: 'Orders' }, { value: 'payments', label: 'Payments' }, { value: 'rates', label: 'Rate history' }]} />

      {tab === 'orders' && (
        <Panel bodyless title={`Order ledger, ${describeRange(dr.range)}`} actions={<Button size="sm" icon="download" onClick={() => void exportLedger()}>Export CSV</Button>}>
          <DataTable
            rows={orders}
            columns={ledgerColumns(ledgerKind)}
            rowKey={(o) => o.id}
            loading={ordersLoading}
            error={ordersError}
            onRetry={() => void loadOrders(null)}
            hasMore={!!cursor}
            loadingMore={ordersLoading && orders.length > 0}
            onLoadMore={() => void loadOrders(cursor)}
            empty={{ title: 'No orders in this period', body: 'Choose a wider date range to see more.' }}
          />
          <SummaryBand type={type} period={periodSummary} lifetime={lifetimeSummary} periodLabel={periodLabel} />
        </Panel>
      )}

      {tab === 'payments' && (
        <Panel bodyless title={`Payments, ${describeRange(dr.range)}`}>
          <DataTable
            rows={payments.data?.payments ?? []}
            columns={paymentColumns}
            rowKey={(p) => p.id}
            loading={payments.loading}
            error={payments.error}
            onRetry={payments.reload}
            rowClassName={(p) => (p.status === 'VOID' ? 'is-void' : '')}
            empty={{ title: 'No payments in this period' }}
          />
          <SummaryBand type={type} period={periodSummary} lifetime={lifetimeSummary} periodLabel={periodLabel} />
        </Panel>
      )}

      {tab === 'rates' && (
        <Panel bodyless title="Rate history">
          {history.loading && !history.data ? (
            <SkeletonRows rows={3} />
          ) : history.error ? (
            <div style={{ padding: 18 }}><ErrorNotice error={history.error} onRetry={history.reload} /></div>
          ) : (history.data?.length ?? 0) === 0 ? (
            <p className="muted small" style={{ padding: 18 }}>No rate changes recorded yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Changed</th><th>Rate</th><th className="r">From</th><th className="r">To</th><th>Effective</th><th>Source</th></tr></thead>
                <tbody>
                  {history.data!.map((h) => {
                    const pct = RATE_META[h.rateType].unit === 'BASIS_POINTS';
                    const f = (v: number | null) => (pct ? formatPercent(v) : formatRate(v));
                    return (
                      <tr key={h.id}>
                        <td className="nowrap">{formatDateTime(h.createdAt)}</td>
                        <td>{RATE_META[h.rateType].label}</td>
                        <td className="r">{f(h.oldRate)}</td>
                        <td className="r"><strong>{f(h.newRate)}</strong></td>
                        <td>{formatDate(h.effectiveFrom)}</td>
                        <td>{h.sourceOrderId ? <a href={`#/orders/${h.sourceOrderId}`}>{h.sourceOrderNumber}</a> : h.reason || 'Profile change'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {editing && <PartyFormDialog type={type} party={party} onClose={() => setEditing(false)} />}
      {rateDialog && <ChangeRateDialog party={party} rateType={rateDialog} onClose={() => setRateDialog(null)} />}
      {paying && <PaymentFormDialog initialCategory={PARTY_TO_CATEGORY[type]} initialPartyId={party.id} onClose={() => setPaying(false)} onSaved={payments.reload} />}
      {toggling && (
        <ConfirmDialog
          title={party.active ? `Deactivate ${party.name}?` : `Reactivate ${party.name}?`}
          body={party.active ? 'Inactive records disappear from order forms. All past orders, payments and history are kept.' : 'It will be available on new orders again.'}
          confirmLabel={party.active ? 'Deactivate' : 'Reactivate'}
          busy={busy}
          onCancel={() => setToggling(false)}
          onConfirm={() => void toggleActive()}
        />
      )}
    </div>
  );
}
