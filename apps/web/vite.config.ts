import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Local dev: serve on the configured WEB_ORIGIN port and proxy API/auth
  // calls to the (Docker) API on :4000 so everything is same-origin
  // (cookies + auth work) while keeping Vite HMR.
  server: {
    port: 8080,
    host: true,
    proxy: {
      '/v1': { target: 'http://localhost:4000', changeOrigin: true },
      '/auth': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
