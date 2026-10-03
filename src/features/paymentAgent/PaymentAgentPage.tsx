import { useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { DateFilter } from '../../components/DateFilter';
import { PartySelect } from '../../components/PartySelect';
import { SummaryBand } from '../../components/SummaryBand';
import { ButtonLink, EmptyState, ErrorNotice, Field, Figure, PageHeader, Panel, Skeleton } from '../../components/ui';
import { describeRange } from '../../domain/dates';
import { formatCount, formatINR, formatQty } from '../../domain/format';
import { partySummary } from '../../domain/rollups';
import { useAsync } from '../../hooks/useAsync';
import { useDateRange } from '../../hooks/useDateRange';
import { useRollup } from '../../hooks/useRollup';
import { queryPayments } from '../../services/payments';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';
import { ledgerColumns } from '../ledger/columns';
import { useOrderPages } from '../ledger/useOrderPages';

/** Dedicated Payment Agent dashboard: buyer money in, agent's per-MT charge out, balance passed on. */
export default function PaymentAgentPage() {
  const { ofType } = useData();
  const { settings } = useSession();
  const agents = ofType('PAYMENT_AGENT', { includeInactive: true });
  const [agentId, setAgentId] = useState<string | null>(settings.defaultPaymentAgentId ?? agents[0]?.id ?? null);
  const selected = agentId ?? agents[0]?.id ?? null;
  const dr = useDateRange('THIS_MONTH');
  const period = useRollup(dr.range);
  const lifetime = useRollup({ from: null, to: null });
  const pages = useOrderPages(
    selected ? { range: dr.range, status: 'CONFIRMED', party: { type: 'PAYMENT_AGENT', id: selected }, pageSize: 100 } : null,
    `${selected}|${dr.range.from}|${dr.range.to}`,
  );
  const settlements = useAsync(
    () => (selected ? queryPayments({ range: dr.range, partyId: selected, category: 'PAYMENT_AGENT_SETTLEMENT', pageSize: 500 }) : Promise.resolve({ payments: [], cursor: null })),
    [selected, dr.range.from, dr.range.to],
  );

  if (agents.length === 0) {
    return (
      <>
        <PageHeader title="Payment agent" />
        <EmptyState title="No payment agent yet" body="Add the payment agent who receives buyer payments and charges a per-MT fee." action={<ButtonLink to="/payment-agents" variant="primary">Add payment agent</ButtonLink>} />
      </>
    );
  }
  const p = period.data && selected ? partySummary(period.data, 'PAYMENT_AGENT', selected) : undefined;
  const l = lifetime.data && selected ? partySummary(lifetime.data, 'PAYMENT_AGENT', selected) : undefined;
  const sk = <Skeleton height={26} width={110} />;
  const activeSettlements = settlements.data?.payments.filter((x) => x.status === 'ACTIVE') ?? [];

  return (
    <div className="stack">
      <PageHeader
        title="Payment agent"
        sub="Buyers pay the agent; the agent keeps a per-MT charge and passes the balance on"
        actions={selected && <ButtonLink to={`/payment-agents/${selected}`}>Open profile</ButtonLink>}
      />
      <div className="filters no-print">
        {agents.length > 1 && (
          <Field label="Agent" htmlFor="pa-sel">
            <PartySelect id="pa-sel" type="PAYMENT_AGENT" value={selected} onChange={(id) => setAgentId(id)} includeInactive />
          </Field>
        )}
      </div>
      <DateFilter state={dr} />
      {period.error && <ErrorNotice error={period.error} onRetry={period.reload} />}
      <div className="figures">
        <Figure lead label="Total amount processed" value={p ? formatINR(p.received) : sk} />
        <Figure label="Total quantity" value={p ? formatQty(p.qtyKg) : sk} />
        <Figure label="Total agent charges" value={p ? formatINR(p.charge) : sk} />
        <Figure lead label="Total balance after deduction" value={p ? formatINR(p.amount) : sk} />
        <Figure label="Settlement payments" note={activeSettlements.length ? formatINR(activeSettlements.reduce((s, x) => s + x.amount, 0)) : 'recorded in period'} value={settlements.data ? formatCount(activeSettlements.length) : sk} />
        <Figure label="Pending settlement" note="All time" value={l ? formatINR(l.outstanding) : sk} />
      </div>
      <Panel bodyless title={`Ledger, ${describeRange(dr.range)}`} actions={<ButtonLink size="sm" to={`/ledger/paymentAgent?party=${selected ?? ''}&from=${dr.range.from ?? ''}&to=${dr.range.to ?? ''}`}>Full ledger & export</ButtonLink>}>
        <DataTable
          rows={pages.rows}
          columns={ledgerColumns('paymentAgent')}
          rowKey={(o) => o.id}
          loading={pages.loading}
          error={pages.error}
          onRetry={pages.reload}
          hasMore={pages.hasMore}
          loadingMore={pages.loading && pages.rows.length > 0}
          onLoadMore={pages.loadMore}
          empty={{ title: 'No orders through this agent in this period' }}
        />
        <SummaryBand type="PAYMENT_AGENT" period={p} lifetime={l} periodLabel={dr.preset === 'ALL_TIME' ? 'All time' : 'Selected period'} />
      </Panel>
    </div>
  );
}
