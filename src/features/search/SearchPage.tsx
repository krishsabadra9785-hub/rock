import { Link, useSearchParams } from 'react-router-dom';
import { Badge, EmptyState, ErrorNotice, PageHeader, Panel, SkeletonRows } from '../../components/ui';
import { formatDate, formatINR, formatQty } from '../../domain/format';
import { useAsync } from '../../hooks/useAsync';
import { PARTY_LABELS } from '../../services/parties';
import { globalSearch } from '../../services/search';
import { useData } from '../../state/DataProvider';

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const { parties } = useData();
  const res = useAsync(() => globalSearch(q, parties), [q, parties.length]);

  return (
    <div className="stack">
      <PageHeader title={`Search: "${q}"`} sub="Orders by number, vehicle, driver, phone, receipt no., party or destination; parties by name, ID, phone or GSTIN" />
      {res.error && <ErrorNotice error={res.error} onRetry={res.reload} />}
      {res.loading && !res.data ? (
        <SkeletonRows rows={5} />
      ) : res.data && res.data.orders.length === 0 && res.data.parties.length === 0 ? (
        <EmptyState title="Nothing found" body="Check the spelling, or search by vehicle number, order number or phone." />
      ) : (
        <>
          {(res.data?.parties.length ?? 0) > 0 && (
            <Panel title="Parties" bodyless>
              {res.data!.parties.map((p) => (
                <Link key={p.id} to={`/${PARTY_LABELS[p.type].path}/${p.id}`} className="search-result">
                  <span>
                    <strong>{p.name}</strong> <span className="muted small">{p.code}</span>
                  </span>
                  <span className="small muted">
                    {PARTY_LABELS[p.type].singular} {!p.active && <Badge tone="warn">Inactive</Badge>}
                  </span>
                </Link>
              ))}
            </Panel>
          )}
          {(res.data?.orders.length ?? 0) > 0 && (
            <Panel title="Orders" bodyless>
              {res.data!.orders.map((o) => (
                <Link key={o.id} to={`/orders/${o.id}`} className="search-result">
                  <span>
                    <strong>{o.orderNumber}</strong> {o.status === 'CANCELLED' && <Badge tone="danger">Cancelled</Badge>}
                    <div className="small muted">
                      {o.buyer.name} ← {o.seller.name}. {o.receipt.vehicleNumber} {o.receipt.driverName && `, ${o.receipt.driverName}`}
                    </div>
                  </span>
                  <span className="small right">
                    {formatDate(o.dispatchDate)}
                    <div className="muted">
                      {formatQty(o.qtyKg)}, {formatINR(o.buyer.grossAmount)}
                    </div>
                  </span>
                </Link>
              ))}
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
