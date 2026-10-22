/**
 * Візуальні регресійні тести: скріншоти ключових екранів порівнюються з еталонами
 * в e2e/visual/__screenshots__/.
 *
 * Еталони знято в Linux-середовищі CI (рендеринг шрифтів залежить від ОС), тому
 * на Windows/macOS порівняння вимкнене за замовчуванням — запускайте в CI, а еталони
 * оновлюйте workflow-ом «Visual baselines» (Actions → Run workflow).
 */
import { defineConfig, devices } from '@playwright/test';
import web from './web.config.js';

export default defineConfig({
  ...web,
  testDir: './visual',
  outputDir: './test-results-visual',
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-visual' }]],
  // Один еталон на сцену, без суфікса платформи: «правда» — лише Linux у CI
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: {
    ...web.expect,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      // Невеликий запас на антиаліасинг між версіями Chromium
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
    },
  },
  use: {
    ...web.use,
    timezoneId: 'Europe/Kyiv',
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
      grep: /@mobile/,
    },
  ],
});
