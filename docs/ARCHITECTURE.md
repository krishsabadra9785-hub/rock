# ROCK architecture

## Constraints (V1)

- **Zero cost, no billing account.** Firebase stays on the Spark plan.
- Website: static files on **GitHub Pages** at `/rock/`, deployed by GitHub Actions.
- Firebase products used: **Authentication, Cloud Firestore, App Check (reCAPTCHA v3), Firebase AI Logic with the Gemini Developer API free tier**.
- Not used: Firebase Hosting, Cloud Storage, Cloud Functions, Vertex AI, any server.

## High-level picture

```
 Browser (React PWA, served from GitHub Pages /rock/)
   │  Firebase Web SDK (auth token + App Check token on every request)
   ├──► Firebase Authentication      (who you are)
   ├──► Cloud Firestore              (all business data; security rules decide access)
   └──► Firebase AI Logic → Gemini   (reads a receipt photo; nothing is stored)
```

There is no backend of our own. All authorisation is enforced by `firestore.rules`, which run on Google's servers and cannot be bypassed by a modified client.

## Layers in `src/`

| Layer | Responsibility | Depends on |
|---|---|---|
| `domain/` | Pure TypeScript: money, calculations, rate engine, dates/FY, validation, payments, statistics (rollups), search tokens, CSV, AI-output parsing, permissions | nothing (fully unit-tested) |
| `services/` | Firebase reads/writes and transactions, AI call, receipt-image handling, receipt storage interface | `domain/`, Firebase SDK |
| `state/` | Session state machine (login → profile → PIN lock), live master data, toasts | `services/` |
| `features/` | Screens | all of the above |
| `components/` | Shared UI | `domain/` formatting |

## Money handling

- Money is stored as **integer paise**, quantity as **integer kilograms** (1 MT = 1000 kg, so up to 3 decimals of MT are exact), GST as **integer basis points** (5% = 500).
- Products use **BigInt**: `amount = qtyKg × ratePaisePerMT / 1000`, rounded **half-up to the paisa**, once per stored amount.
- GST is computed on the base *amount* (not per MT): `gst = base × bp / 10000`, half-up.
- User input is parsed from strings (`parseRupees`, `parseQuantityMt`, `parsePercent`) — never `parseFloat`.
- All formulas live in `domain/calc.ts → calculateOrder()`; UI previews, saved snapshots, corrections and tests all use it.
- Firestore security rules re-check invariants on save (e.g. `gross == base + gst`, and every payable amount = qty × its rate).

## The universal rate engine (`domain/rates.ts`)

Every reusable rate — buyer rate, buyer GST, seller rate, commission, freight, payment-agent rate, and any future type — follows one rule:

1. New orders are pre-filled with the party's **current default** (`party.rates[RATE_TYPE]`).
2. If the user changes a value, they choose **This order only** or **New default going forward**.
3. The order stores its own copy (snapshot) of every rate and amount.
4. "New default" updates the party's default **in the same Firestore transaction** that creates the order, and appends a `rateHistory` entry (`oldRate`, `newRate`, `effectiveFrom`, `changedBy`, `sourceOrderId`).
5. Historical orders are never recalculated from master data.

Rates can also be changed from a party's profile ("Change rate"), which writes history with no source order.

## Order creation (one atomic transaction)

`services/orders.ts → createOrder()`:

- **Idempotent**: the order document ID is a client-generated UUID created when the form opens. A double-click or retried request finds the existing document and returns it instead of creating a duplicate.
- **Race-free numbering**: reads and increments `counters/orders-YYYY` inside the transaction. Firestore retries on contention; security rules require `seq == previous + 1`.
- Reads the selected parties (must exist, be active and be the right type), resolves rate decisions, calculates, then writes: the order, the counter, any new party defaults, rate-history entries, statistics increments and an audit entry.

Corrections (`editOrder`) require a reason, check an optimistic `version`, never touch party defaults, adjust statistics (remove old contribution, add new) and log before/after values. Cancellation is blocked while payments exist. Financial records are never deleted.

## Payments

Each payment is its own document (`payments/{id}`), so any number of part payments per order is supported. When linked to an order, the same transaction increments `order.paid.<obligation>` (a cache for list views, derived from payments) and the statistics. Payments are **voided**, never deleted; voiding reverses those increments.

Obligations per order: buyer gross (receivable: the buyer pays us directly), and seller amount, commission, freight and the payment-agent commission (payables we owe).

## Dashboards and statistics (`domain/rollups.ts`)

Reading every order for every dashboard would exhaust the free read quota. Instead, every order/payment transaction applies **atomic increments** to two small summary documents: `rollups/D-YYYY-MM-DD` and `rollups/M-YYYY-MM`. They hold totals and per-party buckets (orders, quantity, amounts, paid).

- A date range is answered with the fewest documents: whole months use monthly docs, partial months use daily docs (a financial year = 12 reads; "this week" = up to 7).
- Party summaries (lifetime and period) come from the same docs.
- They are **derived data**. *Settings → Data → Rebuild statistics* recomputes them from orders and payments at any time.

## Receipt images (V1: not stored)

1. The user picks or photographs a receipt. It stays in browser memory as a `File` with a `blob:` preview URL.
2. A downscaled copy is sent to Gemini through Firebase AI Logic with a strict JSON schema.
3. `domain/extraction.ts` validates every field (types, units, dates, phone, vehicle format, suspicious values) and marks it FOUND / UNCERTAIN / MISSING / INVALID. Nothing is trusted until the user confirms.
4. On confirmation, only the structured fields are saved. The preview URL is revoked and the file reference dropped.
5. AI failure of any kind (quota, network, unreadable image, malformed output) drops to the same form for manual entry.

**Future image storage:** `services/receiptStorage.ts` defines a `ReceiptStorageProvider` interface. V1 uses `NoPermanentStorageProvider`, which returns metadata only (`provider: 'NONE'`). Orders already store a `receipt.image` reference (`provider`, `ref`, `fileName`, `contentType`, `sizeBytes`). To add storage later: implement a `FirebaseStorageProvider` (upload in `save`, return `{ provider: 'FIREBASE_STORAGE', ref: path }`; `getViewUrl` returns a viewable URL), swap the exported `receiptStorage`, add Storage rules, and show the image on the order page when `getViewUrl` returns a URL. The order system, rules for orders and the data model do not change.

## Routing and hosting

- `HashRouter`: URLs look like `/rock/#/orders`. GitHub Pages only serves real files, so hash routing guarantees refreshes and deep links never 404.
- `vite.config.ts` sets `base: '/rock/'`. The manifest `start_url`/`scope`, icons and service worker all live under `/rock/`.
- The service worker caches only the app shell (JS, CSS, icons). Firestore data and receipt images are never cached by it, and Firestore uses an in-memory cache only.

## Failure behaviour

| Situation | Behaviour |
|---|---|
| AI unavailable / quota / bad output | Message + manual entry; never a paid fallback |
| Firestore write fails | Transaction is all-or-nothing; clear message; retry is safe (idempotency keys) |
| Offline | Banner; saves are blocked with a clear message |
| Firestore quota exceeded | "Usage limit reached for today"; no partial writes |
| Statistics drift | "Rebuild statistics" |
| GitHub Pages build fails | Nothing is deployed; the live site stays on the previous version |

## Design decisions (and why)

- **Single `parties` collection with a `type` field** instead of five collections: one rate engine, one set of rules, one listener for dropdowns.
- **Buyer/seller "freight if applicable"** is modelled as a *default transporter* preference; freight amounts always come from the transporter's rate.
- **Total Selling** on the dashboard is the buyer gross including GST; base and GST are shown separately.
- **Payment agent (current model):** the buyer pays us directly; buyer money is never routed through the payment agent. The agent earns a commission = qty × its per-MT rate (snapshotted on the order), which is a **payable**. Payments we make to the agent reduce it: outstanding payable = commission − active payments. The stored category value `PAYMENT_AGENT_SETTLEMENT` is kept for compatibility and means "payment to the payment agent".
- **Obsolete model (data compatibility only):** orders saved earlier stored `paymentAgent.received/deduction/balance` ("agent receives the buyer's money, deducts its charge, owes us the balance"). They are read with commission = `deduction`; `received`/`balance` are ignored and never shown. Settings → Data → **Upgrade old records** rewrites them to the current shape through the audited correction path.
- **"Left after payouts"** on an order = buyer gross − seller − commission − freight − payment-agent commission. It still includes GST collected, which is owed separately.
- **Order numbers** restart each calendar year: `ROCK-2026-000001`. The prefix is configurable; existing numbers never change.
- **Drafts** are kept in the browser while the form is open (an auto-lock overlays rather than unmounts the form). Firestore orders are created only on confirmation.
