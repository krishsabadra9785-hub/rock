import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NoPermanentStorageProvider, receiptStorage } from '../src/services/receiptStorage';

/**
 * Guard-rail tests for the zero-cost (Spark plan + GitHub Pages) architecture.
 * They fail the build if a paid/forbidden dependency or a wrong base path sneaks in.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}
const sources = sourceFiles(join(root, 'src')).map((p) => ({ p, text: readFileSync(p, 'utf8') }));

describe('receipt storage (V1: no permanent storage)', () => {
  it('the active provider does not persist images', () => {
    expect(receiptStorage.persistsImages).toBe(false);
    expect(receiptStorage.id).toBe('NONE');
  });
  it('keeps only metadata, never content', async () => {
    const ref = await new NoPermanentStorageProvider().save({ name: 'slip.jpg', type: 'image/jpeg', size: 2048 });
    expect(ref).toEqual({ provider: 'NONE', ref: null, fileName: 'slip.jpg', contentType: 'image/jpeg', sizeBytes: 2048 });
    expect(await new NoPermanentStorageProvider().getViewUrl()).toBeNull();
  });
});

describe('no Blaze-only or forbidden Firebase products', () => {
  const forbidden = ['firebase/storage', 'firebase/functions', 'VertexAIBackend', 'firebase/vertexai'];
  for (const word of forbidden) {
    it(`source never imports ${word}`, () => {
      const offenders = sources.filter((s) => s.text.includes(word)).map((s) => s.p);
      expect(offenders).toEqual([]);
    });
  }
  it('AI uses the Gemini Developer API backend', () => {
    expect(read('src/services/ai.ts').includes('GoogleAIBackend')).toBe(true);
  });
  it('firebase.json has no hosting, storage or functions', () => {
    const cfg = JSON.parse(read('firebase.json')) as Record<string, unknown>;
    expect(cfg.hosting).toBeUndefined();
    expect(cfg.storage).toBeUndefined();
    expect(cfg.functions).toBeUndefined();
  });
  it('there is no storage.rules file', () => {
    expect(existsSync(join(root, 'storage.rules'))).toBe(false);
  });
});

describe('GitHub Pages hosting', () => {
  it('Vite base path is /rock/', () => {
    expect(/BASE_PATH = '\/rock\/'/.test(read('vite.config.ts'))).toBe(true);
    expect(read('vite.config.ts').includes('base: BASE_PATH')).toBe(true);
  });
  it('uses HashRouter so refreshes never 404', () => {
    const app = read('src/App.tsx');
    expect(app.includes('HashRouter')).toBe(true);
    expect(app.includes('BrowserRouter')).toBe(false);
  });
  it('index.html uses relative asset paths', () => {
    const html = read('index.html');
    expect(html.includes('href="/favicon')).toBe(false);
    expect(html.includes('href="favicon.svg"')).toBe(true);
  });
  it('deploy workflow uses the official Pages actions', () => {
    const wf = read('.github/workflows/deploy.yml');
    expect(wf.includes('actions/upload-pages-artifact')).toBe(true);
    expect(wf.includes('actions/deploy-pages')).toBe(true);
    expect(wf.includes('npm test')).toBe(true);
  });
});

describe('security hygiene', () => {
  it('rules never allow open access', () => {
    const rules = read('firestore.rules');
    expect(/allow\s+read\s*,\s*write\s*:\s*if\s+true/.test(rules)).toBe(false);
    expect(rules.includes('allow delete: if false')).toBe(true);
  });
  it('no private keys or service accounts in the source', () => {
    for (const s of sources) {
      expect(/-----BEGIN (RSA )?PRIVATE KEY-----/.test(s.text)).toBe(false);
      expect(s.text.includes('"type": "service_account"')).toBe(false);
    }
  });
  it('.env files are git-ignored', () => {
    const gi = read('.gitignore');
    expect(gi.includes('.env')).toBe(true);
    expect(gi.includes('!.env.example')).toBe(true);
  });
  it('no image data is written into order documents', () => {
    const orders = read('src/services/orders.ts');
    expect(/base64|dataURL|data:image/i.test(orders)).toBe(false);
  });
});
