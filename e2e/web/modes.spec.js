import { test, expect, runFullTest } from './fixtures.js';

test.describe('економний режим', () => {
  test('вмикається при Save-Data: показує позначку, тест працює', async ({ page, app }) => {
    void page;
    // За замовчуванням (без Save-Data) позначки немає
    await expect(app.locator('#mode-note')).toBeHidden();

    await app.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true, effectiveType: '4g', addEventListener() {} },
      });
    });
    await app.reload();
    await expect(app.locator('#mode-note')).toBeVisible();
    await expect(app.locator('#mode-note')).toContainText('Економний режим');
    await runFullTest(app);
  });
});

test('картки download/upload показують середню та підказку про P90', async ({ app }) => {
  await runFullTest(app);
  const sub = app.locator('[data-metric="download"] [data-sub]');
  await expect(sub).toContainText(/^сер\. \d/);
  await expect(sub).toHaveAttribute('title', /90-й перцентиль/);
});
