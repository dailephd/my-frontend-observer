import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Real Chromium capture is resource-heavy; bounding file-level workers
    // prevents concurrent screenshot sessions from exhausting the browser on
    // Windows while preserving parallel coverage.
    maxWorkers: 1,
  },
});
