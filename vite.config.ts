import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any static host path (root or subfolder).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
