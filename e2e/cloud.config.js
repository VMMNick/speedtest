/**
 * E2E хмарної збірки (як на Render): вимірювання через Cloudflare (тут — підмінений),
 * сервер без download/upload, лише статистика й аналітика.
 *   npm run test:e2e:cloud
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4181;

export default defineConfig({
  testDir: './cloud',
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'uk-UA',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'cloud', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    cwd: '..',
    command: 'npm run build:cloud && npm run server',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      // Абсолютний шлях: сервер запускається з теки свого воркспейсу (apps/server)
      STATIC_DIR: fileURLToPath(new URL('../apps/web/dist', import.meta.url)),
      LOG_LEVEL: 'warn',
      // Тест у браузері з короткими фазами триває ~3 с — мінімальний вік токена 1 с (у продакшні 5 с)
      RESULTS_TOKEN_MIN_AGE_MS: '1000',
      SPEED_ENDPOINTS: 'false',
      // У CI цей прогін іде одразу після e2e-server з тим самим Redis: лічильник rate limit для
      // 127.0.0.1 спільний, і продакшн-ліміт (10/хв) вичерпують засіяні там результати
      RATE_RESULTS_PER_MIN: '1000',
      TRUST_PROXY: 'true',
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
    },
  },
});
