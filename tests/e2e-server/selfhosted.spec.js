import { test, expect } from '@playwright/test';

// Короткі фази, щоб тест тривав секунди
const FAST = {
  ping: { count: 6, intervalMs: 10 },
  download: { durationMs: 1500, streams: 2 },
  upload: { durationMs: 1500, streams: 2, graceMs: 2000 },
  warmupMs: 300,
  liveWindowMs: 400,
};

test.beforeEach(async ({ context }) => {
  // Повністю локально: Cloudflare недоступний → ServerSelector обирає власний сервер
  await context.route(/speed\.cloudflare\.com/, (r) => r.abort());
  await context.addInitScript((cfg) => {
    // @ts-ignore
    window.__SPEEDTEST_CONFIG__ = cfg;
  }, FAST);
});

test('повний тест через власний сервер + анонімна статистика', async ({ page, request }) => {
  const before = (await (await request.get('api/results/stats')).json()).count;

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      // @ts-ignore
      (window.__csp ??= []).push(e.violatedDirective),
    ),
  );

  await page.goto('/');
  await expect(page.locator('#server-name')).toContainText('Власний сервер');
  await expect(page.locator('#server-ip')).not.toHaveText('—'); // /api/meta віддав IP
  await expect(page.locator('#stats-optin')).toBeVisible(); // згода видима лише в self-hosted збірці
  await expect(page.locator('#stats-consent')).toBeChecked();

  // Запит на збереження результату
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/results') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 30_000 });
  expect((await saved).status()).toBe(201);

  for (const m of ['download', 'upload', 'ping']) {
    await expect(page.locator(`[data-metric="${m}"] [data-value]`)).toHaveText(/^\d/);
  }
  const after = await (await request.get('api/results/stats')).json();
  expect(after.count).toBe(before + 1);
  expect(after.avgDownload).toBeGreaterThan(0);

  // Згоду можна зняти — наступний результат не надсилається
  await page.locator('#stats-consent').uncheck();
  let posted = false;
  page.on('request', (r) => r.url().endsWith('/api/results') && (posted = true));
  await page.getByRole('button', { name: 'Ще раз' }).click();
  await expect(page.locator('#gauge')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
  await page.waitForTimeout(500);
  expect(posted).toBe(false);

  expect(await page.evaluate(() => /** @type {any} */ (window).__csp ?? [])).toEqual([]);
  expect(errors).toEqual([]);
});

test('сервер віддає безпечні заголовки й правильний кеш', async ({ request }) => {
  const html = await request.get('/');
  expect(html.headers()['cache-control']).toBe('no-cache');
  expect(html.headers()['x-content-type-options']).toBe('nosniff');
  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toBe('no-cache');
  const body = await html.text();
  const asset = body.match(/assets\/index-[\w-]+\.js/)[0];
  expect((await request.get(asset)).headers()['cache-control']).toContain('immutable');
  expect((await request.get('api/health')).status()).toBe(200);
});
