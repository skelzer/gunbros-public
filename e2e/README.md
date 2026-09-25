# @gunbros/e2e

The Playwright smoke test (DESIGN §10): start the built server, open two browser
contexts, create and join a room by code, both ready, host starts, one player holds the
charge key for a second, and both pages reach the next turn with a desync counter of 0.

```
pnpm build          # the suite drives the built client served by the built server
pnpm e2e            # from the repo root: builds, then runs the suite (`pnpm --filter @gunbros/e2e e2e` skips the build)
```

This package builds nothing itself. `playwright.config.ts` starts
`node ../packages/server/dist/index.js` on `E2E_PORT` (**8099** by default, so a dev
server on 8080 is never mistaken for the build under test) and waits for `/health`;
`reuseExistingServer` is false, so a leftover listener fails the run rather than being
tested.

The browser is installed once:

```
pnpm --filter @gunbros/e2e exec playwright install chromium
```

The pages are opened with `?debug=1`, which is what publishes `window.__gunbrosMatch`
(DESIGN §7 item 53) — the HUD is canvas, so the assertions read that instead of pixels.

The specs live in `tests/`.
