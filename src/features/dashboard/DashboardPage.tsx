import { useNavigate } from 'react-router-dom';
import { BarList, type BarItem } from '../../components/BarList';
import { DateFilter } from '../../components/DateFilter';
import { ButtonLink, ErrorNotice, Figure, PageHeader, Panel, Skeleton } from '../../components/ui';
import { formatCount, formatINR, formatQty } from '../../domain/format';
import { breakdown, outstandingSummary, type RollupData } from '../../domain/rollups';
import type { PartyType } from '../../domain/types';
import { rangeQuery, useDateRange } from '../../hooks/useDateRange';
import { useRollup } from '../../hooks/useRollup';
import { PARTY_LABELS } from '../../services/parties';
import { useData } from '../../state/DataProvider';
import { useSession } from '../../state/SessionProvider';

export default function DashboardPage() {
  const { settings } = useSession();
  const { nameOf } = useData();
  const navigate = useNavigate();
  const dr = useDateRange('THIS_MONTH');
  const period = useRollup(dr.range);
  const lifetime = useRollup({ from: null, to: null });
  const q = rangeQuery(dr.range);

  const t = period.data?.totals;
  const out = lifetime.data ? outstandingSummary(lifetime.data.totals) : null;
  const v = (n: number | undefined, kind: 'inr' | 'qty' | 'count' = 'inr') =>
    n === undefined ? <Skeleton height={26} width={110} /> : kind === 'qty' ? formatQty(n) : kind === 'count' ? formatCount(n) : formatINR(n);

  const items = (data: RollupData | undefined, type: PartyType): BarItem[] =>
    data
      ? breakdown(data, type)
          .slice(0, 8)
          .map((r) => ({ id: r.id, name: nameOf(r.id, 'Unknown'), value: r.amount, valueText: formatINR(r.amount), qtyKg: r.qtyKg }))
      : [];
  const goParty = (type: PartyType) => (id: string) => navigate(`/${PARTY_LABELS[type].path}/${id}`);

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        sub={settings.businessName !== 'ROCK' ? settings.businessName : 'Trading overview from confirmed orders and recorded payments'}
        actions={
          <ButtonLink to="/orders/new" variant="primary" icon="plus">
            Create order
          </ButtonLink>
        }
      />
      <DateFilter state={dr} />
      {period.error && <ErrorNotice error={period.error} onRetry={period.reload} />}

      <div className="figures">
        <Figure lead label="Total selling (incl. GST)" value={v(t?.buyerGross)} onClick={() => navigate(`/ledger/buyer?${q}`)} />
        <Figure lead label="Total buying" value={v(t?.seller)} onClick={() => navigate(`/ledger/seller?${q}`)} />
        <Figure label="Total commission" value={v(t?.commission)} onClick={() => navigate(`/ledger/commission?${q}`)} />
        <Figure label="Total freight" value={v(t?.freight)} onClick={() => navigate(`/ledger/freight?${q}`)} />
        <Figure label="Payment agent charges" value={v(t?.paCharge)} onClick={() => navigate(`/ledger/paymentAgent?${q}`)} />
        <Figure label="Total quantity" value={v(t?.qtyKg, 'qty')} onClick={() => navigate(`/ledger/orders?${q}`)} />
        <Figure label="Total orders" value={v(t?.orders, 'count')} onClick={() => navigate(`/ledger/orders?${q}`)} />
      </div>

      <div className="figures compact">
        <Figure label="Buyer base value" value={v(t?.buyerBase)} />
        <Figure label="GST" value={v(t?.gst)} />
        <Figure label="Gross sales" value={v(t?.buyerGross)} />
        <Figure label="Seller value" value={v(t?.seller)} />
        <Figure label="Payment agent paid" note="Payments made in period" value={v(t?.paid.PAYMENT_AGENT_SETTLEMENT)} />
        <Figure
          label="Payment agent outstanding"
          note="All time, payable"
          value={out ? formatINR(out.paymentAgent) : <Skeleton height={22} width={100} />}
          onClick={() => navigate('/payment-agent')}
        />
        <Figure
          label="Outstanding receivables"
          note="All time, from buyers"
          value={out ? formatINR(out.receivables) : <Skeleton height={22} width={100} />}
          onClick={() => navigate('/reports?type=outstanding')}
        />
        <Figure
          label="Outstanding payables"
          note="Sellers, agents, transporters, payment agent"
          value={out ? formatINR(out.payables) : <Skeleton height={22} width={100} />}
          onClick={() => navigate('/reports?type=outstanding')}
        />
      </div>

      <div className="grid-2">
        <Panel title="Selling by buyer" bodyless actions={<ButtonLink size="sm" to={`/ledger/buyer?${q}`}>Ledger</ButtonLink>}>
          <BarList items={items(period.data, 'BUYER')} onSelect={goParty('BUYER')} />
        </Panel>
        <Panel title="Buying by seller" bodyless actions={<ButtonLink size="sm" to={`/ledger/seller?${q}`}>Ledger</ButtonLink>}>
          <BarList items={items(period.data, 'SELLER')} onSelect={goParty('SELLER')} />
        </Panel>
        <Panel title="Commission by agent" bodyless actions={<ButtonLink size="sm" to={`/ledger/commission?${q}`}>Ledger</ButtonLink>}>
          <BarList items={items(period.data, 'COMMISSION_AGENT')} onSelect={goParty('COMMISSION_AGENT')} />
        </Panel>
        <Panel title="Freight by transporter" bodyless actions={<ButtonLink size="sm" to={`/ledger/freight?${q}`}>Ledger</ButtonLink>}>
          <BarList items={items(period.data, 'TRANSPORTER')} onSelect={goParty('TRANSPORTER')} />
        </Panel>
      </div>

      <Panel title="Payment agent" bodyless actions={<ButtonLink size="sm" to="/payment-agent">Open dashboard</ButtonLink>}>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Agent</th>
                <th className="r">Quantity</th>
                <th className="r">Charges</th>
                <th className="r">Paid</th>
                <th className="r">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {period.data &&
                breakdown(period.data, 'PAYMENT_AGENT').map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/payment-agents/${r.id}`)}>
                    <td>{nameOf(r.id, 'Unknown')}</td>
                    <td className="r">{formatQty(r.qtyKg)}</td>
                    <td className="r">{formatINR(r.amount)}</td>
                    <td className="r">{formatINR(r.paid)}</td>
                    <td className="r">{formatINR(r.outstanding)}</td>
                  </tr>
                ))}
            </tbody>
            {t && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="r">{formatQty(t.qtyKg)}</td>
                  <td className="r">{formatINR(t.paCharge)}</td>
                  <td className="r">{formatINR(t.paid.PAYMENT_AGENT_SETTLEMENT)}</td>
                  <td className="r">{formatINR(t.paCharge - t.paid.PAYMENT_AGENT_SETTLEMENT)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Panel>
    </div>
  );
}
