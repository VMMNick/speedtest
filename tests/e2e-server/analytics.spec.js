import { test, expect } from '@playwright/test';

const base = { server: 'cloudflare', upload: 40, jitter: 2, loss: 0, grade: 'B', score: 80, country: 'UA' };
// Унікальні назви, щоб не залежати від даних інших тестів у тій самій БД
const run = Date.now().toString(36);
const FAST = `Fast-${run}`;
const SLOW = `Slow-${run}`;
const TINY = `Tiny-${run}`;
const CITY = `Town-${run}`;

test.beforeAll(async ({ request }) => {
  const rows = [
    ...[300, 350, 400].map((download) => ({ ...base, isp: FAST, city: CITY, download, ping: 9 })),
    ...[30, 40, 50].map((download) => ({ ...base, isp: SLOW, city: CITY, download, ping: 35 })),
    ...[999, 999].map((download) => ({ ...base, isp: TINY, city: CITY, download, ping: 3 })), // < 3 тестів — прихований
  ];
  for (const data of rows) {
    const res = await request.post('api/results', { data });
    expect(res.status()).toBe(201);
  }
});

test('аналітика: рейтинг, фільтр за містом, теплова карта, k-анонімність', async ({ page }) => {
  await page.route(/speed\.cloudflare\.com/, (r) => r.abort());
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Посилання на аналітику є на головній (self-hosted збірка)
  await page.goto('/');
  await page.getByRole('link', { name: 'Аналітика' }).click();
  await expect(page).toHaveURL(/analytics\.html$/);
  await expect(page.getByRole('heading', { name: 'Аналітика', level: 1 })).toBeVisible();

  // Фільтр за містом із засіяних даних
  await page.getByLabel('Місто').selectOption(CITY);
  const rows = page.locator('#providers-body tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.isp')).toHaveText(FAST);
  await expect(rows.nth(1).locator('.isp')).toHaveText(SLOW);
  await expect(page.locator('#providers-body')).not.toContainText(TINY); // < 3 тестів
  await expect(rows.nth(0).locator('.bar__label')).toHaveText('350 Мбіт/с');

  // Теплова карта: 7 × 24 клітинок, заповнені лише ті, де є дані
  await expect(page.locator('.heatmap__cell')).toHaveCount(7 * 24);
  await expect(page.locator('.heatmap__cell[data-tip]')).toHaveCount(1); // усі тести — «зараз»
  await expect(page.locator('#heatmap-insight')).toContainText('Найшвидше');
  await expect(page.locator('#heatmap')).toHaveAttribute('aria-label', /Найшвидше/);

  // Підказка при наведенні
  await page.locator('.heatmap__cell[data-tip]').hover();
  await expect(page.locator('#tooltip')).toBeVisible();
  await expect(page.locator('#tooltip')).toContainText('тестів: 8');

  // Фільтр теплової карти за провайдером
  await page.locator('#f-isp').selectOption(SLOW);
  await expect(page.locator('#tooltip')).toBeHidden();
  await page.locator('.heatmap__cell[data-tip]').hover();
  await expect(page.locator('#tooltip')).toContainText('тестів: 3');

  // Перемикання мови на сторінці аналітики
  await page.getByRole('button', { name: 'Мова: English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Analytics');
  await expect(rows.nth(0).locator('.bar__label')).toHaveText('350 Mbps');

  expect(errors).toEqual([]);
});

test('API аналітики кешується (X-Cache) і валідує параметри', async ({ request }) => {
  const a = await request.get('api/analytics/providers?days=7');
  expect(a.status()).toBe(200);
  expect(['HIT', 'MISS']).toContain(a.headers()['x-cache']);
  expect((await request.get('api/analytics/heatmap?tz=Not/AZone')).status()).toBe(400);
});

test('мобільна ширина: без горизонтальної прокрутки сторінки', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route(/speed\.cloudflare\.com/, (r) => r.abort());
  await page.goto('/analytics.html');
  await expect(page.locator('.heatmap__cell')).toHaveCount(7 * 24);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
