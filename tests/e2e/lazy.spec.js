import { test, expect, runFullTest } from './fixtures.js';

test('Chart.js не вантажиться на старті, лише за наміром користувача', async ({ app }) => {
  const chunks = [];
  app.on('request', (r) => /ChartManager-.*\.js$/.test(r.url()) && chunks.push(r.url()));
  await app.reload();
  // Сторінка повністю ініціалізована (сервер визначено) — і все одно без Chart.js
  await expect(app.locator('#server-ip')).not.toHaveText('—');
  await app.waitForTimeout(500);
  expect(chunks).toHaveLength(0);

  await app.getByRole('button', { name: 'Старт' }).hover();
  await expect.poll(() => chunks.length).toBe(1);

  await runFullTest(app);
  // Графік намальовано: canvas має непрозорі пікселі
  const painted = await app.locator('#live-chart').evaluate((/** @type {HTMLCanvasElement} */ c) => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(1000);
  expect(chunks).toHaveLength(1);
});
