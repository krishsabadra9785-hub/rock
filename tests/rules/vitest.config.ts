import { defineConfig } from 'vitest/config';

/**
 * Own config for the Firestore security-rules tests.
 * Without this file Vitest walks up the folders and loads the ROOT
 * vite.config.ts, which imports app-only packages (React plugin, PWA plugin)
 * that are not installed for this test package → ERR_MODULE_NOT_FOUND.
 */
export default defineConfig({
  test: {
    root: '.',
    include: ['rules.test.ts'],
    environment: 'node',
    // One shared emulator database is cleared before each test: run serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
