import { formatCount, formatINR, formatQty, formatRate } from '../domain/format';
import type { PartySummary } from '../domain/rollups';
import type { PartyType } from '../domain/types';
import { Skeleton } from './ui';

type Metric = { label: string; value: (s: PartySummary) => string };

const COMMON: Metric[] = [
  { label: 'Total orders', value: (s) => formatCount(s.orders) },
  { label: 'Total quantity', value: (s) => formatQty(s.qtyKg) },
];

export const SUMMARY_METRICS: Record<PartyType, Metric[]> = {
  BUYER: [
    ...COMMON,
    { label: 'Total value (incl. GST)', value: (s) => formatINR(s.amount) },
    { label: 'Average rate (excl. GST)', value: (s) => formatRate(s.averageRate) },
    { label: 'Total received', value: (s) => formatINR(s.paid) },
    { label: 'Outstanding', value: (s) => formatINR(s.outstanding) },
  ],
  SELLER: [
    ...COMMON,
    { label: 'Total purchase value', value: (s) => formatINR(s.amount) },
    { label: 'Average rate', value: (s) => formatRate(s.averageRate) },
    { label: 'Total paid', value: (s) => formatINR(s.paid) },
    { label: 'Outstanding', value: (s) => formatINR(s.outstanding) },
  ],
  COMMISSION_AGENT: [
    ...COMMON,
    { label: 'Total commission', value: (s) => formatINR(s.amount) },
    { label: 'Total paid', value: (s) => formatINR(s.paid) },
    { label: 'Outstanding', value: (s) => formatINR(s.outstanding) },
  ],
  TRANSPORTER: [
    ...COMMON,
    { label: 'Total freight', value: (s) => formatINR(s.amount) },
    { label: 'Total paid', value: (s) => formatINR(s.paid) },
    { label: 'Outstanding', value: (s) => formatINR(s.outstanding) },
  ],
  PAYMENT_AGENT: [
    ...COMMON,
    { label: 'Amount processed', value: (s) => formatINR(s.received) },
    { label: 'Total deductions', value: (s) => formatINR(s.charge) },
    { label: 'Balance after deductions', value: (s) => formatINR(s.amount) },
    { label: 'Settled to us', value: (s) => formatINR(s.paid) },
    { label: 'Pending settlement', value: (s) => formatINR(s.outstanding) },
  ],
};

/** The clearly-visible summary that sits at the bottom of every party ledger. */
export function SummaryBand({
  type,
  period,
  lifetime,
  periodLabel,
}: {
  type: PartyType;
  period: PartySummary | undefined;
  lifetime: PartySummary | undefined;
  periodLabel: string;
}) {
  const metrics = SUMMARY_METRICS[type];
  const row = (label: string, s: PartySummary | undefined) => (
    <div className="summary-row">
      <div className="lbl">{label}</div>
      {metrics.map((m) => (
        <div className="cell" key={m.label}>
          <span>{m.label}</span>
          {s ? <strong>{m.value(s)}</strong> : <Skeleton height={18} width={80} />}
        </div>
      ))}
    </div>
  );
  return (
    <div className="summary-band" aria-label="Summary">
      {row(periodLabel, period)}
      {row('Lifetime', lifetime)}
    </div>
  );
}
