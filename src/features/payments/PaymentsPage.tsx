import { APP_FILE_PREFIX } from '../../config/brand';
import { useCallback, useEffect, useState } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { PartySelect } from '../../components/PartySelect';
import { Button, ConfirmDialog, Field, PageHeader, Panel, Select, TextArea } from '../../components/ui';
import { formatDate, formatINR, paiseToPlain } from '../../domain/format';
import { CATEGORY_META, METHOD_LABELS } from '../../domain/payments';
import { can } from '../../domain/permissions';
import { PAYMENT_CATEGORIES, type Payment, type PaymentCategory } from '../../domain/types';
import { useDateRange } from '../../hooks/useDateRange';
import { friendlyError } from '../../services/errors';
import { queryAllPayments, queryPayments, voidPayment } from '../../services/payments';
import { invalidateRollupCache } from '../../services/rollups';
import { useSession } from '../../state/SessionProvider';
import { useToast } from '../../state/ToastProvider';
import { downloadCsv } from '../../utils/download';
import type { Column } from '../ledger/columns';
import { PaymentFormDialog } from './PaymentFormDialog';

export function paymentColumns(): Column<Payment>[] {
  return [
    { id: 'date', header: 'Date', text: (p) => formatDate(p.date), csv: (p) => p.date, sortValue: (p) => p.date },
    { id: 'type', header: 'Type', text: (p) => CATEGORY_META[p.category].label, csv: (p) => CATEGORY_META[p.category].label, sortValue: (p) => p.category },
    { id: 'party', header: 'Party', text: (p) => p.partyName || '—', csv: (p) => p.partyName, sortValue: (p) => p.partyName.toLowerCase() },
    { id: 'order', header: 'Order', text: (p) => p.orderNumber ?? 'On account', csv: (p) => p.orderNumber ?? '', link: (p) => (p.orderId ? `/orders/${p.orderId}` : null) },
    { id: 'method', header: 'Method', text: (p) => METHOD_LABELS[p.method], csv: (p) => METHOD_LABELS[p.method] },
    { id: 'ref', header: 'Reference', text: (p) => p.reference || '—', csv: (p) => p.reference },
    { id: 'status', header: 'Status', text: (p) => (p.status === 'VOID' ? 'Void' : 'Active'), csv: (p) => p.status },
    { id: 'amount', header: 'Amount', align: 'right', text: (p) => formatINR(p.amount), csv: (p) => paiseToPlain(p.amount), sum: (p) => (p.status === 'ACTIVE' ? p.amount : 0), sumKind: 'inr', sortValue: (p) => p.amount },
  ];
}

export default function PaymentsPage() {
  const { profile } = useSession();
  const toast = useToast();
  const dr = useDateRange('THIS_MONTH');
  const [category, setCategory] = useState<PaymentCategory | ''>('');
  const [partyId, setPartyId] = useState<string | null>(null);
  const [rows, setRows] = useState<Payment[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const partyType = category ? CATEGORY_META[category].partyType : null;

  const load = useCallback(
    async (after: QueryDocumentSnapshot | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await queryPayments({ range: dr.range, category: category || null, partyId: partyType ? partyId : null, pageSize: 100 }, after);
        setRows((r) => (after ? [...r, ...page.payments] : page.payments));
        setCursor(page.cursor);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setLoading(false);
      }
    },
    [dr.range, category, partyId, partyType],
  );
  useEffect(() => {
    void load(null);
  }, [load]);

  const doVoid = async () => {
    if (!voiding) return;
    setBusy(true);
    try {
      await voidPayment(voiding.id, reason);
      invalidateRollupCache();
      toast.success('Payment voided');
      setVoiding(null);
      void load(null);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    try {
      const all = await queryAllPayments({ range: dr.range, category: category || null, partyId: partyType ? partyId : null });
      downloadCsv(`${APP_FILE_PREFIX}-payments-${dr.range.from ?? 'all'}-${dr.range.to ?? 'now'}.csv`, all.payments, paymentColumns());
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const canVoid = can(profile?.role, 'payment.void');

  return (
    <div className="stack">
      <PageHeader
        title="Payments"
        sub="Every receipt and payout is its own record. Voided payments stay visible but don't count."
        actions={
          <>
            <Button icon="download" onClick={() => void exportCsv()}>Export CSV</Button>
            {can(profile?.role, 'payment.create') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Record payment</Button>}
          </>
        }
      />
      <DateFilter state={dr} />
      <div className="filters no-print">
        <Field label="Type" htmlFor="pp-cat">
          <Select id="pp-cat" value={category} onChange={(e) => { setCategory(e.target.value as PaymentCategory | ''); setPartyId(null); }}>
            <option value="">All types</option>
            {PAYMENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
          </Select>
        </Field>
        {partyType && (
          <Field label="Party" htmlFor="pp-party">
            <PartySelect id="pp-party" type={partyType} value={partyId} onChange={(id) => setPartyId(id)} allowNone noneLabel="All" includeInactive />
          </Field>
        )}
      </div>
      <Panel bodyless>
        <DataTable
          rows={rows}
          columns={paymentColumns()}
          rowKey={(p) => p.id}
          loading={loading}
          error={error}
          onRetry={() => void load(null)}
          hasMore={!!cursor}
          loadingMore={loading && rows.length > 0}
          onLoadMore={() => void load(cursor)}
          rowClassName={(p) => (p.status === 'VOID' ? 'is-void' : '')}
          onRowClick={canVoid ? (p) => { if (p.status === 'ACTIVE') { setReason(''); setVoiding(p); } } : undefined}
          empty={{ title: 'No payments in this period', action: can(profile?.role, 'payment.create') ? <Button variant="primary" onClick={() => setAdding(true)}>Record payment</Button> : undefined }}
        />
      </Panel>
      {canVoid && rows.length > 0 && <p className="small muted">Select an active payment to void it.</p>}
      {adding && <PaymentFormDialog onClose={() => setAdding(false)} onSaved={() => void load(null)} />}
      {voiding && (
        <ConfirmDialog
          title="Void this payment?"
          danger
          busy={busy}
          confirmLabel="Void payment"
          confirmDisabled={reason.trim().length < 3}
          onCancel={() => setVoiding(null)}
          onConfirm={() => void doVoid()}
          body={`${CATEGORY_META[voiding.category].label} of ${formatINR(voiding.amount)}${voiding.partyName ? ` (${voiding.partyName})` : ''} on ${formatDate(voiding.date)}. It stays on record as void and stops counting towards balances.`}
        >
          <Field label="Reason *" htmlFor="pv-reason">
            <TextArea id="pv-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </ConfirmDialog>
      )}
    </div>
  );
}
