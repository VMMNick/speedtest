import { test, expect } from './fixtures.js';

test('маніфест валідний, іконки доступні', async ({ app, request }) => {
  const href = await app.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(new URL(href, app.url()).toString())).json();
  expect(manifest).toMatchObject({ short_name: 'Спідтест', display: 'standalone', start_url: './' });
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, new URL(href, app.url())).toString());
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
});

test('service worker: застосунок відкривається без мережі', async ({ app, context }) => {
  // Чекаємо, поки SW встановиться (precache) і візьме сторінку під контроль
  await app.evaluate(() => navigator.serviceWorker.ready);
  await app.reload();
  await expect.poll(() => app.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await app.reload();
  await expect(app).toHaveTitle(/Спідтест/);
  await expect(app.getByRole('button', { name: 'Старт' })).toBeVisible();
  // Стилі й іконки теж із кешу
  const bg = await app.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  await context.setOffline(false);
});
