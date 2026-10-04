import { StaleStatisticsNotice } from '../../components/StaleStatisticsNotice';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from '../../components/DataTable';
import { Badge, Button, ErrorNotice, Field, PageHeader, Panel, TextInput } from '../../components/ui';
import { formatCount, formatINR, formatPercent, formatQtyNumber, formatRate } from '../../domain/format';
import { can } from '../../domain/permissions';
import { RATE_META, RATE_TYPES_BY_PARTY } from '../../domain/rates';
import { partySummary } from '../../domain/rollups';
import { matchesQuery } from '../../domain/search';
import type { Party, PartyType } from '../../domain/types';
import { useRollup } from '../../hooks/useRollup';
import { PARTY_LABELS } from '../../services/parties';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';
import type { Column } from '../ledger/columns';
import { PartyFormDialog } from './PartyFormDialog';

export default function PartyListPage({ type }: { type: PartyType }) {
  const { profile } = useSession();
  const { ofType, nameOf, loading, error } = useData();
  const navigate = useNavigate();
  const lifetime = useRollup({ from: null, to: null });
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);
  const labels = PARTY_LABELS[type];

  const rows = ofType(type, { includeInactive: showInactive }).filter((p) => matchesQuery([p.name, p.code, p.phone, p.gstin, p.address], q));
  const sum = (p: Party) => (lifetime.data ? partySummary(lifetime.data, type, p.id) : null);

  const columns = useMemo<Column<Party>[]>(() => {
    const cols: Column<Party>[] = [
      { id: 'code', header: 'ID', text: (p) => p.code, csv: (p) => p.code, sortValue: (p) => p.code },
      { id: 'name', header: 'Name', text: (p) => p.name, csv: (p) => p.name, link: (p) => `/${labels.path}/${p.id}`, sortValue: (p) => p.name.toLowerCase() },
      { id: 'phone', header: 'Phone', text: (p) => p.phone || '—', csv: (p) => p.phone },
    ];
    for (const rt of RATE_TYPES_BY_PARTY[type]) {
      const pct = RATE_META[rt].unit === 'BASIS_POINTS';
      cols.push({
        id: rt,
        header: RATE_META[rt].label,
        align: 'right',
        text: (p) => (p.rates[rt] === undefined ? '—' : pct ? formatPercent(p.rates[rt]) : formatRate(p.rates[rt])),
        csv: (p) => p.rates[rt] ?? '',
        sortValue: (p) => p.rates[rt] ?? -1,
      });
    }
    if (type === 'BUYER' || type === 'SELLER') {
      cols.push({ id: 'agent', header: 'Default agent', text: (p) => (p.defaults.commissionAgentId ? nameOf(p.defaults.commissionAgentId) : '—'), csv: () => '' });
    }
    cols.push(
      { id: 'orders', header: 'Orders', align: 'right', text: (p) => formatCount(sum(p)?.orders ?? 0), csv: (p) => sum(p)?.orders ?? 0, sortValue: (p) => sum(p)?.orders ?? 0 },
      { id: 'qty', header: 'Qty (MT)', align: 'right', text: (p) => formatQtyNumber(sum(p)?.qtyKg ?? 0), csv: (p) => sum(p)?.qtyKg ?? 0, sortValue: (p) => sum(p)?.qtyKg ?? 0 },
      { id: 'out', header: 'Outstanding', align: 'right', text: (p) => formatINR(sum(p)?.outstanding ?? 0), csv: (p) => sum(p)?.outstanding ?? 0, sortValue: (p) => sum(p)?.outstanding ?? 0 },
      { id: 'status', header: 'Status', text: (p) => (p.active ? 'Active' : 'Inactive'), csv: (p) => (p.active ? 'Active' : 'Inactive') },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, labels.path, lifetime.data, nameOf]);

  return (
    <div className="stack">
      <PageHeader
        title={labels.plural}
        sub="Lifetime figures from confirmed orders and recorded payments"
        actions={can(profile?.role, 'party.write') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add {labels.singular.toLowerCase()}</Button>}
      />
      <div className="filters no-print">
        <Field label="Search" htmlFor="pl-q">
          <TextInput id="pl-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID, phone, GSTIN" />
        </Field>
        <label className="check" style={{ paddingBottom: 10 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
      </div>
      {error && <ErrorNotice error={error} />}
      <StaleStatisticsNotice data={[lifetime.data]} />
      <Panel bodyless>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(p) => p.id}
          loading={loading}
          showTotals={false}
          onRowClick={(p) => navigate(`/${labels.path}/${p.id}`)}
          rowClassName={(p) => (p.active ? '' : 'is-inactive')}
          empty={{
            title: q ? 'No matches' : `No ${labels.plural.toLowerCase()} yet`,
            body: q ? 'Try a different search.' : `Add your first ${labels.singular.toLowerCase()} to use it on orders.`,
            action: !q && can(profile?.role, 'party.write') ? <Button variant="primary" onClick={() => setAdding(true)}>Add {labels.singular.toLowerCase()}</Button> : undefined,
          }}
        />
      </Panel>
      {!showInactive && ofType(type, { includeInactive: true }).some((p) => !p.active) && (
        <p className="small muted">
          <Badge>Inactive</Badge> records are hidden. Their history is kept.
        </p>
      )}
      {adding && <PartyFormDialog type={type} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/${labels.path}/${id}`)} />}
    </div>
  );
}
