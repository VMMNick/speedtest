import { test, expect, runFullTest } from './fixtures.js';

test.describe('повний тест', () => {
  test('проходить фази ping → download → upload і показує підсумок', async ({ app, errors }) => {
    const gauge = app.locator('#gauge');
    await app.getByRole('button', { name: 'Старт' }).click();

    await expect(app.getByRole('button', { name: 'Зупинити' })).toBeVisible();
    for (const phase of ['ping', 'download', 'upload']) {
      await expect(gauge).toHaveAttribute('data-phase', phase, { timeout: 15_000 });
    }
    await expect(app.locator('#summary')).toBeVisible({ timeout: 15_000 });
    await expect(gauge).toHaveAttribute('data-phase', 'done');

    // Усі картки заповнені числами
    for (const metric of ['download', 'upload', 'ping', 'jitter', 'loss', 'stability']) {
      await expect(app.locator(`[data-metric="${metric}"] [data-value]`)).toHaveText(/^\d/);
    }
    await expect(app.locator('#summary-grade')).toHaveText(/^[A-F]$/);
    await expect(app.locator('#usecases li')).toHaveCount(4);
    await expect(app.getByRole('button', { name: 'Ще раз' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Зупинити' })).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('швидкість на датчику відповідає підмінному серверу (порядок величини)', async ({ app }) => {
    await runFullTest(app);
    const dl = Number(await app.locator('[data-metric="download"] [data-value]').textContent());
    // 20 000 байт/мс на потік ≈ 160 Мбіт/с; з накладними витратами чекаємо десятки–сотні Мбіт/с
    expect(dl).toBeGreaterThan(5);
    expect(dl).toBeLessThan(2000);
  });

  test('можна запустити повторно', async ({ app }) => {
    await runFullTest(app);
    await runFullTest(app);
    await expect(app.locator('#gauge')).toHaveAttribute('data-phase', 'done');
  });
});

test.describe('зупинка', () => {
  test('кнопка «Зупинити» перериває тест і нічого не зберігає', async ({ app }) => {
    await app.getByRole('button', { name: 'Старт' }).click();
    await expect(app.locator('#gauge')).toHaveAttribute('data-phase', 'download', { timeout: 15_000 });
    await app.getByRole('button', { name: 'Зупинити' }).click();

    await expect(app.locator('.toast')).toContainText('Тест зупинено');
    await expect(app.locator('#gauge')).toHaveAttribute('data-phase', 'idle');
    await expect(app.locator('#summary')).toBeHidden();

    await app.getByRole('button', { name: 'Історія тестів' }).click();
    await expect(app.locator('#history-empty')).toBeVisible();
  });
});

test.describe('клавіатура', () => {
  test('Enter запускає, Escape зупиняє', async ({ app }) => {
    await app.locator('body').press('Enter');
    await expect(app.locator('body')).toHaveClass(/is-running/);
    await expect(app.locator('#gauge')).toHaveAttribute('data-phase', 'download', { timeout: 15_000 });
    await app.locator('body').press('Escape');
    await expect(app.locator('body')).not.toHaveClass(/is-running/);
  });

  test('Enter на кнопці «Історія» відкриває модалку і НЕ запускає тест', async ({ app }) => {
    await app.getByRole('button', { name: 'Історія тестів' }).focus();
    await app.keyboard.press('Enter');
    await expect(app.getByRole('dialog', { name: 'Історія тестів' })).toBeVisible();
    await expect(app.locator('body')).not.toHaveClass(/is-running/);
  });
});

test.describe('помилки мережі', () => {
  test.describe('сервер недоступний', () => {
    test.use({ mock: { ping: 'down' } });

    test('показує помилку і не запускає тест', async ({ app }) => {
      await expect(app.locator('.toast--error')).toContainText('недоступний', { timeout: 15_000 });
      await app.getByRole('button', { name: 'Старт' }).click();
      await expect(app.locator('body')).not.toHaveClass(/is-running/, { timeout: 15_000 });
      await expect(app.locator('#summary')).toBeHidden();
    });
  });

  test.describe('rate limit на download', () => {
    test.use({ mock: { downloadStatus: 429 } });

    test('показує зрозуміле повідомлення', async ({ app }) => {
      await app.getByRole('button', { name: 'Старт' }).click();
      await expect(app.locator('.toast--error')).toContainText('HTTP 429', { timeout: 20_000 });
      await expect(app.locator('body')).not.toHaveClass(/is-running/);
    });
  });
});
