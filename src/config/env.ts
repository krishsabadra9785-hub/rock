/** Typed access to build-time environment variables (see .env.example). */

function str(name: string, fallback = ''): string {
  const v = (import.meta.env as Record<string, string | boolean | undefined>)[name];
  return typeof v === 'string' ? v.trim() : fallback;
}

function bool(name: string): boolean {
  return str(name).toLowerCase() === 'true';
}

export const env = {
  firebase: {
    apiKey: str('VITE_FIREBASE_API_KEY'),
    authDomain: str('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: str('VITE_FIREBASE_PROJECT_ID'),
    appId: str('VITE_FIREBASE_APP_ID'),
    messagingSenderId: str('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    measurementId: str('VITE_FIREBASE_MEASUREMENT_ID'),
  },
  loginEmailDomain: str('VITE_LOGIN_EMAIL_DOMAIN', 'rock.local') || 'rock.local',
  recaptchaV3SiteKey: str('VITE_RECAPTCHA_V3_SITE_KEY'),
  aiModel: str('VITE_AI_MODEL', 'gemini-2.5-flash') || 'gemini-2.5-flash',
  useEmulators: bool('VITE_USE_EMULATORS'),
  enableDemoTools: bool('VITE_ENABLE_DEMO_TOOLS'),
  isDev: import.meta.env.DEV,
};

/** Names of required variables that are missing, so the UI can show a setup screen. */
export function missingFirebaseConfig(): string[] {
  const required: [string, string][] = [
    ['VITE_FIREBASE_API_KEY', env.firebase.apiKey],
    ['VITE_FIREBASE_AUTH_DOMAIN', env.firebase.authDomain],
    ['VITE_FIREBASE_PROJECT_ID', env.firebase.projectId],
    ['VITE_FIREBASE_APP_ID', env.firebase.appId],
  ];
  return required.filter(([, v]) => !v).map(([k]) => k);
}
