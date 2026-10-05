import { readFile } from 'node:fs/promises';
import { test, expect, runFullTest } from './fixtures.js';

test('посилання на результат: копіюється і відкриває результат у банері', async ({ app, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await runFullTest(app);
  const download = await app.locator('[data-metric="download"] [data-value]').textContent();

  await app.getByRole('button', { name: 'Скопіювати посилання' }).click();
  await expect(app.locator('.toast')).toContainText('Посилання скопійовано');
  const link = await app.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#r=[A-Za-z0-9_-]+$/);

  // «Друг» відкриває посилання в чистому браузері
  const friend = await context.browser().newContext({ locale: 'uk-UA' });
  const page = await friend.newPage();
  await page.route(/speed\.cloudflare\.com|fonts\./, (r) => r.abort());
  await page.goto(link);
  await expect(page.locator('#shared-banner')).toBeVisible();
  await expect(page.locator('#shared-banner')).toContainText('Результат, яким з вами поділились');
  // Значення округлюються до 0.1 — для швидкостей ≥ 100 Мбіт/с (цілі числа) збіг точний
  const sharedDl = await page.locator('[data-metric="download"] [data-value]').textContent();
  expect(Math.abs(Number(sharedDl) - Number(download))).toBeLessThanOrEqual(0.1);
  await expect(page.locator('[data-metric="download"] [data-sub]')).toHaveText('з посилання');
  // IP та провайдер у посилання не потрапляють
  expect(Buffer.from(link.split('#r=')[1], 'base64url').toString()).not.toMatch(/203\.0\.113|Test ISP/);
  await friend.close();
});

test('після старту власного тесту банер ховається, hash прибирається', async ({ app, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await runFullTest(app);
  await app.getByRole('button', { name: 'Скопіювати посилання' }).click();
  const shared = await app.evaluate(() => navigator.clipboard.readText());
  await app.goto(shared);
  await app.reload(); // відкриття «з нуля», а не лише зміна hash
  await expect(app.locator('#shared-banner')).toBeVisible();
  await runFullTest(app);
  await expect(app.locator('#shared-banner')).toBeHidden();
  expect(await app.evaluate(() => location.hash)).toBe('');
});

test('пошкоджене посилання (вставлене у відкриту вкладку) → зрозуміла помилка', async ({ app }) => {
  await app.goto('./#r=@@@broken'); // лише зміна hash — спрацьовує hashchange
  await expect(app.locator('.toast--error')).toContainText('Посилання на результат пошкоджене');
  await expect(app.locator('#shared-banner')).toBeHidden();
});

test('картинка результату: PNG 1200×630', async ({ app }) => {
  await runFullTest(app);
  const [dl] = await Promise.all([
    app.waitForEvent('download'),
    app.getByRole('button', { name: 'Зберегти картинку' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^speedtest-.*\.png$/);
  const png = await readFile(await dl.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(1200); // IHDR width
  expect(png.readUInt32BE(20)).toBe(630); // IHDR height
});
