import { readFile } from 'node:fs/promises';
import { test, expect, runFullTest } from './fixtures.js';

const BOM = String.fromCharCode(0xfeff);

test.describe('англійська (браузер en-US)', () => {
  test.use({ locale: 'en-US' });

  test('мова визначається автоматично, без «сирих» ключів і кирилиці в контенті', async ({ app, errors }) => {
    await expect(app.locator('html')).toHaveAttribute('lang', 'en');
    await expect(app).toHaveTitle(/Speedcheck/);
    await expect(app.getByRole('button', { name: 'Go' })).toBeVisible();
    await expect(app.locator('[data-metric="download"] .metric__head')).toHaveText('Download');
    await expect(app.locator('#footer-text')).toContainText('Measured via Cloudflare');
    await expect(app.locator('#footer-text a')).toHaveAttribute('href', 'https://speed.cloudflare.com');

    await runFullTest(app);
    const text = await app.locator('main').innerText();
    // Ніде не лишилось ключів словника (напр. "metric.avg")
    expect(text).not.toMatch(/\b(metric|phase|unit|summary|plan|share|history|usecase|delta)\.\w+/);
    // Кирилиця допустима лише в назві кнопки мови
    expect(text.replace(/УК/g, '')).not.toMatch(/[А-Яа-яІіЇїЄєҐґ]/);
    await expect(app.locator('[data-metric="download"] [data-sub]')).toContainText(/^avg \d/);
    await expect(app.locator('#usecases li').first()).toHaveAttribute('aria-label', /: (good|not suitable)$/);
    expect(errors).toEqual([]);
  });

  test('CSV-експорт з англійськими заголовками', async ({ app }) => {
    await runFullTest(app);
    await app.getByRole('button', { name: 'Test history' }).click();
    const [dl] = await Promise.all([
      app.waitForEvent('download'),
      app.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    const csv = (await readFile(await dl.path(), 'utf8')).replace(BOM, '');
    expect(csv.split('\n')[0]).toBe(
      '"Date","Server","Ping, ms","Jitter, ms","Loss, %","Download, Mbps","Upload, Mbps","Stability"',
    );
  });
});

test('перемикач мови: на льоту перекладає показані результати і запам’ятовується', async ({ app }) => {
  await expect(app.locator('html')).toHaveAttribute('lang', 'uk');
  await runFullTest(app);
  await expect(app.locator('[data-metric="download"] [data-sub]')).toContainText(/^сер\./);

  await app.getByRole('button', { name: 'Мова: English' }).click();
  await expect(app.locator('html')).toHaveAttribute('lang', 'en');
  await expect(app.locator('[data-metric="download"] [data-sub]')).toContainText(/^avg /);
  await expect(app.locator('#gauge-phase')).toHaveText('Done');
  await expect(app.getByRole('button', { name: 'Again' })).toBeVisible();
  await expect(app.locator('.summary h2')).toHaveText('Summary');

  await app.reload();
  await expect(app.locator('html')).toHaveAttribute('lang', 'en');
  await app.getByRole('button', { name: 'Мова: українська' }).click();
  await expect(app.getByRole('button', { name: 'Старт' })).toBeVisible();
});
