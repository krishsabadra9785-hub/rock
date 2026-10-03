import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, type Firestore } from 'firebase/firestore';
import { env, missingFirebaseConfig } from '../config/env';

/**
 * Single place where Firebase is initialised.
 * ROCK V1 uses ONLY Spark-plan (no-cost) Firebase products:
 *   Authentication, Cloud Firestore, App Check (reCAPTCHA v3) and
 *   Firebase AI Logic with the Gemini Developer API free tier.
 * No Cloud Storage, Hosting or Functions.
 */

export const firebaseConfigured = missingFirebaseConfig().length === 0;

let app!: FirebaseApp;
let auth!: Auth;
let db!: Firestore;
let appCheck: AppCheck | null = null;

if (firebaseConfigured) {
  const { measurementId, ...rest } = env.firebase;
  app = initializeApp(measurementId ? { ...rest, measurementId } : rest);

  if (env.recaptchaV3SiteKey && !env.useEmulators) {
    if (env.isDev) {
      // Local development: prints a debug token in the browser console.
      // Register it in Firebase → App Check → Apps → Manage debug tokens.
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(env.recaptchaV3SiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }

  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });

  // Memory cache only: confidential business data is not written to the
  // device's disk by Firestore. (See docs/SECURITY.md → "Data on devices".)
  db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });

  if (env.useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export { app, auth, db, appCheck };
