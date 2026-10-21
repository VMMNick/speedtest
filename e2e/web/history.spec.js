import { readFile } from 'node:fs/promises';
import { test, expect, runFullTest } from './fixtures.js';

test('результати зберігаються, видаляються, експортуються й очищаються', async ({ app }) => {
  await runFullTest(app);
  await runFullTest(app);

  const dialog = app.getByRole('dialog', { name: 'Історія тестів' });
  const rows = dialog.locator('#history-body tr');

  await app.getByRole('button', { name: 'Історія тестів' }).click();
  await expect(rows).toHaveCount(2);
  await expect(dialog.locator('#history-stats')).toContainText('Тестів2');

  // Історія переживає перезавантаження (IndexedDB)
  await app.reload();
  await app.getByRole('button', { name: 'Історія тестів' }).click();
  await expect(rows).toHaveCount(2);

  // Експорт CSV
  const [download] = await Promise.all([
    app.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Експорт CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^speedtest-history-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  const lines = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\n');
  expect(lines).toHaveLength(3);
  expect(lines[0]).toContain('Download');

  // Видалення одного запису
  await rows.first().getByRole('button', { name: 'Видалити' }).click();
  await expect(rows).toHaveCount(1);

  // Очищення
  await dialog.getByRole('button', { name: 'Очистити історію' }).click();
  await dialog.getByRole('button', { name: /Точно очистити/ }).click(); // підтвердження
  await expect(rows).toHaveCount(0);
  await expect(dialog.locator('#history-empty')).toBeVisible();

  // Закриття
  await dialog.getByRole('button', { name: 'Закрити' }).click();
  await expect(dialog).toBeHidden();
});
