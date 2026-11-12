import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['health-check.js', 'scripts/**/*.cjs'],
      reporter: ['text', 'html'],
      reportOnFailure: true,
      thresholds: {
        perFile: true,
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
