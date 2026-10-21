import { test, expect } from '@playwright/test';
import { mockCloudflare, FAST_CONFIG } from '../web/fixtures.js';

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

  expect(res.request().headers()['x-result-token']).toMatch(/^\d+\./); // токен узято на старті тесту

  expect((await (await request.get('api/results/stats')).json()).count).toBe(before + 1);

  // Результат «у обхід» тесту — без токена — сервер не приймає
  const forged = await request.post('api/results', {
    data: { server: 'cloudflare', download: 9999, upload: 9999, ping: 1, jitter: 0, loss: 0, grade: 'A', score: 100 },
  });
  expect(forged.status()).toBe(403);
  expect((await (await request.get('api/results/stats')).json()).count).toBe(before + 1);
});
