import { test, expect, runFullTest } from './fixtures.js';

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('немає горизонтальної прокрутки до і після тесту', async ({ app }) => {
  expect(await overflowX(app)).toBeLessThanOrEqual(0);
  await runFullTest(app);
  expect(await overflowX(app)).toBeLessThanOrEqual(0);
  await expect(app.locator('#gauge')).toBeInViewport();
});
