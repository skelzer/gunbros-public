# GunBros

A browser-based, turn-based 2D artillery game for two brothers in different cities.
`docs/DESIGN.md` is the contract every phase is built against.

- `packages/shared` — the whole simulation: deterministic, zero DOM, zero Node.
- `packages/client` — Vite + Canvas 2D presentation layer (no framework).
- `packages/server` — Node + `ws`: rooms in memory, authoritative match loop, serves the
  built client and upgrades `/ws`.
- `e2e` — one Playwright smoke test: two browsers play three turns against the built server.

`docs/PROGRESS.md` is the per-phase log (what works, what is rough, what is next).
`docs/DEPLOY.md` is how it gets online.

## Running

```
pnpm install
pnpm dev
```

`pnpm dev` starts both halves: the server on **:8080** (`/ws`, `/health`) and Vite on
**:5173**, which proxies `/ws` through to it. Play at <http://localhost:5173> — pick a
name, create a room, and send the other player the `/r/CODE` link the room screen
copies for you. Both tabs on one machine work fine; use two browser profiles or a
private window, since the reconnect token lives in `localStorage`.

Production build, then the one process that serves everything from **:8080**:

```
pnpm build        # shared/dist, server/dist, client/dist
pnpm start        # node packages/server/dist/index.js — client and /ws on one origin
```

Tests:

```
pnpm test         # vitest: the shared simulation, the server and the client
pnpm e2e                 # builds first, then the Playwright suite against the built server
pnpm typecheck    # tsc --noEmit everywhere
pnpm lint
```

The e2e suite starts the built server itself on **:8099** and opens two browser
contexts. The browser is installed once with `pnpm --filter @gunbros/e2e exec playwright
install chromium`.

Deployment (one Ubuntu server with Caddy and docker compose, auto-deployed from main; hosting the client elsewhere) is in `docs/DEPLOY.md`. The
root `Dockerfile` builds the whole thing and runs the server alone:

```
docker build -t gunbros .
docker run -p 8080:8080 gunbros
```

### The dev sandbox

```
open http://localhost:5173/sandbox
open 'http://localhost:5173/sandbox?a=lightning&b=turtle&map=cave&sky=tornado'
```

One tab, no server, a full local match. The route is behind `import.meta.env.DEV`, so
the module is not part of a production build (DESIGN §7.14).

| query | values |
|---|---|
| `a` / `b` | the mobile in seat A / seat B, e.g. `armor`, `lightning`, `turtle` |
| `map` | `hills`, `pit`, `islands`, `cave`, `glacier`, `forge`, `temple`, `scrapyard` |
| `sky` | `none`, `thor`, `tornado`, `force`; omitted rolls one off the sandbox seed |

### Running two servers side by side

Both dev ports come from the environment, because `pnpm --filter … dev -- --port N`
forwards the `--` literally and Vite ignores everything after it:

```
CLIENT_PORT=8120 SERVER_PORT=8121 pnpm --filter @gunbros/client dev
PORT=8121 pnpm --filter @gunbros/server dev
```

`SKY_EVENT=thor|tornado|force|none` on the server pins every match's sky event instead
of rolling it (DESIGN §5), which is how the tests and a sky playtest get a fixed one.

### Controls

Control follows whoever's turn it is; in an online match that is your mobile on your
turn and a spectator's view on theirs. Every in-match key has an on-screen twin in the
bottom bar.

| key | action |
|---|---|
| `←` `→` | walk (costs the movement gauge) |
| `↑` `↓` | aim; the HUD shows the relative and the true angle |
| `Space` | hold to charge the power bar, release to fire |
| `Tab` | cycle the shot: S1 → S2 → SS |
| `W` `A` `S` `D` | the same four, for a hand that prefers them |
| `1`–`6` | item slots |
| `X` | skip the turn |
| `H` | the controls card |
| `Enter` | chat (match only; `Esc` closes it) |
| `F` | free camera (drag with the mouse, or push the screen edges) |
| `M` | mute |

Sandbox-only keys: `R` rerolls the wind, `N` regenerates the map, `P` cycles the
controlled seat's mobile, `Enter` restarts after a game over, `` ` `` toggles free play,
and `C` switches the driven seat while in it.

`?debug=1` on any URL adds a panel with the tick, the phase and the desync counter.
