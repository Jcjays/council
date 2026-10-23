import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Several tests spawn real child processes (git, node); none of them should need a minute.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
