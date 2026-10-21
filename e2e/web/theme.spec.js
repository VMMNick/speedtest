import { test, expect } from './fixtures.js';

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);

test.describe('тема', () => {
  test.use({ colorScheme: 'light' });

  test('за замовчуванням слідує за системою', async ({ app }) => {
    expect(await theme(app)).toBe('light');
  });

  test('перемикач змінює тему і запам’ятовує вибір', async ({ app }) => {
    await app.getByRole('button', { name: 'Змінити тему' }).click();
    expect(await theme(app)).toBe('dark');
    await app.reload();
    expect(await theme(app)).toBe('dark');
  });

  test('тема ставиться ДО виконання JS застосунку (без блимання)', async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem('speedtest:settings', JSON.stringify({ theme: 'dark' })));
    await context.route(/\/assets\/index-.*\.js$/, (r) => r.abort()); // app.js не виконується
    await page.goto('/');
    expect(await theme(page)).toBe('dark');
  });
});
