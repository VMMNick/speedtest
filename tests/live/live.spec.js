/**
 * Smoke-тест продакшн-сайту зі справжнім speed.cloudflare.com.
 * Перевіряє те, що неможливо перевірити з моками: CORS реального API,
 * base path на GitHub Pages, CSP у бойових умовах.
 */
import { test, expect } from '@playwright/test';

// Коротші фази, щоб не навантажувати Cloudflare з CI і не впертися в rate limit
const LIVE_CONFIG = {
  download: { durationMs: 4000 },
  upload: { durationMs: 4000, maxBytes: 5_000_000 },
  ping: { count: 10 },
};

test('сайт працює зі справжнім Cloudflare', async ({ page, baseURL }) => {
  /** @type {string[]} */
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('response', (r) => {
    if (r.url().startsWith(baseURL) && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    // Обірвані запити при дедлайні download — норма
    if (!/__down|__up/.test(r.url())) problems.push(`failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  await page.addInitScript((cfg) => {
    // @ts-ignore
    window.__SPEEDTEST_CONFIG__ = cfg;
    // @ts-ignore
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      // @ts-ignore
      window.__cspViolations.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'}`),
    );
  }, LIVE_CONFIG);

  await page.goto('./');

  // 1. /meta доступний через CORS → відомі провайдер і IP
  await expect(page.locator('#server-name')).toContainText('Cloudflare');
  await expect(page.locator('#server-name')).not.toContainText('Визначаю');
  await expect(page.locator('#server-ip')).not.toHaveText('—');

  // 2. Іконки підвантажились з правильним base path
  const iconOk = await page.evaluate(async () => {
    const url = getComputedStyle(document.querySelector('.icon--pin')).getPropertyValue('--icon');
    const href = url.match(/url\("?([^")]+)"?\)/)?.[1];
    return href ? (await fetch(new URL(href, document.baseURI))).ok : false;
  });
  expect(iconOk).toBe(true);

  // 3. Повний тест: ping (GET), download (GET-стрім), upload (POST text/plain — без preflight)
  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 60_000 });

  const value = async (m) => Number(await page.locator(`[data-metric="${m}"] [data-value]`).textContent());
  expect(await value('ping')).toBeGreaterThan(0);
  expect(await value('download')).toBeGreaterThan(0.1);
  expect(await value('upload')).toBeGreaterThan(0.1);

  // 4. Результат зберігся в IndexedDB
  await page.getByRole('button', { name: 'Історія тестів' }).click();
  await expect(page.locator('#history-body tr')).toHaveCount(1);

  // 5. Жодних помилок і порушень CSP
  expect(await page.evaluate(() => /** @type {any} */ (window).__cspViolations)).toEqual([]);
  expect(problems).toEqual([]);

  test.info().annotations.push({
    type: 'result',
    description: `ping ${await value('ping')} ms · ↓ ${await value('download')} Mbps · ↑ ${await value('upload')} Mbps`,
  });
});
