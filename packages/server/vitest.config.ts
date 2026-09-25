import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The server's tests run against the simulation's TypeScript source, exactly like the
 * client's bundle and the `tsx` dev server do, so a red test never means "the shared
 * package's dist is stale".
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
    // The integration test boots a real server; its log lines are noise in a test run.
    env: { LOG_LEVEL: 'silent' },
    include: ['test/**/*.test.ts'],
    // A full match over real sockets is slower than a unit test but still seconds.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
