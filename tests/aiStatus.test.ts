import { describe, expect, it } from 'vitest';
import { aiStatus } from '../src/config/aiStatus';

const production = {
  apiKey: 'AIzaPublicWebKeyForTestsOnly',
  projectId: 'rock-e6719',
  appId: '1:123:web:abc',
  model: 'gemini-2.5-flash',
  aiEnabledSetting: true,
  appCheckSiteKey: '',
};

describe('AI configuration status', () => {
  it('is CONFIGURED with Firebase web config + model and NO App Check', () => {
    const s = aiStatus(production);
    expect(s.state).toBe('CONFIGURED');
    expect(s.missing).toEqual([]);
    expect(s.model).toBe('gemini-2.5-flash');
    expect(s.appCheck).toBe('NOT_ENABLED');
  });
  it('a missing optional App Check key never makes AI "not configured"', () => {
    expect(aiStatus({ ...production, appCheckSiteKey: '' }).state).toBe('CONFIGURED');
    expect(aiStatus({ ...production, appCheckSiteKey: 'site-key' }).appCheck).toBe('ENABLED');
    expect(aiStatus({ ...production, appCheckSiteKey: 'site-key' }).state).toBe('CONFIGURED');
  });
  it('reports genuinely missing Firebase configuration', () => {
    const s = aiStatus({ ...production, apiKey: '', appId: ' ' });
    expect(s.state).toBe('NOT_CONFIGURED');
    expect(s.missing).toEqual(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID']);
  });
  it('reports a missing or invalid model name', () => {
    expect(aiStatus({ ...production, model: '' }).state).toBe('NOT_CONFIGURED');
    expect(aiStatus({ ...production, model: 'Gemini Flash!' }).state).toBe('NOT_CONFIGURED');
  });
  it('distinguishes "turned off in Settings" from "not configured"', () => {
    expect(aiStatus({ ...production, aiEnabledSetting: false }).state).toBe('DISABLED_IN_SETTINGS');
  });
  it('the deploy workflow passes VITE_AI_MODEL to the build and does not require an App Check key', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const wf = readFileSync(fileURLToPath(new URL('../.github/workflows/deploy.yml', import.meta.url)), 'utf8');
    expect(wf.includes('VITE_AI_MODEL: ${{ vars.VITE_AI_MODEL }}')).toBe(true);
    const required = wf.slice(wf.indexOf('for v in'), wf.indexOf('; do', wf.indexOf('for v in')));
    expect(required.includes('VITE_RECAPTCHA_V3_SITE_KEY')).toBe(false);
  });
});
