import { cpSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';

/**
 * Serves the Twemoji SVG set from /emoji/ (copied from node_modules, not committed), so
 * emoji look the same on every device instead of depending on installed fonts.
 */
function emojiAssets(): Plugin {
  return {
    name: 'talkio-emoji-assets',
    // `config` runs before Vite indexes public/ (buildStart would be too late for the dev server).
    config() {
      const source = dirname(createRequire(import.meta.url).resolve('@twemoji/svg/package.json'));
      const target = resolve(__dirname, 'public/emoji');
      const wanted = readdirSync(source).filter((f) => f.endsWith('.svg')).length;
      if (existsSync(target) && readdirSync(target).length >= wanted) return;
      cpSync(source, target, { recursive: true, filter: (f) => !f.endsWith('.json') && !f.endsWith('.md') });
    },
  };
}

// The dev server proxies the Django backend so the browser sees one origin
// (session cookies + CSRF work without CORS). Ports follow the shared-env rules.
const backend = process.env.TALKIO_API_TARGET ?? 'http://127.0.0.1:4800';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [emojiAssets(), react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT ?? 4801),
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: false },
      '/media': { target: backend, changeOrigin: false },
      '/social-auth': { target: backend, changeOrigin: false },
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: Number(process.env.WEB_PORT ?? 4801) },
  build: { sourcemap: true, chunkSizeWarningLimit: 700 },
});
