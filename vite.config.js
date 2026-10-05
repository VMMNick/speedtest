import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import csp from './config/vite-plugin-csp.js';
import serviceWorker from './config/vite-plugin-sw.js';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => ({
  // Для GitHub Pages сайт живе в підкаталозі (/speedtest/) — задається в CI через BASE_PATH
  base: process.env.BASE_PATH || '/',
  root: r('./src'),
  // .env.* лежать у корені репозиторію, а не в src/
  envDir: r('.'),
  plugins: [csp(), serviceWorker({ publicDir: r('./public') })],
  publicDir: r('./public'),
  build: {
    outDir: r('./dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Не вбудовувати шрифти як data: URI — CSP дозволяє font-src лише 'self'
    // Аналітика має сенс лише з бекендом (режими selfhosted і cloud) — на GitHub Pages її немає
    rollupOptions: {
      input:
        loadEnv(mode, r('.'), 'VITE_').VITE_RESULTS_API === 'true'
          ? { main: r('./src/index.html'), analytics: r('./src/analytics.html') }
          : { main: r('./src/index.html') },
    },
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined),
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
}));
