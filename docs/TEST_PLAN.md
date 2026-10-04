# ROCK test plan

## 1. Automated tests (`npm test`)

Run on every push by GitHub Actions; deployment is blocked if any fail.

| File | Covers |
|---|---|
| `tests/calc.test.ts` | **The 38.52 MT acceptance figures**: base ₹4,81,500 · GST ₹24,075 · buyer total ₹5,05,575 (owed to us) · effective ₹13,125/MT · seller ₹3,73,644 · commission ₹27,927 · freight ₹32,742 · payment agent commission ₹38,520 (payable; no ₹4,67,055 \"balance\" exists). Also GST 0/18/2.5%, 3-decimal quantities, half-up rounding, no float drift, invalid inputs. |
| `tests/money.test.ts` | Parsing rupees/MT/percent from strings, Indian formatting (₹5,05,575), safe sums, average rate |
| `tests/rates.test.ts` | Carry-forward: orders 1–10 use ₹1,000; "this order only" leaves default; "new default" carries forward with history; historical orders unchanged; identical behaviour for every rate type incl. GST and payment agent |
| `tests/payments.test.ts` | Obligations from snapshots (PA obligation = commission), multiple part payments, outstanding, payment status |
| `tests/rollups.test.ts` | Dashboard statistics: order/payment contributions, cancel/void reversal, party summaries, outstanding receivables/payables, minimal day/month key planning, edits that move dates |
| `tests/dates.test.ts` | Configurable financial year (April default, Jan/July), week/month/custom ranges, leap years |
| `tests/validation.test.ts` | Quantity, rates, GST, phones, dates, GSTIN, receipt files, login ID, PIN rules, passwords |
| `tests/extraction.test.ts` | AI output never trusted: kg→MT conversion, suspicious values, low confidence, wrong types, DD/MM dates, malformed JSON |
| `tests/misc.test.ts` | Order numbering, CSV escaping and formula-injection guard, search tokens, role permissions |
| `tests/paymentIntegrity.test.ts` | Negative/zero/fractional/NaN/Infinity amounts rejected; payment ↔ order party consistency for all five categories; overpayment rejected; multiple part payments; void reversal never negative; payment agent payable ₹38,520 → ₹28,520 after ₹10,000 → restored on void; overpayment rejected; corrections can't go below paid; reconciliation of paid totals vs ACTIVE payments; PA rate snapshot unaffected by later default change; role matrix |
| `tests/rulesMirror.test.ts` | Proves app amounts always satisfy the rules' integer formula (5,000 random orders) and tampered ±1 paisa never does; 64-bit bounds; statistics diff detection |
| `tests/rules/rules.test.ts` (emulator, `npm run test:rules`) | The real `firestore.rules`: access control, role escalation, PIN-hash privacy, order amount validation (GST, PA deduction/balance, seller), party type/name checks, counter-allocated numbers, no image content, no deletes, cancelled orders final, payment↔paid coupling, wrong party, overpayment, negative/zero/fractional amounts, double counting, void once, immutable payments, rate history genuine + append-only, master rate change leaves orders unchanged, statistics paid totals protected from OPERATIONS, audit log append-only |
| `tests/aiStatus.test.ts` | AI is Configured with Firebase web config + model and **without** App Check; missing App Check never disables AI; genuinely missing config/model reported; "turned off" distinct; workflow passes `VITE_AI_MODEL` and doesn't require an App Check key |
| `tests/architecture.test.ts` | Zero-cost guard rails: no Firebase Storage/Functions/Vertex imports, no hosting/storage in `firebase.json`, `/rock/` base path, HashRouter, Pages workflow, receipt provider stores nothing, no open rules, no private keys |

**Rules testing:** `npm run test:rules` runs the emulator suite automatically (also in GitHub Actions). For ad-hoc checks use Firebase console → Firestore → Rules → **Rules Playground**.

## 2. End-to-end acceptance (manual, on the live site)

Use a phone for steps 9–12 at least once. Record pass/fail and date.

| # | Step | Expected |
|---|---|---|
| 1 | Open https://krishsabadra9785-hub.github.io/rock/ and sign in with Login ID + password | PIN creation screen (first time) or dashboard |
| 2 | Create PIN, reach dashboard | Dashboard loads; figures ₹0 on an empty database |
| 3 | Add Buyer: rate ₹12,500, GST 5% | Appears in Buyers with code BUY-0001 |
| 4 | Add Seller: ₹9,700 | SEL-0001 |
| 5 | Add Commission Agent: ₹725 | AGT-0001 |
| 6 | Edit Buyer → default commission agent = the agent | Saved; shown on profile |
| 7 | Add Transporter: ₹850 | TRN-0001 |
| 8 | Add Payment Agent: ₹1,000; set it as default in Settings → Business | PAG-0001 |
| 9 | Create order → Take photo of a slip | Preview shows; "Reading the receipt…" |
| 10 | AI extracts fields **or** (turn off Wi-Fi / disable AI in Settings) manual form appears | Fields filled with status labels, or empty manual form with a clear message |
| 11 | Set quantity 38.52 and correct fields | Uncertain fields highlighted |
| 12 | Confirm receipt details | Parties step |
| 13 | Select buyer | Rate ₹12,500, GST 5% pre-filled |
| 14 | Select seller | ₹9,700 pre-filled |
| 15 | Default commission agent | Pre-selected with ₹725 |
| 16 | Transporter | Pre-selected (or select) with ₹850 |
| 17 | Payment agent | Pre-selected with ₹1,000 |
| 18 | Review | Base ₹4,81,500; GST ₹24,075; buyer owes ₹5,05,575; seller ₹3,73,644; commission ₹27,927; freight ₹32,742; payment agent commission payable ₹38,520 |
| 19 | Double-click **Confirm order** | Exactly one order created (ROCK-2026-000001) |
| 20 | Order page | All figures as above; payment table lists the payment agent commission as a payable |
| 21 | Receipt | Confirmed fields shown; note says image was not stored |
| 22–26 | Open buyer, seller, agent, transporter, payment agent profiles | Order in each ledger; summary band shows period and lifetime totals |
| 27 | Dashboard (This month) | Selling ₹5,05,575; buying ₹3,73,644; commission ₹27,927; freight ₹32,742; PA charges ₹38,520; quantity 38.52 MT; 1 order |
| 28–29 | Switch dashboard / profiles between Today, Month, FY, All time | Totals consistent; ranges without the order show ₹0 |
| 30 | New order, change seller rate to ₹10,000, choose **New default going forward** | Saved; seller profile rate = ₹10,000; rate history entry linked to the order |
| 31 | Open the first order | Seller rate still ₹9,700, total ₹3,73,644 |
| 32a | On the first order record a ₹10,000 payment agent payment, void it, then try ₹38,521 | Outstanding payable ₹28,520 then back to ₹38,520; ₹38,521 rejected |
| 32 | On the first order record transporter payments ₹10,000 then ₹22,742 | Two payment rows; status Part paid → Paid |
| 33 | Transporter profile and dashboard outstanding payables | Freight outstanding decreases accordingly |
| 34 | Search the vehicle number and the order number | Order found |
| 35 | Reports → each report → Download CSV; Print / PDF | Opens in Excel with correct figures; print preview clean |
| 36 | Refresh the page on `/rock/#/orders` | No 404; data persists; PIN requested if locked |
| 37 | Unauthorised access (see §3) | Blocked |

Also check: Settings → Data → **Rebuild statistics** leaves dashboard totals unchanged; install to home screen (Add to Home Screen) and open from the icon.

## 3. Security scenarios

| Scenario | Expected |
|---|---|
| New Firebase user with no `users` doc signs in | "Account isn't set up" screen; no data visible; direct Firestore reads denied |
| `users/{uid}.active = false` while signed in | Signed out immediately |
| VIEW_ONLY user tries to record a payment (UI hidden; try via Rules Playground) | Denied |
| Delete an order or payment (Rules Playground) | Denied |
| Change `orderNumber`, `buyerId` or `paid` with an edit | Denied |
| Create an order with `gross != base + gst` | Denied |
| 5 wrong PINs | Device signed out; password required |
| Open the site from another domain/localhost without debug token after App Check enforcement | AI/Firestore requests rejected |

## 4. Failure handling

| Scenario | Expected |
|---|---|
| Airplane mode during receipt reading | Manual entry with "offline" message |
| Unreadable photo (blank wall) | "Could not be read clearly", manual form |
| Wrong model name in Settings | "Model was not found" message, manual entry works |
| Airplane mode on Confirm order | Error shown; turning network back on and confirming again creates one order |
| Firestore quota exceeded (simulate via Rules Playground deny) | Clear message; no partial data |
