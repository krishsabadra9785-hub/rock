# ROCK

ROCK is a private business app for a trading business that buys bulk material from **sellers**, sells it to **buyers**, and pays **commission agents**, **transporters** and a **payment agent** on every truck. It records each order from the weighbridge slip, works out every amount automatically, tracks every payment, and shows dashboards, ledgers and reports.

**Live address (after setup):** https://krishsabadra9785-hub.github.io/rock/

It costs nothing to run: the website is hosted free on **GitHub Pages**, and data lives in **Firebase on the free Spark plan**. No billing account is needed anywhere.

---

## Contents

1. [What ROCK does](#1-what-rock-does)
2. [How it is built](#2-how-it-is-built)
3. [One-time setup: Firebase](#3-one-time-setup-firebase)
4. [One-time setup: your computer](#4-one-time-setup-your-computer)
5. [Run ROCK on your computer](#5-run-rock-on-your-computer)
6. [Test and build](#6-test-and-build)
7. [Publish on GitHub Pages](#7-publish-on-github-pages)
8. [Create the first administrator](#8-create-the-first-administrator)
9. [How login and the PIN work](#9-how-login-and-the-pin-work)
10. [Updating ROCK later](#10-updating-rock-later)
11. [Adding employees](#11-adding-employees)
12. [Backups](#12-backups)
13. [Free-plan limits](#13-free-plan-limits)
14. [Troubleshooting](#14-troubleshooting)
15. [Project structure](#15-project-structure)

---

## 1. What ROCK does

- **Create order**: photograph the weighbridge slip or challan, and ROCK reads net quantity, driver, phone, vehicle, date, slip number and destination with Google's Gemini AI. You check and correct every field, then pick the buyer, seller, agent, transporter and payment agent. Rates fill in automatically.
- **Calculates everything**: buyer amount and GST (what the buyer owes us), and what we owe the seller, commission agent, transporter and payment agent. Example for 38.52 MT: the buyer owes us ₹5,05,575 incl. GST, and we owe the payment agent its commission of ₹38,520 (38.52 × ₹1,000).
- **Remembers rates**: when you change a rate on an order you choose *This order only* or *New default going forward*. Old orders never change.
- **Payments**: record any number of part payments per order; outstanding balances update automatically.
- **Dashboards, ledgers, reports**: by day, week, month, financial year (April–March by default), custom range or all time. CSV export (opens in Excel) and print / save as PDF.
- **Works on phones**: install it to the home screen like an app.

**Receipt images are not kept.** To stay on the free plan, ROCK reads the photo on your device and then discards it. Only the details you confirmed are saved. (The code is ready for permanent image storage later if you ever choose to enable a paid storage plan.)

## 2. How it is built

| Part | What it uses | Cost |
|---|---|---|
| Website | React + TypeScript, built with Vite, installable PWA | — |
| Hosting | GitHub Pages, deployed by GitHub Actions | Free |
| Login | Firebase Authentication (email/password underneath, Login ID + PIN on screen) | Free (Spark) |
| Database | Cloud Firestore | Free (Spark) |
| Receipt reading | Firebase AI Logic → Gemini Developer API, free tier | Free |
| Abuse protection | Firebase App Check with reCAPTCHA v3 | Free |

**Not used:** Firebase Hosting, Firebase Storage, Cloud Functions, Vertex AI, or anything that needs a billing account.

---

## 3. One-time setup: Firebase

Your Firebase project is **rock-e6719**. Open https://console.firebase.google.com and select it. Check the plan shown at the bottom-left says **Spark**. Never click "Upgrade".

### 3.1 Register the web app and copy its settings

1. Click the **gear icon → Project settings**.
2. Under **Your apps**, if there is no web app yet, click the **`</>`** (Web) icon. Nickname: `ROCK`. **Do not** tick "Also set up Firebase Hosting". Click **Register app**.
3. You'll see a block of code with `firebaseConfig = { apiKey: "...", ... }`. Keep this page open: you'll copy these values in steps 4 and 7.

> These values are not passwords. Every Firebase website exposes them. Your data is protected by login, by the security rules, and by App Check.

### 3.2 Authentication

Email/Password sign-in is already enabled. Two more things:

1. **Authentication → Settings → Authorized domains → Add domain** → enter `krishsabadra9785-hub.github.io` → Add. (`localhost` is already there.)
2. **Optional, recommended:** Authentication → Settings → **User actions**. If you see "Enable create (sign-up)", untick it and save. (If that option isn't shown on your plan, that's fine: anyone who signs up on their own still gets no access, because the security rules require an administrator to grant it.)

Create your own account now:

3. **Authentication → Users → Add user**.
   - Email: `owner@rock.local` (your Login ID will be `owner`; you can choose any ID — the email is always `<login id>@rock.local`).
   - Password: a strong password of at least 10 characters with letters and numbers. Store it somewhere safe.
4. Copy the **User UID** shown in the list (a long code like `kX9a…`). You'll need it in step 8.

### 3.3 Firestore database

1. **Build → Firestore Database → Create database**.
2. Choose **Standard edition** if asked, then **Start in production mode**.
3. Location: **asia-south1 (Mumbai)**. This cannot be changed later.
4. Click **Create**.

**Publish the security rules** (do this before anything else touches the database):

- Easiest: open **Firestore Database → Rules**, delete everything in the editor, paste the entire contents of the file [`firestore.rules`](firestore.rules) from this project, and click **Publish**.
- Or with the command line (also publishes the indexes — see step 4.4): `npm run deploy:rules`.

**Indexes:** ROCK needs some search indexes. Deploy them with `npm run deploy:rules` (step 4.4). If you skip that, the app shows an error the first time a list needs an index; the browser console then shows a link that creates it in one click. Indexes take a few minutes to build.

### 3.4 AI receipt reading (Firebase AI Logic, free tier)

1. In the Firebase console left menu, open **AI Logic** (under Build, or "AI" → "AI Logic").
2. Click **Get started**.
3. Choose **Gemini Developer API** (the one that works on the Spark/no-cost plan). **Do not choose Vertex AI Gemini API** — it needs billing.
4. Follow the prompts to enable the required APIs. Firebase creates and manages an API key for this inside your project — you don't need to copy it anywhere, and it must never be put in the code.

ROCK uses the model `gemini-2.5-flash` by default. If Google retires it or the free quota is too small, change it later in **ROCK → Settings → AI receipt reading** (for example to `gemini-2.5-flash-lite`). Use only models listed as available on the Gemini Developer API free tier.

If the free quota runs out, ROCK says "AI usage limit reached for now" and you type the details yourself. It never switches to a paid service.

### 3.5 App Check (protects your free quotas from abuse)

App Check proves requests come from your real ROCK website. It uses Google reCAPTCHA v3, which is free and needs no billing.

1. Go to https://www.google.com/recaptcha/admin/create.
   - Label: `ROCK`
   - Type: **Score based (v3)**
   - Domains: `krishsabadra9785-hub.github.io` and `localhost`
   - Submit. You get a **site key** and a **secret key**.
2. Firebase console → **App Check → Apps** → your web app → **reCAPTCHA** → paste the **secret key** → **Save**.
3. Keep the **site key**: it goes in `VITE_RECAPTCHA_V3_SITE_KEY` (steps 4 and 7). The site key is public.
4. After ROCK has been live for a day, open **App Check → APIs**. When the metrics show nearly all requests as *verified*, click **Enforce** for **Firebase AI Logic** first, then **Cloud Firestore**, then **Authentication**. Enforcing blocks requests that don't come from your app.

**For local development:** when App Check is on and you run `npm run dev`, the browser console prints *"App Check debug token: …"*. Copy it to **App Check → Apps → ⋮ → Manage debug tokens → Add**. Never share debug tokens.

---

## 4. One-time setup: your computer

You need this only to run ROCK locally or to publish the rules from the command line. Publishing the website itself happens automatically on GitHub.

### 4.1 Install tools

- **Node.js 22 LTS**: download from https://nodejs.org (choose "LTS"), install with default options.
- **Git**: https://git-scm.com/downloads.

Check in a terminal (Windows: "Command Prompt"; Mac: "Terminal"):

```bash
node -v
npm -v
git --version
```

### 4.2 Get the project and install

```bash
git clone https://github.com/krishsabadra9785-hub/rock.git
cd rock
npm install
```

`npm install` downloads the libraries (a few minutes the first time) and creates **`package-lock.json`**. Commit that file (step 10) so GitHub builds use exactly the same versions.

### 4.3 Local settings file

```bash
# Mac / Linux
cp .env.example .env.local
# Windows (Command Prompt)
copy .env.example .env.local
```

Open `.env.local` in a text editor and fill in the values from step 3.1 (`apiKey` → `VITE_FIREBASE_API_KEY`, `appId` → `VITE_FIREBASE_APP_ID`, etc.) and the reCAPTCHA site key from step 3.5. `.env.local` is ignored by Git and is never uploaded.

### 4.4 Publish Firestore rules and indexes from the command line (optional)

```bash
npx firebase-tools login
npm run deploy:rules
```

The first command opens a browser to sign in with your Google account. The project `rock-e6719` is already selected by the `.firebaserc` file. This works on the free Spark plan.

## 5. Run ROCK on your computer

```bash
npm run dev
```

Open **http://localhost:5173/rock/** in your browser. Stop it with `Ctrl + C`.

## 6. Test and build

```bash
npm test            # automated tests, including every figure of the 38.52 MT example
npm run test:rules  # security-rules tests on the Firestore emulator (needs Java 21, see below)
npm run typecheck   # checks the code for type errors
npm run lint        # code style checks
npm run build       # creates the production website in the dist/ folder
npm run preview     # serves the built site at http://localhost:4173/rock/
npm run check       # all of the above in one go
```

### Security-rules tests (recommended before publishing rules)

These run the real `firestore.rules` against Google's local Firestore emulator. That needs no Firebase project and no billing, but it does need **Java 21**:

```bash
# Mac (with Homebrew: https://brew.sh)
brew install openjdk@21
echo 'export PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
java -version
npm run test:rules:install   # once (and after dependency changes); creates tests/rules/package-lock.json — commit it
npm run test:rules
```

GitHub Actions also runs them on every push. The website is only published if both the app tests and the rules tests pass.

## 7. Publish on GitHub Pages

### 7.1 Turn on GitHub Pages (once)

1. Open https://github.com/krishsabadra9785-hub/rock → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**. (Not "Deploy from a branch".)

### 7.2 Add your Firebase settings to GitHub (once)

1. Repository → **Settings → Secrets and variables → Actions** → **Variables** tab → **New repository variable**.
2. Add each of these (Name exactly as written, Value from step 3.1 / 3.5):

| Name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `rock-e6719.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `rock-e6719` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_RECAPTCHA_V3_SITE_KEY` | reCAPTCHA **site** key |
| `VITE_LOGIN_EMAIL_DOMAIN` | `rock.local` |
| `VITE_AI_MODEL` | `gemini-2.5-flash` |
| `VITE_FIREBASE_MEASUREMENT_ID` | `measurementId` (only if present; otherwise skip) |

(They are *variables*, not secrets, because they are public web settings. Never add passwords, PINs or service-account files to GitHub.)

### 7.3 Upload the project

From the project folder:

```bash
git add .
git commit -m "ROCK V1"
git branch -M main
git remote add origin https://github.com/krishsabadra9785-hub/rock.git   # skip if it says "remote origin already exists"
git push -u origin main
```

### 7.4 Watch it deploy

Repository → **Actions** tab → **Build and deploy to GitHub Pages**. A yellow dot means running, a green tick means published (usually 2–4 minutes). Then open **https://krishsabadra9785-hub.github.io/rock/**.

The workflow installs, type-checks, runs every test, builds, and only then publishes. **If any step fails, nothing is published and the current live site keeps working.**

Pages inside ROCK have addresses like `https://krishsabadra9785-hub.github.io/rock/#/orders`. The `#` is intentional: it lets you refresh any page without errors on GitHub Pages.

## 8. Create the first administrator

The first time you sign in, ROCK shows "Your account isn't set up in ROCK yet" with your **User UID**. That's expected — give yourself access:

1. Firebase console → **Firestore Database → Data → + Start collection**.
2. Collection ID: `users` → Next.
3. Document ID: paste your **User UID** exactly.
4. Add fields (click "Add field" for each):

| Field | Type | Value |
|---|---|---|
| `loginId` | string | `owner` |
| `displayName` | string | your name |
| `role` | string | `ADMIN` |
| `active` | boolean | `true` |

   Add **only** these four fields. The security rules reject profile documents with extra fields when an administrator edits them later.
5. Save, go back to ROCK, sign in again with Login ID `owner` and your password, and create your 4-digit PIN.

Then, inside ROCK:

1. **Settings → Business**: business name, default GST, financial-year start, order prefix.
2. Add your **Payment agent**, **Commission agents**, **Transporters**, **Sellers** and **Buyers** with their default rates (buyers can have a default agent, transporter and payment agent).
3. **Settings → Business → Default payment agent**.
4. **Create order** and try it end to end.

## 9. How login and the PIN work

Firebase only supports secure passwords, not bare 4-digit PINs, and a website on free static hosting has no private server to check a PIN safely. So ROCK uses the safest arrangement possible on the free plan:

1. **First time on a device:** sign in with your **Login ID + password** (real Firebase Authentication).
2. **Create a 4-digit PIN.** ROCK stores only a salted, slow hash of it (PBKDF2-SHA-256, 310,000 rounds) in your private Firestore record. The PIN itself is never stored anywhere.
3. **After that:** opening ROCK on that device asks only for the PIN. It also locks after 5 minutes idle (configurable).
4. **Limits:** after 3 wrong PINs there's a 30-second wait; after 5 the device is signed out and the password is required. The password is also required every 30 days (configurable), and for changing your PIN or password.
5. **What actually protects the data** is your Firebase login plus the security rules. Every database request is checked against your role. The PIN is a quick lock for a device you have already signed in on, like a banking app's PIN — it is not a substitute for keeping your device and password safe.

Details: [docs/SECURITY.md](docs/SECURITY.md).

**Forgot the PIN?** Tap "Use password instead", sign in with your password, and set a new PIN in Settings.
**Forgot the password?** `@rock.local` addresses can't receive reset emails, so an administrator deletes the user in Firebase console → Authentication → Users and adds them again with the same email and a new password. That gives a new User UID: grant it access in ROCK → Settings → Users (or create the `users/<new UID>` document as in step 8), and set the old entry to inactive. Their orders and history are unaffected.

## 10. Updating ROCK later

Change files, then:

```bash
npm run check                      # make sure everything still passes
git add .
git commit -m "Describe the change"
git push
```

GitHub Actions publishes the new version automatically. People using ROCK see "A new version of ROCK is available — Reload".

If `firestore.rules` or `firestore.indexes.json` changed, publish them too: `npm run deploy:rules` (or paste the rules in the console).

## 11. Adding employees

1. Firebase console → Authentication → **Add user**: `ramesh@rock.local` with a temporary password.
2. Copy their **User UID**.
3. ROCK → **Settings → Users** → paste UID, Login ID `ramesh`, name, role → **Save access**.

| Role | Can do |
|---|---|
| Administrator | Everything, including settings, users, cancelling orders, backups |
| Accounts | Orders, corrections, payments, parties, reports |
| Operations | Create orders, manage parties and rates, view everything |
| View only | View dashboards, ledgers and reports |

To remove access, untick **Access active**. Their history is kept.

## 12. Backups

**ROCK → Settings → Data → Download backup** saves every business record as a JSON file. Do this regularly (e.g. weekly) and keep copies in two places. It contains confidential data, so store it safely.

(Firestore's automatic scheduled backups require the paid Blaze plan, so they aren't used.)

## 13. Free-plan limits

| Service | Free allowance (approximate; Google may change it) | What happens if exceeded |
|---|---|---|
| Firestore | 50,000 reads, 20,000 writes per day; 1 GiB stored | Requests fail until the daily reset; ROCK shows "Usage limit reached for today". Nothing is corrupted: each save is all-or-nothing. |
| Gemini (AI Logic) | Free-tier requests per minute/day depend on the model | ROCK shows "AI temporarily unavailable" and you type the details manually. |
| GitHub Pages | Generous for a private business app | — |

ROCK is designed to read little data. For example, dashboards read small daily and monthly summaries instead of every order.

## 14. Troubleshooting

### The GitHub deployment failed (red ✗ in Actions)

Open **Actions → the failed run → the red step** and read the last lines.

| Failing step | Likely cause | Fix |
|---|---|---|
| **Check Firebase configuration variables** | A repository variable is missing | Add it (step 7.2), then **Actions → the run → Re-run all jobs** |
| **Install dependencies** says `npm ci` can only install with an existing lock file / lock file out of sync | `package-lock.json` doesn't match `package.json` | On your computer run `npm install`, commit the updated `package-lock.json`, push |
| **Type check**, **Lint** or **Tests** | A code change broke something | Run `npm run check` locally, fix what it reports, push again |
| **Firestore security rules tests** (job "rules") | A rules test failed, or the emulator couldn't start | Run `npm run test:rules` locally (needs Java 21) and read which test failed |
| **Deploy to GitHub Pages**: "Get Pages site failed" / "Not Found" | Pages source isn't set to GitHub Actions | Step 7.1, then re-run |
| **Deploy**: "Branch is not allowed to deploy to github-pages" | Environment protection rule | Settings → Environments → github-pages → Deployment branches → allow `main` |

A failed run never takes the live site down — the previous version stays online.

### The website shows a 404 or blank page

- Use the full address including **`/rock/`**: https://krishsabadra9785-hub.github.io/rock/
- "Firebase isn't configured": the repository variables are missing or misspelled. Fix step 7.2 and re-run the workflow.
- After a new deployment, wait a minute and refresh. If an old version persists, close all ROCK tabs and reopen.

### Login problems

| Message | Fix |
|---|---|
| "Login ID or password is incorrect" | Check the Login ID (it becomes `<id>@rock.local`) and password |
| `auth/unauthorized-domain` | Add `krishsabadra9785-hub.github.io` to Authentication → Authorized domains (3.2) |
| "Your account isn't set up in ROCK yet" | Create the `users/<UID>` document (step 8) with `active` = `true` |
| "Too many attempts" | Wait a few minutes; Firebase temporarily blocks repeated failures |

### "You do not have permission to do this"

- The security rules weren't published, or your `users` document has the wrong role, or `active` isn't the boolean `true`.
- View-only and Operations roles can't record payments (by design).

### "The database needs an index"

Run `npm run deploy:rules`, or open the browser's developer console (F12) where Firebase prints a link that creates the missing index. Wait a few minutes for it to build.

### Receipt reading doesn't work

| Message | Fix |
|---|---|
| "not enabled for this Firebase project" | Complete step 3.4 (choose Gemini Developer API) |
| "blocked by App Check" | Check the reCAPTCHA keys (3.5); for localhost register the debug token |
| "usage limit reached" | Free quota exhausted; enter manually, try later, or pick a lighter model in Settings |
| "model was not found" | Change the model name in Settings → AI receipt reading |
| "API key is not allowed to call Firebase AI Logic" | Google Cloud console → APIs & Services → Credentials → your Browser key: if it has API restrictions, add **Firebase AI Logic API** |

**Settings → AI receipt reading** shows the real status. **Configured** means the Firebase settings and a model name are present. **Test AI connection** sends one tiny request to prove it works end to end. App Check is shown separately and is optional; leaving it off never disables AI.

You can always create orders manually.

### Figures on the dashboard look wrong

**Orders saved before the payment-agent change.** If any exist, run **Settings → Data → Upgrade old records** once, then **Rebuild statistics**. Both are safe to repeat.

**Settings → Data → Check figures** recalculates every total from the original orders and active payments and reports any difference without changing anything. **Rebuild statistics** then repairs dashboard summaries. Running *Check figures* once a month is a good habit.

## 15. Project structure

```
rock/
├─ .github/workflows/deploy.yml   GitHub Actions: test, build, publish to Pages
├─ docs/                          Architecture, database schema, security, test plan
├─ public/                        Icons and favicon (PWA)
├─ src/
│  ├─ domain/                     Pure business logic: money, calculations, rates,
│  │                              dates, validation, payments, statistics (fully tested)
│  ├─ services/                   Firebase access: auth, PIN, orders, payments, parties,
│  │                              AI receipt reading, receipt storage interface, reports
│  ├─ state/                      Session (login/PIN lock), master data, notifications
│  ├─ features/                   Screens: dashboard, create order, orders, parties,
│  │                              payment agent, payments, ledgers, reports, settings
│  ├─ components/                 Shared UI (tables, forms, dialogs, filters)
│  └─ styles/global.css           Design system
├─ tests/                         Automated tests (Vitest)
├─ firestore.rules                Database security rules
├─ firestore.indexes.json         Database indexes
├─ firebase.json / .firebaserc    Firebase CLI config (rules + indexes only)
├─ vite.config.ts                 Build config (base path /rock/, PWA)
└─ .env.example                   Template for local settings
```

## License

Copyright © the ROCK owner. All rights reserved. This repository is public for hosting convenience only; no permission is granted to use, copy or modify the code without the owner's written consent. See [LICENSE](LICENSE).
