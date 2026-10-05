import { defineConfig } from 'vitest/config';

/** Pinned CDN copies of the libraries, used only by the hosted build. */
const CDN = {
  three: 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js',
  rapier: 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.21.0/dist/rapier.mjs',
};

/**
 * `vite build` makes the normal self-contained static site in dist/.
 * `vite build --mode hosted` makes dist-hosted/ for hosts that require third-party libraries to
 * come from a public CDN: three and Rapier are imported from pinned jsDelivr URLs and the game's
 * own code is left unminified.
 */
export default defineConfig(({ mode }) => {
  const hosted = mode === 'hosted';
  return {
    // Relative base so the build works from any static host path (root or subfolder).
    base: './',
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 2500,
      outDir: hosted ? 'dist-hosted' : 'dist',
      minify: !hosted,
      rolldownOptions: hosted ? { external: [/^https:\/\//] } : {},
    },
    resolve: hosted ? { alias: { three: CDN.three, '@dimforge/rapier3d-compat': CDN.rapier } } : {},
    worker: {
      format: 'es',
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
