import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Production is served by GitHub Pages at
 *   https://krishsabadra9785-hub.github.io/rock/
 * so every asset, the manifest and the service worker live under /rock/.
 * `npm run dev` also uses /rock/ so local behaviour matches production.
 */
export const BASE_PATH = '/rock/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: BASE_PATH,
        name: 'ROCK',
        short_name: 'ROCK',
        description: 'Orders, ledgers and payments for your trading business.',
        theme_color: '#1D2A2F',
        background_color: '#F3F5F4',
        display: 'standalone',
        orientation: 'any',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell (code, styles, icons) is cached. Business data from
        // Firestore and receipt images are NEVER cached by the service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${BASE_PATH}index.html`,
        navigateFallbackAllowlist: [/^\/rock\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/app-check'],
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/rules/**', 'node_modules/**'],
    environment: 'node',
  },
});
