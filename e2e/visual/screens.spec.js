/**
 * Ключові екрани у світлій і темній темах, на десктопі й мобільному.
 * Дані детерміновані: Cloudflare підмінений, результат відкривається з посилання (#r=…),
 * час і часовий пояс зафіксовані.
 */
import { test, expect, mockCloudflare } from '../web/fixtures.js';

/** Результат «як у посиланні», без вимірювання — завжди однакові цифри */
const SHARED = {
  v: 1,
  t: Date.UTC(2026, 9, 5, 18, 30), // 5 жовтня 2026, 21:30 за Києвом
  d: 487.3,
  u: 94.6,
  p: 11.8,
  j: 1.4,
  l: 0,
  s: 92,
  g: 'A',
  n: 'Kyiv (KBP)',
};
const SHARED_HASH = `#r=${Buffer.from(JSON.stringify(SHARED)).toString('base64url')}`;

/**
 * Відкриває сторінку з підмінним Cloudflare й чекає, поки шрифти завантажаться,
 * а панель сервера заповниться (інакше скріншот ловить проміжний стан).
 * @param {import('@playwright/test').Page} page
 * @param {string} url
 */
async function open(page, url) {
  await mockCloudflare(page.context());
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  if (!url.includes('privacy')) await expect(page.locator('#server-name')).not.toHaveText('Визначаю…');
}

/** Пінг до підмінного сервера в панелі сервера трохи відрізняється між запусками — маскуємо */
const masks = (page) => [page.locator('#server-name')];

for (const scheme of /** @type {const} */ (['light', 'dark'])) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test(`головна до тесту — ${scheme} @mobile`, async ({ page }) => {
      await open(page, '/');
      await expect(page).toHaveScreenshot(`home-${scheme}.png`, { fullPage: true, mask: masks(page) });
    });

    test(`результат із посилання — ${scheme} @mobile`, async ({ page }) => {
      await open(page, `/${SHARED_HASH}`);
      await expect(page.locator('#shared-banner')).toBeVisible();
      await expect(page).toHaveScreenshot(`result-${scheme}.png`, { fullPage: true, mask: masks(page) });
    });

    test(`сторінка конфіденційності — ${scheme}`, async ({ page }) => {
      await open(page, '/privacy.html');
      await expect(page).toHaveScreenshot(`privacy-${scheme}.png`, { fullPage: true });
    });
  });
}

test.describe('англійська', () => {
  test.use({ locale: 'en-US', colorScheme: 'light' });

  test('результат із посилання — en', async ({ page }) => {
    await mockCloudflare(page.context());
    await page.goto(`/${SHARED_HASH}`);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#shared-banner')).toBeVisible();
    await expect(page).toHaveScreenshot('result-en.png', { fullPage: true, mask: masks(page) });
  });
});

test.describe('помилка', () => {
  test.use({ colorScheme: 'light' });

  test('сервер недоступний', async ({ page }) => {
    await mockCloudflare(page.context(), { ping: 'down' });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: /^старт$/i }).click();
    await expect(page.getByRole('button', { name: /^ще раз$/i })).toBeVisible({ timeout: 15_000 });
    // Те саме повідомлення не дублюється (при завантаженні й після «Старт»)
    await expect(page.locator('.toast--error')).toHaveCount(1);
    await expect(page.locator('main')).toHaveScreenshot('error-unreachable.png', { mask: masks(page) });
  });
});
