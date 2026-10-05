/**
 * Спільні фікстури E2E: підмінний Cloudflare, короткі фази тесту, збір помилок консолі.
 * Реальна мережа в тестах не використовується — результати детерміновані й швидкі.
 */
import { test as base, expect } from '@playwright/test';

/** Скорочена конфігурація: повний тест триває ~3 с замість ~22 с. */
export const FAST_CONFIG = {
  ping: { count: 8, timeoutMs: 1500, intervalMs: 10, warmup: 1 },
  download: { durationMs: 1200, streams: 2, initialBytes: 50_000, maxBytes: 2_000_000, targetRequestMs: 200 },
  upload: {
    durationMs: 1200,
    streams: 2,
    initialBytes: 50_000,
    maxBytes: 2_000_000,
    targetRequestMs: 200,
    graceMs: 1500,
  },
  loadedLatency: { intervalMs: 150, timeoutMs: 1500 },
  warmupMs: 300,
  liveWindowMs: 400,
};

export const META = {
  clientIp: '203.0.113.7',
  asOrganization: 'Test ISP',
  city: 'Kyiv',
  colo: 'KBP',
  country: 'UA',
};

const CORS = { 'access-control-allow-origin': '*', 'timing-allow-origin': '*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @typedef {object} MockOptions
 * @property {number} [latencyMs]        затримка відповіді на пінг
 * @property {'ok' | 'down'} [ping]      'down' — сервер недоступний
 * @property {number} [downloadStatus]   HTTP-статус для /__down (напр. 429)
 * @property {number} [bytesPerMs]       «пропускна здатність» підмінного сервера
 */

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {MockOptions} [opts]
 */
export async function mockCloudflare(context, opts = {}) {
  const { latencyMs = 12, ping = 'ok', downloadStatus = 200, bytesPerMs = 20_000 } = opts;
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await context.route('https://speed.cloudflare.com/**', async (route) => {
    const url = new URL(route.request().url());
    const bytes = Number(url.searchParams.get('bytes') || 0);

    if (url.pathname === '/meta') return route.fulfill({ headers: CORS, json: META });

    if (url.pathname === '/__down' && bytes === 0) {
      if (ping === 'down') return route.abort('connectionrefused');
      await sleep(latencyMs);
      return route.fulfill({ headers: CORS, body: '' });
    }
    if (url.pathname === '/__down') {
      if (downloadStatus !== 200) return route.fulfill({ status: downloadStatus, headers: CORS, body: 'error' });
      await sleep(latencyMs + bytes / bytesPerMs);
      return route.fulfill({ headers: CORS, body: Buffer.alloc(bytes) });
    }
    if (url.pathname === '/__up') {
      const size = route.request().postDataBuffer()?.length ?? 0;
      await sleep(latencyMs + size / bytesPerMs);
      return route.fulfill({ headers: CORS, body: 'ok' });
    }
    return route.fulfill({ status: 404, headers: CORS });
  });
}

/**
 * test з фікстурами:
 *   mock      — опції підмінного сервера (перевизначаються через test.use({ mock: {...} }))
 *   app       — сторінка з відкритим застосунком і короткою конфігурацією
 *   errors    — масив помилок консолі / необроблених винятків
 */
export const test = base.extend({
  mock: [{}, { option: true }],

  errors: async ({ page }, use) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      // Шрифти навмисно заблоковані — це не помилка застосунку
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await use(errors);
  },

  app: async ({ page, context, mock, errors }, use) => {
    void errors; // підключаємо слухачі до завантаження сторінки
    await mockCloudflare(context, mock);
    // Збираємо порушення CSP (CSP є лише в продакшн-збірці, яку й тестуємо)
    await page.addInitScript(() => {
      // @ts-ignore
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        // @ts-ignore
        window.__cspViolations.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`),
      );
    });
    await page.addInitScript((cfg) => {
      // @ts-ignore — тестовий гачок, див. app.js
      window.__SPEEDTEST_CONFIG__ = cfg;
    }, FAST_CONFIG);
    await page.goto('/');
    await use(page);
  },
});

/**
 * Запускає тест і чекає підсумку.
 * @param {import('@playwright/test').Page} page
 */
export async function runFullTest(page) {
  await page.getByRole('button', { name: /старт|ще раз/i }).click();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 30_000 });
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export const cspViolations = (page) => page.evaluate(() => /** @type {any} */ (window).__cspViolations ?? []);

export { expect };
