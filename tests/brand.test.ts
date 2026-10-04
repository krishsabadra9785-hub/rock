import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APP_FILE_PREFIX, APP_NAME, LEGACY_DEFAULT_BUSINESS_NAME } from '../src/config/brand';
import { DEFAULT_SETTINGS } from '../src/domain/types';
import { formatOrderNumber, sanitizePrefix } from '../src/domain/orderNumber';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

describe('visible brand: Sabadra Minerals', () => {
  it('app name, page title, PWA manifest and home-screen title', () => {
    expect(APP_NAME).toBe('Sabadra Minerals');
    expect(DEFAULT_SETTINGS.businessName).toBe('Sabadra Minerals');
    const html = read('index.html');
    expect(html.includes('<title>Sabadra Minerals</title>')).toBe(true);
    expect(html.includes('apple-mobile-web-app-title" content="Sabadra Minerals"')).toBe(true);
    const vite = read('vite.config.ts');
    expect(vite.includes("name: 'Sabadra Minerals'")).toBe(true);
    expect(vite.includes("short_name: 'Sabadra Minerals'")).toBe(true);
  });
  it('no user-facing "ROCK" text left in screens', () => {
    for (const f of ['src/layout/AppShell.tsx', 'src/features/auth/AuthLayout.tsx', 'src/features/auth/LoginPage.tsx', 'src/features/auth/LockScreen.tsx', 'src/features/auth/SetPinPage.tsx', 'src/features/auth/StatusScreens.tsx', 'src/components/UpdatePrompt.tsx', 'src/App.tsx', 'index.html']) {
      expect(/\bROCK\b(?!-)/.test(read(f))).toBe(false);
    }
  });
  it('exported files use the new name', () => {
    expect(APP_FILE_PREFIX).toBe('sabadra-minerals');
    for (const f of ['src/features/ledger/LedgerPage.tsx', 'src/features/payments/PaymentsPage.tsx', 'src/features/reports/ReportsPage.tsx', 'src/features/settings/SettingsPage.tsx']) {
      expect(read(f).includes('`rock-')).toBe(false);
    }
  });
});

describe('technical identifiers intentionally retained', () => {
  it('GitHub Pages path /rock/ and PWA scope', () => {
    const vite = read('vite.config.ts');
    expect(vite.includes("export const BASE_PATH = '/rock/';")).toBe(true);
    expect(vite.includes('start_url: BASE_PATH')).toBe(true);
    expect(vite.includes('scope: BASE_PATH')).toBe(true);
  });
  it('Firebase project rock-e6719', () => {
    expect(read('.firebaserc').includes('"default": "rock-e6719"')).toBe(true);
    expect(read('.env.example').includes('VITE_FIREBASE_PROJECT_ID=rock-e6719')).toBe(true);
  });
  it('login email domain rock.local (existing users sign in with it)', () => {
    expect(read('src/config/env.ts').includes("'rock.local'")).toBe(true);
    expect(read('.env.example').includes('VITE_LOGIN_EMAIL_DOMAIN=rock.local')).toBe(true);
  });
  it('order numbers keep the ROCK-YYYY-###### format', () => {
    expect(DEFAULT_SETTINGS.orderPrefix).toBe('ROCK');
    expect(sanitizePrefix('')).toBe('ROCK');
    expect(formatOrderNumber(DEFAULT_SETTINGS.orderPrefix, 2026, 4)).toBe('ROCK-2026-000004');
  });
  it('PIN-attempt storage key and the legacy stored business name are unchanged', () => {
    expect(read('src/services/pin.ts').includes('`rock.pinAttempts.${uid}`')).toBe(true);
    expect(LEGACY_DEFAULT_BUSINESS_NAME).toBe('ROCK');
  });
  it('Firestore collections are unchanged', () => {
    const fs = read('src/services/firestore.ts');
    for (const c of ["orders: 'orders'", "payments: 'payments'", "parties: 'parties'", "rollups: 'rollups'", "counters: 'counters'", "users: 'users'"]) {
      expect(fs.includes(c)).toBe(true);
    }
  });
});
