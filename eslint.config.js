import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

const NO_SERVER = { group: ['**/server/**'], message: 'фронтенд не імпортує сервер' };

export default [
  {
    ignores: [
      'dist/',
      'coverage/',
      '**/node_modules/',
      'playwright-report/',
      'playwright-report-live/',
      'test-results/',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['src/workers/**/*.js'],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ['tests/**/*.js', '*.config.js', 'config/**/*.js', 'scripts/**/*.js', 'server/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Код у page.evaluate() виконується в браузері
    files: ['tests/e2e/**/*.js', 'tests/live/**/*.js', 'tests/e2e-server/**/*.js', 'tests/e2e-cloud/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  // ───── Межі шарів (див. «Архітектура» в README) ─────
  // У flat config пізніший блок замінює правило цілком, тому кожен блок містить повний набір заборон.
  {
    files: ['src/**/*.js'],
    rules: { 'no-restricted-imports': ['error', { patterns: [NO_SERVER] }] },
  },
  {
    // core — чиста логіка вимірювань: без DOM, i18n, UI і сервісів (працює і у воркері, і в Node)
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            NO_SERVER,
            { group: ['**/ui/**', '**/services/**', '**/i18n/**'], message: 'core не залежить від ui/services/i18n' },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'document', 'window', 'localStorage', 'indexedDB'],
    },
  },
  {
    // services — введення-виведення (мережа, сховище, звук, PWA), без DOM-розмітки
    files: ['src/services/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [NO_SERVER, { group: ['**/ui/**'], message: 'services не залежить від ui' }] },
      ],
    },
  },
  {
    // shared — контракт клієнт↔сервер без залежностей: імпортується і в браузері, і в Node
    files: ['shared/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**', '!./**'], message: 'shared — без залежностей' }] },
      ],
    },
  },
  {
    // Сервер і фронтенд спілкуються лише через HTTP і shared/
    files: ['server/src/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/src/**'], message: 'сервер не імпортує фронтенд' }] },
      ],
    },
  },
  {
    files: ['scripts/**/*.js', 'server/src/migrate-cli.js'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
