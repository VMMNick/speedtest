/**
 * Живі тести проти задеплоєного сайту і СПРАВЖНЬОГО Cloudflare (без моків).
 *   LIVE_URL=https://<user>.github.io/speedtest/ npm run test:live
 */
import { defineConfig, devices } from '@playwright/test';

const LIVE_URL = process.env.LIVE_URL;
if (!LIVE_URL) throw new Error('Задайте LIVE_URL, напр. LIVE_URL=https://vmmnick.github.io/speedtest/');

export default defineConfig({
  testDir: './tests/live',
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]] : 'list',
  use: {
    baseURL: LIVE_URL.endsWith('/') ? LIVE_URL : LIVE_URL + '/',
    // Тексти в тесті — українською; без цього браузер CI (en-US) отримав би англійський інтерфейс
    locale: 'uk-UA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'live', use: { ...devices['Desktop Chrome'] } }],
});
