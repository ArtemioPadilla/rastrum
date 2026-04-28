import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom: smaller, faster than jsdom, and avoids vitest 4's
    // node-localstorage conflict that breaks localStorage.clear().
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json'],
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
