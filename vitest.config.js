import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src_sdk_ts/**/*.test.js'],
    watch: false, // Run once and exit
    reporter: 'verbose', // Detailed output including failures
    coverage: {
      provider: 'v8', // or 'istanbul'
      include: ['src_sdk_ts/**/*.ts'],
      exclude: ['src_sdk_ts/**/*.test.js'],
      reporter: ['text', 'html', 'json'],
    },
  },
});
