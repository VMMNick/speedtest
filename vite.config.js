import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./src'),
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
