import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The client's own tests. They cover `net/playback.ts`, which was written as pure
 * `(state, message) -> result` functions precisely so the reconciliation could be tested
 * without a browser: no DOM is touched here and the environment is plain Node.
 *
 * `@gunbros/shared` maps to its TypeScript source, exactly as the Vite build does, so a
 * red test never means "the shared package's dist is stale" (DESIGN §1.5).
 */
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@gunbros/shared': sharedSrc,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
