import AxeBuilder from '@axe-core/playwright';
import { test, expect, runFullTest } from './fixtures.js';

/** Перевірка WCAG 2.1 AA — допускаємо лише minor/moderate зауваження. */
async function seriousViolations(page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const colorScheme of /** @type {const} */ (['light', 'dark'])) {
  test.describe(`axe (${colorScheme})`, () => {
    test.use({ colorScheme });

    test('стартовий екран', async ({ app }) => {
      expect(await seriousViolations(app)).toEqual([]);
    });

    test('після тесту та в модалці історії', async ({ app }) => {
      await runFullTest(app);
      expect(await seriousViolations(app)).toEqual([]);
      await app.getByRole('button', { name: 'Історія тестів' }).click();
      // Дочекатися кінця анімації появи: під час fade-in axe бачить «блідий» текст і хибно лає контраст
      await app.locator('#history-modal').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      expect(await seriousViolations(app)).toEqual([]);
    });
  });
}

test('скрінрідер чує підсумки фаз, а не кожен кадр датчика', async ({ app }) => {
  await expect(app.locator('.gauge__readout')).not.toHaveAttribute('aria-live');
  await app.evaluate(() => {
    // @ts-ignore
    window.__ann = [];
    const el = document.getElementById('sr-announcer');
    // @ts-ignore
    new MutationObserver(() => el.textContent && window.__ann.push(el.textContent)).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await runFullTest(app);
  await expect.poll(() => app.evaluate(() => /** @type {any} */ (window).__ann.at(-1))).toMatch(/Тест завершено/);
  const ann = await app.evaluate(() => /** @type {any} */ (window).__ann);
  expect(ann.length).toBeLessThan(12);
  expect(ann.join(' | ')).toMatch(/Пінг .* мс.*Завантаження: .* Мбіт\/с.*Вивантаження: .* Мбіт\/с/);
});
