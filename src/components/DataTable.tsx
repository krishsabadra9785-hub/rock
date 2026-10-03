import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatINR, formatQtyNumber } from '../domain/format';
import type { SettlementStatus } from '../domain/types';
import { STATUS_LABELS } from '../domain/payments';
import type { Column } from '../features/ledger/columns';
import { Badge, Button, EmptyState, ErrorNotice, SkeletonRows } from './ui';

export function StatusBadge({ status }: { status: SettlementStatus }) {
  const tone = status === 'PAID' ? 'ok' : status === 'PARTIAL' ? 'warn' : status === 'UNPAID' ? 'danger' : status === 'OVERPAID' ? 'info' : undefined;
  return <Badge tone={tone}>{STATUS_LABELS[status]}</Badge>;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  empty?: { title: string; body?: ReactNode; action?: ReactNode };
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  showTotals?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  caption?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onLoadMore,
  hasMore,
  loadingMore,
  showTotals = true,
  onRowClick,
  rowClassName,
  caption,
}: Props<T>) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);

  if (error && rows.length === 0) return <div style={{ padding: 18 }}><ErrorNotice error={error} onRetry={onRetry} /></div>;
  if (loading && rows.length === 0) return <SkeletonRows rows={6} />;
  if (!loading && rows.length === 0 && empty) return <EmptyState {...empty} />;

  const hasSums = showTotals && columns.some((c) => c.sum);
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  className={`${c.align === 'right' ? 'r' : ''} ${c.sortValue ? 'sortable' : ''}`}
                  aria-sort={sort?.id === c.id ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  onClick={c.sortValue ? () => setSort((s) => (s?.id === c.id ? { id: c.id, dir: s.dir === 1 ? -1 : 1 } : { id: c.id, dir: -1 })) : undefined}
                >
                  {c.header}
                  {sort?.id === c.id ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={rowKey(r)}
                className={`${onRowClick ? 'clickable' : ''} ${rowClassName?.(r) ?? ''}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map((c) => {
                  const href = c.link?.(r);
                  const content = c.status ? <StatusBadge status={c.status(r)} /> : c.text(r);
                  return (
                    <td key={c.id} className={c.align === 'right' ? 'r' : ''}>
                      {href ? (
                        <Link to={href} onClick={(e) => e.stopPropagation()}>
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {hasSums && rows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => {
                  if (i === 0) return <td key={c.id}>Total ({rows.length})</td>;
                  if (!c.sum) return <td key={c.id} />;
                  const total = rows.reduce((s, r) => s + c.sum!(r), 0);
                  return (
                    <td key={c.id} className="r">
                      {c.sumKind === 'qty' ? formatQtyNumber(total) : formatINR(total)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {(hasMore || loadingMore || (error && rows.length > 0)) && (
        <div className="table-foot no-print">
          <span>{error ? error : `Showing ${rows.length} rows`}</span>
          {hasMore && (
            <Button size="sm" onClick={onLoadMore} busy={loadingMore}>
              Load more
            </Button>
          )}
        </div>
      )}
    </>
  );
}
