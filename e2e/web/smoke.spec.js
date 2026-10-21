import { test, expect, META } from './fixtures.js';

test('сторінка завантажується без помилок і показує дані з’єднання', async ({ app, errors }) => {
  await expect(app).toHaveTitle(/Спідтест/);
  await expect(app.getByRole('button', { name: 'Старт' })).toBeVisible();
  await expect(app.locator('#server-name')).toContainText(`${META.city} (${META.colo})`);
  await expect(app.locator('#server-isp')).toHaveText(META.asOrganization);
  await expect(app.locator('#server-ip')).toHaveText(META.clientIp);
  expect(errors).toEqual([]);
});
