# Sabadra Minerals security model

## What protects the data

1. **Firebase Authentication.** Every request carries a signed ID token.
2. **Firestore security rules** (`firestore.rules`), enforced on Google's servers:
   - deny everything by default;
   - require an **active `users/{uid}` profile** created by an administrator — self sign-up grants nothing;
   - role checks per operation (matrix below);
   - immutable financial history: no deletes; orders cancel, payments void; identity fields must equal the caller.
3. **App Check (reCAPTCHA v3)** rejects requests that don't come from the genuine Sabadra Minerals site once enforced, protecting free quotas (especially Gemini) from abuse.
4. **No secrets in the repository.** The Firebase web config is public by design. The Gemini key is managed by Firebase AI Logic inside the project and never appears in code. `.env*` files are git-ignored. An automated test fails the build if a private key or service-account JSON appears in `src/`.

## Financial invariants and where each is enforced

Layers: **A** Firestore rules · **B** transactions/atomic batches · **C** app validation · **D** immutable snapshots · **E** automated tests (`tests/*.test.ts` = app layer, `tests/rules/rules.test.ts` = rules on the emulator).

| Invariant | Enforced by |
|---|---|
| Every order amount = qty × rate (half-up to the paisa); GST = base × %; gross = base + GST | A (integer re-derivation in `validFinancials`), C (`calculateOrder`), E (5,000-case mirror test + rules tests) |
| Payment agent commission = qty × snapshotted PA rate (a payable); no buyer money attributed to the agent; obsolete received/balance fields rejected on new orders | A (`validFreightAndAgent`), C, D, E |
| No party → zero rate and zero amount for that line | A, C |
| Order lines reference real parties of the right type; name snapshots match | A (`validParties`), B |
| Order number = counter value allocated in the same commit; counter only +1 | A (`validNumbering`, counter rules), B |
| Paid totals are whole paise, ≥ 0, ≤ obligation (no overpayment against an order) | A (`validPaid`), C (`applyPaymentToOrder`), E |
| Order paid totals change **only** together with one payment created/voided in the same commit, by exactly its amount, for the matching obligation → paid = Σ ACTIVE linked payments | A (`paidChangeBackedByPayment` ↔ `orderAcceptsPayment`/`orderAcceptsVoid`, mutual checks), B, E |
| Payment party/category/order relationship is consistent | A (`validPaymentParty`, `orderAcceptsPayment`), C (`assertPaymentMatchesOrder`), E |
| Payment amount positive whole paise ≤ ₹100 crore | A, C, E |
| Duplicate submission counted once | B (client UUID document IDs, existence check in the transaction), A (re-creating an existing payment is an update, which only allows voiding) |
| Concurrent payments can't corrupt totals | B (transaction reads the order; Firestore retries on conflict), A (delta checked against the stored value, so stale explicit values are rejected) |
| Payments are never edited or deleted; only ACTIVE → VOID once | A, E |
| Corrections can't change parties/number/paid, can't push an amount below what was paid, bump `version` | A, C, E |
| Cancelled orders are final; cancel only by ADMIN with nothing paid | A, C, E |
| No deletion of orders, payments, parties, rate history, audit logs | A, E |
| Default rate change always creates a new history entry with the real old value; history is append-only | A (`rateChangeRecorded`, `validRateHistory`), B, E |
| Changing a master rate never changes saved orders | D (orders store their own rates/amounts; nothing recomputes them), E |
| No receipt image content in Firestore | A (receipt key whitelists; provider must be `NONE`; all receipt text must be strings with ≤ 700 characters in total, AI output ≤ 8,600), C (`NoPermanentStorageProvider` returns metadata only), E |
| Dashboard statistics (`rollups`) match the source records | B (updated in the same transaction), plus **Check figures** / **Rebuild statistics** (deterministic recomputation). See residual risks. |

## Rules expression budget

Firestore evaluates at most 1,000 expressions per request, and function arguments are re-evaluated wherever a parameter is used. The order rules are therefore written to touch each value once:
- Each amount is checked with one remainder, `0 ≤ qty×rate − amount×1000 + 500 < 1000`. That is exact half-up rounding, and it also implies amount ≥ 0 and amount = 0 for a zero rate.
- All receipt text is checked with one concatenated string-length test.
- Updates are validated with per-purpose field whitelists (`affectedKeys().hasOnly`) instead of full-document checks.
- A rate-only party update validates just the rates and history.

`tests/rules/rules.test.ts` replays the app's complete order, payment and correction commits so the budget is tested, not assumed.

## Residual risks (client-side / serverless architecture)

There is no trusted server on the free plan, so be clear about what remains:

1. **Statistics documents are derived data and only partly protected.** Rules restrict who can write them and stop non-accounting roles changing payment totals in them. They cannot verify that every per-party increment exactly matches an order. A malicious *authorised* OPERATIONS/ACCOUNTS user calling Firestore directly could distort dashboard figures. Orders and payments, the source of truth, stay correct. **Settings → Data → Check figures** detects any divergence and **Rebuild statistics** repairs it. Run Check figures periodically, e.g. monthly.
2. **Authorised users are trusted within their role.** ACCOUNTS can record real-looking payments and corrections (each audit-logged and reason-tagged). OPERATIONS can create orders and change default rates (each with history). The rules stop impossible numbers, not dishonest-but-valid entries.
3. **The PIN is a device unlock, not server-verified** (see below).
4. **Audit log entries are written by the client.** Rules make them append-only and attributed to the caller's uid. A user calling Firestore directly could omit an audit entry for a legitimate action. The financial records themselves (with `createdBy`/`updatedBy`, `version`, rate history, voided payments) remain.
5. **Configuration-dependent:** the rules must actually be published; App Check enforcement is a manual console step; Authorized domains must be set; self sign-up should be disabled where available.
6. **Receipt storage provider:** V1 rules accept only `provider: 'NONE'`. Enabling image storage later requires a rules change as well as the new provider.
7. **Pre-existing data:** the paid-total invariant holds by induction from creation under these rules. Data written under an older rule set should be checked once with **Check figures**.

## Role matrix

| Action | ADMIN | ACCOUNTS | OPERATIONS | VIEW_ONLY |
|---|:-:|:-:|:-:|:-:|
| View everything | ✓ | ✓ | ✓ | ✓ |
| Create orders | ✓ | ✓ | ✓ | |
| Add/edit parties, change default rates | ✓ | ✓ | ✓ | |
| Correct confirmed orders | ✓ | ✓ | | |
| Record / void payments | ✓ | ✓ | | |
| Cancel orders | ✓ | | | |
| Settings, users, rebuild statistics, backup | ✓ | | | |
| Read audit log | ✓ | ✓ | | |
| Write statistics (as part of orders) | ✓ | ✓ | ✓ (not payment totals) | |
| Write audit entries (as part of actions) | ✓ | ✓ | ✓ | |

VIEW_ONLY users can write only their own display name and their own PIN hash.

Mirrored in `src/domain/permissions.ts` (UI) — the rules are authoritative.

## Login ID + 4-digit PIN

Requirements: Login-ID + PIN experience, no plaintext PIN anywhere, no weakening of Firebase security, Spark plan, static hosting (no trusted server).

**Chosen design**

1. **Enrolment / full sign-in:** Login ID + password → `signInWithEmailAndPassword` with `<loginId>@<VITE_LOGIN_EMAIL_DOMAIN>`. Passwords: ≥ 10 characters, letters + digits. Firebase applies its own brute-force throttling.
2. **PIN creation:** only right after a full sign-in. Stored as `PBKDF2-SHA-256(uid:PIN, 16-byte random salt, 310,000 iterations)` in `userSecurity/{uid}`, readable only by that user.
3. **Unlock:** a device with a saved Firebase session shows the lock screen; the PIN is verified against the hash with WebCrypto and a constant-time comparison.
4. **Throttling:** 30-second delay after 3 failures; after 5 the device is **signed out** (session token discarded) and the password is required.
5. **Session limits:** auto-lock after N idle minutes (default 5) and when returning after being hidden longer than that; full password required every N days (default 30), checked against the token's `auth_time`; password required to change the PIN or password (`reauthenticateWithCredential`).
6. **Revocation:** deactivating a user in Settings → Users takes effect immediately (live profile listener signs them out; rules deny all data).

**Honest threat model**

- The PIN is a **device unlock**, like a banking app's PIN on an already-enrolled phone. It is *not* the authorisation layer — Firebase Auth + rules are.
- It protects against someone picking up an unlocked/left-open device or reopening the app.
- It does **not** protect against an attacker with full forensic access to the device's browser storage: they could take the saved Firebase session directly, and a 4-digit PIN hash is brute-forceable offline (10,000 combinations). This is inherent to any PIN without a trusted server; it is why the password, device security and remote deactivation matter.
- A server-verified PIN (attempt counter and hash held server-side, issuing custom tokens) would need Cloud Functions, which require the Blaze plan. It is deliberately not used. If billing is ever enabled, that is the recommended upgrade.

## Data on devices

- Firestore uses an **in-memory cache only**; business data isn't persisted to disk by Firestore.
- The service worker caches **only the app shell**; no API responses.
- Receipt images exist only in memory during order creation and are released afterwards; they are **never uploaded or stored** in V1.
- `localStorage` holds only the PIN attempt counter. Firebase Auth keeps its session token in IndexedDB.

## Before going live checklist

- [ ] `firestore.rules` published (Rules tab shows the Sabadra Minerals header comment)
- [ ] First admin `users/{uid}` created; no other unexpected `users` docs
- [ ] Authentication → Authorized domains contains `krishsabadra9785-hub.github.io`
- [ ] (If available) self sign-up disabled
- [ ] App Check registered; after a day of clean metrics, **Enforce** for AI Logic, Firestore and Auth
- [ ] No `.env.local` or credentials committed (`git status` before every push)
- [ ] Owner password stored safely; backup downloaded
