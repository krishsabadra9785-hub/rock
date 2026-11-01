# CLAUDE.md — Sabadra Minerals (codebase: ROCK)

Context for Claude Code. Read this before changing anything.

## What this is
Private business app for a bulk-material trading business: orders from weighbridge slips (Gemini reads the photo, the user confirms), automatic financial calculations, party ledgers, payments, dashboards, reports and CSV export. Installable PWA. Users see the brand **Sabadra Minerals**; code and infrastructure keep the name **rock**.

- Live: https://krishsabadra9785-hub.github.io/rock/  (GitHub Pages, deployed by `.github/workflows/deploy.yml` on push to `main`)
- Backend: Firebase project `rock-e6719`, using Authentication, Cloud Firestore and AI Logic (Gemini Developer API). **There is no server of our own.**

## Hard constraints (never violate)
- **Zero cost / Spark plan.** No Blaze or billing, Cloud Functions, Firebase Storage, Firebase Hosting, App Hosting, Vertex AI, or any paid fallback.
- **Receipt images are never stored.** They are used in memory for AI reading, then released. Never write Base64, blobs or data URLs to Firestore. `src/services/receiptStorage.ts` (`NoPermanentStorageProvider`) is the extension point.
- **No secrets in the repo** (it's public). Firebase web config comes from env vars and GitHub repo *Variables*.
- **Never weaken `firestore.rules`** to make something pass. Never push or deploy unless the owner explicitly asks.
- **Do not rename technical identifiers:** `/rock/` base path, repo `rock`, project `rock-e6719`, login domain `rock.local`, order prefix `ROCK-YYYY-######`, Firestore collection names, `rock.pinAttempts.*` key. `tests/brand.test.ts` guards these.

## Stack and layout
React 19 + TypeScript (strict) + Vite, HashRouter (URLs like `/rock/#/orders`), vite-plugin-pwa, Firebase JS SDK v12, Vitest.

- `src/domain/`: pure business logic, fully unit-tested (money, calc, rates, dates, payments, rollups, validation, extraction, search, permissions).
- `src/services/`: Firestore and AI access (orders, payments, parties, rollups, auth, pin, ai, receiptImage, receiptStorage).
- `src/state/`: SessionProvider (login → profile → PIN lock), DataProvider (live parties), toasts.
- `src/features/`: screens. `src/components/`: shared UI. `src/config/`: env, brand, aiStatus.
- `firestore.rules`, `firestore.indexes.json`: database security and indexes.
- `tests/*.test.ts`: app tests. `tests/rules/`: emulator rules tests (own package.json and vitest config).
- `docs/`: ARCHITECTURE, DATABASE_SCHEMA, SECURITY, TEST_PLAN.

## Financial model (do not change without the owner)
- Money is integer **paise**, quantity integer **kg** (1 MT = 1000 kg), GST in **basis points**. BigInt multiply, round **half-up** once per amount. Never use floats or `parseFloat` for money.
- All order figures come from `calculateOrder()` in `src/domain/calc.ts`.
- **Buyer pays us directly**: buyer gross = base + GST is a receivable.
- Seller, commission, freight and the **payment-agent commission** (qty × agent rate) are **payables we owe**.
- Payment category `PAYMENT_AGENT_SETTLEMENT` means a payment **to** the agent. The stored name is kept for compatibility.
- Legacy orders may hold obsolete `paymentAgent.received/deduction/balance`; they are read as amount = `deduction`.
- **Universal rate engine:** every order snapshots its rates. "New default" updates the party and appends to `rateHistory` in the same transaction. Old orders never change.
- **Payments:** each payment is its own document. The order's `paid.<key>` changes only in the same commit as that payment's create/void, linked via `lastPaymentId`. No overpayment. Void, never delete.
- **Dashboards** read `rollups` (day/month docs updated by increments). They are derived and rebuildable:
  - Settings → Data → Check figures, Rebuild statistics, Repair Payment Agent figures.
  - `REBUILD_BATCH_SIZE` = 10.

## Firestore rules: important lesson
Firestore allows at most **1,000 evaluated expressions per request (across all documents in a batch)**, and function arguments are re-evaluated wherever a parameter is used.
- Keep validation flat: `let`-bind values once, avoid nested helper chains, and use remainder checks `0 ≤ qty×rate − amount×1000 + 500 < 1000`.
- Updates use per-purpose `affectedKeys().hasOnly([...])` whitelists.
- Any rules change must keep `npm run test:rules` green. The rules tests replay full app commits.

## Commands (the gate before any commit)
```bash
npm run test:rules:install   # once / after deps change (needs Java 21)
npm run test:rules           # Firestore emulator security tests
npm run test                 # app tests (Vitest)
npm run typecheck
npm run lint                 # 0 errors required (Fast Refresh warnings are OK)
npm run build
npm run dev                  # http://localhost:5173/rock/  (needs .env.local)
npm run deploy:rules         # publish firestore.rules + indexes (owner decides when)
```
Report exact results. Never claim a command passed without running it.

## Conventions
- Minimal, targeted changes; keep the existing visual language (`src/styles/global.css`).
- Use the brand constant `APP_NAME` from `src/config/brand.ts` for any user-visible app name.
- Update the relevant `docs/*.md` and tests with every behavior change.
- Pending owner action may still be open: after deploying, run Settings → Data → **Repair Payment Agent figures** in production (see README).
