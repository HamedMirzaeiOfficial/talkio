import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: (() => { const target = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'; return { port: 5173, proxy: { '/api': target, '/ws': { target: target.replace(/^http/, 'ws'), ws: true } } }; })(),
});
