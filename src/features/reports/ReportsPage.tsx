import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { PartySelect } from '../../components/PartySelect';
import { Button, Field, Notice, PageHeader, Panel, Select } from '../../components/ui';
import { describeRange } from '../../domain/dates';
import { formatCount, formatINR, formatQtyNumber, kgToPlainMt, paiseToPlain } from '../../domain/format';
import { CATEGORY_META } from '../../domain/payments';
import { breakdown } from '../../domain/rollups';
import { PARTY_TYPES, PAYMENT_CATEGORIES, type Order, type PartyType, type Payment, type PaymentCategory } from '../../domain/types';
import { useDateRange } from '../../hooks/useDateRange';
import { friendlyError } from '../../services/errors';
import { queryAllOrders } from '../../services/orders';
import { queryAllPayments } from '../../services/payments';
import { loadRollup } from '../../services/rollups';
import { PARTY_LABELS } from '../../services/parties';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';
import { downloadCsv } from '../../utils/download';
import { LEDGER_PARTY_TYPE, LEDGER_TITLES, ledgerColumns, orderExportColumns, type Column, type LedgerKind } from '../ledger/columns';
import { hasParty } from '../ledger/LedgerPage';
import { paymentColumns } from '../payments/PaymentsPage';

type ReportType = Exclude<LedgerKind, 'orders'> | 'orders' | 'payments' | 'outstanding';
const REPORTS: { value: ReportType; label: string }[] = [
  { value: 'orders', label: 'Orders (all fields)' },
  { value: 'buyer', label: LEDGER_TITLES.buyer },
  { value: 'seller', label: LEDGER_TITLES.seller },
  { value: 'commission', label: LEDGER_TITLES.commission },
  { value: 'freight', label: LEDGER_TITLES.freight },
  { value: 'paymentAgent', label: LEDGER_TITLES.paymentAgent },
  { value: 'payments', label: 'Payments' },
  { value: 'outstanding', label: 'Outstanding balances (as of today)' },
];

interface OutstandingRow {
  id: string;
  type: PartyType;
  name: string;
  orders: number;
  qtyKg: number;
  amount: number;
  paid: number;
  outstanding: number;
}

type Loaded =
  | { kind: 'orders'; report: ReportType; rows: Order[]; truncated: boolean }
  | { kind: 'payments'; rows: Payment[]; truncated: boolean }
  | { kind: 'outstanding'; rows: OutstandingRow[] };

const outstandingColumns: Column<OutstandingRow>[] = [
  { id: 'type', header: 'Type', text: (r) => PARTY_LABELS[r.type].singular, csv: (r) => PARTY_LABELS[r.type].singular, sortValue: (r) => r.type },
  { id: 'name', header: 'Party', text: (r) => r.name, csv: (r) => r.name, link: (r) => `/${PARTY_LABELS[r.type].path}/${r.id}`, sortValue: (r) => r.name.toLowerCase() },
  { id: 'orders', header: 'Orders', align: 'right', text: (r) => formatCount(r.orders), csv: (r) => r.orders },
  { id: 'qty', header: 'Qty (MT)', align: 'right', text: (r) => formatQtyNumber(r.qtyKg), csv: (r) => kgToPlainMt(r.qtyKg) },
  { id: 'amount', header: 'Total due', align: 'right', text: (r) => formatINR(r.amount), csv: (r) => paiseToPlain(r.amount), sortValue: (r) => r.amount },
  { id: 'paid', header: 'Paid', align: 'right', text: (r) => formatINR(r.paid), csv: (r) => paiseToPlain(r.paid) },
  { id: 'out', header: 'Outstanding', align: 'right', text: (r) => formatINR(r.outstanding), csv: (r) => paiseToPlain(r.outstanding), sum: (r) => r.outstanding, sumKind: 'inr', sortValue: (r) => r.outstanding },
];

export default function ReportsPage() {
  const [params] = useSearchParams();
  const { settings } = useSession();
  const { nameOf } = useData();
  const initial = (REPORTS.find((r) => r.value === params.get('type'))?.value ?? 'orders') as ReportType;
  const [report, setReport] = useState<ReportType>(initial);
  const dr = useDateRange('THIS_MONTH');
  const [partyId, setPartyId] = useState<string | null>(null);
  const [category, setCategory] = useState<PaymentCategory | ''>('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partyType: PartyType | null = report !== 'orders' && report !== 'payments' && report !== 'outstanding' ? LEDGER_PARTY_TYPE[report] : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (report === 'payments') {
        const r = await queryAllPayments({ range: dr.range, category: category || null });
        setLoaded({ kind: 'payments', rows: r.payments, truncated: r.truncated });
      } else if (report === 'outstanding') {
        const data = await loadRollup({ from: null, to: null });
        const rows: OutstandingRow[] = [];
        for (const t of PARTY_TYPES) {
          for (const b of breakdown(data, t)) {
            if (b.outstanding === 0) continue;
            rows.push({ id: b.id, type: t, name: nameOf(b.id, 'Unknown'), orders: b.n, qtyKg: b.qtyKg, amount: b.amount, paid: b.paid, outstanding: b.outstanding });
          }
        }
        setLoaded({ kind: 'outstanding', rows });
      } else {
        const r = await queryAllOrders({ range: dr.range, status: 'CONFIRMED', party: partyType && partyId ? { type: partyType, id: partyId } : null });
        setLoaded({ kind: 'orders', report, rows: r.orders.filter((o) => hasParty(o, report)), truncated: r.truncated });
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const fileBase = `rock-${report}-${report === 'outstanding' ? 'today' : `${dr.range.from ?? 'all'}-${dr.range.to ?? 'now'}`}`;
  const download = () => {
    if (!loaded) return;
    if (loaded.kind === 'orders') downloadCsv(`${fileBase}.csv`, loaded.rows, loaded.report === 'orders' ? orderExportColumns() : ledgerColumns(loaded.report as LedgerKind));
    else if (loaded.kind === 'payments') downloadCsv(`${fileBase}.csv`, loaded.rows, paymentColumns());
    else downloadCsv(`${fileBase}.csv`, loaded.rows, outstandingColumns);
  };

  const title = REPORTS.find((r) => r.value === report)!.label;
  return (
    <div className="stack">
      <PageHeader title="Reports" sub="Preview, download as CSV (opens in Excel), or print / save as PDF" />
      <Panel className="no-print">
        <div className="filters" style={{ marginBottom: 0 }}>
          <Field label="Report" htmlFor="rp-type">
            <Select id="rp-type" value={report} onChange={(e) => { setReport(e.target.value as ReportType); setLoaded(null); setPartyId(null); }}>
              {REPORTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          {partyType && (
            <Field label={PARTY_LABELS[partyType].singular} htmlFor="rp-party">
              <PartySelect id="rp-party" type={partyType} value={partyId} onChange={(id) => setPartyId(id)} allowNone noneLabel="All" includeInactive />
            </Field>
          )}
          {report === 'payments' && (
            <Field label="Payment type" htmlFor="rp-cat">
              <Select id="rp-cat" value={category} onChange={(e) => setCategory(e.target.value as PaymentCategory | '')}>
                <option value="">All</option>
                {PAYMENT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_META[c].label}</option>)}
              </Select>
            </Field>
          )}
          <Button variant="primary" busy={busy} onClick={() => void run()}>Preview report</Button>
        </div>
        {report !== 'outstanding' && <div style={{ marginTop: 14 }}><DateFilter state={dr} /></div>}
      </Panel>
      {error && <Notice tone="danger">{error}</Notice>}
      {loaded && (
        <Panel
          bodyless
          title={`${title}${report === 'outstanding' ? '' : `, ${describeRange(dr.range)}`}`}
          actions={
            <>
              <Button size="sm" icon="download" onClick={download}>Download CSV</Button>
              <Button size="sm" icon="print" onClick={() => window.print()}>Print / PDF</Button>
            </>
          }
        >
          <div className="print-only" style={{ padding: '0 0 8px' }}>
            <strong>{settings.businessName}</strong>: {title} {report !== 'outstanding' && `(${describeRange(dr.range)})`}, printed {new Date().toLocaleString('en-IN')}
          </div>
          {'truncated' in loaded && loaded.truncated && <div style={{ padding: 14 }}><Notice tone="warn">Limited to the first 5,000 records. Narrow the date range.</Notice></div>}
          {loaded.kind === 'orders' && <DataTable rows={loaded.rows} columns={ledgerColumns(loaded.report as LedgerKind)} rowKey={(o) => o.id} empty={{ title: 'No records' }} />}
          {loaded.kind === 'payments' && <DataTable rows={loaded.rows} columns={paymentColumns()} rowKey={(p) => p.id} rowClassName={(p) => (p.status === 'VOID' ? 'is-void' : '')} empty={{ title: 'No records' }} />}
          {loaded.kind === 'outstanding' && <DataTable rows={loaded.rows} columns={outstandingColumns} rowKey={(r) => `${r.type}-${r.id}`} empty={{ title: 'Nothing outstanding' }} />}
        </Panel>
      )}
    </div>
  );
}
