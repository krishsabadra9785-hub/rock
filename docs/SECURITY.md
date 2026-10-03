# ROCK security model

## What protects the data

1. **Firebase Authentication.** Every request carries a signed ID token.
2. **Firestore security rules** (`firestore.rules`), enforced on Google's servers:
   - deny everything by default;
   - require an **active `users/{uid}` profile** created by an administrator — self sign-up grants nothing;
   - role checks per operation (matrix below);
   - immutable financial history: no deletes; orders cancel, payments void; identity fields must equal the caller.
3. **App Check (reCAPTCHA v3)** rejects requests that don't come from the genuine ROCK site once enforced, protecting free quotas (especially Gemini) from abuse.
4. **No secrets in the repository.** The Firebase web config is public by design. The Gemini key is managed by Firebase AI Logic inside the project and never appears in code. `.env*` files are git-ignored. An automated test fails the build if a private key or service-account JSON appears in `src/`.

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

- [ ] `firestore.rules` published (Rules tab shows the ROCK header comment)
- [ ] First admin `users/{uid}` created; no other unexpected `users` docs
- [ ] Authentication → Authorized domains contains `krishsabadra9785-hub.github.io`
- [ ] (If available) self sign-up disabled
- [ ] App Check registered; after a day of clean metrics, **Enforce** for AI Logic, Firestore and Auth
- [ ] No `.env.local` or credentials committed (`git status` before every push)
- [ ] Owner password stored safely; backup downloaded
