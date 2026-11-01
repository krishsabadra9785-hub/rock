import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataTable } from '../src/components/DataTable';
import { Figure } from '../src/components/ui';
import { calculateOrder } from '../src/domain/calc';
import { formatINR } from '../src/domain/format';
import { parseQuantityMt, parseRupees } from '../src/domain/money';
import type { Column } from '../src/features/ledger/columns';
import { ledgerColumns } from '../src/features/ledger/columns';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

/** Guards what the UI redesign must not lose. Screens are checked by source; shared components by rendering. */

describe('navigation keeps every destination', () => {
  const shell = read('src/layout/AppShell.tsx');
  for (const to of ['/', '/orders', '/buyers', '/sellers', '/commission-agents', '/transporters', '/payment-agent', '/payments', '/reports', '/settings']) {
    it(`sidebar links to ${to}`, () => expect(shell.includes(`to: '${to}'`)).toBe(true));
  }
  it('create order, lock and sign out stay reachable', () => {
    expect(shell.includes('to="/orders/new"')).toBe(true);
    expect(shell.includes('onClick={lock}')).toBe(true);
    expect(shell.includes('signOut()')).toBe(true);
  });
  it('routes are unchanged', () => {
    const app = read('src/App.tsx');
    for (const r of ['/orders/new', '/orders/:id', '/payment-agent', '/payments', '/ledger/:kind', '/reports', '/search', '/settings']) {
      expect(app.includes(`path="${r}"`)).toBe(true);
    }
  });
});

describe('financial presentation', () => {
  it('money figures are never truncated', () => {
    const css = read('src/styles/global.css');
    const figure = css.slice(css.indexOf('.figure-value {'), css.indexOf('}', css.indexOf('.figure-value {')));
    expect(figure.includes('text-overflow')).toBe(false);
    expect(figure.includes('overflow: hidden')).toBe(false);
  });
  it('the dashboard does its sums with the rollup helpers, not its own business logic', () => {
    const dash = read('src/features/dashboard/DashboardPage.tsx');
    expect(dash.includes('outstandingSummary(lifetime.data.totals)')).toBe(true);
    expect(dash.includes('breakdown(')).toBe(true);
  });
  it('the order summary shows calculateOrder results and adds nothing of its own', () => {
    const page = read('src/features/orders/CreateOrderPage.tsx');
    const summary = page.slice(page.indexOf('title="Order summary"'), page.indexOf('</Panel>', page.indexOf('title="Order summary"')));
    expect(summary.includes('fin.buyer.grossAmount')).toBe(true);
    expect(/fin\.[\w.]+\s*[-+*/]/.test(summary)).toBe(false);
  });
  it('38.52 MT reference order keeps its amounts', () => {
    const r = calculateOrder({
      qtyKg: parseQuantityMt('38.52')!,
      buyerRatePaise: parseRupees('12500')!,
      gstBp: 500,
      sellerRatePaise: parseRupees('9700')!,
      commissionRatePaise: parseRupees('725')!,
      freightRatePaise: parseRupees('850')!,
      paymentAgentRatePaise: parseRupees('1000')!,
    });
    expect([r.buyer.baseAmount, r.buyer.gstAmount, r.buyer.grossAmount, r.seller.amount, r.commission.amount, r.freight.amount, r.paymentAgent.amount].map(formatINR)).toEqual([
      '₹4,81,500', '₹24,075', '₹5,05,575', '₹3,73,644', '₹27,927', '₹32,742', '₹38,520',
    ]);
  });
  it('payment agent scenario: 152.78 MT at ₹1,000 less ₹1,16,360 paid leaves ₹36,420', () => {
    const r = calculateOrder({
      qtyKg: parseQuantityMt('152.78')!,
      buyerRatePaise: parseRupees('12500')!,
      gstBp: 500,
      sellerRatePaise: parseRupees('9700')!,
      commissionRatePaise: 0,
      freightRatePaise: 0,
      paymentAgentRatePaise: parseRupees('1000')!,
    });
    expect(formatINR(r.paymentAgent.amount)).toBe('₹1,52,780');
    expect(formatINR(r.paymentAgent.amount - parseRupees('116360')!)).toBe('₹36,420');
    // The commission is its own payable, not a share of the buyer's money.
    expect(r.paymentAgent.amount).not.toBe(r.buyer.grossAmount);
  });
  it('payment agent copy never describes the obsolete model', () => {
    const page = read('src/features/paymentAgent/PaymentAgentPage.tsx');
    expect(page.includes('receives buyer payments')).toBe(false);
    expect(page.includes('Buyers pay us directly')).toBe(true);
  });
  it('CSV columns for the payment agent ledger are unchanged', () => {
    expect(ledgerColumns('paymentAgent').map((c) => c.header)).toEqual(['Order', 'Date', 'Payment agent', 'Buyer', 'Qty (MT)', 'Rate/MT', 'Commission payable', 'Paid', 'Outstanding', 'Status']);
  });
});

describe('integrity warnings and dangerous actions', () => {
  it('stale statistics warning stays on every screen that shows rollups', () => {
    for (const f of ['src/features/dashboard/DashboardPage.tsx', 'src/features/paymentAgent/PaymentAgentPage.tsx', 'src/features/parties/PartyListPage.tsx', 'src/features/parties/PartyProfilePage.tsx']) {
      expect(read(f).includes('<StaleStatisticsNotice')).toBe(true);
    }
  });
  it('repair, upgrade and rebuild ask first and never run on load', () => {
    const s = read('src/features/settings/SettingsPage.tsx');
    for (const k of ['repair', 'upgrade', 'rebuild']) expect(s.includes(`onClick={() => setConfirming('${k}')}`)).toBe(true);
    const tab = s.slice(s.indexOf('function DataTab()'), s.indexOf('export default function SettingsPage'));
    expect(tab.includes('useEffect')).toBe(false);
  });
  it('permission checks stay on the screens that had them', () => {
    expect(read('src/features/orders/OrderDetailPage.tsx').includes("can(profile?.role, 'order.cancel')")).toBe(true);
    expect(read('src/features/payments/PaymentsPage.tsx').includes("can(profile?.role, 'payment.void')")).toBe(true);
    expect(read('src/features/settings/SettingsPage.tsx').includes("can(profile?.role, 'users.manage')")).toBe(true);
  });
});

describe('design tokens', () => {
  it('colours are defined only in :root', () => {
    const css = read('src/styles/global.css');
    const body = css.slice(css.indexOf('}', css.indexOf(':root {')));
    expect(body.replace(/#fff\b/g, '').match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
  it('no hard-coded colours in layout or auth screens', () => {
    for (const f of ['src/layout/AppShell.tsx', 'src/features/auth/AuthLayout.tsx', 'src/features/dashboard/DashboardPage.tsx']) {
      expect(/#[0-9a-fA-F]{6}\b/.test(read(f))).toBe(false);
    }
  });
});

describe('shared components', () => {
  interface Row { id: string; name: string; amount: number }
  const columns: Column<Row>[] = [
    { id: 'name', header: 'Name', text: (r) => r.name, csv: (r) => r.name, sortValue: (r) => r.name },
    { id: 'status', header: 'Status', text: () => 'Part paid', csv: () => 'PARTIAL', status: () => 'PARTIAL' },
    { id: 'amount', header: 'Amount', align: 'right', text: (r) => formatINR(r.amount), csv: (r) => r.amount, sum: (r) => r.amount, sumKind: 'inr' },
  ];
  const table = (props: Partial<Parameters<typeof DataTable<Row>>[0]>) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DataTable<Row>, { rows: [{ id: '1', name: 'A very long company name', amount: 50557500 }], columns, rowKey: (r) => r.id, ...props })));

  it('right-aligns amounts, keeps totals and full names', () => {
    const html = table({});
    expect(html).toContain('<td class="r">₹5,05,575</td>');
    expect(html).toContain('Total (1)');
    expect(html).toContain('title="A very long company name"');
  });
  it('status is shown in words, not colour alone', () => {
    expect(table({})).toContain('Part paid');
  });
  it('clickable rows and sortable headers are keyboard reachable', () => {
    const html = table({ onRowClick: () => undefined });
    expect(html).toMatch(/<tr class="clickable [^"]*" tabindex="0"/);
    expect(html).toMatch(/<th class="[^"]*sortable" tabindex="0"/);
  });
  it('rows are not focusable when they do nothing', () => {
    expect(table({})).not.toMatch(/<tr[^>]*tabindex/);
  });
  it('an error is never disguised as an empty table', () => {
    const html = table({ rows: [], error: 'Permission denied', empty: { title: 'No orders' } });
    expect(html).toContain('Permission denied');
    expect(html).not.toContain('No orders');
  });
  it('a figure is a button only when it does something', () => {
    expect(renderToStaticMarkup(createElement(Figure, { label: 'GST', value: '₹1' }))).not.toContain('<button');
    expect(renderToStaticMarkup(createElement(Figure, { label: 'GST', value: '₹1', onClick: () => undefined }))).toContain('<button');
  });
});
