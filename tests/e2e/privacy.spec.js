import { test, expect, cspViolations } from './fixtures.js';

test('сторінка конфіденційності: посилання з футера, переклад, CSP', async ({ app, errors }) => {
  await app.getByRole('link', { name: 'Конфіденційність' }).click();
  await expect(app).toHaveURL(/privacy\.html$/);
  await expect(app.getByRole('heading', { level: 1 })).toHaveText('Конфіденційність');
  await expect(app.locator('main')).toContainText('IP-адреса не зберігається');

  await app.getByRole('button', { name: 'Мова: English' }).click();
  await expect(app.getByRole('heading', { level: 1 })).toHaveText('Privacy');
  await expect(app).toHaveTitle(/Privacy/);
  await expect(app.locator('main')).not.toContainText('Конфіденційність');

  expect(await cspViolations(app)).toEqual([]);
  expect(errors).toEqual([]);
});
