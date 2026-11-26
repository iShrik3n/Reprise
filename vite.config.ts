import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Optional: REPRISE_API=http://<host> npm run dev  proxies /api to a deployed Reprise API,
  // so the YouTube option works in development too.
  const api = loadEnv(mode, '.', 'REPRISE_').REPRISE_API;
  return {
    build: {
      target: 'es2022',
    },
    worker: {
      format: 'es',
    },
    server: api ? { proxy: { '/api': { target: api, changeOrigin: true } } } : undefined,
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
