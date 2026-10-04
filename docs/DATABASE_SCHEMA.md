# Firestore database schema

All money values are **integer paise**, quantities **integer kg**, percentages **integer basis points**, business dates **`YYYY-MM-DD` strings**. Timestamps are Firestore server timestamps. No images, Base64 or blobs are ever stored.

Security summary per collection is in the last column; the authoritative source is [`firestore.rules`](../firestore.rules). "Active user" = signed in **and** `users/{uid}.active == true`.

---

## `users/{uid}`
**Purpose:** grants access and a role. Document ID = Firebase Auth UID. The first admin is created in the Firebase console.

| Field | Type | Notes |
|---|---|---|
| loginId | string | e.g. `owner` (email is `owner@<VITE_LOGIN_EMAIL_DOMAIN>`) |
| displayName | string | |
| role | string | `ADMIN` · `ACCOUNTS` · `OPERATIONS` · `VIEW_ONLY` |
| active | boolean | `false` revokes all access immediately |
| updatedAt / updatedBy | timestamp / string | |

**Security:** read own or admin; write admin only (users may change their own `displayName`); an admin can't remove their own admin access; no delete.

## `userSecurity/{uid}`
**Purpose:** PIN verifier. **Never the PIN.**

| Field | Type | Notes |
|---|---|---|
| pinHash | string | base64 PBKDF2-SHA-256 (256-bit) of `uid:PIN` |
| pinSalt | string | base64, 16 random bytes |
| pinIterations | int | 310,000 |
| pinUpdatedAt | timestamp | |

**Security:** only the owning, active user can read/write; shape validated.

## `settings/app`
| Field | Type | Default |
|---|---|---|
| businessName | string | `ROCK` |
| orderPrefix | string | `ROCK` |
| defaultGstBp | int | 500 |
| fyStartMonth | int 1–12 | 4 (April) |
| defaultPaymentAgentId | string\|null | |
| autoLockMinutes | int | 5 |
| maxSessionDays | int | 30 |
| aiEnabled | boolean | true |
| aiModel | string | `gemini-2.5-flash` |

**Security:** read active users; write admin.

## `parties/{partyId}`
**Purpose:** master records for buyers, sellers, commission agents, transporters and payment agents (one collection, `type` field).

| Field | Type | Notes |
|---|---|---|
| type | string | `BUYER` · `SELLER` · `COMMISSION_AGENT` · `TRANSPORTER` · `PAYMENT_AGENT` (immutable) |
| code | string | `BUY-0001`, `SEL-0001`, `AGT-`, `TRN-`, `PAG-` (immutable) |
| name, nameLower | string | `nameLower` for ordering |
| phone, address, gstin, notes | string | |
| active | boolean | deactivate instead of delete |
| rates | map | current defaults: `BUYER_RATE`, `BUYER_GST` (bp), `SELLER_RATE`, `COMMISSION_RATE`, `FREIGHT_RATE`, `PAYMENT_AGENT_RATE` (paise/MT) |
| defaults | map | `commissionAgentId`, `transporterId`, `paymentAgentId` (string\|null) |
| demo | boolean? | demo data marker |
| createdAt/By, updatedAt/By | | |

**Relationships:** referenced by `orders.*Id`, `payments.partyId`, `rateHistory.partyId`, rollup buckets.
**Indexes:** single-field `nameLower` (automatic).
**Security:** read active; create/update ADMIN/ACCOUNTS/OPERATIONS; `type`, `code`, `createdAt/By` immutable; no delete.

## `rateHistory/{id}` (append-only)
| Field | Type |
|---|---|
| partyId, partyType, rateType | string |
| oldRate | int\|null |
| newRate | int |
| effectiveFrom | `YYYY-MM-DD` |
| changedBy | uid |
| sourceOrderId, sourceOrderNumber | string\|null |
| reason | string |
| createdAt | timestamp |

**Index:** `partyId ASC, createdAt DESC`. **Security:** create by operators with `changedBy == uid`; no update/delete.

## `counters/{id}`
`orders-YYYY` → `{ seq, year }` for order numbers; `party-<TYPE>` → `{ seq }` for party codes. **Security:** create with `seq == 1`, update only `seq == old + 1`.

## `orders/{orderId}`
**Purpose:** the central transaction with an immutable financial snapshot. Document ID = idempotency key (UUID).

| Field | Type | Notes |
|---|---|---|
| orderNumber, seq | string, int | `ROCK-2026-000001` |
| status | string | `CONFIRMED` · `CANCELLED` (`DRAFT` reserved) |
| dispatchDate | `YYYY-MM-DD` | used for ranges and statistics |
| qtyKg | int | net quantity |
| receipt | map | `image {provider:'NONE', ref:null, fileName, contentType, sizeBytes}`, `receiptNumber`, `driverName`, `driverPhone`, `vehicleNumber`, `destination`, `dispatchDate`, `netQtyKg`, `ai {status, model, raw (≤8000 chars), error}`, `confirmedAt`, `confirmedBy` |
| buyer | map | `id, name, ratePaise, gstBp, baseAmount, gstAmount, grossAmount` |
| seller | map | `id, name, ratePaise, amount` |
| commission | map | `id\|null, name, ratePaise, amount` |
| freight | map | `id\|null, name, ratePaise, amount, destination` |
| paymentAgent | map | `id\|null, name, ratePaise, amount`: **commission payable we owe the agent** (amount = qty × ratePaise). *Deprecated, legacy documents only:* `received, deduction, balance` from the obsolete model; read as amount = `deduction`; `received`/`balance` ignored. New orders may not contain them. |
| buyerId, sellerId, commissionAgentId, transporterId, paymentAgentId | string\|null | flattened for indexed queries |
| paid | map | `buyer, seller, commission, freight, paymentAgent` — sums of active linked payments (cache maintained transactionally) |
| rateDecisions | array (≤6) | `{rateType, partyId, defaultValue, value, decision}` |
| searchTokens | array (≤120) | lowercase tokens for search |
| notes, cancelReason | string | |
| version | int | +1 on every correction/cancel |
| createdAt/By, updatedAt/By | | |

**Indexes:** `status + dispatchDate + seq` (both directions); `status + <partyId> + dispatchDate desc + seq desc` for each of the five party fields; `searchTokens (contains) + status + dispatchDate desc + seq desc`.
**Security:** read active. Create by operators: status CONFIRMED, `createdBy == uid`, `paid` all zero, receipt/financial invariants (`gross == base + gst`; seller, commission, freight and payment-agent amounts = qty × rate; payment-agent line has exactly `id, name, ratePaise, amount`). Update by ADMIN/ACCOUNTS only as (a) paid-only change, (b) versioned correction with invariants, or (c) admin cancellation; identity, number and parties immutable. No delete.

## `payments/{paymentId}`
Document ID = idempotency key.

| Field | Type | Notes |
|---|---|---|
| category | string | `BUYER_RECEIPT` (in), `SELLER_PAYMENT`, `COMMISSION_PAYMENT`, `TRANSPORTER_PAYMENT`, `PAYMENT_AGENT_SETTLEMENT` (out: payment **to** the payment agent; name kept for compatibility), `OTHER` |
| date | `YYYY-MM-DD` | |
| amount | int > 0 | |
| partyId, partyType, partyName | | name snapshot |
| orderId, orderNumber | string\|null | null = on-account payment |
| method | string | `BANK`, `UPI`, `CASH`, `CHEQUE`, `OTHER` |
| reference, notes | string | |
| status | string | `ACTIVE` · `VOID` |
| voidReason | string\|null | |
| createdAt/By, updatedAt/By | | |

**Indexes:** `orderId|partyId|category + date desc + createdAt desc`; `date desc + createdAt desc`.
**Security:** read active; create ADMIN/ACCOUNTS (`createdBy == uid`, amount > 0); update only ACTIVE → VOID; no delete.

## `rollups/{key}` (derived statistics)
Keys `D-YYYY-MM-DD` (day) and `M-YYYY-MM` (month).

| Field | Type |
|---|---|
| kind | `D` \| `M` |
| key | date / month |
| totals | `orders, qtyKg, buyerBase, gst, buyerGross, seller, commission, freight, paCharge (payment-agent commission), paid{<category>}` |
| parties | `{BUYER|SELLER|COMMISSION_AGENT|TRANSPORTER|PAYMENT_AGENT: {<partyId>: {n, qtyKg, amount, paid, base, gst}}}`: `amount` is the receivable for buyers and the payable for every other party (payment agent = commission). Legacy docs may also hold `received`/`charge`; these are ignored and removed by Rebuild statistics. |

Updated only via atomic increments inside order/payment transactions; fully rebuildable from orders and payments. **Security:** read active; write operators; delete admin (rebuild).

## `auditLogs/{id}` (append-only)
`entityType`, `entityId`, `action` (`CREATE`, `EDIT`, `CANCEL`, `VOID`, `RATE_CHANGE`, `UPDATE`, `REBUILD`), `summary`, `changes {field: {from, to}}`, `reason`, `actorId`, `at`.
**Index:** `entityId + at desc`. **Security:** read ADMIN/ACCOUNTS; create by active users with `actorId == uid`; no update/delete.
