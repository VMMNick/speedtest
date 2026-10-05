import { test, expect, runFullTest } from './fixtures.js';

test('тариф: частка від заявленої швидкості, значення запам’ятовується', async ({ app }) => {
  await runFullTest(app);
  const input = app.getByLabel('Тариф провайдера');
  await expect(app.locator('#plan-result')).toBeHidden();

  await input.fill('100000'); // недосяжний тариф → «значно нижче»
  await expect(app.locator('#plan-result')).toBeVisible();
  await expect(app.locator('#plan-result')).toHaveAttribute('data-level', 'bad');
  await expect(app.locator('#plan-text')).toContainText('від тарифу');

  await input.fill('1'); // будь-яка швидкість перевищує → good
  await expect(app.locator('#plan-result')).toHaveAttribute('data-level', 'good');

  await app.reload();
  await expect(app.getByLabel('Тариф провайдера')).toHaveValue('1');
});

test('Enter у полі тарифу не запускає тест', async ({ app }) => {
  await runFullTest(app);
  await app.getByLabel('Тариф провайдера').press('Enter');
  await expect(app.locator('body')).not.toHaveClass(/is-running/);
});

test('після другого тесту — порівняння з попереднім на картках', async ({ app }) => {
  await runFullTest(app);
  await expect(app.locator('[data-metric="download"] [data-delta]')).toBeHidden();
  await runFullTest(app);
  for (const m of ['download', 'upload', 'ping', 'jitter']) {
    const badge = app.locator(`[data-metric="${m}"] [data-delta]`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-trend', /better|worse|same/);
    await expect(badge).toHaveText(/^(↑|↓) \d+%$|^≈ без змін$/);
  }
});

test('спарклайн пінгу малюється під час тесту', async ({ app }) => {
  await runFullTest(app);
  const points = await app.locator('[data-metric="ping"] [data-spark] polyline').getAttribute('points');
  expect(points.split(' ').length).toBeGreaterThanOrEqual(5);
});

test('історія: фільтр за періодом і очищення з підтвердженням', async ({ app }) => {
  await runFullTest(app);
  // Підкидаємо «старий» запис 40-денної давнини прямо в IndexedDB
  await app.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('speedtest-db', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('history', 'readwrite');
          tx.objectStore('history').add({
            timestamp: Date.now() - 40 * 24 * 3600_000,
            server: { name: 'Old' },
            ping: { median: 30, jitter: 3 },
            download: { mbps: 50 },
            upload: { mbps: 10 },
            stability: { score: 70, grade: 'C' },
          });
          tx.oncomplete = resolve;
          tx.onerror = reject;
        };
      }),
  );

  await app.getByRole('button', { name: 'Історія тестів' }).click();
  const rows = app.locator('#history-body tr');
  await expect(rows).toHaveCount(2);
  await app.getByLabel('Період').selectOption('7d');
  await expect(rows).toHaveCount(1);
  await app.getByLabel('Період').selectOption('24h');
  await expect(rows).toHaveCount(1);
  await app.getByLabel('Період').selectOption('all');
  await expect(rows).toHaveCount(2);

  // Перший клік лише просить підтвердження
  const clear = app.locator('#btn-clear');
  await clear.click();
  await expect(clear).toHaveText(/Точно очистити/);
  await expect(rows).toHaveCount(2);
  await clear.click();
  await expect(rows).toHaveCount(0);
  await expect(clear).toHaveText('Очистити історію');
});
