/**
 * Receipt-AI configuration status (pure; unit-tested in tests/aiStatus.test.ts).
 *
 * AI receipt reading needs ONLY:
 *   - the Firebase web config (API key, project ID, app ID) — Firebase AI Logic
 *     routes Gemini Developer API calls through the Firebase project; and
 *   - a model name (VITE_AI_MODEL or Settings → AI).
 *
 * App Check is OPTIONAL. It is reported separately and never disables AI.
 */

export type AiState = 'CONFIGURED' | 'DISABLED_IN_SETTINGS' | 'NOT_CONFIGURED';

export interface AiStatusInput {
  apiKey: string;
  projectId: string;
  appId: string;
  model: string;
  aiEnabledSetting: boolean;
  appCheckSiteKey: string;
}

export interface AiStatus {
  state: AiState;
  /** Missing/invalid configuration that prevents AI (empty when configured). */
  missing: string[];
  model: string;
  appCheck: 'ENABLED' | 'NOT_ENABLED';
}

export const MODEL_NAME_RE = /^[a-z0-9.-]{3,60}$/;

export function aiStatus(input: AiStatusInput): AiStatus {
  const missing: string[] = [];
  if (!input.apiKey.trim()) missing.push('VITE_FIREBASE_API_KEY');
  if (!input.projectId.trim()) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!input.appId.trim()) missing.push('VITE_FIREBASE_APP_ID');
  const model = input.model.trim();
  if (!MODEL_NAME_RE.test(model)) missing.push('AI model name (VITE_AI_MODEL or Settings → AI)');
  const appCheck = input.appCheckSiteKey.trim() ? 'ENABLED' : 'NOT_ENABLED';
  const state: AiState = missing.length > 0 ? 'NOT_CONFIGURED' : input.aiEnabledSetting ? 'CONFIGURED' : 'DISABLED_IN_SETTINGS';
  return { state, missing, model, appCheck };
}
