import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import csp from './config/vite-plugin-csp.js';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Для GitHub Pages сайт живе в підкаталозі (/speedtest/) — задається в CI через BASE_PATH
  base: process.env.BASE_PATH || '/',
  root: r('./src'),
  plugins: [csp()],
  publicDir: r('./public'),
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5173,
    open: true,
  },
  test: {
    root: r('.'),
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
