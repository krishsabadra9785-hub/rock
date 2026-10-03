import { toCsv, type CsvColumn } from '../domain/csv';
import type { Column } from '../features/ledger/columns';

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv<T>(filename: string, rows: readonly T[], columns: readonly (Column<T> | CsvColumn<T>)[]): void {
  const csvCols: CsvColumn<T>[] = columns.map((c) => ('csv' in c ? { header: c.header, value: c.csv } : c));
  downloadBlob(filename, new Blob([toCsv(rows, csvCols)], { type: 'text/csv;charset=utf-8' }));
}

export function safeFileName(s: string): string {
  return s.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'export';
}
