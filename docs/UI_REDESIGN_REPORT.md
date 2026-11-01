# UI redesign report

Local, uncommitted work on top of `7ab54dc`. Nothing was pushed or deployed and no production data was touched: there is no `.env.local` on this machine, and browser testing ran on Firebase emulators under the throwaway project `demo-rock`.

## Files

**Added:** `docs/DESIGN_SYSTEM.md`, `docs/UI_REDESIGN_REPORT.md`, `tests/uiRedesign.test.ts`

**Presentation only (A):** `src/styles/global.css`, `src/components/Icon.tsx`, `src/components/BarList.tsx`, `src/features/auth/AuthLayout.tsx`, `src/features/orders/OrdersPage.tsx`, `index.html`, `vite.config.ts` (theme colours only), `docs/TEST_PLAN.md`

**Presentation with behaviour (B):** `src/layout/AppShell.tsx`, `src/components/ui.tsx`, `src/components/DataTable.tsx`, `src/features/dashboard/DashboardPage.tsx`, `src/features/orders/CreateOrderPage.tsx`, `src/features/parties/PartyListPage.tsx`, `src/features/parties/PartyProfilePage.tsx`, `src/features/paymentAgent/PaymentAgentPage.tsx`, `src/features/settings/SettingsPage.tsx`

**Business-critical (C):** none. `git diff` is empty for `src/domain`, `src/services`, `src/state`, `src/firebase`, `src/hooks`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` and `package.json`. No dependencies were added. Removed: nothing.

## Behaviour changes to review

1. Repair, Upgrade and Rebuild in Settings → Data now ask for confirmation first. What they do is unchanged. Repair is no longer styled as the primary button.
2. Settings → Data progress messages moved to the top of the tab.
3. The Create order parties step has a live order summary, showing `calculateOrder()` results only.
4. The rate history marks the newest entry for each rate as Current, when it still equals the party's default.
5. The Payment Agent page explains how outstanding is worked out. Its empty state no longer describes the obsolete model.
6. Keyboard: clickable rows, sort headers and tabs are operable from the keyboard; focus stays inside dialogs; a skip link was added; Escape closes the More sheet.
7. Pages scroll to the top on navigation.
8. On phones the top bar shows the brand mark, not the name, to leave room for search.
9. The dashboard leads with all-time receivables and payables. Every earlier metric and drill-down is still there; the three all-time figures moved from the lower band to the top.

## Feature preservation

| Module | Exercised in the browser on the emulator | Other evidence |
|---|---|---|
| Login, set PIN, lock, wrong PIN, unlock, sign out | Yes | |
| Dashboard figures | Yes, matched the reference amounts | Date presets rendered; only This month was read |
| Create order, manual entry | Yes, saved through the real rules | Empty-field validation seen |
| Order detail, settlement, payment list, history | Yes | |
| Record payment, overpayment blocked | Yes | |
| Payment Agent screen | Yes, ₹1,52,780 / ₹1,16,360 / ₹36,420 on the order | |
| Party list | Yes | |
| Party profile | Yes | |
| Settings: Rebuild statistics, Check figures, demo data | Yes, "All figures match" | |
| View-only role | Yes: no write controls on orders, parties, payments or order detail; no Users or Data tabs | |
| Reports, ledgers, search, 404 | Page load and layout only | Query and CSV code unchanged |
| AI receipt reading, photo or file upload | **No** | Logic unchanged |
| Correct order, cancel order, void payment | **No** | Logic unchanged; dialogs share the tested `Modal` |
| Add or edit party, change rate | **No** | Logic unchanged |
| CSV export, backup download, print | **No** | Column code unchanged; header test on one ledger |
| Repair Payment Agent, Upgrade records | **No** (the confirmation code path was tested through Rebuild) | Called functions unchanged |
| Stale statistics warning | **Not seen on screen** | Component unchanged; source test on all four screens |
| PWA install, update prompt, offline banner | **No** | Service worker config unchanged apart from theme colours |

## Visual checks

Automated sweep for sideways page scroll and clipped amounts: 17 routes at 375px, 8 routes each at 768px and 1024px; none found after the fix below. Screenshots reviewed at 1440, 1280, 1024, 768 and 375px for the main screens. 390px was not separately tested.

The sweep and review caught a real bug in the first version: large amounts were cut off with an ellipsis in figure cards. It's fixed and guarded by a test, and a crore-sized value was confirmed to fit at 375px.

Touch target sweep at 375px: no control in the main content under 40px. Small buttons are 40px and standard controls 44px, so the 44px guideline is not met everywhere.

Not checked: real iPhone or Android devices, Safari, screen readers, automated WCAG tooling. Contrast was calculated for 22 token pairs, all at least 4.5:1. WCAG 2.2 AA is a target, not a certified result.

## Existing issues left alone

- **Void by row click:** on Payments, clicking any row opens the void dialog. A reason and confirmation are still required, but an explicit Void button would be safer.
- **Dashboard Payment agent table:** its Total quantity shows all orders, including any without a payment agent, so it can exceed the sum of the rows.
- **View-only users:** they still see Create order links, which lead to a "your role can't" notice.
- **Overpayment:** the payment dialog shows the error twice.
- **Dashboard:** "Gross sales" repeats "Total selling", and "Seller value" repeats "Total buying". Both were kept because nothing was to be removed.

## Limitations

- Dark mode was not built (see `docs/DESIGN_SYSTEM.md`).
- There is no browser-automation test suite in the repo. `tests/uiRedesign.test.ts` uses server rendering and source checks, without adding dependencies, so it doesn't simulate clicks.
- CSS grew by about 10 kB (1.6 kB gzipped).

## Deploying

The work is already in this checkout.

1. Review the diff and run the app with your `.env.local`. It would connect to production, so look around but don't create records.
2. Commit and push to `main` when you're happy; the push deploys to GitHub Pages.
3. `firestore.rules` didn't change, so `npm run deploy:rules` isn't needed for this.
4. The earlier pending step may still be open: Settings → Data → Repair Payment Agent figures.
