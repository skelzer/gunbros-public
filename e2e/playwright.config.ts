/**
 * Playwright smoke test configuration (DESIGN §10).
 *
 * The suite builds nothing. It drives the *built* stack, so `pnpm build` has to have
 * run: this starts `node ../packages/server/dist/index.js`, which serves
 * `packages/client/dist` and the WebSocket from one origin — the same shape as the
 * deployment (DESIGN §1.5). Two browser contexts then create and join a room and play a
 * turn.
 *
 * The port is 8099, not 8080: a dev server left running on the usual port must not be
 * mistaken for the build under test, which is also why `reuseExistingServer` is false —
 * an already-listening 8099 is a leftover, and the run should fail loudly rather than
 * test a stale binary.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8099);

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Desktop Chrome'],
    // A failure here is a race or a desync, and neither is reproducible by staring at
    // the console: keep the trace and a screenshot of the moment it went wrong.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Both contexts simulate at 60 Hz off requestAnimationFrame, and only one browser
    // window can be in the foreground: without these the backgrounded one is throttled
    // to a crawl and never sees its own turn.
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: 'node ../packages/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), LOG_LEVEL: 'warn' },
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
