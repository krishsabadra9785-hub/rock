import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '../../components/DataTable';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorNotice, Field, Notice, PageHeader, Panel, SkeletonRows, TextArea, ButtonLink } from '../../components/ui';
import { formatDate, formatDateTime, formatINR, formatPercent, formatQty, formatRate } from '../../domain/format';
import { CATEGORY_META, METHOD_LABELS, orderSettlement } from '../../domain/payments';
import { can } from '../../domain/permissions';
import { RATE_META } from '../../domain/rates';
import { tryCalculateOrder } from '../../domain/calc';
import type { Order, PaidKey, Payment, PaymentCategory } from '../../domain/types';
import { useAsync } from '../../hooks/useAsync';
import { listAuditLogs } from '../../services/audit';
import { friendlyError } from '../../services/errors';
import { cancelOrder, subscribeOrder } from '../../services/orders';
import { queryPayments, voidPayment } from '../../services/payments';
import { invalidateRollupCache } from '../../services/rollups';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';
import { PaymentFormDialog } from '../payments/PaymentFormDialog';
import { EditOrderDialog } from './EditOrderDialog';
import { MoneyFlow } from './orderParts';

const OBLIGATIONS: { key: PaidKey; label: string; category: PaymentCategory; path: string }[] = [
  { key: 'buyer', label: 'Receivable from buyer', category: 'BUYER_RECEIPT', path: 'buyers' },
  { key: 'seller', label: 'Payable to seller', category: 'SELLER_PAYMENT', path: 'sellers' },
  { key: 'commission', label: 'Commission payable', category: 'COMMISSION_PAYMENT', path: 'commission-agents' },
  { key: 'freight', label: 'Freight payable', category: 'TRANSPORTER_PAYMENT', path: 'transporters' },
  { key: 'paymentAgent', label: 'Payment agent commission payable', category: 'PAYMENT_AGENT_SETTLEMENT', path: 'payment-agents' },
];

function partyFor(o: Order, key: PaidKey): { id: string | null; name: string } {
  switch (key) {
    case 'buyer':
      return { id: o.buyerId, name: o.buyer.name };
    case 'seller':
      return { id: o.sellerId, name: o.seller.name };
    case 'commission':
      return { id: o.commissionAgentId, name: o.commission.name };
    case 'freight':
      return { id: o.transporterId, name: o.freight.name };
    case 'paymentAgent':
      return { id: o.paymentAgentId, name: o.paymentAgent.name };
  }
}

export default function OrderDetailPage() {
  const { id = '' } = useParams();
  const { profile } = useSession();
  const toast = useToast();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<PaymentCategory | null>(null);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);

  useEffect(() => subscribeOrder(id, setOrder, (e) => setError(friendlyError(e))), [id]);
  const payments = useAsync(() => queryPayments({ range: { from: null, to: null }, orderId: id, pageSize: 200 }), [id, order?.paid]);
  const audit = useAsync(() => (can(profile?.role, 'audit.read') ? listAuditLogs(id) : Promise.resolve([])), [id, order?.version]);

  if (error) return <ErrorNotice error={error} />;
  if (order === undefined) return <SkeletonRows rows={8} />;
  if (order === null) return <EmptyState title="Order not found" action={<ButtonLink to="/orders">Back to orders</ButtonLink>} />;

  const fin = tryCalculateOrder({
    qtyKg: order.qtyKg,
    buyerRatePaise: order.buyer.ratePaise,
    gstBp: order.buyer.gstBp,
    sellerRatePaise: order.seller.ratePaise,
    commissionRatePaise: order.commission.ratePaise,
    freightRatePaise: order.freight.ratePaise,
    paymentAgentRatePaise: order.paymentAgent.ratePaise,
  });
  const confirmed = order.status === 'CONFIRMED';
  const hasPayments = Object.values(order.paid).some((v) => v !== 0);

  const doCancel = async () => {
    setBusy(true);
    try {
      await cancelOrder(order.id, reason);
      invalidateRollupCache();
      toast.success(`${order.orderNumber} cancelled`);
      setCancelling(false);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  const doVoid = async () => {
    if (!voiding) return;
    setBusy(true);
    try {
      await voidPayment(voiding.id, reason);
      invalidateRollupCache();
      toast.success('Payment voided');
      setVoiding(null);
      setReason('');
      payments.reload();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        back={{ to: '/orders', label: 'Orders' }}
        title={
          <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {order.orderNumber} {confirmed ? <Badge tone="ok">Confirmed</Badge> : <Badge tone="danger">Cancelled</Badge>}
            {order.demo && <Badge tone="warn">Demo</Badge>}
          </span>
        }
        sub={`${formatQty(order.qtyKg)}, ${order.buyer.name} ← ${order.seller.name}, dispatched ${formatDate(order.dispatchDate)}`}
        actions={
          <>
            {confirmed && can(profile?.role, 'payment.create') && (
              <Button variant="primary" icon="wallet" onClick={() => setPayFor('BUYER_RECEIPT')}>
                Record payment
              </Button>
            )}
            {confirmed && can(profile?.role, 'order.edit') && (
              <Button icon="edit" onClick={() => setEditing(true)}>
                Correct
              </Button>
            )}
            {confirmed && can(profile?.role, 'order.cancel') && <Button onClick={() => { setReason(''); setCancelling(true); }}>Cancel order</Button>}
            <Button icon="print" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />
      {!confirmed && <Notice tone="danger">Cancelled: {order.cancelReason}. Cancelled orders are excluded from dashboards and ledgers.</Notice>}

      {fin && (
        <Panel title="Where the money goes" bodyless>
          <MoneyFlow fin={fin} />
        </Panel>
      )}

      <div className="grid-2">
        <Panel title="Receipt (confirmed details)">
          <dl className="kv">
            <dt>Net quantity</dt>
            <dd className="strong">{formatQty(order.qtyKg)}</dd>
            <dt>Dispatch date</dt>
            <dd>{formatDate(order.receipt.dispatchDate)}</dd>
            <dt>Vehicle</dt>
            <dd>{order.receipt.vehicleNumber || '—'}</dd>
            <dt>Driver</dt>
            <dd>{order.receipt.driverName || '—'}</dd>
            <dt>Driver phone</dt>
            <dd>{order.receipt.driverPhone ? <a href={`tel:${order.receipt.driverPhone}`}>{order.receipt.driverPhone}</a> : '—'}</dd>
            <dt>Destination</dt>
            <dd>{order.receipt.destination || '—'}</dd>
            <dt>Receipt no.</dt>
            <dd>{order.receipt.receiptNumber || '—'}</dd>
            <dt>How it was entered</dt>
            <dd>
              {order.receipt.ai.status === 'SKIPPED' ? 'Typed manually' : `Read by AI (${order.receipt.ai.model ?? 'Gemini'}), then confirmed by a person`}
            </dd>
          </dl>
          <p className="small faint" style={{ marginTop: 12 }}>
            {order.receipt.image.provider === 'NONE'
              ? `The receipt image was used only to read these details and was not stored${order.receipt.image.fileName ? ` (${order.receipt.image.fileName})` : ''}.`
              : 'Receipt image stored.'}
          </p>
        </Panel>
        <Panel title="Rates on this order">
          <dl className="kv">
            <dt>Buyer</dt>
            <dd>
              <Link to={`/buyers/${order.buyerId}`}>{order.buyer.name}</Link>: {formatRate(order.buyer.ratePaise)} + {formatPercent(order.buyer.gstBp)} GST
            </dd>
            <dt>Buyer amounts</dt>
            <dd>
              {formatINR(order.buyer.baseAmount)} + {formatINR(order.buyer.gstAmount)} = <strong>{formatINR(order.buyer.grossAmount)}</strong>
            </dd>
            <dt>Seller</dt>
            <dd>
              <Link to={`/sellers/${order.sellerId}`}>{order.seller.name}</Link>: {formatRate(order.seller.ratePaise)} = {formatINR(order.seller.amount)}
            </dd>
            <dt>Commission</dt>
            <dd>{order.commissionAgentId ? <><Link to={`/commission-agents/${order.commissionAgentId}`}>{order.commission.name}</Link>: {formatRate(order.commission.ratePaise)} = {formatINR(order.commission.amount)}</> : 'None'}</dd>
            <dt>Freight</dt>
            <dd>{order.transporterId ? <><Link to={`/transporters/${order.transporterId}`}>{order.freight.name}</Link>: {formatRate(order.freight.ratePaise)} = {formatINR(order.freight.amount)}</> : 'None'}</dd>
            <dt>Payment agent</dt>
            <dd>{order.paymentAgentId ? <><Link to={`/payment-agents/${order.paymentAgentId}`}>{order.paymentAgent.name}</Link>: {formatRate(order.paymentAgent.ratePaise)} = {formatINR(order.paymentAgent.amount)} commission payable</> : 'None'}</dd>
          </dl>
          {order.rateDecisions.some((r) => r.decision === 'NEW_DEFAULT') && (
            <p className="small muted" style={{ marginTop: 10 }}>
              New defaults set on this order: {order.rateDecisions.filter((r) => r.decision === 'NEW_DEFAULT').map((r) => RATE_META[r.rateType].label).join(', ')}.
            </p>
          )}
          {order.notes && <p className="small" style={{ marginTop: 10 }}>Notes: {order.notes}</p>}
        </Panel>
      </div>

      <Panel title="Settlement" bodyless>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Obligation</th>
                <th>Party</th>
                <th className="r">Amount</th>
                <th className="r">Paid</th>
                <th className="r">Outstanding</th>
                <th>Status</th>
                <th className="no-print" />
              </tr>
            </thead>
            <tbody>
              {OBLIGATIONS.map((ob) => {
                const p = partyFor(order, ob.key);
                if (!p.id) return null;
                const s = orderSettlement(order, ob.key);
                return (
                  <tr key={ob.key}>
                    <td>{ob.label}</td>
                    <td><Link to={`/${ob.path}/${p.id}`}>{p.name}</Link></td>
                    <td className="r">{formatINR(s.obligation)}</td>
                    <td className="r">{formatINR(s.paid)}</td>
                    <td className="r">{formatINR(s.outstanding)}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="no-print">
                      {confirmed && can(profile?.role, 'payment.create') && s.outstanding > 0 && (
                        <Button size="sm" onClick={() => setPayFor(ob.category)}>Record</Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Payments on this order" bodyless>
        {payments.loading && !payments.data ? (
          <SkeletonRows rows={2} />
        ) : payments.error ? (
          <div style={{ padding: 18 }}><ErrorNotice error={payments.error} onRetry={payments.reload} /></div>
        ) : (payments.data?.payments.length ?? 0) === 0 ? (
          <p className="muted small" style={{ padding: 18 }}>No payments recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Date</th><th>Type</th><th>Party</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th /></tr>
              </thead>
              <tbody>
                {payments.data!.payments.map((p) => (
                  <tr key={p.id} className={p.status === 'VOID' ? 'is-void' : ''}>
                    <td>{formatDate(p.date)}</td>
                    <td>{CATEGORY_META[p.category].label}</td>
                    <td>{p.partyName}</td>
                    <td>{METHOD_LABELS[p.method]}</td>
                    <td>{p.reference || '—'}</td>
                    <td className="r">{formatINR(p.amount)}</td>
                    <td className="no-print">
                      {p.status === 'ACTIVE' && can(profile?.role, 'payment.void') ? (
                        <Button size="sm" variant="ghost" onClick={() => { setReason(''); setVoiding(p); }}>Void</Button>
                      ) : p.status === 'VOID' ? (
                        <span className="small faint">Void: {p.voidReason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(audit.data?.length ?? 0) > 0 && (
        <Panel title="History" bodyless>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>
                {audit.data!.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{formatDateTime(a.at)}</td>
                    <td>{a.action}</td>
                    <td>
                      {a.summary}
                      {a.reason && <div className="small muted">Reason: {a.reason}</div>}
                      {a.changes && (
                        <div className="small muted">
                          {Object.entries(a.changes).map(([k, c]) => `${k}: ${String(c.from)} → ${String(c.to)}`).join('; ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <p className="small faint">
        Created {formatDateTime(order.createdAt)}
        {order.updatedAt && order.version > 1 ? `, last changed ${formatDateTime(order.updatedAt)} (version ${order.version})` : ''}
      </p>

      {payFor && <PaymentFormDialog order={order} initialCategory={payFor} onClose={() => setPayFor(null)} onSaved={payments.reload} />}
      {editing && <EditOrderDialog order={order} onClose={() => setEditing(false)} />}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${order.orderNumber}?`}
          danger
          busy={busy}
          confirmLabel="Cancel order"
          confirmDisabled={reason.trim().length < 3 || hasPayments}
          onCancel={() => setCancelling(false)}
          onConfirm={() => void doCancel()}
          body={hasPayments ? <Notice tone="warn">This order has payments. Void them first, then cancel.</Notice> : 'The order stays on record as cancelled and is removed from totals. This cannot be undone.'}
        >
          <Field label="Reason *" htmlFor="c-reason">
            <TextArea id="c-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
      {voiding && (
        <ConfirmDialog
          title="Void this payment?"
          danger
          busy={busy}
          confirmLabel="Void payment"
          confirmDisabled={reason.trim().length < 3}
          onCancel={() => setVoiding(null)}
          onConfirm={() => void doVoid()}
          body={`${CATEGORY_META[voiding.category].label} of ${formatINR(voiding.amount)} on ${formatDate(voiding.date)} will stay on record as void and stop counting towards balances.`}
        >
          <Field label="Reason *" htmlFor="v-reason">
            <TextArea id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
