import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

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
  {
    files: ['scripts/**/*.js', 'server/src/migrate-cli.js'],
    rules: { 'no-console': 'off' },
  },
  prettier,
];
