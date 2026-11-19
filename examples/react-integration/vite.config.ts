import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxies the example Django host (examples/django-integration) so the session cookie
// and the chat API share this origin.
const backend = process.env.HOST_BACKEND ?? 'http://127.0.0.1:4810';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4811,
    proxy: {
      '/api': backend,
      '/login': backend,
      '/logout': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
});
