import { test, expect } from '@playwright/test';
import { mockCloudflare, FAST_CONFIG } from '../e2e/fixtures.js';

test('хмарна збірка: міряє через Cloudflare, статистику зберігає на сервері', async ({ page, context, request }) => {
  await mockCloudflare(context);
  await context.addInitScript((cfg) => {
    // @ts-ignore
    window.__SPEEDTEST_CONFIG__ = cfg;
  }, FAST_CONFIG);

  // Сервер не роздає трафік вимірювань
  expect((await request.get('api/download?bytes=10')).status()).toBe(404);
  const before = (await (await request.get('api/results/stats')).json()).count;

  await page.goto('/');
  await expect(page.locator('#server-name')).toContainText('Cloudflare');
  await expect(page.getByRole('link', { name: 'Аналітика' })).toBeVisible();

  const saved = page.waitForResponse((r) => r.url().endsWith('/api/results') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Старт' }).click();
  await expect(page.locator('#summary')).toBeVisible({ timeout: 30_000 });
  const res = await saved;
  expect(res.status()).toBe(201);
  expect(JSON.parse(res.request().postData())).toMatchObject({ server: 'cloudflare', isp: 'Test ISP', country: 'UA' });

  expect((await (await request.get('api/results/stats')).json()).count).toBe(before + 1);
});
