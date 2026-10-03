import { formatQty } from '../domain/format';

export interface BarItem {
  id: string;
  name: string;
  value: number;
  valueText: string;
  qtyKg: number;
  sub?: string;
}

/** Restrained horizontal bars: name, proportional bar, value. Rows are clickable. */
export function BarList({ items, onSelect, emptyText = 'Nothing in this period' }: { items: BarItem[]; onSelect?: (id: string) => void; emptyText?: string }) {
  if (items.length === 0) return <p className="muted small" style={{ padding: 18 }}>{emptyText}</p>;
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="bars">
      {items.map((i) => (
        <button key={i.id} type="button" className="bar-row" onClick={() => onSelect?.(i.id)}>
          <span className="bar-name">
            {i.name}
            <small>{i.sub ?? formatQty(i.qtyKg)}</small>
          </span>
          <span className="bar-track" aria-hidden="true">
            <div style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} />
          </span>
          <span className="bar-value">{i.valueText}</span>
        </button>
      ))}
    </div>
  );
}
