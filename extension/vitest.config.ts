import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to node; files needing a DOM opt in with
    // `// @vitest-environment jsdom` at the top.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
