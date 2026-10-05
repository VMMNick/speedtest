/**
 * E2E хмарної збірки (як на Render): вимірювання через Cloudflare (тут — підмінений),
 * сервер без download/upload, лише статистика й аналітика.
 *   npm run test:e2e:cloud
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4181;

export default defineConfig({
  testDir: './tests/e2e-cloud',
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
    command: 'npm run build:cloud && node server/src/index.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      STATIC_DIR: 'dist',
      LOG_LEVEL: 'warn',
      SPEED_ENDPOINTS: 'false',
      TRUST_PROXY: 'true',
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
    },
  },
});
