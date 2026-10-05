/**
 * E2E проти власного бекенду: фронтенд збирається в режимі selfhosted і роздається
 * Fastify-сервером разом з API. Cloudflare у тестах заблоковано — усе локально.
 *
 *   npm run test:e2e:server
 *   (опційно DATABASE_URL / REDIS_URL — тоді з PostgreSQL і Redis)
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4180;

export default defineConfig({
  testDir: './tests/e2e-server',
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'uk-UA',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'selfhosted', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:self && node server/src/index.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      STATIC_DIR: 'dist',
      LOG_LEVEL: 'warn',
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      ...(process.env.REDIS_URL ? { REDIS_URL: process.env.REDIS_URL } : {}),
    },
  },
});
