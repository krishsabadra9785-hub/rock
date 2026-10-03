import { defineConfig } from 'vitest/config';

/**
 * Dedicated config for Firestore security-rules tests.
 * Prevents Vitest from loading the root Vite config.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['rules.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
