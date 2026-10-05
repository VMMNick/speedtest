import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    // Інтеграційні тести ділять одну БД — без паралелізму між файлами
    fileParallelism: false,
  },
});
