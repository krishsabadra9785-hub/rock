/** CSV builder that opens cleanly in Excel (UTF-8 BOM, CRLF, RFC 4180 quoting). */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Neutralise spreadsheet formula injection (cells starting with = + - @).
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], opts: { bom?: boolean } = {}): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(r))).join(','));
  return (opts.bom === false ? '' : '\uFEFF') + lines.join('\r\n') + '\r\n';
}
