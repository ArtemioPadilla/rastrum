import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // happy-dom: smaller, faster than jsdom, and avoids vitest 4's
    // node-localstorage conflict that breaks localStorage.clear().
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // #648: gemma-vision.test.ts uses vi.mock('@huggingface/transformers') to
    // stub onnxruntime-node (a native binary dep ~50-100 MB that ships with
    // @huggingface/transformers v4 even in browser-only builds). The mock is
    // defined inline in the test file — no exclusion needed here.
    coverage: {
      reporter: ['text', 'json'],
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
