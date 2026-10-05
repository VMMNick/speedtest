import { test, expect, runFullTest, cspViolations } from './fixtures.js';

test('Content-Security-Policy присутня і не порушується за весь сценарій', async ({ app }) => {
  const policy = await app.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);

  await runFullTest(app);
  await app.getByRole('button', { name: 'Змінити тему' }).click();
  await app.getByRole('button', { name: 'Історія тестів' }).click();
  await expect(app.locator('#history-body tr')).toHaveCount(1);

  expect(await cspViolations(app)).toEqual([]);
});
