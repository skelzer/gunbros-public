# GunBros — Design Document

Working title `GunBros`. A browser-based, turn-based 2D artillery game in the spirit of early-2000s
online artillery games. Private hobby project for two brothers in different cities; nostalgic feel
over polish. This document is the contract that every implementation phase is built against.

Conventions used throughout:

- Every tunable number lives in `packages/shared/src/data/*.ts`. Numbers quoted here are the
  initial values in those files, not promises. Tune by feel.
- Mechanical reference keys (`armor`, `mage`, …) are `id`s. Player-facing names are `displayName`
  and live next to the `id` in data so they can be renamed without touching code.
- "Tick" means one fixed simulation step of 1/60 s.
- "Pixel" means one pixel of the 800×600 internal resolution.

---

## 1. Architecture

### 1.1 Monorepo layout

```
gunbros/
  package.json                 pnpm workspace root; `pnpm dev` runs server + client together
  pnpm-workspace.yaml
  tsconfig.base.json           strict: true, noUncheckedIndexedAccess, isolatedModules
  Dockerfile                   multi-stage: build client + server, run server only
  docs/
    DESIGN.md                  this file
    PROGRESS.md                per-phase log: what works / what is rough / what is next
    DEPLOY.md                  server setup, deploys, abuse limits
  packages/
    shared/                    the entire game simulation; zero DOM, zero Node imports
    client/                    Vite + Canvas 2D; lobby, room, match, dev sandbox
    server/                    Node + ws; rooms in memory; serves built client
  e2e/                         Playwright smoke test (two contexts join a room, play three turns)
```

### 1.2 `packages/shared` — the simulation

Pure TypeScript, no side effects, no globals. Everything in here runs identically on the server
and in every browser. Module map:

```
src/
  index.ts                     public API surface
  math/
    prng.ts                    seeded PRNG (xoshiro128**), never Math.random
    trig.ts                    sin / cos / atan2 implemented in the sim (see §2 Determinism)
    fixed.ts                   quantisation helpers (q8 rounding for hashes)
    vec.ts                     tiny vector helpers
  terrain/
    terrain.ts                 Uint8Array mask, carve, ground probes, slope sampling, hash
    generate.ts                procedural map generators (hills, pit, islands, cave)
    codec.ts                   RLE compress / decompress of the mask for resync
  entities/
    mobile.ts                  MobileState, movement, tilt, falling, death
    projectile.ts              generic projectile entity + integration
    behaviours/                one small module per non-trivial shot behaviour (see §3)
    mines.ts                   walking mines (raon), persistent across turns
  rules/
    damage.ts                  falloff, class × type multipliers, shield absorption, defence debuffs
    delay.ts                   delay accounting and turn ordering
    turn.ts                    turn state machine (aiming → moving → firing → resolving → ended)
    wind.ts                    wind generation and per-turn change schedule
    items.ts                   item effects and delay costs
    sky.ts                     Thor / Tornado / Force
    suddenDeath.ts
  match/
    match.ts                   MatchState: players, mobiles, terrain, wind, delays, phase
    reducer.ts                 applyIntent(state, intent) and step(state) — the only mutators
    snapshot.ts                serialise / hash / reconcile
    events.ts                  SimEvent stream (explosion, hit, spawn, …) consumed by render + audio
  data/
    constants.ts               global tunables (gravity, tick rate, turn timer, power curve …)
    mobiles.ts                 all 18 mobiles: stats + shot definitions
    items.ts
    maps/                      one file per map, index.ts (registry, mapOrder), types.ts,
                               generation.ts (terrainGen, spawnGen), masks/<id>.ts (generated)
    damageTable.ts             damageType × mobileClass multipliers
    sky.ts
  sprites/
    pixelArt.ts                palette-indexed pixel grid format (data only; rendering is client-side)
    mobiles/*.ts               one file per mobile: palette + frames
```

Design rule: **the sim is a pure reducer**. `step(state, tick)` and `applyIntent(state, intent)`
mutate a `MatchState` in place (for speed) but are the only two entry points. Rendering reads the
state and the `SimEvent` list emitted by each step; it never writes.

### 1.3 `packages/client`

Vite, TypeScript, Canvas 2D, no game framework. Justification: the sim already owns all logic;
the client only needs an image blitter, an input map and a WebSocket. A framework would add
weight and fight the fixed 800×600 nearest-neighbour presentation.

Presentation-only numbers (HUD geometry, easing rates, particle counts, palette colours)
live in `client/src/data/clientConstants.ts`. The "every tunable in
`shared/src/data`" rule is about numbers the *simulation* reads; a number that can never
reach `MatchState` belongs with the renderer, but it is still collected in one file
rather than buried in a draw call.

```
src/
  data/clientConstants.ts      presentation tunables (never read by the sim)
  main.ts                      boots the scene router
  scenes/
    lobby.ts                   nickname, create / join by code
    room.ts                    team, mobile, map, items, chat, host start
    match.ts                   the game
    sandbox.ts                 dev-only: one tab drives two mobiles, no server (route /sandbox)
  render/
    canvas.ts                  800×600 backbuffer, integer upscale, imageSmoothing off
    camera.ts                  follow projectile, return to next player, free drag / edge scroll
    terrain.ts                 mask → ImageData, dirty-rect updates
    sprites.ts                 pixel grid or PNG spritesheet → offscreen canvases; animation
    background.ts              parallax layers
    hud.ts                     bottom bar, wind, delay list, name/HP/shield tags
    effects.ts                 explosions, trails, sky-event visuals
  input/
    keyboard.ts, pointer.ts    raw input → Intent objects (mouse and touch, §7 item 144)
  net/
    socket.ts                  WebSocket wrapper, reconnect with token, message typing
    playback.ts                runs the shared sim locally for smooth playback, reconciles
  audio/
    synth.ts                   WebAudio SFX (charge, fire, explosion, hit, turn start, warning)
    music.ts                   the soundtrack: which track a scene plays, one streamed player (§8.3)
  state/
    session.ts                 nickname, token, settings (sound mode) in localStorage
```

### 1.4 `packages/server`

Node 22+, `ws`, plain `http` for static files (no Express). Rooms in memory. One process.

```
src/
  index.ts                     http server: static client + /ws upgrade + /health
  rooms.ts                     RoomManager: create / join by code / cleanup
  room.ts                      Room: lobby state, player slots, chat, start
  matchRunner.ts               drives shared sim at fixed timestep; validates intents; broadcasts
  protocol.ts                  re-export of shared message types + zod-free runtime guards
  config.ts                    PORT, RECONNECT_GRACE_MS, ROOM_TTL_MS, …
```

The server is authoritative. It runs the same `step()` as the clients, at real time, using
`setInterval` drift-corrected to 60 Hz while a shot is in flight and lazily otherwise
(nothing moves between turns except mobiles walking and shield regen, both of which are cheap).

### 1.5 Deployment

- `pnpm build` produces `packages/client/dist` and `packages/server/dist`.
- `@gunbros/shared` is published to the workspace as its built `dist` (`exports["."]`),
  which is how `node packages/server/dist/index.js` resolves it. Everything that runs
  from source — the Vite bundle, `tsx watch` in the server, both `typecheck`s and both
  vitest projects — maps `@gunbros/shared` to `../shared/src/index.ts` instead, through
  a Vite alias, a vitest alias and `paths` in the two `tsconfig.json`s, so no `dev`,
  `test` or `typecheck` ever depends on the shared package having been built. Only
  `packages/server/tsconfig.build.json` drops the mapping, because its emitted
  `import '@gunbros/shared'` has to resolve the same way at runtime.
- The server serves `client/dist` at `/` (with an SPA fallback to `index.html`) and
  upgrades `/ws`.
- Client reads `VITE_WS_URL` at build time; if empty it derives `ws(s)://<same-host>/ws`.
  This lets the client be hosted statically elsewhere and point at any server.
- `Dockerfile`: multi-stage, `node:22-alpine`, runs `node packages/server/dist/index.js`.
- Production: one Ubuntu 24.04 server (Hetzner CX, `nbg1`), exactly one game container because
  rooms live in memory. `deploy/server/compose.yaml`: Caddy (TLS, the only published ports,
  80/443) → `game:8080`; Caddy sets `X-Real-IP`, the game trusts it (`CLIENT_IP_HEADER=x-real-ip`).
- `deploy/server/bootstrap.sh` sets up any fresh Ubuntu 24.04 over SSH (deploy user, Docker,
  ufw, unattended-upgrades, keys-only SSH); `deploy/hetzner/provision.sh` creates the Hetzner
  server and runs it through cloud-init.
- `deploy/server/deploy.sh` (`pnpm deploy:prod`): builds `linux/amd64`, `docker save | ssh |
  docker load`, `docker compose up -d`, waits for `/health`. `.github/workflows/deploy.yml`
  runs it on every CI success on `main`. Details in `docs/DEPLOY.md`.

---

## 2. Simulation fundamentals

### 2.1 Determinism

Same seed + same intent sequence ⇒ bit-identical `MatchState` on every engine. Rules:

- Fixed timestep: 60 ticks/s. Projectiles integrate with 4 sub-steps per tick (semi-implicit
  Euler) so fast shots cannot tunnel through 1-px terrain.
- PRNG: xoshiro128** seeded from the server. One stream per match; every consumer draws from it
  in a defined order (the reducer is single-threaded and sequential, so order is by construction).
- Transcendentals: `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp`, `Math.pow` (non-integer),
  `Math.hypot` are **banned** inside `shared` (enforced by an ESLint rule). `math/trig.ts`
  implements `sin`/`cos` via range reduction + a fixed polynomial, and `atan2` via a rational
  approximation. Only IEEE-754 `+ - * /` and `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.min/max`
  are used; those are correctly rounded everywhere.
- No iteration over object keys where order matters; arrays only.
- State hash: FNV-1a 32-bit over, in this order: terrain hash; then per mobile (in seat order)
  `q8(x)`, `q8(y)`, `q8(vx)`, `q8(hp)`, `q8(shield)`, `q8(defenceMod)`, `q8(delay)`,
  `q8(ssGauge)`, `alive`; then wind
  strength and direction; then `turn`; then the turn machine — `completedTurns`, the phase index,
  `turnTicksLeft`, `activeSeat`, `q8(pendingDelay)`, `turnStartTick` and `q8(moveGauge)` of the
  active seat; and finally the walking mines in list order. `q8` = `Math.floor(v * 256)`. The header comment of `match/snapshot.ts` is kept in
  step with this list. `chargingPower` and `lastShotPower` are deliberately outside the hash: the
  first is a client report (§6.2 `chargingEcho`), the second is a HUD marker.

### 2.2 Coordinates and units

- World origin top-left, +y down. Map size per map, roughly 1600–2000 × 900–1200 px
  (2 to 2.5 screens wide, 1.5 to 2 screens tall).
- Gravity: `constants.gravity = 0.16 px/tick²` (≈ 576 px/s²).
- Power: bar value `p ∈ [0, 1]`; launch speed = `shot.speed * p` where `armor` S1
  `speed = 14.3 px/tick`. The flat 45° range is `v² / g = 14.3² / 0.16 ≈ 1280 px`, i.e. about
  1.6 screens. That is deliberately more than the widest spawn separation the map
  generators produce (about 820 px on `hills`), so the opening turns are not spent walking
  into range; `projectile.test.ts` pins both numbers against each other.
- Wind: `strength ∈ [0, 26]`, direction `θ ∈ [0, 360)`. Force per tick on a projectile:
  `windFactor * strength * constants.windScale * (cos θ, sin θ)`, `windScale = 0.0015`
  (max wind ≈ a quarter of gravity; a 45° full shot drifts about 25 % of its range).

### 2.3 Terrain

- `Uint8Array(width * height)`; `1` = solid, `0` = air. (Byte per pixel keeps carve and probes
  branch-free; a 2000×1200 map is 2.4 MB, acceptable.)
- `carve(cx, cy, r)`: zero every pixel with `dx²+dy² ≤ r²`. Emits `SimEvent.carve` with the
  circle so the renderer can update a dirty rect.
- `isSolid(x, y)`, `groundBelow(x, yFrom, maxDrop)`, `heightAt(x)`.
- Slope sampling for tilt: probe ground at `x - w/2` and `x + w/2` (w = mobile footprint), tilt =
  `atan2(yR - yL, w)`. Smoothed per tick toward the target with a data-driven rate so mobiles do not
  jitter on jagged edges.
- Terrain does not collapse. Mobiles fall when the pixels under their footprint are gone.
- Hash: FNV-1a over the mask, cached and invalidated on carve.
- Codec: run-length encoding of the mask (byte runs), then `deflate` is **not** used (no Node/DOM
  in shared); RLE alone reduces a typical mask to under 40 KB, fine for a rare resync.

### 2.4 Mobiles

```ts
interface MobileState {
  x: number; y: number;        // feet centre
  vy: number;                  // vertical velocity while falling
  facing: -1 | 1;
  tilt: number;                // radians, follows slope
  relAngle: number;            // aim angle relative to tilt, within [def.angleMin, def.angleMax]
  hp: number; shield: number;
  defenceMod: number;          // stacking debuff (ice), decays per turn
  moveGauge: number;           // px of walking left this turn
  alive: boolean;
  anim: { name: 'idle' | 'move' | 'fire' | 'hurt' | 'death'; frame: number; t: number };
}
```

- True angle (degrees, 0 = right, 90 = up):
  `trueAngle = (facing === 1 ? relAngle : 180 - relAngle) + tiltDeg`. Facing mirrors the aim
  through the **vertical** axis — turning the tank around keeps the barrel the same height
  above the horizon and points it the other way — while `tiltDeg` is a world-space rotation
  of the hull and keeps its sign for either facing. Both values are shown in the HUD.
- Movement: `def.moveSpeed` px/tick horizontally. Each px walked costs 1 unit of `moveGauge`
  (`def.moveGauge` ≈ 120–200 px per turn). Moving into a rise higher than `def.maxStep` px over
  the next `moveSpeed` px is blocked (steepness limit). Small rises are stepped up; drops are
  walked off and become falls.
- Falling: `vy += gravity`, stop when the footprint touches ground. No fall damage. `y > map.height + 50`
  ⇒ death (`SimEvent.death`).
- Classes: `mechanical | shielded | bionic`. Shielded mobiles have `shieldMax > 0` and regen
  `def.shieldRegen` per completed turn of their own.

### 2.5 Projectiles

One generic entity; most shots are pure configuration.

```ts
interface ProjectileDef {
  speed: number;               // px/tick at power 1.0
  gravity: number;             // multiplier of constants.gravity (0 for beams / bolts)
  windFactor: number;          // 0 (immune) … 3 (boomer)
  radius: number;              // collision radius vs terrain and mobiles
  carveRadius: number;         // terrain hole
  damage: number;              // at explosion centre
  damageRadius: number;        // linear falloff to 0 at this distance
  damageType: DamageType;      // 'explosive' | 'energy' | 'impact' | 'fire' | 'ice' | 'water'
  lifetimeTicks?: number;      // onTimer fires when reached (default: none)
  bounces?: number;            // remaining ground bounces (grub)
  restitution?: number;        // bounce energy kept
  behaviour?: string;          // key into the behaviour registry
  params?: Record<string, number>;  // behaviour-specific tunables (still data)
  sprite: string;              // sprite key
  trail?: 'none' | 'smoke' | 'spark' | 'bubble';
}
```

```ts
interface ProjectileState {
  id: number; def: ProjectileDef; ownerSeat: number;
  x: number; y: number; vx: number; vy: number;
  age: number; alive: boolean;
  bouncesLeft: number;
  data: Record<string, number>;   // behaviour scratch (all numeric, hash-safe)
}
```

Integration per sub-step, with `dt = 1 / constants.subSteps`:
`vx += wind.x * windFactor * dt; vy += (gravity * def.gravity + wind.y * windFactor) * dt;`
`x += vx * dt; y += vy * dt` — then move along that segment sampling every ≤1 px for a
terrain / mobile hit.

Behaviour registry:

```ts
interface Behaviour {
  onSpawn?(p, ctx): void;
  onTick?(p, ctx): void;        // every sub-step after integration
  onImpact?(p, ctx, hit: { x, y, mobileSeat?: number }): boolean;  // return true to suppress default explode
  onTimer?(p, ctx): void;       // lifetimeTicks reached
  onExpire?(p, ctx): void;      // left the world
}
```

`ctx` (BehaviourContext) is built once per step rather than per projectile, so the calls
that need to know whose shot it is take that explicitly:

```ts
spawn(def, x, y, vx, vy, ownerSeat, data?): ProjectileState   // runs the def's onSpawn hook
explode(p, x, y, defOverride?): void
carve(x, y, r): void
damageArea(x, y, def, ownerSeat): void
applyImpulse(seat, dx, dy): void
mark(x, y): void                                              // schedules a sky strike
emit(event): void
scheduleTurnEffect(effect): void                              // outlives the shot (mines, bolts)
defOf(seat): MobileDef | undefined
tick, rng, wind, mobiles, terrain
```

Every projectile in the game is created through `ctx.spawn`, including the ones a `fire`
intent produces, so `onSpawn` is the reliable place for a behaviour to initialise its
scratch data.

Default impact = `explode`: carve `carveRadius`, damage every mobile with linear falloff from
`damage` at centre to 0 at `damageRadius`, multiplied by the damage table, then shield absorbs
first. Emits `explosion`, `hit`, `death` events.

The shot resolves (turn can end) when every projectile spawned this turn is dead **and** every
mobile has stopped falling **and** no scheduled same-turn effect is pending (lightning bolt,
satellite beam, sky strike). Persistent entities (mines) do not block resolution.

### 2.6 Damage

```
raw      = damage * max(0, 1 - dist / damageRadius)
typed    = raw * damageTable[damageType][mobile.class]
final    = typed * (1 + defenceDebuff) * suddenDeathMultiplier * powerUpMultiplier * forceMultiplier
shield absorbs min(shield, final); remainder hits hp
```

`damageTable` initial values (rows = type, columns = mechanical / shielded / bionic):

| type | mechanical | shielded | bionic |
|---|---|---|---|
| explosive | 1.00 | 0.90 | 1.10 |
| energy | 0.90 | 1.15 | 1.00 |
| impact | 1.10 | 0.95 | 0.90 |
| fire | 1.00 | 1.00 | 1.20 |
| ice | 0.95 | 1.05 | 1.00 |
| water | 1.05 | 1.00 | 0.90 |

### 2.7 Wind

- New wind = random strength `0..26` (the lower of two uniform draws, so calm is common and
  20+ is rare, about 5 %) and uniform direction.
- Changes every `wind.changeEveryTurns = 2` completed turns (the sim counts completed turns; the
  server does nothing special).
- Shown at top centre: arrow + integer strength. Projectile trails make wind readable.

### 2.8 Turn order by delay

Every player carries an accumulated `delay: number`. Next player = lowest delay among alive
players; tie → lower seat index. Costs (initial values in `data/constants.ts` and per shot/item):

| action | delay |
|---|---|
| Shot 1 | +250 (per mobile, range 200–320) |
| Shot 2 | +450 |
| SS | +800 |
| Skip / timeout | +250 |
| item (each) | listed in `data/items.ts`, 100–600 |
| time on turn | +1 per second used |
| movement | +0 (it costs gauge and time) |

The HUD shows the next 4 players sorted by delay.

### 2.9 Turn structure

State machine per turn: `starting (0.5 s) → active (20 s timer) → resolving → ending (0.75 s)`.

- `active`: the active player may move (gauge-limited), aim, select shot, use ≤ 1 item, charge and
  fire, or skip. Chat any time.
- Timer expiry: turn ends as a skip. If the player was charging when the timer expired, the shot
  fires at the current power (this matches memory of the original and feels better than losing it).
- `resolving`: no input except chat. Camera follows the projectile.
- SS availability (assumption, see §7): a per-player SS gauge that gains `+1` per own completed
  turn and `+1` per hit taken, unlocks at `ssGaugeMax = 4`, resets to 0 on use (the turn it
  was spent on still earns its own +1, and the selection drops back to S1 with the gauge —
  §7 items 103 and 104).
- Sudden death: after `suddenDeath.afterTurns = 40` total completed turns, damage ×2; after 60, ×3.

### 2.10 Power bar

- Hold Space to charge, release to fire. Fill time `power.chargeSeconds = 2.6` for 0 → 1, linear.
  Reaching 1.0 holds at 1.0 (no bounce-back; the original fired at max when the bar overflowed —
  we hold and fire on release, see Assumptions).
- 4 major bars with 5 minor ticks each (20 ticks). A thin marker shows the previous shot's power.
- The client samples input at animation frame rate but the *released power* is what is sent, as a
  number in `[0, 1]` quantised to 1/1000. The server validates and uses it verbatim, so the shot
  is deterministic regardless of frame rate.
- Audio: rising pitch during charge, tick at each major bar, distinct release.

---

## 3. Mobiles

All stats in `packages/shared/src/data/mobiles.ts`. Common shape:

```ts
interface MobileDef {
  id: MobileId; displayName: string;
  class: 'mechanical' | 'shielded' | 'bionic';
  hp: number; shieldMax: number; shieldRegen: number;
  defence: number;                 // flat multiplier on incoming damage, 0.8–1.1
  moveSpeed: number; moveGauge: number; maxStep: number;
  angleMin: number; angleMax: number;     // relative aim range in degrees
  footprint: { w: number; h: number };
  randomOnly: boolean; randomWeight: number;
  shots: { s1: ShotDef; s2: ShotDef; ss: ShotDef };
  sprite: SpriteRef;
}
interface ShotDef {
  displayName: string; delay: number;
  projectile: ProjectileDef; count?: number; spreadDeg?: number; stagger?: number;
}
```

Behaviour keys and what they do. "cfg" = plain data, no module.

| id | class | S1 | S2 | SS |
|---|---|---|---|---|
| armor | mechanical | cfg shell | cfg heavier shell | cfg big missile, high damage |
| mage | shielded | cfg energy ball | `weave`: two projectiles offset ±sin(age) around a shared path | `shieldBreak`: energy blast, damage ×2.5 vs shield, strips remaining shield |
| nak | bionic | cfg lob | `burrow`: on terrain impact continues underground at reduced speed for N ticks carving a tunnel; explodes on mobile contact, on exiting terrain, or on timer | `burrow` with larger params |
| trico | bionic | cfg ball | `orbit`: three projectiles orbiting a shared centre of mass | cfg heavy projectile |
| bigfoot | mechanical | cfg `count: 4, spreadDeg: 10` missiles | `count: 6` | `count: 9` |
| boomer | bionic | cfg `windFactor: 3.0`, `gravity: 0.6` | `count: 3` | `count: 5`, larger |
| raon | mechanical | cfg shot | `mineDrop`: on impact spawns a walking mine (persistent) | `mineDrop` with a bigger mine |
| lightning | shielded | `markThenBolt`: on impact, mark; next resolve step a vertical bolt (`gravity: 0`, `windFactor: 0`) strikes from the sky | `markThenBolt` with `angleDeg: 30` | `markThenBolt` with `bolts: 3`, spread |
| jd | shielded | cfg shot | `pull`: after explosion, every mobile within `pullRadius` receives an impulse toward the centre | `pull` stronger + larger radius |
| asate | mechanical | `satellite`: marks point; satellite fires 1 beam | 3 beams, fanned | 1 wide beam |
| ice | shielded | cfg `damageType: 'ice'`, on hit +`defenceDebuff: 0.08` | stronger, +0.12 | `shatter`: on timer splits into 6 shards |
| turtle | bionic | cfg water ball | `converge`: two projectiles with lateral velocity ±v that flips after N ticks | `bubbleBurst`: on timer bursts into 12 small bubbles |
| grub | bionic | cfg `bounces: 3, restitution: 0.55` | `bounces: 5` | big bouncy |
| aduka | mechanical | cfg weak shot | `thorCall`: marks point; Thor satellite (§5) fires a laser scaled by Thor level; if Thor is not present a level-0 Thor is used | `thorCall` ×3 |
| kalsiddon | mechanical | cfg shot | `split`: at apex (vy ≥ 0) splits into 4 projectiles with fanned vx | cfg heavy |
| jfrog | bionic | cfg slime | `crawl`: on terrain impact becomes a surface crawler moving in the original travel direction for N px, then explodes | `crawl` longer + splits |
| dragon | bionic | cfg `damageType: 'fire'` strong | cfg `count: 3` fire balls | cfg big fireball, large carve |
| knight | mechanical | `markThenSwords`: mark; 3 swords fall vertically with small spread | 5 swords | 9 swords, wide |

`dragon` and `knight`: `randomOnly: true`, `randomWeight: 1` versus `randomWeight: 10` for the
others (so ≈ 1.2% each when picking Random).

Mines (raon): `MineState { x, y, ownerSeat, hp, radius, speed, ttlTurns }`. At the start of each
turn every mine walks `speed * 60` px toward the nearest enemy along the terrain surface (using
the same step/slope rules as mobiles), then explodes if within `triggerRadius`. Any explosion
within its `radius` detonates it. Mines expire after `ttlTurns`.

Shot 1 for every mobile uses angle range and delay values that make it the "safe" shot; Shot 2
trades reliability for damage or utility; SS is the big swing.

---

## 4. Items

`packages/shared/src/data/items.ts`. Six slots, chosen in the room before the match. One item
per turn. Items are applied to the current turn only.

| id | displayName | slots | delay | effect |
|---|---|---|---|---|
| dual | Dual | 2 | +300 | fires the selected shot twice (second fire 20 ticks after the first, same angle and power) |
| dualPlus | Dual+ | 2 | +350 | fires S1 then S2 |
| teleport | Teleport | 1 | +250 | click a point: moves the mobile there (must be air above ground); costs the whole move gauge |
| healSmall | Bandage | 1 | +150 | +150 HP |
| healLarge | Med Kit | 2 | +300 | +400 HP |
| bunge | Bunge | 1 | +200 | carve radius ×2.2 for this shot, damage ×0.7 |
| powerUp | Power Up | 1 | +250 | damage ×1.5 for this shot |
| windChange | Wind Change | 1 | +200 | reroll wind now (uses the match PRNG) |

Items are **consumables**: a loadout entry is spent the moment it is used and is gone for the rest
of the match (`PlayerSlot.items` is the loadout, `PlayerSlot.itemsUsed` what has been spent). The
shared intent is `{ t: 'useItem', seat, itemId, target? }` and `rules/items.ts` validates it with
`canUseItem(state, seat, itemId, target?)`: the id exists, it is the seat's own active turn, the
mobile is alive, the seat still owns an unspent copy, no other item has been used this turn, and —
for Teleport — the target is inside the map, in the air, with ground within reach below it and not
on top of another mobile. Dual, Dual+, Bunge and Power Up are held in `MatchState.turnMods` until
the turn ends; the item's delay is banked into `MatchState.pendingDelay` through `itemDelay`
(§7 item 19). The shared mechanics (Dual's gap, the teleport probes) are in `constants.items`; the
magnitudes (heal, multipliers) are in `data/items.ts`.

---

## 5. Sky events

`data/sky.ts`. At match start the map rolls one active sky event (or none) per `sky.rollTable`
(40% chance of opening with weather). Weather then comes and goes (§7 item 163): an event lasts
`sky.weather.minTurns`..`maxTurns` (2–4) completed turns and then the sky clears; every turn that
ends under a clear sky rolls `sky.weather.arriveChance` (30%) for a new event, picked off the same
table without its `none` row. Events sit in a horizontal band of the map, drawn in the parallax
layer between background and terrain.

- **Thor**: satellite at the top of the map. Level starts at 1. Any explosion within
  `thor.triggerRadius` of an enemy mobile adds a laser from Thor to the impact point dealing
  `thor.baseDamage * level`. Thor gains +1 level every `thor.levelEveryHits = 3` triggered
  strikes, max level 5. `aduka` S2/SS call Thor explicitly.
- **Tornado**: vertical column `x ± tornado.halfWidth`. A projectile entering it is captured
  (`vx, vy = 0`), rides up `tornado.liftPx` over `tornado.holdTicks`, then is released with a new
  velocity: same speed, direction rotated by `±tornado.exitAngleDeg` from vertical (sign from PRNG).
- **Force**: horizontal band `y ∈ [top, bottom]`. Every sub-step a projectile is inside, it flags
  `data.force = 1`; explosion damage ×`force.multiplier = 1.5` if flagged.

Sudden death (§2.9) is a rule, not a sky event, and always applies.

---

## 6. Network protocol

All messages are JSON over one WebSocket (`/ws`). Every message is `{ t: string, ...payload }`.
Types live in `packages/shared/src/net/protocol.ts` and are shared by client and server.

### 6.1 Client → server

| t | payload | notes |
|---|---|---|
| `hello` | `{ nick, token? }` | token from localStorage for reconnect |
| `createRoom` | `{ mapId?, maxPlayers?, listed?, practice? }` | responds `roomState`; `listed` puts it in the lobby's open-rooms list; `practice` adds one Normal bot on team B and makes the room unlisted (§11) |
| `joinRoom` | `{ code }` | |
| `listRooms` | | responds `roomList`; the lobby polls it every few seconds |
| `leaveRoom` | | |
| `setTeam` | `{ team: 'A' \| 'B' }` | |
| `setMobile` | `{ mobileId \| 'random' }` | |
| `setItems` | `{ items: ItemId[] }` | ≤ 6 slots; a one-slot item may be repeated, a two-slot one may not (§7 item 98) |
| `setMap` | `{ mapId }` | host only |
| `setReady` | `{ ready }` | |
| `start` | | host only; needs ≥ 2 players, both teams present, all ready |
| `addBot` | `{ team, difficulty }` | host only, lobby; takes a seat like a player (§11) |
| `setBot` | `{ playerId, team?, mobileId?, difficulty? }` | host only, lobby; a bot's lobby picks |
| `removeBot` | `{ playerId }` | host only, lobby |
| `chat` | `{ text }` | room or match |
| `move` | `{ dir: -1 \| 0 \| 1, seq }` | edge-triggered: send on key down / up |
| `aim` | `{ relAngle }` | throttled; server clamps to mobile range |
| `selectShot` | `{ shot: 's1' \| 's2' \| 'ss' }` | |
| `useItem` | `{ itemId, target?: { x, y } }` | |
| `fire` | `{ shot, relAngle, power, seq }` | power ∈ [0,1] |
| `skip` | | |
| `charging` | `{ power }` | the power bar a few times a second while the charge key is held; negative means "stopped charging" (§7 items 18 and 31) |
| `requestTerrain` | | client asks for full mask after hash mismatch |
| `ping` | | keep-alive; the server answers `pong` and nothing else |

### 6.2 Server → client

| t | payload | notes |
|---|---|---|
| `welcome` | `{ playerId, token }` | store token |
| `error` | `{ code, message }` | |
| `roomState` | `{ code, hostId, mapId, maxPlayers, players: PlayerInfo[], phase }` | full lobby state, sent on every change |
| `roomList` | `{ rooms: { code, host, mapId, players, maxPlayers }[] }` | listed rooms in their lobby with a free seat and someone connected, fullest first |
| `chat` | `{ from, text, ts }` | |
| `matchStart` | `{ seed, mapId, players: SeatInfo[], skyEvent }` | client builds initial `MatchState` from this; identical on all clients. `SeatInfo` carries `items: ItemId[]`, the seat's loadout (§4), which `createMatch` takes as `SeatSpec.items` |
| `turnStart` | `{ seat, turn, deadlineMs, wind, delays: number[], ssReady: boolean[] }` | |
| `moveEcho` | `{ seat, dir, x, y, facing, gauge, tick }` | the authoritative walk: sent on every direction edge and then at ~10 Hz while the mobile moves or falls. `dir` is the intent to apply at `tick`; x/y/gauge are for lerping a client that is not tick-aligned |
| `aimEcho` | `{ seat, relAngle, tick }` | already clamped to the mobile's range |
| `shotEcho` | `{ seat, shot, tick }` | the authoritative shot selection; a timer expiry fires `slot.shot`, so every engine needs it |
| `itemUsed` | `{ seat, itemId, target?, tick }` | the authoritative item use: every client applies `{ t: 'useItem', seat, itemId, target }` at `tick`, exactly as it applies `fire` |
| `fire` | `{ seat, shot, relAngle, power, shooter: { x, y, facing, tilt }, wind, rngState, items: ItemId[], tick }` | the authoritative fire command: every client runs the sim from this exact start |
| `skipEcho` | `{ seat, tick }` | the `fire` message's twin: the turn ended without a shot |
| `chargingEcho` | `{ seat, power, tick }` | echo of the client's `charging`, so every engine's timer expiry fires (§7 item 31) |
| `turnEnd` | `{ snapshot: Snapshot }` | positions (q8), hp, shield, delay, defenceMod, wind, PRNG state, mines, sky state, terrain hash, turn counter |
| `resync` | `{ snapshot, width, height, rle, turn: TurnStart payload }` | everything a returning client needs in one message (§6.4) |
| `terrainMask` | `{ width, height, rle: string }` | on request or when server detects mismatch report |
| `playerLeft` / `playerReconnected` | `{ seat }` | the socket dropped / came back; the match state is untouched either way |
| `playerForfeit` | `{ seat, tick }` | the grace expired or the player left: every engine applies the same `forfeit` intent, which kills that mobile |
| `matchEnd` | `{ winnerTeam, reason }` | |
| `pong` | | keep-alive |

### 6.3 Flow of one turn

1. Server picks next seat by delay, sends `turnStart`.
2. Active client sends `move` / `aim` / `selectShot` / `useItem`. Server applies to its sim,
   broadcasts echoes. Others lerp.
3. Active client sends `fire`. Server validates (right seat, turn active, power in range, angle
   in range), snapshots the shooter, broadcasts `fire` to **everyone including the shooter**.
   The shooter does not fire locally before the echo (round trip is ~100 ms; acceptable, keeps one
   code path).
4. Every client runs `step()` until the shot resolves, rendering as it goes. Server does the same
   in real time. Every authoritative message carries the `tick` the server applied it on: a client
   whose clock is aligned applies it at that tick and stays bit-identical, and one that is ahead
   applies it immediately and lets step 5 reconcile.
5. Server sends `turnEnd` with the snapshot. A snapshot is q8-lossy, so **both sides quantise
   at this point** (`snapshotForTurnEnd`, which every client calls too, hash match or not);
   otherwise the client would hold rounded values while the server holds raw floats and every
   later turn would mismatch forever. Client compares its own hash. Match ⇒ done. Mismatch ⇒
   overwrite mobiles/wind/PRNG/etc. from the snapshot, and if the terrain hash differs,
   `requestTerrain`. The client logs a desync counter visible in a debug overlay (`?debug=1`).
6. Repeat. `matchEnd` when one team has no living mobiles.

A `Snapshot` and a state hash are only comparable between engines running the *same* phase of the
project: the Phase 2 turn machine added fields to both (§2.1), so a Phase 1 hash or snapshot means
nothing to a Phase 2 engine and vice versa. There is no version field yet because both ends are
deployed together.

### 6.4 Reconnection

- `welcome.token` is stored in `localStorage`. On page load the client sends `hello` with it.
- On socket close the server keeps the seat for `reconnectGraceMs = 60 000` and changes nothing
  in `MatchState` (`slot.connected` is never written during a match: it feeds `nextSeat`, it is
  not in the hash, and no client can see a socket — see Assumptions). If the player returns, the
  server sends `roomState` + (if in match) `matchStart` + one `resync` carrying the snapshot, the
  terrain mask and the current `turnStart` payload.
- If the grace period expires during their turn, the turn is skipped. When it expires, the player
  forfeits: their mobile is removed; the match continues or ends.
- Rooms with no connected players are deleted after `roomTtlMs = 10 min`.

---

## 7. Assumptions and choices

Recorded so they can be revisited; each is cheap to change because it is data or a single module.

1. **SS availability** is a gauge (turns taken + hits received) rather than a fixed turn count.
   Feels closer to "earned" than a timer; `ssGaugeMax` is one number.
2. **Power bar at max**: holds at 1.0 until release. The original fired automatically at overflow;
   holding is more forgiving and keeps release as the only fire trigger.
3. **Timer expiry while charging** fires the shot at current power instead of skipping.
4. **Delay tie-break** is seat index; "time on turn" adds +1 per second so long turns are mildly
   penalised.
5. **No fall damage.** Falling off the map is instant death.
6. **Wind changes every 2 completed turns**, not per round, because rounds are ill-defined under
   delay ordering.
7. **Shield regen** happens at the start of the owner's turn, not every global turn.
8. **Mines walk at the start of each turn** (all mines, regardless of owner), which is simpler and
   still produces the creeping-threat feel.
9. **Thor without a Thor sky event**: aduka's S2 still works using a level-1 satellite that only
   aduka can trigger.
10. **Random pick weights**: 10 for normal mobiles, 1 for dragon and knight.
11. **Sudden death** is a damage multiplier after a total turn count, rather than shrinking terrain.
12. **Shooter waits for its own fire echo** instead of predicting locally; simplicity over 100 ms.
13. **Team assignment**: 1v1 rooms auto-assign A/B; larger rooms let players toggle. Host can start
    with uneven teams if everyone is ready (it is a private game).
14. **The dev sandbox** is a Vite route (`/sandbox`) compiled only when `import.meta.env.DEV` is
    true, so it never ships in the production build.
15. **Map spawn points** are generated per map: alternating team positions spread across the width,
    each dropped onto the first solid pixel below.
16. **Angle ranges** are relative to tilt and per mobile, e.g. armor `[-10, 70]`, lightning `[20, 85]`.
    Facing mirrors the aim through the vertical (§2.4), it does not flip the elevation.
    Walking always turns the mobile to face the way it moves; there is no separate turn
    action and no backward walk. (Phase 2 may revisit this — a dedicated turn intent would
    let a player reposition without losing the aim — but one rule is easier to play.)
17. **Turn durations are tick counts**, not milliseconds: `startingTicks: 30`,
    `activeTicks: 1200`, `endingTicks: 45`. The simulation has no clock (§2.1), so the
    timer is a counter `step()` decrements. `resolving` has no design duration and gets a
    `maxResolvingTicks: 3600` watchdog, so a shot that somehow never settles ends the turn
    anyway instead of freezing the match.
18. **A `charging` intent** carries the client's current power bar a few times a second.
    The charge itself is client-side (§2.10 only puts the *released* power on the wire),
    so without it the simulation would have no way to honour item 3 above — firing at the
    current power when the timer expires. A negative power means "stopped charging".
19. **Delay is banked when the turn ends**, after the shot has resolved, not at the moment
    of firing. The cost is computed when the action happens (shot or skip, plus one per
    whole second of `active` used, plus items in Phase 5) and held in
    `MatchState.pendingDelay` until then, so the HUD's order does not reshuffle while a
    shell is still in the air.
20. **`upcomingOrder(state, n)`** is the current standing — eligible seats sorted by
    (delay, seat) — not a forecast. Only its head is a promise; the rest move as soon as
    the seat ahead of them pays for its turn.
21. **The SS gauge is filled but never spent in Phase 2**: +1 per own completed turn and
    +1 per hit taken, uncapped, and `ss.gateEnabled = false` so nothing is locked behind
    it yet. Phase 5 turns it into a real gate and resets it on use.
22. **Two turn counters.** `MatchState.turn` is the turn being played (1-based; 0 before
    the first one and for the whole of a `freePlay` match); `completedTurns` is how many
    have finished. The wind schedule (§2.7) and sudden death (§2.9) read `completedTurns`.
23. **A `turns` match opens its first turn on its first `step()`**, not inside
    `createMatch`: `createMatch` returns a state, not an event stream, and `turnStart`
    should be a real event that every engine sees at the same tick.
24. **`projectileExpire`** is emitted when a projectile leaves the world or is culled by
    age. Phase 1 left that silent, which gave the client's camera nothing to return on.
25. **Only the active seat's intents are accepted, and only during `active`.** A
    `freePlay` match accepts everything, which is what lets the dev sandbox drive both
    mobiles from one keyboard.
26. **The power charge accumulates in real time**, at the animation frame rate, not on
    the fixed 60 Hz sim clock: holding the key for `power.chargeSeconds` fills the bar
    exactly once whatever the frame rate or a dropped tick backlog does. Only the
    released value reaches the simulation, quantised to 1/1000 (§2.10), plus the
    `charging` intent at `input.chargeSendHz` = 5 Hz. The sim keeps its own accumulator.
27. **Control follows `state.activeSeat`.** The client never picks the seat it drives in
    a `turns` match, so the Phase 1 "switch controlled mobile" key is gone; `Tab` now
    cycles the shot selection (S1 → S2 → SS) as the brief asks, `1`–`6` are the six item
    slots (empty until Phase 5), `X` skips the turn, `` ` `` restarts the sandbox match
    in `freePlay` mode and `C` switches the driven seat while in it. The in-match
    controls all have an on-screen twin in the bottom bar — shot buttons for `Tab`, item
    slots for `1`–`6`, `SKIP` for `X`, `FIRE` for `Space`, angle arrows for `↑`/`↓` and
    move arrows for `←`/`→`. The sandbox-only keys (`` ` ``, `C`, `R`, `N`, `F`, `M`) do
    not: they are dev conveniences and go away with the sandbox.
28. **The free camera is released when a shot is fired.** Dragging or edge-scrolling
    parks the camera until the next shot or `turnStart` takes it back, which is the rule
    the brief asks for; the `F` toggle obeys the same rule rather than being sticky
    across a shot. A `projectileExpire` shortens the return delay, because a shot that
    left the world leaves nothing to linger on.
29. **The turn timer is drawn under the wind dial**, and the HUD's own "banner" line
    under it reads the phase: `TURN n — nick` while `starting`, `YOUR TURN — nick` while
    `active`, `SHOT IN FLIGHT` while `resolving`, `WAITING FOR nick` while `ending`.
    The delay list shows banked delays only, never `pendingDelay`, so the order cannot
    reshuffle while a shell is in the air (item 19).
30. **`connected === false` is a lull, not a result.** If no seat is connected when a
    turn should open, the machine stays in `ending` and looks again `endingTicks` later
    rather than ending the match as a draw, so a simultaneous socket blip at a turn
    boundary cannot kill a match both players are about to rejoin (§6.4's 60 s grace).
    Only "one team has no living mobile" ends a match; a forfeit in Phase 3 kills the
    mobile rather than merely clearing `connected`.
31. **`charging` is echoed by the server** (`chargingEcho`, §6.2). Every engine runs
    `step()` and so every engine reaches the timer expiry; the expiry fires instead of
    skipping only where `chargingPower` is known (item 3). Without the echo a non-active
    client would skip, leave `active`, and then drop the authoritative `fire` because
    `turnAcceptsIntent` rejects intents outside `active`. The snapshot carries
    `chargingPower` too, for a resync taken mid-charge.
32. **A charge that never got a `charging` report fires at ~0 power.** Pressing the
    charge key less than one report interval (`input.chargeSendHz`, 5 Hz) before the
    timer expires means the simulation's last known power is the first sample, near
    zero: the shell drops at the muzzle. This is kept — a dud at your feet for grabbing
    the trigger at the buzzer is the honest artillery-game outcome, and the alternative
    (a minimum power floor) would silently change a shot the player did aim.
33. **The active mobile dying during its own turn ends that turn immediately**, at no
    delay cost. `applyIntent` ignores everything a dead mobile sends, so nothing could
    otherwise shortcut the 20 s timer; and a dead seat never takes another turn, so what
    its delay would have been does not matter.
34. **The `resolving` watchdog clears what it was waiting on.** When
    `turn.maxResolvingTicks` runs out the machine empties `projectiles` (with a
    `projectileExpire` each), `pendingSpawns` and `turnEffects` before ending the turn,
    so one stuck entity cannot cost every following turn the same 60 s. Cross-turn
    entities (mines, §3) therefore must not live in `turnEffects`.

35. **Every authoritative message carries a `tick`.** `fire`, `skipEcho`, `moveEcho`,
    `aimEcho`, `shotEcho`, `chargingEcho` and `playerForfeit` all say which tick the
    authority applied the intent on. Without it two engines that apply the same shot
    two ticks apart bank a different time cost (§7 item 19 — `+1` per whole second),
    which is part of the state hash, so a perfectly reproduced shot would still
    mismatch. A client that is tick-aligned steps to that tick and applies the intent
    there; one that is already past it applies immediately and takes the `turnEnd`
    reconciliation. `packages/server/test/testClient.ts` is the first kind and asserts
    equal hashes; a browser client is the second.
36. **`skipEcho` and `shotEcho` exist** because §6.2 had no authoritative twin for two
    intents that change the turn. A voluntary skip would otherwise leave the other
    engines sitting on the timer, and a stale shot selection would fire the wrong shot
    on a timer expiry (the machine fires `slot.shot`).
37. **`slot.connected` is never written while a match runs.** `canTakeTurn` reads it, it
    is not in the state hash, and a client cannot observe a socket — so a server that
    flipped it would silently desync the turn order. A dropped player therefore keeps
    their seat *and* their turns: an unattended turn simply runs out its 20 s timer and
    skips, identically on every engine. When the grace expires the server broadcasts
    `playerForfeit` and every engine applies the same `forfeit` intent (a new shared
    intent) which kills that mobile where it stands. §7 item 30's "lull" case is
    therefore not reachable from a disconnect in Phase 3; it remains the safety net for
    a seat that is set disconnected for any other reason.
38. **The server ticks at 60 Hz for the whole match**, not lazily between turns. §1.4
    allowed either; the turn timer is a tick count (§7 item 17), so a lazy loop would
    have to keep an equivalent schedule anyway. The loop is a drift-corrected
    accumulator: `setInterval` only wakes it, and it runs the ticks it owes, up to
    `MAX_CATCHUP_TICKS` at a time so a suspended machine cannot replay minutes of
    simulation in one blocking burst.
39. **The room rolls, the match rolls.** Random mobile picks (§7 item 10) and the sky
    event are drawn from the *room's* PRNG, seeded from `node:crypto`, never from the
    match stream — `createMatch` has to leave the match PRNG at exactly the same
    position on every engine, and the client is only told the outcome (`matchStart`
    carries the resolved `mobileId` per seat and the rolled `skyEvent`). A rolled id
    with no definition yet falls back to the first implemented mobile, so the resolver
    is already the Phase 4 one.
40. **`packages/server` has three modules more than §1.4 lists**: `log.ts` (one logger,
    one `LOG_LEVEL`), `connection.ts` (the socket wrapper, so nothing else imports
    `ws`) and `player.ts` (the identity that outlives a socket). The static file server
    lives inside `index.ts`, and the five modules §1.4 names all exist and do what it
    says.
41. **Leaving a match on purpose forfeits immediately.** `leaveRoom` during a match gets
    no grace period: the player closed the door themselves. Only a dropped socket waits
    out `reconnectGraceMs`.
42. **A dropped player keeps their lobby slot too**, not just a match seat, for the same
    grace period, so a page refresh in the room screen does not lose the room.

43. **The lobby and the room are DOM, not canvas.** They are menus — a text field, a
    list, a scrolling chat log — and reimplementing those with a blitter would cost more
    than it buys. They use the HUD's palette and monospace so the two halves still look
    like one game, and the CSS lives in `client/index.html`. Only the match is canvas.
44. **Four client modules more than §1.3 lists**: `scenes/matchView.ts` holds
    everything the sandbox and the networked match have in common (backbuffer, camera,
    world drawing, HUD, keyboard and mouse, the real-time charge, the fixed-timestep
    loop) behind a small `MatchViewDriver` interface — the sandbox's driver applies an
    intent locally, the match's driver puts it on the socket. `ui/dom.ts` and
    `ui/chat.ts` are the menu helpers and the chat panel that the room screen and the
    in-match overlay share. `net/clock.ts` is the authority's clock (item 45), split out
    of the match scene so the one property a networked client cannot get wrong — never
    simulating past the server — is a pure function of the messages seen and their
    arrival times, and is unit-tested against jitter without a browser. The four scenes
    and the two `net/` modules §1.3 names all exist and do what it says.
45. **The browser client caps its own clock at the authority's** instead of free-running
    at 60 Hz. `state.turnStartTick` is part of the state hash (§2.1), so an engine whose
    absolute tick counter has drifted by even one mismatches at every `turnEnd` however
    perfectly it reproduced the shot — §7 item 35's "a real-time client drifts and gets
    corrected" would mean a desync every single turn, and the counter would stop meaning
    anything. So the match scene remembers the last tick the authority reported and when
    it heard it, and lets the local simulation run no further than that tick plus the
    real time since. The client therefore runs exactly one network latency behind the
    server, applies every authoritative message at the tick it names, and matches the
    authority's hash turn after turn. A stalled tab still catches up through `stepTo`,
    bounded by `net.maxCatchUpTicks`, and falls back to the snapshot beyond that.

    **The cap carries a margin** (amended after Phase 3 playtesting). "The last tick the
    authority reported plus the real time since" is an estimate built from *one*
    message, and it is only safe if that message was not unusually fast: a message that
    arrived quickly lets the local clock run past a tick the server has not reached yet,
    and then the next message names a tick this engine has already passed — a `move`
    applied one tick late shifts the whole walk by a tick, a `turnEnd` compares
    `turnTicksLeft` one tick apart, and the hashes disagree although the replay was
    perfect. Two things fix it. Every message is read as an estimate of *when the
    authority's tick 0 happened on our clock* (`received − tick × tickMs`); latency and
    the server's own scheduling can only push that estimate later, never earlier, so the
    **largest** estimate is the honest one and is the one kept (bounded by
    `net.tickOriginRelaxMs`, so one slow message does not cost lag for the rest of the
    match). On top of it the cap subtracts `net.tickCapSlackTicks` (2), never falling
    below the last tick the authority actually reported. On the server side the match
    loop wakes every `loopWakeMs` (5 ms) rather than once per tick, so a tick is
    processed a few milliseconds late instead of up to a whole tick late. With both, a
    multi-turn match with walks reports zero desyncs, which is what the e2e suite (§10)
    asserts.
46. **Aim is requested, not applied locally.** The active player's angle is accumulated
    client-side, sent no faster than the server accepts it (`net.aimSendMs`, 45 ms
    against the server's 40 ms floor) and only enters the simulation through `aimEcho`.
    The HUD and the aim line draw the *requested* angle while an echo is in flight, so
    the dial follows the key immediately while the simulation stays authoritative; the
    override is dropped the moment the simulation agrees, which in the sandbox is the
    next tick.
47. **`moveEcho` snaps a mobile only when it is visibly wrong.** The echo carries the
    authority's position; a difference under `net.moveSnapPx` (6 px) is ordinary
    latency and is left for `turnEnd` to reconcile, a larger one is snapped at once
    rather than letting the two drift apart on screen for the rest of the turn.
48. **`roomState` carries `maxPlayers`** (§6.2 table amended). The room screen shows
    "2 / 4" with it, and it is what decides whether the team toggle is offered at all:
    a two-seat room assigns A and B by itself (item 13), so the buttons would be noise.
49. **A rename re-sends `hello`.** `hello` is the only message carrying a nickname and
    the server already treats a second one on a live socket as a rename, so the lobby
    calls it before creating or joining if the name changed after the socket opened.
50. **A reconnected client re-sends `joinRoom` for the room it is showing.** If the
    token was honoured the server has already replayed `roomState`, `matchStart` and
    `resync` and the extra message answers with another `roomState`; if the server
    forgot us (it restarted, or the grace expired) the answer is `noSuchRoom` and the
    client drops back to the lobby with that message, instead of leaving a dead room on
    screen. `roomInMatch`, `roomFull` and `notInRoom` are treated the same way.
51. **Leaving a running match is a button.** `leaveRoom` during a match forfeits
    immediately (item 41), so the match screen carries one small "Forfeit & leave"
    control rather than making a player close the tab. The end-of-match plate is the
    ordinary way out and returns to the room.
52. **The match scene is rebuilt on every `matchStart`**, including the one a reconnect
    replays. The alternative — patching a live scene from a `resync` — has two code
    paths where one will do, and the camera settling again is a small price.
53. **The smoke test reads numbers, not pixels.** The match HUD is canvas, so a browser
    test can assert nothing about it. With `?debug=1` the match scene publishes the
    same values its debug panel draws — seat, active seat, turn, completed turns,
    phase, tick, desync count, ended — as live getters on `window.__gunbrosMatch`
    (`MatchProbe`). It is created only under the debug flag, removed with the scene,
    and read by nothing in the client. The desync counter is what the Playwright test
    (§10) actually checks: two engines that both reached the next turn with zero
    desyncs agreed with the authority's hash.
54. **`?debug=1` is read once at boot and re-attached to every URL the shell writes.**
    The shell rewrites the location when it enters a room (`/r/CODE`) and when it drops
    back to the lobby; a plain rewrite dropped the query, so the flag died half a
    screen before the match it was meant to instrument. The flag is now a constant
    read at boot and the only query parameter a rewrite keeps.
55. **The e2e suite is a separate workspace package that builds nothing.** `pnpm e2e`
    runs Playwright in `e2e/`, which starts `node ../packages/server/dist/index.js` on
    port **8099** — not 8080, so a dev server left running is never mistaken for the
    build under test, and with `reuseExistingServer: false` so a stale listener fails
    the run instead of being tested. `pnpm build` first is therefore part of the
    contract, and the root `pnpm test` filters to `packages/*` so the unit tests never
    drag a browser in. Its script is called `e2e`, not `test`, so that `pnpm -r test`
    cannot recurse into it and launch a browser against a `dist` that may not be built
    yet. The suite plays three turns and walks before the shot in two of them, because a
    charge-only turn never exercises `moveEcho`, which is the message most sensitive to
    the clock (item 45).
56. **A snapshot clears what this engine still had in flight.** A `Snapshot` carries no
    projectiles (§6.3 step 5), so when one arrives with a phase other than `resolving`
    the authority has already decided what that shot did: any projectile, pending spawn
    or turn effect still held here is stale. Left alone, a shell this client applied a
    tick late keeps flying through `ending` and explodes a *second* time — damage the
    server never dealt, which can kill a mobile locally that is standing on the
    authority and take that player's input away for the rest of the match.
    `applySnapshot` therefore empties the three lists, and the client reports each
    dropped projectile as an ordinary `projectileExpire` so the camera comes home.
57. **Only the authority ends a match.** The local simulation reaching `phase: 'ended'`
    shows nothing: the end plate (and the `ended` latch behind it, which stops input)
    is raised by the server's `matchEnd` and by nothing else. A client that applied one
    shot a tick early would otherwise end a match that is still being played.
58. **The in-match countdown is counted off the simulation**, not off `turnStart`'s
    `deadlineMs`. The local tick is held at the authority's (item 45), so
    `secondsLeft(state)` *is* the server's count, while `deadlineMs` is the server's
    wall clock and comparing it with the browser's would show the skew between two
    machines as a wrong timer — the whole point of Phase 3 being two machines.
    `deadlineMs` stays in the protocol as a human-readable debugging aid.
59. **A `resync` taken mid-`resolving` holds the client's clock** until the next
    authoritative message. The snapshot carries no projectiles (item 56), so a client
    rebuilt from it finds the turn settled and would end it before the authority does —
    banking delay and possibly rerolling the wind off the PRNG. Holding is one boolean;
    the alternative (putting live projectiles in `resync`) is a protocol change for a
    case that lasts a few hundred milliseconds.
60. **`matchEnd.reason` remembers what killed the mobile.** A forfeit kills a mobile
    exactly as a shell does, so the simulation's `matchEnd` event cannot tell them
    apart: the runner records the cause when it applies a `forfeit` and clears it at
    every `turnStart`. A match whose loop throws is closed as `abandoned` with no
    winner, and the room returns to the lobby — one bad tick in one room must not take
    the process, and every other room, with it.
61. **`hello` on a socket that already has a player is a rename**, never a reconnect:
    the lobby re-sends `hello` to change a nickname (item 49), and taking the reconnect
    branch there would replay `matchStart` and a `resync` to a client that never went
    anywhere. A `hello` carrying a *different* player's token detaches the current one
    through the ordinary disconnect path first, so a crafted client cannot strand a
    player that is connected forever, holding a seat and keeping its room unreapable.
62. **Every socket has a message budget.** A token bucket (`messagesPerSecond`,
    `messageBurst`) closes a socket that goes past it with 1008, because most messages
    cost a broadcast to the whole room and only a few of them were throttled
    individually. A real client peaks at a few dozen messages a second while walking.
63. **One file per mobile, one file per sprite.** `data/mobiles.ts` became
    `data/mobiles/index.ts` (the id union, `ShotDef`/`MobileDef`, the ordered
    `mobileDefs` list and the lookups) plus `data/mobiles/<id>.ts` for each of the
    eighteen, and `sprites/mobiles/<id>.ts` likewise. Phase 4 is four agents in one
    working tree (§9), and two of them editing one 2000-line roster file would collide
    on every change; this way the only shared files are the two indexes, which the
    integrator owns. `data/mobiles.ts` survives as a re-export shim so no import path
    written before the split had to move. A mobile file imports `MobileDef` with
    `import type`, which `verbatimModuleSyntax` erases, so the index and the files it
    loads are not a runtime cycle.
64. **The seventeen unwritten mobiles ship as stubs, not as gaps.** Each one carries its
    real `id`, `displayName`, `class`, `randomOnly` and `randomWeight` and a hue-shifted
    armor sprite, and clones armor's numbers for everything else. So the roster is
    complete and *playable* from the start of Phase 4: the room picker lists sixteen
    mobiles, Random rolls over all eighteen, and `determinism.test.ts` plays a four-turn
    match with every id — which means a group's first commit is covered by the
    determinism net before it has written a test of its own.
65. **Display names are evocative and deliberately not the ids** (Sorcerer, Delver,
    Triclops, Stomper, Zephyr, Sapper, Tempest, Vortex, Orbital, Frostbite, Deepshell,
    Skipper, Herald, Shrike, Croaker, Wyvern, Paladin). They are data next to the id
    (§3) and renaming one touches nothing else; armor keeps "Armor".
66. **The behaviour registry is split in two.** `entities/behaviours/registry.ts` holds
    the types, the key→module map and `basic`; `entities/behaviours/index.ts` imports
    the seventeen modules, re-exports everything and registers them in one fixed order.
    A behaviour module therefore imports only `registry.js` and never the file that
    imports it, and the registration list is the one place that knows the roster.
    Lookup stays by the string key in `ProjectileDef.behaviour`.
67. **`mark` takes a payload and calls the behaviour back.** `ctx.mark(x, y, ticksUntil,
    { behaviour, kind?, data? })` schedules a `TurnEffect` and emits a `mark` event; when
    the effect comes due the reducer calls `onTurnEffect(effect, ctx)` on the named
    behaviour and retires the effect. Without the behaviour key on the effect the
    reducer would need a `switch` over every mobile's kind — which is exactly the shared
    file four agents must not have to edit. Chaining is done by scheduling another
    effect; an effect whose behaviour has no hook simply disappears, so a half-written
    behaviour can never hang the turn.
68. **`beamStrike` is a context primitive, not four copies of one.** Lightning bolts,
    satellite beams, Thor's laser and knight's swords are all "a vertical column at
    column x from `fromY` down to `y`": `ctx.beamStrike(x, y, fromY, width, def,
    ownerSeat?)` carves the column as overlapping circles of `width / 2` (the terrain has
    no column primitive and a beam is rare), emits one `beam` event, and damages every
    mobile by its distance to the *segment* with the def's ordinary falloff — so a
    mobile in the beam takes the centre value, one beside it takes the edge, and nobody
    is damaged twice. `ownerSeat` is last and optional because the caller is usually the
    active seat.
69. **Two new `ProjectileDef` fields carry ice and shield-break.** `defenceDebuff` is
    added to `MobileState.defenceMod` of everything the shot damages, capped at
    `constants.debuff.max` and thawed by `constants.debuff.decayPerTurn` at the start of
    the *victim's* own turn (`rules/turn.ts`); damage is multiplied by `(1 +
    defenceMod)` (§2.6). `shieldDamageMultiplier` makes the shield lose `amount × mult`
    points, and only the share of the raw amount actually spent on the shield is kept
    off hp — at the default 1 it is exactly the old rule. Both are data, so ice and mage
    need no core change.
70. **An impulse is a velocity, not a teleport.** `MobileState` gained `vx`;
    `applyImpulse(seat, dx, dy)` adds to `vx`/`vy` and takes the mobile off the ground,
    and `stepMobile` integrates `vx` only while airborne, stopping it against a wall and
    scaling it by `constants.mobile.landingFriction` (0 — raise it to let a thrown
    mobile skid) on landing. `vx` is in the state hash because only an impulse ever sets
    it, so two engines that disagree about it disagree about a pull that has already
    happened; `vy` stays out, as it always has.
71. **Mines are state, not effects, and walk on a turn hook.** `MatchState.mines` is a
    list of `MineState` carried by `hashState` and by the snapshot, and it never blocks
    `isSettled` (§3, §7 item 34). `rules/turn.ts` gained `registerTurnHook(key, {
    onTurnStart?, onTurnEnd? })`, which runs the registered hooks in **sorted key
    order** — never registration order, which would depend on which module a bundler
    loaded first — and `entities/mines.ts` registers itself under `mines`. Phase 5's
    items and Phase 6's sky events have the same hook to hang off.
72. **`thorStrike` lands in Phase 4, at level 1.** aduka's S2 needs Thor before Phase 6
    writes the satellite (§7 item 9), so `rules/sky.ts` ships one function — a
    `beamStrike` scaled by `sky.thor.baseDamage × level` — and a `thorLevel(state)` that
    answers 1 today. Phase 6 replaces the body of the second and no caller changes.
73. **The Random roll moved into shared data.** `randomMobileId(roll)` walks
    `mobileDefs` (all eighteen, `randomOnly` included) by `randomWeight`, and the server
    only supplies the `nextFloat` from the room's PRNG (§7 item 39). The protocol guard
    now uses `isPickableMobile`, so `setMobile` accepts every id except dragon and
    knight and the room picker and the server agree by construction.
74. **The sandbox picks mobiles from the URL.** `/sandbox?a=<mobileId>&b=<mobileId>`
    seats the two (armor for anything unknown) and `P` cycles the controlled seat's
    mobile through the roster and restarts the match. It is the fastest way to look at a
    Phase 4 mobile: no server, no room, no second browser.
75. **Beams and marks are rendered generically.** `client/render/effects.ts` draws any
    `beam` event as a fading bright column and any `mark` event as a blinking crosshair,
    keyed off nothing but the event, so a Phase 4 group adds a mobile without touching
    the client at all. `mineSpawn` / `mineMove` / `mineExplode` and `pull` exist in the
    event union for the same reason.

76. **A shot that calls something down waits as a live projectile, not as a
    `TurnEffect`.** lightning's bolts and asate's beams both mark a point and strike it
    a fixed number of ticks later. A `TurnEffect` carries numbers only (item 67), but
    the strike needs the shot's damage *type* and sprite, which are data in the mobile's
    file — so instead of scheduling an effect, the shell parks itself on the point it
    marked (velocity zeroed each sub-step, impacts ignored) and fires the strike from
    `onTick`. A live projectile holds `isSettled` false exactly as a pending effect
    would, so the turn still waits; it gives the camera something to sit on; and it
    needs no core change. The `mark` event is emitted directly, so the client still
    blinks its crosshair (item 75).

77. **A bolt may arrive at an angle, so lightning carves and damages its own column.**
    `ctx.beamStrike` (item 68) is vertical by construction, which is all asate's
    satellite needs, but DESIGN §3 gives lightning's S2 `angleDeg: 30`. `markThenBolt`
    therefore carves the slanted channel itself (as overlapping circles, and only where
    there is something to carve — a bolt crosses hundreds of px of empty sky), emits the
    `beam` event with `x1 ≠ x2`, and resolves the damage with `ctx.damageArea` around
    the point the bolt lands on. The damage table, shields, debuffs and the SS gauge all
    behave as they do for an explosion, because `damageArea` is the same one path.

78. **A mine carries its own `climb`.** DESIGN §3 says a mine walks "using the same
    step/slope rules as mobiles", and `constants.mine.maxStep` (4 px) is that rule — but
    the delivery charge that drops the mine leaves a crater whose rim is steeper than
    that, so a mine with a mobile's step limit is trapped in the hole it arrived in.
    `MineState.climb` (data, per shot, `params.mineClimb`) is the tallest rise that mine
    can step up; it defaults to `constants.mine.maxStep` and is carried by the snapshot
    like `speed` and `radius`. Raon's mines climb 14/20 px, which is enough to cross any
    crater in the roster.

79. **An explosion detonates a mine from `damageArea`, and a spent mine has `hp` 0.**
    DESIGN §3 wants a blast within a mine's `radius` to set it off. The trigger lives at
    the end of `makeContext().damageArea` in `match/reducer.ts` rather than in `explode`,
    because that is the one call *every* blast in the game goes through — the default
    explode, a lightning bolt, a satellite beam, a falling sword, another mine — and
    reading the trigger off the terrain instead missed every shot whose carve radius is
    smaller than a mine's own (lightning 14/16/20, bolts 6–9, raon S2 18, mage S2 20).
    `beamStrike` triggers separately at the foot of its column, because a beam does not
    go through `damageArea`. Two guards keep it finite: a re-entry latch in `makeContext`
    (a mine's own blast resolves through `damageArea` again, and a mine is inside its own
    radius), and `detonateMine` setting `mine.hp = 0` before it damages anything, so a
    chain that started somewhere else cannot set the same mine off twice. `hp` is hashed
    and snapshotted, so both engines agree on which mines are spent. The turn-end
    `minesShakenLoose` sweep stays as the fallback for a mine left hanging in mid-air by
    a carve that was not a blast — a burrow's tunnel, a beam's column.

80. **`restitution` is the normal component only; grub gets a second friction for the
    tangent.** §2.5 calls `restitution` "bounce energy kept", and the core's own bounce
    scales the *whole* velocity vector by it — which makes a skipping shot stall rather
    than skip, because it loses as much of its run as of its hop. `entities/behaviours/
    bounce.ts` therefore resolves every terrain contact itself: the into-surface half of
    the velocity is reflected and keeps `restitution`, the along-surface half keeps
    `params.bounceFriction`. Below `params.rollSpeed`, or once the bounces are spent, a
    contact *rolls* instead — the velocity is projected onto the surface tangent and
    scaled by `params.rollFriction` — so the slug runs along flat ground, accelerates
    down a slope and detonates where it comes to rest, under `params.restSpeed` or after
    `params.maxRollTicks`. The core's bounce is untouched and still serves anything that
    does not name the `bounce` behaviour.

81. **A skip and a frost hit are `mark` events.** §7 item 75 makes `mark` the generic
    "something happened at this point" the client already draws, and there is no
    `bounce` or `chill` event in the union — adding one would mean editing `match/
    events.ts` and the renderer, which no Phase 4 group may do. So grub emits a `mark`
    with `kind: 'bounce'` at every skip and ice emits one with `kind: 'frost'`, both
    through `ctx.emit` with `ticksUntil: 0`, which schedules nothing and simply flashes
    the crosshair for `fx.markTicks`. The behaviour tests count them, which is also the
    cheapest honest way to assert "it bounced three times".

82. **`converge` spawns its own twin rather than using `ShotDef.count`.** Turtle's S2 is
    two balls with *opposite* lateral drift, and a `count: 2` shot gives both projectiles
    the same def and the same `onSpawn` with nothing to tell them apart — the sign would
    have to come from a module-level counter (not in the hash) or from projectile-id
    parity (a coincidence, not a rule). Instead the shot is `count: 1`: the ball the
    `fire` intent produced claims `data.side = 1` and spawns its twin with
    `{ side: -1 }`, and the guard on `data.side` is what stops the twin spawning a third.
    The drift is added to `vx`, not to `x`, so the pair is still integrated and
    collision-walked like any other shot, and the separation is an exact triangle wave.

83. **A behaviour cannot reach `MatchState`, so `rules/sky.ts` answers the Thor level
    twice.** `thorLevel(state)` is for callers that have the match; `defaultThorLevel()`
    is the same answer for callers that do not, which is every `Behaviour` —
    `BehaviourContext` deliberately carries no state handle. `thorCall` uses
    `params.level` when the data names one and `defaultThorLevel()` otherwise, so
    Phase 6 has one body to change (and can pass the real level through `params` or a new
    context field without touching aduka). While it was there, `thorStrike` also began
    taking the beam's width from the *resolved* def rather than from
    `sky.thor.beamCarveRadius`, so a caller that overrides `carveRadius` widens the
    column it sees as well as the hole it leaves.

84. **Ice chills twice, and the second chill is a scheduled effect.** The core already
    stacks `ProjectileDef.defenceDebuff` on everything a shot damages, so the `debuff`
    behaviour would otherwise be an empty module. It earns its place by marking the
    impact and blooming there `params.lingerTicks` later: a carve-free `damageArea` at a
    fraction of the shell's damage carrying a second, smaller `defenceDebuff`. So a
    target that stays in the crater is softened twice by one shell, which is the
    attrition identity DESIGN §3 gives Frostbite, and the whole of it is data.

85. **The shooter is immune to its own shot until it has left its own hull, not for a
    fixed number of ticks.** `constants.projectile.ownerGraceTicks` (2) survives as a
    floor, but `entities/projectile.ts` latches `p.data.leftOwner` the first sub-step the
    body is outside the owner's footprint box, and the owner cannot be hit before that.
    A tick count could not cover either family of muzzle self-kill: sprites whose barrel
    pivot sits inside their own footprint at some legal angles (grub's pivot is left of
    and above its anchor, kalsiddon's is low under a tall hull) fired a slow quarter-power
    shell that had not cleared the box in two ticks, and the multi-body shots put one body
    a ring radius *behind* the muzzle on the first sub-step. The accepted dud is
    unchanged: a 10 %-power shot whose muzzle *is* outside the hull leaves, falls back and
    detonates at its owner's feet (§7 item 32).

86. **`orbit` and `weave` open from a point.** Both scale their offset from 0 to
    `params.radiusPx` / `params.amplitudePx` over the first `params.rampSubSteps`
    sub-steps. This is the data half of item 85 — with the full offset applied
    immediately, a spinning ring walked a spoke back through the shooter's chest even
    after the latch had cleared it, because the spoke had briefly been outside the box.
    Ramping also reads better: a ball that splits open rather than three that appear
    spread out. The offsets of a full ring still sum to zero at every scale, so the
    centre of mass is untouched and the two behaviours stay position-offset-only.

87. **`burrow` has a depth cap as well as a tick budget.** `params.maxDepthPx` detonates
    the drill once it is that far below the point it entered the ground. Without it a
    shell that went into a *floor* rather than a wall had no far side to break out of and
    spent its whole budget diving — gravity bends the heading a little further down every
    sub-step — so nak's S2 landing 40 px short of a target on open ground exploded ~290 px
    of solid rock beneath it for nothing, and was a worse shot than the plain S1 lob. The
    cap is smaller than the shot's own carve radius, so the crater still opens at the
    surface. A tunnel through a wall runs level and never reaches it.

88. **`pull` caps the horizontal impulse at the distance to the crater.** `pullStrength /
    dist` grows without bound as a target gets closer to the blast, and the impulse is a
    velocity flown for `2 * lift / gravity` ticks (§7 item 70), so the *nearest* target
    was flung the hardest: 20 px from a jd S2 crater used to land 137 px on the far side.
    The cap is `|dx| / flightTicks * params.overshootFactor`, and `overshootFactor: 1`
    means the mobile lands on the centre. Outside ~120 px the linear falloff is below the
    cap and nothing changes, so only the vortex's own close range is affected.

89. **Mines do not walk in `freePlay`.** Walking, triggering and the shaken-loose sweep
    all hang off the turn hooks in `rules/turn.ts`, and `stepTurn` returns immediately in
    `freePlay` mode. Every online match and the sandbox's default are `turns`, so this is
    a sandbox limitation only: with the sandbox's free-play toggle on, a raon mine sits
    where it landed. The blast trigger (item 79) still works in both modes, because it
    hangs off `damageArea` rather than off a turn hook.

90. **Playtest notes, not defects.** Recorded so the next pass knows they were seen and
    left: boomer's `windFactor: 3` means wind acceleration at strength 26 (0.117 px/tick²)
    exceeds the shot's own gravity (0.096), so a 60° / 0.8 throw into a 26 head wind is
    blown back over the thrower — that is the intended feel until played. Wind can carry
    a 70 %-power shot past `width + cullMarginPx` and off the map with no visible result,
    which matches §2.7 numerically. bigfoot's SS fans 22°, so the lowest missile can clip
    a slope rising in front of the shooter and splash it. ice's SS has a fixed 48-tick
    fuse, so a low-power shell cracks next to its owner. grub's S1 at 45° / full power
    leaves a 1600 px arena without a single bounce. All five are `data/mobiles/*.ts`
    numbers; none needs a code change.

91. **The SS gate binds a `turns` match only.** `ss.gateEnabled` is true from Phase 5
    (§7 item 21): `selectShot` and `fire` of `ss` are both refused below
    `ss.gaugeMax`, and firing one resets the gauge to 0. A `freePlay` match is exempt,
    because it has no completed turns to earn the gauge with — the dev sandbox
    (§7 items 14 and 74) exists precisely so that any mobile's SS can be looked at, and
    a gate there would lock away a third of the roster with no way to unlock it. The
    refusal is inside `performFire`, so the one path that does not come from an intent —
    the timer expiring on a charge (§7 item 3) — falls back to a skip instead of hanging.

92. **An item is spent, not equipped.** DESIGN §4's "six slots" is a *loadout*, and every
    entry in it is a single use: `PlayerSlot.items` never changes and `PlayerSlot.itemsUsed`
    grows. Both are hashed and snapshotted — the loadout because a `resync` should be
    enough on its own, the used list because two engines that disagree about what is left
    disagree about what a later turn may do. One item per turn, and a refused item costs
    nothing at all, not even its delay.

93. **Bunge and Power Up are resolved where the damage is, not on the fired def.**
    Multiplying `ShotDef.projectile` at the trigger would miss everything a behaviour
    creates afterwards — kalsiddon's split, ice's shards, turtle's bubbles, lightning's
    bolt — so instead `damageArea`/`beamStrike` multiply by `itemDamageMultiplier(state,
    ownerSeat)` and `explode` scales its crater by `itemCarveMultiplier(state, ownerSeat)`.
    Both are keyed on the blast's **owner**, not on whose turn it is, so a mine another
    seat dropped three turns ago is not boosted by my Power Up when it goes off during my
    turn.

94. **Dual's second volley is a queued spawn, not a second trigger pull.** It goes into
    `pendingSpawns` in its entirety, at `tick + constants.items.dualGapTicks`, which is the
    queue a staggered multi-shot already uses: the volley is born through `ctx.spawn` on the
    tick it is due (so its behaviour's `onSpawn` runs there), it holds `isSettled` false
    until it has resolved, and it needs no new machinery. It emits no second `fire` event
    and plays no second fire animation — the muzzle flash would be drawn now for shells
    that leave twenty ticks later — so the renderer follows its `spawn` events instead.

95. **Dual+ replaces the selection rather than adding to it.** DESIGN §4 says "fires S1
    then S2", so a turn with Dual+ fires S1 first whatever the player had selected, and
    banks S1's delay plus the item's 350. An SS selection is therefore *not* spent by a
    Dual+ turn. The alternative — the selected shot then the other one — has no answer for
    an SS selection and makes the item's cost depend on what was picked.

96. **Teleport lands where the ground is, not where the click was.** The target must be
    air, inside the map and with ground within `items.teleportGroundProbePx` below it; the
    mobile is then moved there and `settleOnGround` drops it onto that ground. The
    "not inside another mobile" check is made at the **landing** point for the same reason.
    It costs the whole move gauge (§4) and stops the walk first, so a mobile that
    teleports mid-stride cannot carry on walking from its new spot on a gauge it no longer
    has.

97. **Sudden death moved out of `rules/damage.ts`.** It is a pure function of
    `completedTurns` (§7 item 11), so nothing stores it; `rules/suddenDeath.ts` answers
    `suddenDeathLevel`, `suddenDeathMultiplier` and where each level starts, and
    `finishTurn` emits a `suddenDeath { level, multiplier, completedTurns }` event on the
    one turn end that crosses a threshold, so the client can raise a banner without
    polling. `constants.suddenDeath` is `{ afterTurns, multiplier, secondAfterTurns,
    secondMultiplier }`.

98. **A loadout may repeat a one-slot item, never a two-slot one.** Every item is a
    consumable (item 92), so "three bandages" is a sensible six-slot loadout and the
    room accepts it; `packages/server/src/protocol.ts` only refuses a *second* copy of a
    two-slot item, which would spend four of the six slots on one trick and would make
    Dual or Dual+ a two-turn certainty. The budget itself is unchanged — the slots still
    have to add up to `itemSlots` — and `validateLoadout` in shared, which `Room.setItems`
    now runs the accepted list through, is what decides what the match will actually
    honour, so the room state, `matchStart.players[].items` and `PlayerSlot.items` are
    the same list on every engine.

99. **`itemUsed` arrives before the `fire` it modifies, so `fire` carries no modifier.**
    The server applies a `useItem` the instant it validates it and broadcasts
    `itemUsed { seat, itemId, target?, tick }` on the same turn of the event loop; one
    WebSocket delivers in order, so every engine has `turnMods.dual` (or `bunge`, or
    `powerUp`) in its own state before it applies the `fire` that follows, and
    `FireBroadcastMsg.items` is a label for logs rather than an input (§6.2). The tick is
    captured *before* `applyIntent` for the same reason a shot's is: Wind Change draws
    from the match PRNG. The refusals are a coarser vocabulary than the simulation's
    `ItemRejection`: the server answers `error` with `badItem`, `itemNotOwned`,
    `itemAlreadyUsed`, `itemThisTurn`, `badTarget` (all five target rejections),
    `notYourTurn` or `deadMobile`, and puts the exact `ItemRejection` in the message
    text. The SS gate (item 91) answers `ssNotReady` on both `selectShot` and `fire`,
    where the simulation alone would only refuse silently. Only an *accepted* item is
    rate-limited (`config.itemMinIntervalMs`), because only an accepted one costs the
    room a broadcast; a use that trips that floor is answered `itemTooFast` rather than
    dropped in silence, so nothing is ever spent without the player being told.

100. **The HUD's six slots show the *controlled* seat's loadout**, even while the rest of
     the bottom bar follows the seat whose turn it is (item 27: the bar follows the
     focus, the keys drive our own mobile). Keys `1`–`6` spend our items, so a row
     showing somebody else's would be a row whose keys did something other than what it
     drew. A two-slot item is drawn as one panel spanning both of its rectangles, a spent
     one is greyed and struck through rather than removed — the slots are a fixed map of
     the loadout, not a shrinking list — and the caption under the row names whatever the
     pointer is over. The bar's power and move gauges gave up a few px so the item names
     fit at 10 px (`clientConstants.hud.items`, `power`, `gauge`, `move`).

101. **Teleport is a two-step interaction on the client.** Key `3` (or a click on its
     slot) arms a targeting mode instead of sending anything: a crosshair follows the
     mouse, a click on the map sends `useItem` with that point, Esc, pressing the slot
     again, or losing the turn cancels it. The crosshair's colour comes from the shared
     `checkTeleportTarget`, so what the client greys out and what the simulation refuses
     are the same rule, and the label names the refusal (`ItemRejection`) rather than
     just reddening. Nothing is spent until the click: an item refused at the point of
     use costs nothing at all (item 92).

102. **The client refuses a locked SS before the socket does.** `ssAvailable` gates the
     SS button, `Tab` skips over it, and a release of the charge on a locked SS raises a
     line instead of a `fire` message. The server refuses it too (item 99) and remains
     the authority; this only stops the player losing a full charge to a message that was
     never going to be accepted. The SS button keeps drawing its gauge from `ssReady`,
     which is "is the bar full", and prints `n/max` while it is not.

103. **The turn that fires an SS still earns its +1.** `performFire` zeroes the gauge at
     the trigger and `finishTurn` then adds `ss.gainPerOwnTurn` for the turn that has
     just completed, so the seat ends an SS turn on 1, not 0, and the *next* SS is three
     own turns away rather than four. DESIGN §2.9's "resets to 0 on use" describes the
     trigger, which is where the reset belongs: the turn was played and is paid for like
     any other. `turnStart.ssReady` is false throughout and the HUD reads `1/4`, so
     nothing disagrees; `ss.gaugeMax` is the number to turn if the cycle feels short.

104. **Firing an SS drops the selection with the gauge.** A seat left selecting an SS it
     can no longer fire has a dead turn coming: the `fire` intent is refused inside
     `performFire`, the HUD's own gate (item 102) raises a line instead of sending, and a
     charge that runs into the timer expiry fires `slot.shot` (item 36) and therefore
     becomes a skip. So `performFire` sets `slot.shot = 's1'` after spending the gauge —
     but only when the gate has actually locked it, which leaves free play (item 91,
     where the gate is off) selecting the SS so the sandbox can fire it again.

105. **The SS gate asks about the key that will be fired, not the one that was sent.**
     A Dual+ turn fires S1 whatever is selected (item 95), so the server's `onFire` and
     the client's release both resolve `turnMods.dualPlus ? 's1' : shot` before they
     consult `ssAvailable`. Gating on the raw selection instead refused on the button a
     shot that the simulation fires on a timer expiry — the two routes to a shot have to
     answer the same question.

106. **Free play forgets a turn's items when the shot settles.** `turnMods` is cleared by
     `finishTurn`, which never runs in `freePlay` (item 89), so one Dual in the sandbox
     used to double every later shot from either seat. The sandbox driver is what clears
     them: it remembers that a `fire` went out and calls `resetTurnMods` on the first
     frame where `isSettled` is true again — after the shot, never before it, or the
     Bunge and Power Up multipliers would be gone by the time the blast asked for them
     (item 93). A `turns` match is untouched by this; it has a real turn boundary.

107. **Dual's second volley leaves from the muzzle the trigger was pulled at.** The
     queued spawn (item 94) carries the position, so a shooter that falls — or is blown —
     between the two volleys watches the second one appear where it used to be. It is
     deterministic on every engine (the same queue, the same numbers, no desync), and
     recording the muzzle is what lets the volley be one plain `PendingSpawn`. Storing
     the seat and recomputing at spawn time is the fix if it ever looks wrong.

108. **Teleport may be used in the air, and its target is judged when it is applied.**
     Nothing in `canUseItem` asks for `grounded`: a mobile blown off its perch may still
     teleport out, which reads as a rescue rather than an exploit. The cost is that
     `checkTeleportTarget` is the one authoritative message whose validation reads state
     that moves every tick (the other mobiles' positions, and the user's own mobile being
     alive), so a client whose clock is a few ticks off the message tick can answer
     differently from the authority. The window is bounded by `net/clock.ts` to about one
     one-way latency and `turnEnd` reconciles it; if it ever bites, the fix is to let an
     authoritative `itemUsed` skip the mutable checks the server has already made.

109. **A heal at full HP is refused by the HUD, not by the rule.** `canUseItem` has no
     "already at full" clause on purpose — it would add a third piece of per-tick mutable
     state to the one validation that two engines have to agree on (item 108) — so the
     client stops the press and keeps the item instead, the way it stops a locked SS
     (item 102). The simulation still heals for 0 if something ever sends it.

110. **One function decides what a loadout may hold.** `canAddToLoadout` in
     `shared/data/items.ts` is the six-slot budget *and* the no-repeat rule for two-slot
     items (item 98); the room's picker, the server's `setItems` guard and
     `validateLoadout` all call it, so a button the picker leaves enabled is never
     answered with `badItems`, and a list that reaches `createMatch` by any other route
     is trimmed to the same rule. The room also stores the loadout only once the server
     has accepted it (`roomState.players[].items`), never the request: remembering a
     refused list meant offering it again on the next join and losing the loadout to a
     `badItems` line.

111. **No AudioContext exists until the page has been touched.** Browsers refuse to
     start one before a gesture, and a context built eagerly sits `suspended`, logs a
     warning and swallows the first sounds of the match — and the smoke test (§10)
     fails a run that put anything on the console. So `audio/synth.ts` builds nothing
     until `unlock()` is called from the first key or click `MatchView` sees, and every
     cue before that is dropped rather than queued. The cost is that the turn-start
     chime of the very first turn is silent if nobody has pressed anything yet, which
     is the right trade: a player who has not touched the game is not listening to it.

112. **The audio mapping is pure and the synthesis is not.** `audio/sfx.ts` turns
     events into `SfxCue`s (`{ name, level, pitch }`) with no browser involved, and
     `audio/synth.ts` turns a cue into oscillators. Only the first half is tested
     (`client/test/audio.test.ts`): whether a 40 px carve is louder than a 12 px one is
     arithmetic, whether it sounds good is not.

113. **One tick plays at most `audio.maxCuesPerTick` sounds, one per voice.** A single
     shell emits an explosion, a carve and several hits in the same tick, and a split
     shot multiplies that by eight; `mergeCues` keeps the loudest instance of each voice
     and then the most important three by a fixed priority (match end, sudden death,
     death, explosion, …). Without it a volley clips the master gain into mush.

114. **Your own events are pitched apart from everyone else's.** The turn chime rings a
     fifth up when the turn is yours, and damage to your own mobile a fourth down, so
     the two facts a player checks most often are audible without reading the banner.
     `selfSeat` is the only piece of context the mapping takes.

115. **The keys are a card (H), not a permanent line.** The always-on help strip was
     read for the first five minutes and was clutter for the rest of the match; it is
     now a panel toggled by H or its HUD button, and the drivers' `helpText()` is
     wrapped onto lines by `wrapHelpLines` (pure, tested) rather than trimmed by eye.

116. **Mute lives in three places and means one thing.** `M`, the speaker button and
     the stored session flag all go through the same `toggleMute()` (DESIGN §1.3
     `state/session.ts`), and muting ramps the synth's master gain to zero rather than
     gating each sound, so a note already scheduled is cut with everything else. (Since
     the music, the switch has three steps: item 180.)

117. **The reconnecting badge belongs to the match, not only to the shell.** The
     full-screen plate in `main.ts` stays, but the match scene draws its own small
     badge above the bar from `setStatus` (DESIGN §6.4): a player mid-turn needs to
     know why nothing is being echoed back without losing sight of the board.

118. **The sky's placement is drawn from its own stream, and `skyEventId` is an alias.**
     The tornado's column comes out of `Prng.seed(seed ^ salt)`, never `state.rng`, so
     `createMatch` leaves the match stream in exactly the position item 39 promises
     whatever the room rolled — and so the placement is a pure function of (kind, seed,
     map) that any engine can recompute. `MatchState.sky` holds the event; the old
     `skyEventId` field is a getter/setter onto `sky.kind` whose setter rebuilds the
     sky, so an engine that is told the event only *after* `createMatch` (the server's
     headless test client) lands on the same column as one that passed it as an option.
     `createMatch` takes `skyEvent` and the server and `net/playback.ts` pass it.

119. **Thor watches one hook: `damageArea`.** Every blast in the game ends up there
     (§4's item multipliers already live on the same path), so "any explosion within
     `thor.triggerRadius` of an enemy" is one rule rather than one per behaviour. One
     explosion calls down at most one beam whatever it is standing next to, the blast
     owner's own team never counts, and a re-entry latch — the twin of the mine latch —
     stops the beam's own damage (which can set a mine off, which is another explosion)
     from waking the satellite again.

120. **A behaviour reaches the satellite through the mark it schedules.** A behaviour
     only ever sees a `BehaviourContext`, never the `MatchState`, so `ctx.mark` stamps
     `data.skyThorLevel` — the satellite's level at the moment the point was painted —
     onto every effect it queues, and aduka's `thorCall` reads it (`params.level` still
     overrides, and a match with no Thor still gets the level-1 satellite of item 9).
     The field is numeric like the rest of a `TurnEffect`'s data, so nothing else about
     effects changes.

121. **A captured projectile is held, not flown.** While the tornado is carrying a
     shell, the sub-step belongs to the sky: no wind, no gravity, no segment walk and
     no behaviour `onTick`, and the shell rides the column's centre line. It happens
     once per projectile (`data.tornadoDone`), so a shell spat out of the column can
     fly back across it, and it is released at the speed it came in with — at least
     `tornado.minExitSpeed`, or a shell that crawled in would be dropped straight back
     down the funnel.

122. **Force is keyed off the projectile, not the seat.** `data.force` is set on the
     way through the band and read in `ctx.explode`, which is where a projectile's own
     blast damage is decided, so a def override and a behaviour that explodes by hand
     both keep it. It does not propagate to children a flagged shell splits into: a
     shard that crosses the band is flagged on its own way through, which is the rule
     the band describes.

123. **The Thor satellite is pinned into the view.** DESIGN §5 puts it at the top of
     the map, but the camera spends a match looking at the ground, so the renderer
     clamps it below the HUD's top strip and inside both screen edges — it doubles as
     its own off-screen indicator — and the HUD carries a one-line "SKY: …" plate for
     the event and Thor's level. Its presentation tunables sit in `render/sky.ts`
     rather than `data/clientConstants.ts` only because two phase-6 tasks were editing
     that file at once; they are one collected block and belong there.

124. **A spawn site is searched for, not computed.** Phase 1 put each seat in its slot
     and nudged it to the flattest column nearby, which is enough for a map that is
     solid everywhere. Three of the four maps are not: `pit` has a chasm, `islands` has
     gaps and thin shoulders, `cave` has a ceiling and stalactites. So `spawnGen` in
     `data/maps.ts` states what a legal column *is* — ground below it (the lowest solid
     run, never the cave roof), `minThicknessPx` of rock under the feet,
     `minHeadroomPx` of air above them, a surface drop no worse than `maxDropPx` over
     the footprint, and `minSeparationPx` from the seats already placed — and
     `computeSpawnPoints` takes the nearest column to the nominal slot that satisfies
     it, relaxing in fixed stages (looser slope, then no headroom, then anything with
     ground) rather than ever returning a site in a hole. The scan is a fixed step with
     the left side first and the jitter for every seat is drawn before any placement,
     so it consumes the PRNG in an order the map's shape cannot change.

125. **Spawn sites are sorted left to right, so seat order is map order.** With seats
     alternating A, B, A, B (item 15) that puts team A on the left and team B on the
     right of a 1v1 and interleaves them in a bigger room. The alternative — passing
     teams into the generator — would make the terrain module depend on the roster for
     one line of layout.

126. **The chasm and the gaps are holes, not floors.** `pit` cuts its chasm to the
     bottom of the map and `islands` leaves nothing at all under the sky between its
     masses, so falling in is the ordinary "below the map" death (§2.4) with no new
     rule, no kill plane and nothing in the state hash. `maps.test.ts` pins both: no
     column of the chasm holds a solid pixel, and no island reaches the map floor.

127. **The cave's floor and ceiling are pulled toward the middle of the map.** The
     camera cannot scroll below `height - 600`, so a ceiling drawn near the top of a
     900 px map would never be on screen while a mobile stands on its floor. Both bands
     sit inside the strip the camera actually reaches, which is what makes the roof
     something players aim under. Stalagmites are generated before stalactites and each
     tip is shortened to keep `cave.minClearancePx` of air above whatever the floor
     ended up being, so a bump and a spike in the same column can never seal the cave.

128. **Backgrounds are baked once per map, terrain is banded per run.** Each parallax
     layer is pre-rendered into one offscreen tile as wide as its repeat period and
     only as tall as the band it occupies; a frame is then two or three `drawImage`
     calls per layer plus one flat fill for the colour above or below it, so the cost
     of four maps' worth of mountains, mesas, sky islands and crystals is paid at map
     load, not per frame. The terrain renderer walks a column run by run for the same
     reason a ceiling needs it: a hanging slab is banded from its *underside* up and
     painted with `palette.ceiling`, everything else from its top down, and each band
     is an ordered 4×4 dither between a light and a dark tone. A palette that predates
     the dark tones still renders — the client derives them by darkening.

129. **The tornado's column is placed clear of the spawns, not merely away from the
     edges.** Item 118 keeps the draw in its own salted stream; the range it draws from
     (0.3w … 0.7w) turned out to contain every nominal spawn slot the generator uses —
     0.3w and 0.7w for two seats, 0.4w and 0.6w for four — so about one match in six
     started with somebody inside the funnel, every shell captured at the muzzle and
     thrown back at them. `createMatch` now passes the spawn columns into
     `createSkyState`, which slides the drawn column along the same range, in whole
     pixels, right first then left, to the nearest x that is
     `sky.placement.tornadoSpawnClearancePx` from every seat. The draw itself is
     untouched, so the placement is still a pure function — of (kind, seed, map, seats)
     now — and the spawn columns are closed over rather than stored, so the
     `skyEventId` setter (an engine told the event after `createMatch`) lands on the
     same column without adding a field to `MatchState`.

130. **Force boosts the payload, not only the shell's own blast.** Item 122 keeps the
     flag on the projectile and reads it in `ctx.explode`, which is right for every shot
     whose damage *is* its explosion. It is not most of the damage for the five mobiles
     whose shell is a spotter: lightning's bolt, asate's beam, aduka's Thor call,
     knight's swords and ice's frost bloom all deal their payload through `damageArea`
     or `beamStrike` and so ignored the band entirely. A behaviour that still holds the
     shell scales its payload def with `ctx.forceMultiplier(p)`; one whose payload
     outlives the shell carries `data.force` across the mark like `data.skyThorLevel`
     and scales with `forceMultiplierForFlag` on the other side. A shard a flagged shell
     splits into is still unflagged (item 122): the band is about crossing it, and a
     child crosses it on its own.

131. **The funnel does not drill.** `tornado.liftPx` (260) is taller than the cave's
     clearance, and a captured shell skips the segment walk (item 121), so on `cave` a
     lift that ran its full length released the shell *inside* the roof slab, where it
     burst invisibly or left the map. The hold now probes the column one step ahead and
     releases early at the last air pixel. The exit sign is still the next draw from the
     match stream either way, so the PRNG order is unchanged. A tornado under a roof is
     therefore a shot eaten and thrown at the ceiling rather than a shot that vanishes;
     whether the cave should have a tornado at all is a balance question for the roll
     table, not a code one.

132. **Spawn relaxation has two floors.** Item 124's stages gave up the slope, then the
     headroom, then everything: the last stage asked only for ground. On `pit` with a
     full room of eight that put seats 17 px apart — hulls overlapping — and once put
     one in a pocket of the chasm wall with eleven px of air over its head, where its own
     shells go off at the muzzle. The last stage now keeps `spawnGen.floorHeadroomPx`
     (half the design headroom) and `spawnGen.minSeparationFloorPx` (the widest
     footprint plus a little air) and widens its search to `wideSearchRadiusPx` instead,
     with one final pass that gives the headroom up but never the separation.
     `maps.test.ts` pins both for eight seats on every map.

133. **The cave's clearance is clamped from both sides.** Item 127 shortened each
     stalactite to keep `cave.minClearancePx` of air above the floor, but nothing
     stopped a *stalagmite* from growing up into a low stretch of bare ceiling: a tall
     spike on a high floor left corridors of ~177 px, and the maps test only missed them
     because it sampled every fifth column. Stalagmites are now clamped against the
     ceiling as stalactites are against the floor, and the test walks every column.

134. **A reconnect resets the replay guards.** `lastMoveSeq` / `lastFireSeq` refuse a
     `seq` that is not greater than the last one accepted, which is what stops a
     retransmitted key-up from restarting a walk. A page refresh rebuilds the match
     scene, and with it the client's counters, from 0 — so after a reload every message
     was refused until the fresh counters overtook the old socket's, i.e. one dead turn
     per shot the player had fired, each running out on the 20 s timer. The guards
     belong to the socket, which is gone, so `Room.onReconnect` clears them. The client
     also reports `charging: -1` on every release before it sends the `fire`, so a shot
     the authority never accepts cannot be fired for it by the timer at a stale power
     (§6.1 `charging`).

135. **A resync taken mid-flight costs one expected overwrite, not one desync.** The
     resync snapshot carries no projectiles (§6.4), so the returning engine cannot hold
     the authority's hash at the following `turnEnd` however healthy it is. That first
     mismatch applies the snapshot and asks for the terrain as usual but is not counted
     or warned about; everything after it is a real desync again.

136. **The sky event can be pinned.** `SKY_EVENT` (honoured by `MatchRunner.start`
     through `config.forcedSkyEvent`) replaces the roll for every match in the process.
     The roll is still taken, so the room's stream advances identically. Without it the
     server tests played under a `node:crypto`-seeded sky, which is why an assertion on
     the SS gauge after a shot failed once in ~10 runs and could not be reproduced: the
     tornado had thrown the shell back onto its shooter. The server suite pins `none`
     and then forces each of the three events in a dedicated test that asserts only what
     a random sky cannot break — both engines built the same column and band, and their
     hashes agreed at `turnEnd`.

137. **Three more client modules, and one derived HUD row.** Amending item 44: the
     client also has `render/sky.ts` (the funnel, the band, the satellite and the "SKY:"
     plate), `audio/sfx.ts` (the event → cue mapping over `audio/synth.ts`) and
     `net/wsUrl.ts`. The sky renderer's presentation tunables live in
     `clientConstants.sky`, which supersedes the last sentence of item 123. The toggle
     row and the sky plate take their y from `belowOrderPanelY()` rather than a pinned
     86, so a fifth row in the upcoming-order list pushes them down instead of growing
     through them, and the `?debug=1` panel moved from the top right — where the match
     scene's DOM "Forfeit & leave" button lives — to under the toggles.

138. **Amending §2.1's hash list.** It ends "…and finally the walking mines in list
     order"; the hash has since grown two more groups after the mines: this turn's item
     state (the `turnMods` bits and each seat's spent list) and then the sky event
     (`skyEventIndex(kind)`, `q8(x)`, `q8(top)`, `q8(bottom)`, `level`, `hits`). The
     header of `match/snapshot.ts` is the list that is kept in step with the code.
     Also: §7 item 83 names `sky.thor.beamCarveRadius`, which `data/sky.ts` calls
     `sky.thor.carveRadius` (aduka's per-shot `beamCarveRadius` param is a different key
     and is unchanged).

139. **The Force band is a height, so `pit` gets more of it than the other maps.** The
     band is `[0.25h, 0.45h]` of the map, which on `pit` (1050 px tall) is 263 … 473 —
     and the rims a seat stands on sit at roughly 430 … 570, so on some seeds a mobile
     *starts* inside the band: it fires pre-flagged shells and every shell aimed at it
     is flagged on the way in. Left as it is for now, deliberately: the fix is either a
     band measured from the mean surface rather than from the map top, or a per-map
     override on `MapDef`, and both are balance decisions to take after the map has been
     played rather than a defect to patch. It is deterministic either way — both engines
     compute the same band from the same seed.

140. **A sky-origin beam drills the cave roof, and that is the rule.** `beamStrike` and
     `markThenBolt.strike` carve from y = 0 down to the impact, so one Thor strike, one
     asate lance or one lightning bolt opens a hole straight through `cave`'s ceiling
     above its target. The alternative — starting the column at the roof's underside —
     would make lightning, asate and aduka unusable under the roof, which is most of the
     map. So the roof is destructible from above, the same way the ground is
     destructible from anywhere, and a match that goes long opens it up.

141. **The pit's lips have shelves.** The chasm itself is at least 450 px of empty
     column on every seed (item 126), so falling into the middle is death; but the wall
     noise (`chasmWallAmplitude` over `chasmWallWavelength`) leaves ledges within
     50 … 60 px of each rim, and about 3 % of the columns near a lip drop a knocked-back
     mobile onto one rather than into the hole. Kept: a shelf is a place to be stuck,
     not a place to be safe, and "blast them into the pit" is still the map's tactic. A
     monotone half-width per row would remove them if it ever reads as a bug.

142. **The backbuffer is 800 px wide and as tall as the screen asks for.** §1.3 and §2.2
     quote every number in the pixels of a fixed 800×600 window, and the width stays
     fixed because the whole design is written in it. The *height* is not: it is
     `clamp(round(800 × screenH / screenW), view.minHeightPx, view.maxHeightPx)`, so a
     4:3 window is still exactly 800×600 and a phone in landscape is 800×370 instead of
     a 4:3 window with a third of the glass painted black. The floor is 360 px — 800 over
     20:9 — because that is the tallest aspect the phones in this family have (Pixel 7 at
     915×412 lands on it exactly, the iPhone 13 family at 844×390 above it), so nothing in
     the family is letterboxed at all; wider than 20:9 gets thin bars top and bottom
     rather than a HUD with no room left for the world. Nothing in `shared` knows: the
     simulation never reads a screen size, and `constants.screenWidth/Height` are now only
     the shape of the desktop window the art was drawn for.

     Two consequences, both presentation:
     - *The scale is not always an integer.* A desktop still takes the largest whole
       number of **device** pixels that fits (a fractional `devicePixelRatio` is why the
       snap is counted in device pixels rather than CSS ones). A touch screen takes the
       exact fractional fit instead: it has two or three device pixels per backbuffer
       pixel to hide the unevenness in, and giving up 5 % of a phone's glass to keep the
       blocks perfectly square would trade the thing the player looks at for a thing they
       cannot see. `image-rendering: pixelated` and `imageSmoothingEnabled = false` hold
       either way. "Touch screen" is `(pointer: coarse)` **and** not `(any-pointer:
       fine)` (`ui/viewport.ts`'s `isTouchScreen`): coarse on its own means "the primary
       pointer is a finger", which a desktop with a touch monitor also answers yes to,
       and that machine wants the desktop's whole-pixel snap.

       The snap costs something on one common window, and it is accepted: a 1280×720
       laptop asks for a 800×450 buffer and a fit of 1.6, which floors to 1, so the board
       is drawn at 800×450 CSS px in the middle of the window — about 39 % of it, against
       the 52 % the old fixed 800×600-at-scale-1 filled. Nothing is clipped and the page
       does not scroll. The alternative is a half-step scale, which is a resampled pixel
       and the one thing this rule exists to prevent.
     - *The size changes while the game runs.* A rotation, a browser toolbar sliding away,
       a resized window: `Backbuffer.onResize` is the one event, and `MatchView` answers
       it by re-laying the HUD (`bottomBarLayout(view)`) and telling the camera how much
       map it can see (`Camera.setViewSize`). The available room is the visual viewport
       less the `env(safe-area-inset-*)` insets, which are also `#app`'s padding, so the
       HUD is never under a notch or a home indicator.

143. **A second HUD geometry for short views, rather than one that scales.** At a fit
     scale near 1 a backbuffer pixel is a CSS pixel, so the 18 px walk arrows that a mouse
     is happy with are 18 px targets for a thumb. `hud.compact` is a second set of
     geometry — only the numbers that differ, so every colour and animation period stays
     shared — chosen by two questions together (`hudVariantFor`): is this a touch screen
     (item 142's predicate), and is the view at or below `view.compactMaxHeightPx` (480).
     Height alone was the first rule and was wrong: 16:9 is the commonest desktop aspect
     there is and lands on a 800×450 buffer, so every ordinary desktop window lost the
     captions, the move count and the item digits — which are exactly the things a player
     with a keyboard is using. The height half still matters on its own side of the
     question, because a tablet is a touch screen with room to spare. It
     grows the bar to 124 px and everything a player presses during a turn past 44 CSS px
     on a 390-px-tall phone (fire, skip, the angle and walk keys, the three toggles),
     draws the angle readout and the power percentage at twice the size, and pays for the
     room by dropping what a desktop could afford: the MOVE/POWER/ITEMS captions, the move
     count, the 1-6 key digits on the item slots, and the fourth row of the delay list.
     Chosen by view height rather than by CSS size, so a 1180×820 tablet keeps the full
     HUD — at its 1.47 scale the full geometry is already finger-sized.

     The two layouts are pure functions of a `ViewSize` and a flag, and are unit-tested as
     such (`test/viewLayout.test.ts`): every widget inside the bar, no two of them
     overlapping, the hit test agreeing with the drawing, the full geometry on every
     mouse-driven window from 1920×1080 down, and the 44 px rule at 844×390. The flag is
     a parameter rather than a media query read inside `bottomBarLayout` precisely so the
     whole thing stays testable without a DOM. A HUD row hanging off the bottom of a
     phone looks perfectly fine in every desktop screenshot ever taken.

144. **One input path for a mouse and for fingers: Pointer Events, with a role per
     pointer.** `input/mouse.ts` is gone; `input/pointer.ts` reports where each pointer
     is and nothing else, and `MatchView` keeps a `Map<pointerId, PointerRole>` saying
     what each one is doing — holding FIRE, holding an arrow, sweeping the dial, panning
     the camera, placing a teleport. That map is the whole multi-touch design: a thumb on
     FIRE and a finger on the angle pad are two entries, not one global "the mouse is
     down", and the latched controls (`firePressed`, `angleHold`, `moveHold`) are
     *derived* from the map every time it changes rather than toggled. Derived, because
     a pointer the browser cancels never sends the release a toggle would have needed,
     and because two fingers on the same key must not release it when one lifts.

     Every pointer is captured to the canvas on `pointerdown`, so a thumb that slides off
     the FIRE key still reports its release; `pointerdown` is `preventDefault`ed, which
     is also what stops the browser synthesising a second, mouse-shaped press. Desktop is
     unchanged: a mouse is a pointer with hover, and hover is the only thing touch does
     not have (the item tooltip and the edge scroll ask for it and simply never fire).

145. **A held angle key accelerates.** `aimHoldFactor(heldMs)` is 1 for the first
     350 ms — so a tap is still a single-degree nudge — then ramps to 3.4× over 900 ms.
     A fixed rate is either too slow to cross a mobile's 80-degree range or too coarse to
     land on one degree; with the ramp the whole range takes about 1.2 s of holding. The
     ramp is shared by the arrow keys and the on-screen arrows, because it belongs to the
     *hold*, not to the control.

146. **The dial is a drag pad.** A vertical sweep anywhere on the angle dial sets the
     angle directly, at `aimDragDegPerPx` (0.8° per backbuffer px), measured absolutely
     from where the finger landed rather than accumulated — so a sweep that overshoots
     comes back to the same number instead of drifting. It is the primary aiming control
     on a phone: the arrows are 46 px keys and the pad is a 72×100 px thumb target that
     crosses the whole range in one gesture. `hudHitTest` offers it every point *last*,
     so it can never steal a press from a button whose rectangle it shares, and while it
     is held the dial face lights and the live angle is drawn on a plate *above* the bar,
     where the thumb is not.

147. **The charge is drawn on the FIRE key itself**, filling the plate from the bottom
     with the HOLD label replaced by the percentage. The power bar across the middle of
     the bar is the precise readout and stays; this is the one the hand is on, and a
     player whose thumb covers the key otherwise has no feedback at all.

148. **The backbuffer stops listening while the chat line is open.** A virtual keyboard
     halves the visual viewport, and `canvas.ts` sizes itself from exactly that — so
     without `Backbuffer.setFrozen` the HUD would be re-laid for an 800×180 window and
     laid back out a second later, with the camera re-clamped both times. The game is not
     being played while somebody types, so the size is simply held. Not until the *blur*,
     though — iOS fires that when the keyboard starts to slide away, and the viewport is
     still most of a keyboard short at that moment. The freeze is lifted by the
     `visualViewport` event that says the window is whole again (`height + offsetTop`
     back within a pixel or two of `innerHeight`), with `loop.keyboardSettleMs` as the
     fallback for a browser that never sends one; a desktop, where nothing shrank, takes
     that path immediately. The DOM half of the problem is `--kb-inset` (below), which is
     the opposite answer for the opposite reason: the chat line *does* have to move.

149. **The phone shell is CSS and one small module, not a mobile build.** There is one
     client. `ui/viewport.ts` turns off the browser behaviours that fight a canvas game
     — Safari's `gesture*` pinch zoom, and only on a touch screen, because the same
     events are a trackpad pinch in desktop Safari where suppressing them turns page zoom
     off for no gain — and publishes `--kb-inset`, how much of the window the virtual
     keyboard has taken, which is the only number the DOM overlays cannot work out for
     themselves. Double-tap zoom needs no listener: `touch-action` covers it on the
     canvas and `manipulation` covers the menus. Everything else is media queries in
     `index.html`: `(pointer: coarse)` grows every control past 44 px and puts the hover
     styles behind `(hover: hover)` — a finger's `:hover` sticks after the tap, which on
     the loadout bar left a slot showing its "click to remove" red for the rest of the
     screen. `(orientation: landscape) and (max-height: 520px)` is the landscape-phone
     pass: captions beside their fields instead of above, the mobile picker and the item
     shelf as strips that scroll sideways instead of grids that scroll down, the player
     list stripped to name and ready state, and Ready/Start given the full width of the
     card at the end of it (they used to be `position: sticky`; item 161 is why they are
     not). Fields are exactly 16 px, which is the size below which iOS zooms the page in
     on focus and never back out. The `.btn.small` 36 px exception is declared *before*
     the rules that size the controls floating over the match canvas, because CSS at
     equal specificity is decided by source order and the earlier version of this had the
     exception quietly winning (item 160).

     Known limit, and this is the whole of it, measured rather than remembered
     (`test/viewLayout.test.ts` asserts exactly this list, so the paragraph cannot drift
     from the geometry):
     - At 19.5:9 and 20:9 — the iPhone 13 family at 844×390, the Pixel 7 at 915×412,
       where the fit scale is about 1 — everything a turn needs clears 44 CSS px except
       the three shot rows, which are 124×34: a row, not a square, and wide enough that
       the short side is not what a thumb misses.
     - A 4:3-ish landscape phone — an iPhone SE at 667×375 — gets a 800×450 backbuffer at
       scale 0.83, and there nothing but FIRE (70×47) and the drag pad (60×83) reaches
       44: the arrows are 38, the toggles 37, SKIP 70×35, the item slots 35×43, the shot
       rows 98×27. They do not grow without a third geometry. The drag pad (item 146) and
       the FIRE key are the controls that matter there, and both clear the bar.

150. **Fullscreen is a button in the lobby, never automatic.** `requestFullscreen` plus
     `screen.orientation.lock('landscape')`, both guarded and both allowed to fail
     silently: iOS Safari has neither, and Chrome refuses the lock outside fullscreen.
     The button hides itself where `requestFullscreen` does not exist, because a button
     that does nothing is worse than no button. Automatic would need a gesture the lobby
     does not own, and a game that grabbed the whole screen on load is a game people
     close.

151. **A wake lock while a match is on screen.** A turn-based game is long stretches of
     watching somebody else play, which is the input pattern a phone reads as "nobody is
     here" before it dims. `navigator.wakeLock` is requested when the match scene mounts
     and re-requested on `visibilitychange`, because the browser drops the lock whenever
     the tab is hidden and does not give it back. Unsupported is a no-op.

152. **The room code is shared, not just copied.** On a phone the way a link reaches a
     brother is the share sheet, so the button tries `navigator.share` first and falls
     back to the clipboard everywhere it does not exist or is refused (a cancelled sheet
     rejects exactly like a failed one, so both land on the clipboard).

153. **The app is installable, with icons generated from the armor sprite.**
     `public/manifest.webmanifest` (standalone, `orientation: landscape`), the three
     `apple-` meta tags for iOS, which reads no manifest, and PNGs at 32/180/192/512 plus
     a maskable 512 written by `tools/icons.ts` (`pnpm icons`) on the same hand-rolled
     encoder the sprite previewer uses. Drawn from the sprite data rather than exported
     from an editor, so the icon cannot drift from the tank the player drives; committed
     under `packages/client/public/icons`, because a build must not need a codegen step
     (§1.5). No service worker: the game is useless without its server, so an offline
     shell would only ever show a disconnected lobby. The 32 px PNG is a `rel="icon"`
     fallback beside the inline SVG favicon rather than a file nothing points at.

154. **The held controls are read once a frame, not once a tick.** The walk direction and
     the aim ramp used to be sampled inside the fixed-timestep loop, next to `step()`.
     That loop does not always run: the local clock is capped at the authority's
     (item 45), and while a mobile walks the server echoes its position ten times a
     second, each echo stepping this engine straight to the tick it names — so the sim
     sits *exactly* on the cap and the tick loop breaks every frame without simulating
     anything. The release of the walk arrow was then never sampled: the `move dir: 0`
     that stops the mobile was never sent, and it walked on until the whole gauge was
     spent, with no way to stop it. Measured on two emulated iPhone 13s, it struck from
     each client's second walk onwards and was not touch-specific — a mouse held on the
     same arrow did the same thing, and only the keyboard's own edge tracking hid it.

     `MatchView.sendHeldIntents(elapsedMs)` now runs from the frame, beside
     `updateCharge`, which is where every other input already was. Nothing is lost: an
     intent is a message about what the player is doing *now*, and the authority decides
     which of its ticks to apply it on. The aim ramp's step is still quoted per tick and
     is scaled by the frame's length, so a 120 Hz screen and a stalled one sweep at the
     same speed.

155. **The gesture suppressors are for touch screens only.** See item 149.

156. **A walk ends on the authority's numbers, and the clock keeps a wider margin.**
     Two changes for one bug, and it is worth writing down what the bug actually was,
     because the obvious diagnosis was wrong twice.

     Every client played a match with exactly one desync in it: "#1 at turn N", always on
     that client's first walking turn, always repaired from the snapshot, and invisible
     unless you looked at the debug panel. The field that differed was a single one —
     `mobile N moveGauge`, by two or three pixels' worth. The positions agreed.

     What happens is this. The first `moveEcho` of a walk names the tick the authority
     applied the direction on. A client whose clock is a few ticks past that cannot
     rewind (`stepTo` never does, item 35), so it starts walking three ticks late and
     spends three ticks less gauge than the authority did — and then keeps that
     difference for the whole walk, because from there both sides step the same way. The
     *position* is quietly put right at the end of the turn: the authoritative `fire`
     overwrites the shooter's `x` and `y`. The gauge is not, and the gauge is in the turn
     hash. Hence a desync whose only symptom is a number nothing on screen shows.

     The fix is at the end of the walk, where it belongs: a `moveEcho` with `dir: 0` says
     the walk is *over* and this is where it ended, so the client takes its `x`, `y`,
     `facing` and `gauge` outright rather than weighing them against `moveSnapPx`. There
     is nothing left to reconcile at that point and every reason to be exact. The same
     applies when the local clock is past the echo's tick mid-walk (`late`), where this
     engine *knows* it applied the direction late. Ordinary mid-walk differences under
     `moveSnapPx` are still left alone, so a walk is not tugged into place ten times a
     second. Tilt is left to converge on its own — it is smoothed towards the terrain
     under the mobile, so once both sides agree on `x` they agree on tilt within a few
     ticks, well inside the quantisation the hash is taken at.

     `net.tickCapSlackTicks` went from 2 to 6 at the same time, which is the *frequency*
     half: it is how far behind the estimated authority clock the local sim is kept
     (item 45), and at two the walking client was past its own first echo's tick about a
     third of the time. Six makes that rarer but cannot make it impossible — a slow frame
     on a busy phone will still do it — which is why the snap above is the actual fix and
     this is only prophylaxis. It costs nothing visible, because the floor of
     `ServerClock.cap` is the last tick the authority actually reported: the slack limits
     how far *ahead* of the newest message this engine may guess, never how far behind it
     falls.

     And because a hash says *that* two engines disagree and nothing about what,
     `PlaybackResult.diff` now names the fields — "mobile 0 moveGauge 36352 vs 35840" —
     and `scenes/match.ts` prints them with the warning. Finding the above without it
     took an afternoon of instrumenting a build by hand.

157. **Audio is unlocked inside the event handler, not on the next frame.** WebKit starts
     an `AudioContext` only while a user-gesture indicator is live, and a
     `requestAnimationFrame` callback is a fresh task with none — so a game that called
     `Synth.unlock()` from its loop was silent on an iPhone and audible everywhere else,
     which is also why no test caught it. `PointerInput.attach` and `Keyboard.attach`
     take an `onPress` callback that runs synchronously at the top of `pointerdown` and
     `keydown`, and `MatchView.start` passes the unlock. The call from the loop stays as
     belt and braces: it costs nothing once the context is running.

158. **The controls card has a touch wording.** The card behind the `?` key is the first
     thing a new player presses and it listed key names — Tab, Space, 1-6, Esc — none of
     which a phone has. `MatchViewDriver.helpText(touch)` gets the same signal the HUD
     uses, and on a touch screen the card describes the three controls this pass added
     instead: drag the dial to aim, hold FIRE to charge, hold the arrows to walk. In the
     compact variant it is also drawn against the *right* edge of the bar, because the
     chat log is pinned bottom-left just above it and on a phone the two toggles that
     open them are neighbours in the same 44 px row.

159. **The layout freeze outlives the blur.** See item 148.

160. **Nothing that floats over the match canvas wears `.btn.small`.** The forfeit key
     and the lobby's fullscreen key did, and `.btn.small { min-height: 36px }` was
     declared *after* the coarse-pointer rule written specifically to make them 44 —
     same specificity, later wins, so the two buttons the rule existed for were the two
     that missed it. Both are plain `btn ghost` now, and the overlay rules were moved
     after the exception so source order stops being load-bearing in the other direction.

161. **The room's Ready/Start row does not float.** It was `position: sticky; bottom: 0`
     inside the scrolling setup card, on the reasoning that a player who scrolled down to
     the item shelf should not have to scroll back up to say they are ready. On a
     landscape phone the scroll position the room *opens* on puts the item shelf exactly
     under that row: every one of the eight item buttons had 0 of its 44 px reachable on
     an iPhone 13, and a tap meant for Teleport pressed Ready — or, on the host, Start
     match. A sticky row inside a scrolling card always covers whatever happens to be at
     the bottom of the window; there is no padding that fixes it. The row is the next
     thing under the shelf in the flow anyway, so scrolling to one shows the other.
     `touch.spec.ts` asks `document.elementFromPoint` what is on top of every visible
     item button at the room's initial scroll position, because this is invisible in a
     screenshot taken after scrolling.

162. **A loadout slot acts on the release; every other HUD key acts on the press.** A
     finger has no hover, so the caption that names an item — "bandage · 1 slot · +150
     delay" — never appeared on a phone, and the first tap on a slot spent the item. The
     slot's press now only claims the pointer; the caption reads out whichever slot a
     finger is resting on, and lifting on it is what spends it, so sliding off first is
     how a player who only wanted to read backs out. The room screen has the matching
     gap — the per-item explanation there is a `title`, which touch never shows — and
     answers it by spelling the loadout's total delay into the hint line under the bar.

163. **Weather comes and goes.** Amending §5's "one active sky event per match":
     `SkyState.turnsLeft` counts the completed turns an event has left, and
     `rules/sky.ts` `advanceWeather` runs in `finishTurn` right after the wind reroll. It
     counts the event down and clears the sky on its last turn, or — under a clear sky —
     draws the arrival chance, the kind and a placement seed from the match stream, in
     that order, and builds the new event with the same `createSkyState` the match
     start uses (the tornado kept clear of the *living* mobiles' columns instead of the
     spawns). The opening event's duration comes from its own salted stream, after the
     placement, so `createMatch` still leaves the match PRNG where it was (item 39).
     Both changes are announced as a `skyChange` event, which the client turns into a
     banner and the sky plate turns into a "N TURNS" countdown. `turnsLeft` is hashed
     after `hits` and carried in the snapshot. A pinned sky (`SKY_EVENT`, the sandbox's
     `?sky=`) sets `skyStatic`, carried in `matchStart`: the event stays for the whole
     match and nothing arrives, so the server suite's pinned `none` stays clear.

164. **On a touch screen the weapon cards are a 2 + 1 grid.** Amending item 143, which
     stacked S1 / S2 / SS as three wide rows: after the UI-kit rework those rows were
     32 px tall, 34 CSS px on an iPhone 13 and the one control pressed during a turn
     that missed 44 (`viewLayout.test.ts` recorded it as a known gap). A 108 x 104 px
     block of the bar now holds two rows of 49: S1 and S2 side by side as upright cards
     (52 and 53 px wide), SS as a wide card under them with its gauge and name, so every
     card is over 45 CSS px each way on an iPhone 13's 750 px canvas (item 165) and
     bigger on a Pixel 7. (It was 118 wide at first; 10 px went to the item slots.) An
     upright card has no room for a name and there is none under the grid either, so the
     selected shot's name moves onto the owner tab ("ALFA · ARMOR · SHELL", in the
     selected card's gold); the tab sits on the bar's rail, which carries nothing else.
     `hud.shots.stack` is `'grid'` in `hud.compact`; the desktop row is unchanged.

165. **Every touch screen gets the compact HUD, tablets included.** Item 143 kept a tablet
     on the full geometry on the reasoning that at its ~1.47 scale the full HUD is
     already finger-sized. Measured, it is not: on an iPad in landscape (800x556 at
     1.475) the full toggles are 27 CSS px, the walk keys 29 x 27 and the angle keys 29
     wide, and an iPad Pro (800x600 at 1.7) is not much better. `view.compactMaxHeightPx`
     is therefore 600, the top of the height range, which makes the rule "touch screen"
     in practice; it stays a height so a tablet-sized geometry could take the top of the
     range back. At 800x556 the compact bar is 124 of 556 px and every control is over
     60 CSS px. Mouse windows are untouched (16:9 desktops still get the full HUD).

     **An iPhone 13 is a 750 px canvas, not 844.** In landscape the notch and the home
     indicator put 47 px of safe area on each side, which `#app`'s safe-area padding
     takes off the canvas: it is 750 CSS px wide (Playwright's `iPhone 13 landscape`,
     750x342, is the same box), so the bar is drawn at 0.9375, not a shade over 1. The
     first version was sized for 844 and left the arrows and toggles at 41-43 CSS px,
     the item slots at 39 and SKIP 39 tall there. Every compact target that a thumb
     presses is therefore at least 47 backbuffer px each way: the walk and angle arrows,
     the three toggles, the six item slots (47 x 60, paid for by a power block cut from
     180 to 164 px and the shot grid from 118 to 108) and SKIP (72 x 47; FIRE keeps
     72 x 53 under it). `viewLayout.test.ts` asserts 44 CSS px for every control and
     item slot at 844x390, 750x342 and 750x369 (notch and home indicator), and
     `touch.spec.ts` runs on the `iPhone 13 landscape` descriptor and measures every
     `ControlName` on the live canvas. A 5 px caption is 4 CSS px on a small phone, so
     the compact bar also draws "HOLD" under FIRE and the "LAST" caption at scale 2.

     The iPhone SE (667x375, 800x450 at 0.833) remains the floor of the family: the
     buffer is 800 px wide whatever the phone, so a narrower phone is a smaller scale and
     no layout of this bar gets everything to 44 CSS px there. FIRE (60 x 44) and the
     aim pad (60 x 87) clear it; the shot cards are 43 x 41, the arrows and toggles 39,
     the items 39 x 50, SKIP 60 x 39. The exact list is asserted in `viewLayout.test.ts`.
     The first-generation SE (568x320, 800x451 at 0.71) is below the floor and is not a
     target: everything but the aim pad is under 44 CSS px there, and the small HUD
     captions are about 4 CSS px. It was played end to end by touch under emulation
     (aim, walk, charge and fire, teleport, chat, pan) and works; it is simply small.

     Two small companions: the dev debug panel (sandbox, `?debug=1`) is cut to the lines
     that fit above the owner tab and is drawn before the bar, so on a 800x360 view it
     neither covers the tab nor hides the live angle plate a dial drag puts above the
     bar; and the in-match chat log is `display: none` while it is empty, where it used
     to be a dark empty strip across the board just above the bar.

166. **The chat button acts on its release, inside the event handler.** Every other HUD
     key is read by the frame loop, and the chat button was too: its press opened the
     line and focused the field from the next animation frame. iOS raises the keyboard
     for a programmatic `focus()` only while the gesture is being handled, and for a
     finger the HTML spec counts the *release* (`pointerup`) as that gesture, not the
     press — so on an iPhone the line opened with no keyboard under it. And it could not
     close the line: every press on the canvas blurs the field (that is how a tap on the
     game dismisses the keyboard), so by the frame the toggle ran the line was already
     closed and it opened it again. `PointerInput.attach` now takes `PointerHooks`:
     `keepsFocus` spares the field on a press that lands on the chat button, and
     `onRelease` runs `MatchView.releaseChatToggle` in the `pointerup` handler when the
     press both started and ended on the button. The audio unlock (item 157) runs on the
     release as well as the press, for the same reason, and the wake lock (item 151) is
     asked for again on a tap while it is not held, for a browser that refuses it
     without a gesture. Chromium's emulation raises no keyboard either way, so
     `touch.spec.ts` checks the part it can see — the tap opens and focuses the line and
     the second tap closes it — and `touchInput.test.ts` pins that the hooks run inside
     the handlers.

167. **The in-match chat log fades.** On a phone it is up to 78 % of the board's width
     and sits just above the bar, which is where the mobiles stand, and a line from the
     first turn used to cover them for the rest of the match. It now fades
     `ui.chatLogLingerMs` (8 s) after its last line while the chat line is closed;
     opening the line brings it back, and the unread pip on the chat button already
     says a line arrived. Three menu fixes found in the same phone pass: the kit's
     `.btn.small` (the lobby's Fullscreen, the room's Leave) was 36 px on a finger
     again — item 160's trap at the kit's higher specificity — and is 44 under
     `(pointer: coarse)`; the room's loadout bar keeps 44 px columns and scrolls
     sideways on a landscape phone instead of squeezing a one-slot item to 30 px; and
     `.menu` is `position: relative` with `overscroll-behavior: contain`, because the
     absolutely positioned `.sr-only` labels hung off `#app`, made it scrollable, and a
     fling past the end of the room slid the whole screen off into an empty board.

168. **A cancelled pointer commits nothing.** `pointercancel` was handled as a release
     and a lost window pushed every held pointer into `ups` the same way, with the
     finger's landing point intact, so the frame loop saw a tap: a cancelled FIRE sent
     `fire` with whatever power it had reached, a cancelled item slot spent the item
     and a cancelled crosshair committed the teleport spot. On an iPhone a cancel is
     common — an edge swipe, the home indicator beside FIRE, Control Center, a
     notification, a call. `PointerSample.cancelled` is now set by a separate
     `pointercancel` handler and by the window blur (a cancel's own coordinates are
     not trusted; the last real position is kept), and `releaseOutcome`
     (`input/pointerRole.ts`, pure and unit-tested) turns the end of a pointer into what
     the scene does: a cancelled pointer still drops its role, so walk and angle holds
     clear and a started camera drag is handed back, but commits no item or spot, and a
     cancelled FIRE aborts the charge — `charging` with no power goes out, no `fire`,
     and a "SHOT CANCELLED" notice. The player presses FIRE again to charge again. The
     keyboard's charge key keeps its own blur behaviour. `touch.spec.ts` holds FIRE,
     sends a CDP `touchCancel` and asserts no `fire` frame and the turn still open.

169. **The lobby fits one phone screen; the room is rows.** On a landscape phone under
     `(pointer: coarse)` and at most 430 px tall, the lobby's wordmark is capped at
     44 px tall (`object-fit: contain`: the canvas carries its size inline) and the
     board's spacing is tightened, so Create room is on the first screen of a 342 px
     iPhone 13 and of a 320 px SE (it was at 324-376). The room on a landscape phone
     keeps the picker and the seats side by side in its first row and puts the setup
     card, then the chat, across the whole width under them: as two columns the setup
     card was far taller than anything beside it and the chat card sat at the bottom
     of an empty column. The small print there (tile names, item costs, stats, weapon
     lines, a seat's mobile) is at least 11 px on a finger; it was 9-10.
170. **A `turnEnd` waits for the shot to finish on screen.** The authority sends `turnEnd`
     the tick the shot settles, and every client runs a latency plus the clock slack
     behind it (item 45). Applying it on arrival stepped straight to its tick without
     rendering, so a client L ms behind skipped the last L ms of every shot, which is
     the landing and the explosion. On a phone over a real network that was nearly all
     of it. `net/turnEndHold.ts` now holds the message, and the local clock is capped at
     its tick, so the rest of the shot plays out in real time and the hash comparison
     runs when the engine reaches the tick, exactly where it ran before. Everything
     that arrives behind a held `turnEnd` waits behind it in arrival order, so the
     `matchEnd` of a killing shot no longer raises the end plate over a shell still in
     the air. The clock is fed on arrival, never on the late apply. A client more than
     `net.maxTurnEndHoldTicks` (3 s) behind is let go at once and reconciles from the
     snapshot as before. So is one whose clock is frozen after a mid-shot resync.
171. **The aim line is an outlined arrow.** It was a row of 1 px gold dots 30 px long,
     the selection ring's colour with no outline. On a phone, where the board draws
     slightly under 1:1, it all but vanished against the sky and ran through the name tag. `render/aimArrow.ts`
     draws 2 px dots every 6 px from 8 to 38 px, fading in from half opacity (outline
     and all, since a translucent fill over a solid outline reads brown), then a filled
     head 9 px long and 7 px wide. Long and narrow so it still reads as a point at 45°.
     Every pixel has a 1 px `#10141c` outline. The shape is pure (`aimArrowPixels`) and
     unit-tested; the numbers are `hud.aim`.
172. **Hosting is one fixed-price server, shipped without a registry.** Hetzner Cloud because
     its bill is the server's fixed monthly price and nothing else can grow it; Fly has no hard
     spending cap. A deploy restarts the process and ends any live match: no graceful drain, by
     the owner's choice. The image travels as `docker save` over SSH, so the server holds no
     registry credentials and the last few SHA-tagged images stay there for a rollback.
173. **Effects are flipbooks picked by tier, never scaled.** A blast is one of three size tiers
     (radius 16, 26, 40 px), the one nearest the carve radius, ties to the bigger. Pixel art
     scaled by a non-integer factor on the canvas smears, so a carve past the largest tier (a
     dragon's 88) is the large blast plus up to four medium satellite blasts round it, one per
     12 px past 50, each 3 ticks after the last. A blast with no carve (the frost bloom) is
     sized off half its damage radius. Beams tile a 32 px segment in the width tier nearest
     the event's width (10, 20, 40). All of it is `clientConstants.effects.sprites`.
174. **Effect sprites are not mirrored.** Flipping a sprite for variety would move its key
     light to the top right, and every mobile, projectile and map is lit from the top left.
     Variety comes from the damage type, the tier, the satellites, three smoke variants
     picked at random, and the code particles on top (random every time).
175. **Which effects stay code.** The thrown ground chunks and fine debris (map-coloured
     fillRects on real ballistic arcs), hit sparks, trails, marks, damage numbers and the
     screen shake stay code-drawn over the sprites: they already read as pixel art and they
     depend on the event in ways a flipbook cannot. The flash, shock rings, fireball puffs
     and smoke puffs of a blast, the hit pop, the death smoke, the beam line, the teleport
     ring and code smoke are what the sprites replace. The vortex keeps its code ring on top
     of the sprite, because the pull radius (160 to 270 px) is far bigger than any sprite.
     The code path stays whole as the fallback while the atlas loads, if it fails, and under
     `?sprites=pixel`.
176. **A wreck smokes for three seconds.** The death blast is followed by a column of smoke
     puffs laid every 8 ticks for 170 ticks, rising 0.36 px a tick, so the column's height is
     time, not a sprite. Explosive and fire blasts leave one (medium) or two (large) puffs
     hanging over the crater; energy, ice, water and impact do not smoke.
177. **The blast is drawn where the shell burst.** On a big carve the crater opens under the
     blast's centre, so the fireball hangs over a hole rather than sitting on the new floor.
     That is where the explosion happened and the code blast did the same; left as is.
178. **The music is streamed, not decoded.** A decoded three-minute track is 60 MB and more of
     PCM, which a phone does not keep. One `<audio>` element plays the file and is routed
     through WebAudio only for its gain (iOS ignores `volume` on a media element). The price
     is the loop point: a media element wraps with a short gap where a decoded buffer would
     not. The tracks run a minute or more, so the gap comes round rarely.
179. **The track follows the state, not the events.** `trackFor(matchScene(match, over))` is
     called every frame: the map's track, then sudden death's from the turn
     `suddenDeathLevel` turns non-zero, then the results'. A player who reconnects mid-match
     (§6.4) never saw the events and still hears the right track. The end is the scene's word
     (`MatchViewDriver.matchOver`, the authority's `matchEnd`, item 57), not the local sim's
     `phase`, which a forfeit never reaches; the offline sandbox falls back to the phase.
180. **One sound switch, three steps: on, music off, off.** Most players who want quiet want
     the music gone and the effects kept, so the first press takes only the music. It is the
     HUD speaker (a slashed note for the middle step), `M`, and a button in the lobby and the
     room, which play the music too. Stored as the old `gunbros.mute` plus a new
     `gunbros.music`, so a browser that muted before the music existed stays silent.
181. **The music outlives the scenes.** One player for the app (`appMusic()`); the lobby and
     the room ask for the lobby track, the match view for its own each frame, and asking for
     the track already playing does nothing, so walking from the lobby into a room does not
     restart it. It is unlocked from every press anywhere on the page, in the press's own
     call stack (item 157); the page going to the background fades it out and pauses it.
182. **The server honours byte ranges.** Safari will not play a media file from a server that
     answers its opening `Range: bytes=0-1` with the whole file, and a looping track seeks by
     range. `server/src/range.ts` serves the single-range forms browsers send; anything else
     gets the whole file, which the RFC allows.
183. **MP3, re-encoded from the masters.** MP3 is the one format every browser plays,
     Playwright's Chromium included (it has no AAC). `pnpm music <dir>` decodes the 160 kbps
     masters, trims the silence off the head (Farline3 opened with half a second of it, a gap
     on every loop), re-encodes at 112 kbps and prints the gain that evens each track out.
184. **The admin portal lives in the game process, behind one password.** Rooms exist only in
     that process's memory, so `/admin` is served by it (`server/src/admin.ts`, one static
     page in `admin.html` polling two JSON routes) rather than by a separate service. HTTP
     Basic auth, any user name, `ADMIN_PASSWORD`; wrong passwords are limited per address.
     Its headline is a deploy verdict: a running match means wait, people online but no
     match means ask, nobody means go. Read-only by choice, with no kick or close buttons.
185. **Admin history is minute samples on a volume.** `server/src/metrics.ts` keeps the busiest
     reading of each minute for 14 days, the last 50 matches and running totals, and writes
     them to `DATA_DIR/metrics.json` every 5 minutes and on shutdown. The quiet-hours grid
     averages those samples by hour of the week in the viewer's time zone. Minutes when the
     server was down are missing rather than zero, so they do not make an hour look quiet.
186. **Bots are players with no socket, living on the server.** A bot is a `Player` with
     `bot: { difficulty }` and `conn: null`, created by the room, always ready and always
     "connected" (`isConnected` says yes for a bot, so `start` and the sweeper never see it as
     dropped). It fills a seat like anybody, in any team and any room size, so 1v1, 2v2 and
     mixed tables all work. It sends nothing over the wire: its driver calls the runner's own
     `onMove`, `onAim`, `onCharging`, `onSelectShot` and `onFire`, on the runner's own tick and
     before `step()`, so every validation, throttle and broadcast is the one a human's intent
     gets, and clients cannot tell a bot's shot from a human's except by the `bot` field on
     `PlayerInfo` and `SeatInfo`. A bot is never in the manager's token or id maps, so nobody can
     `hello` as one, and the admin's "online" count never includes it.
187. **The bot aims by simulating, not by solving.** At its turn start the planner copies the
     match state and fires candidate shots at it with the real `applyIntent` and `step` until
     it settles (the copy's turn machine leaves `resolving`, or a tick cap), so wind, terrain,
     tilt, sky events and every mobile's odd shells are right for free. Candidates: every shot
     slot it may fire (SS when ready) and both facings when enemies stand on both sides, a
     coarse grid over the mobile's angle range and the power bar from where it stands; then
     the walk positions of item 190, each screened with a small S1 grid, the best one that
     beats standing still getting the full grid; then three finer passes around the best
     three. The score is hp and shield taken off living enemies, a large bonus per
     kill, minus damage to itself and allies (doubled) and minus a very large penalty for its
     own death or fall; a shot that touches nobody scores by how near its closest blast came to
     an enemy, so the search always has a slope to climb. The copy (`match/clone.ts`) never
     shares a mutable object with the live state — only the map and projectile definitions,
     which nothing writes — and its PRNG is a clone, so a plan never moves the match stream;
     tests walk both object graphs and hash the live state before and after a plan.
188. **Difficulty is noise, not a weaker search.** Easy, Normal and Hard run the same search and
     then miss on purpose: a random error on the chosen angle and power, drawn from the bot's
     own PRNG (never the match's, seeded from `node:crypto`), and Easy (and now and then Normal)
     settles for a slightly worse candidate. Normal and Hard fire SS when it scores best; Easy
     never does. All the numbers live in `shared/src/data/bots.ts`. Measured over 24 simulated
     bot-vs-bot matches (8 per difficulty, 8 mobiles, every map, random skies), walking in:
     Hard hits 87 % of its shots (1v1 matches of ~11 turns), Normal 62 % (~17), Easy 46 %
     (~31), its misses landing a median ~60 px from the target.
189. **The search is budgeted per tick, never blocking.** The planner is a generator that yields
     after each candidate; the driver runs it for at most `bots.budgetMsPerTick` (5 ms) per
     server tick and the plan is capped at `maxCandidates` (520), so a bot turn cannot stall
     other rooms; each simulated walk is its own step, like a candidate. With walking, one
     candidate costs 0.4-0.9 ms on the 1800-2000 px maps, a whole plan ~300-380 candidates
     and 120-340 ms on average (500 ms worst, bigfoot), the worst single step 11 ms; at 5 ms a
     tick that is at most ~1.7 s of ticks, about the think time (Normal and Hard 1.5-2.2 s). If
     the plan is not done when the think time is up — or when less
     than `reserveSeconds` of the turn timer is left — it fires the best found so far; if
     nothing is found, it fires a plain S1 at a middling angle rather than skipping.
190. **A bot turn looks like a human's, walk included.** Think for a moment (by difficulty),
     walk if the plan fires from somewhere else, turn round if the shot faces the other way,
     sweep the barrel to the angle through `aim`, select the shot, charge the bar at the human
     rate through `charging`, then `fire`, all inside the turn timer (about 10 s at the
     slowest, measured).
     - *Where it may stand.* Where it is, and walks left and right of ⅓, ⅔ and all of the
       move gauge left (`bots.walk`). Each walk is simulated on a copy with the real `move`
       intent and `step` for its exact tick count, stopped, and given 30 ticks to land and
       let the tilt settle. A walk is dropped if the bot dies, the turn leaves `active`, or
       it falls (airborne and more than 40 px below its start: a ledge, a pit, the edge of the
       map) — and every longer walk the same way with it. Walks that end within 4 px of each
       other (a wall stopped them) are one position. Walking costs 0.05 score per px, so the
       bot stays put when standing is as good. The "stand further from the enemy's likely
       shots" bonus was left out: it would need the enemy's search too, which is not cheap.
     - *Replay.* The driver sends `move dir`, counts exactly that many runner ticks, and sends
       `move 0` on the tick the copy stopped on, so the live walk ends where the copy's did
       (bit for bit, checked). A gauge that runs out or a wall in the way stops the mobile by
       the simulation's own rule, on every engine; a hull that starts to fall is stopped at
       once. After landing it re-plans the aim from the live state (`refineShot`: the chosen
       shot and three refine rounds, ~25 candidates) before aiming. A walk is only chosen if
       walking it and landing still leaves `reserveSeconds` of the turn timer.
     - *Difficulty.* Hard and Normal weigh every position; Easy looks for a walk only when
       nothing from where it stands hits. Normal's walk is off by up to 8 % of its length,
       Easy's by 30 % (the re-aim then aims from wherever it stopped).
     - *Turning.* Every mobile aims forwards only, so the turn is needed: it is a `move`
       towards the new side and a `move 0` on the same tick with no `step` between, which
       flips the facing without walking a pixel (every engine applies both echoes at that
       tick).

     It does not use items in v1; its loadout is empty. `BOT_TIME_SCALE` scales the think,
     aim and charge times for tests (not the walk, which is simulation ticks); the server's
     own aim and charge throttles still apply.
191. **Rooms belong to humans.** Only a human can be host. When the last human leaves a room, its
     bots go with it and the room is reaped as an empty room; a match of bots alone is stopped
     (recorded as `closed`). A human who only *dropped* keeps the seat for the grace period as
     usual, and the bots play on meanwhile (the dropped seat's turns time out); the bots go when
     the grace expires. `connectedCount` counts humans only, so a room whose human dropped is
     not listed and reaps on the usual TTL. The open-rooms list counts bots as taken seats. A
     bot's nick comes from a list in `data/bots.ts`, unique within the room.
192. **Practice is one button.** The lobby's "Practice vs bot" (beside Create room, with the map
     and size picked there) creates an unlisted room with the player on team A and a Normal bot
     on team B, on the room screen as usual, so the player can change map, mobile, difficulty or
     add more bots before pressing Start. Bot matches go in the admin portal's history with the
     bots marked (`MatchRecord.players[].bot`, absent in older records).

---

## 8. Art and audio

- Sprites: `SpriteRef = { kind: 'pixels', palette: string[], frames: Record<AnimName, string[]> }`
  where each frame is an array of rows of palette indices (`'.'` = transparent, `'0'..'z'` =
  palette index) **or** `{ kind: 'png', url, frameW, frameH, frames: Record<AnimName, number[]> }`.
  The loader (`client/render/sprites.ts`) turns either into a set of offscreen canvases per
  animation. Mobiles are ≈ 40×32 px, 2–4 frames per animation: `idle`, `move`, `fire`, `hurt`,
  `death`.
- Maps: `MapDef { id, displayName, width, height, source: { kind: 'procedural', style, seed } |
  { kind: 'mask', rle }, background: ParallaxLayer[], palette, art?: { terrain, thumb } }`, one
  file per map in `shared/src/data/maps/<id>.ts`, registered in `data/maps/index.ts` and listed
  in the fixed `mapOrder`. `ParallaxLayer` is a code-drawn layer (`{ kind, parallax, colors,
  params }`: gradient, clouds, mountains, stars, birds …) or a `plate` (`{ kind: 'plate', src,
  parallax, width, height, x, y, fillAbove?, fillBelow?, drift? }`, a Blender-rendered PNG in
  `client/public/maps/<id>/`). A painted map (§8.1) has a `mask` source and `art`; its mask
  RLE, sky colours and plate placements are generated into `data/maps/masks/<id>.ts` by `pnpm
  maps`. `palette` stays on every map: it is the band painter's fallback and its `scorch` rims
  craters on painted ground too. Four procedural styles remain as a source: `hills`, `pit`,
  `islands`, `cave` (cave has a ceiling band).
- Audio: `audio/synth.ts` builds every SFX from oscillators + noise + envelopes. The music is
  recorded (§8.3). One sound switch in the HUD, the menus and the `M` key, persisted.

### 8.1 Painted maps (map pass, 2026-09-23)

Maps stop being procedural. Each map is a fixed landscape modelled in Blender and rendered
through the same toon and pixel pipeline as the mobiles, the UI kit and the projectiles
(`tools/blender/README.md`). This is how the original game works: what you see is what you hit.

- **Pool: eight maps.** The four existing ids are remade and keep their ids and names (`hills`
  Rolling Hills, `pit` Sunset Chasm, `islands` Cloudbreak Isles, `cave` Crystal Hollow), and
  four new ones join them: `glacier` (frozen shelves and overhangs, aurora sky), `forge`
  (basalt and lava seams around a volcanic peak), `temple` (stepped jungle ziggurat ruins with
  vines and waterfalls), `scrapyard` (junk piles, girders, a hull bridging a gap). Each has
  its own silhouette and its own tactical idea, not just a new colour scheme.
- **Terrain.** `MapDef.source` is `{ kind: 'mask', rle }`. The RLE is generated from the
  rendered terrain image's alpha by the pack step and committed as
  `packages/shared/src/data/maps/masks/<id>.ts` (generated, never hand-edited). The seed no
  longer shapes the ground; it still picks spawns (from the usual `computeSpawnPoints`), wind
  and everything else. The procedural generators stay in shared as a supported source.
- **Terrain art.** `packages/client/public/maps/<id>/terrain.png`, one image pixel per map
  pixel, RGBA, alpha 255 exactly where the mask is solid and 0 elsewhere (a test pins this).
  The client blits it instead of painting bands; a carve clears the pixels and rims the new
  edge with the existing scorch treatment. Nothing ever adds terrain, so the image only needs
  clearing. If the image fails to load, the client falls back to painting the mask with
  `palette` bands, so `palette` stays on every map.
- **Backgrounds.** A new `ParallaxLayer` kind, `plate`, draws a Blender-rendered PNG from
  `public/maps/<id>/` at a parallax factor, sized so it covers the view at every camera
  position without tiling, with `fillAbove`/`fillBelow` colours past its edges. The
  code-drawn kinds stay and are used for what moves (sky gradient, drifting clouds, birds,
  dust, fireflies, embers, snow); the scenery is plates. 3 to 5 plates per map.
- **Budgets.** Map size stays 1600–2000 × 900–1200. All PNGs for one map under 1.2 MB. At most
  48 colours in a terrain image and 32 in a plate. The art is pixel art: 1 px dark outline on
  the terrain's air edge, 3–4 value steps, light from the top left like the mobiles.
- **Playability is a test.** Every map, over 20 seeds and 2, 4 and 8 seats: legal spawns
  (existing rules), no seat spawns in a sealed pocket, the two teams' spawns can reach each
  other with a shot, and nothing solid overhangs a spawn inside `minHeadroomPx`. A ceiling
  must sit where the camera can see it (the camera stops at `height − viewHeight`). The suite
  is `shared/test/mapPlayability.ts`; it also drives an armor away from each 2- and 4-seat
  spawn (nobody starts boxed in), and it runs on every map in the pool.
- **Spawns agree with walking** (found by that suite in M1, on the procedural maps as well):
  the strict spawn stages also refuse a site where either end of the footprint stands more
  than `spawnGen.maxEdgeRisePx` (4, well under the smallest `maxStep`) above the feet, where the seat
  would start wedged and unable to drive, or hangs more than `maxEdgeDipPx` (13) below them
  (balanced on a point). On a painted map nothing on walkable ground may stand more than
  3 px proud (`tools/blender/maps/map_kit.py`, `WALK_BUMP_PX`).
- **Buried things cast no shadow** (M3). A map is a cross-section, so a fossil, a pebble in a
  stratum or a cart in its mine drift lies *in* the cut face; a shadow thrown from it onto the
  slab behind is a dark wedge no light could make. The kit decides it from the geometry
  (`map_kit.settle_shadows`, run by `build_maps.py` on every terrain): an object whose outline,
  grown by 2 px, shows only the terrain's body (anything reaching 24 px or more behind the
  picture plane), other buried objects or seams lying flush on the body is buried and gets
  `visible_shadow = False`; it keeps its toon shading. Whatever pokes into the air, or stands
  on a prop that does (a window on a house wall), keeps its shadow. `cast_shadow(obj, on)`
  overrides it. Shadows change colour only: the masks do not move.
- **Thumbnails.** The pack step also writes `thumb.png` (160 × 90) per map. The room's map
  picker shows the chosen map's thumbnail beside the dropdown in a gold kit frame (1:1 on a
  desktop, 96 × 54 on a landscape phone) and swaps it with every `roomState`; the lobby's New
  room card shows a smaller one (`client/src/ui/mapThumb.ts`).
- **Short views and the cave roof.** A ceiling is only on screen when the camera can see it:
  on a desktop (view 600) Crystal Hollow's roof (underside 370 to 410) is in view from every
  shelf. On a landscape phone (view 360 to 370, of which the compact HUD bar covers the
  bottom 127) the camera centres the mobile 185 px below the top, and the roof sits 240 to
  310 px above the spawn shelves, so it is off screen while a mobile stands on the floor; the
  fangs hanging from it are in view, and a lob is followed up to where it bursts. Showing the
  roof itself would need a roof-to-floor gap of about 195 px (about 220 with the camera pushed as
  low as the HUD allows), which would take away the lob game the map is built on. Left as is.

### 8.2 Effects (VFX pass, 2026-09-24)

Explosions and the other one-shot effects move to Blender like the mobiles, projectiles, UI
kit and maps (`tools/blender/README.md`, "Effects"): flipbooks rendered with the same toon
light and reduced to pixel art, in one atlas, `client/public/sprites/blender/effects.png`
(indexed, about 180 KB) with `effects.json` (per clip: canvas size, anchor, ticks per frame,
loop/tile, per frame the trimmed rect and its offset).

- **Blasts per damage type, differing in form:** explosive (flash, a boiling fireball with a
  hot heart per lobe, cooling into rising, breaking smoke), fire (a wide bonfire of flame
  tongues, yellow at the root and red at the tips, billows and embers), energy (a plasma ball
  with crawling arcs and a ring that collapses and pops into sparkles), impact (a pale pow,
  faceted rocks on arcs, a low billow of dust), ice (a radial burst of crystal shards that
  shatter and fall, a frost crust, glitter), water (a low dome, a splash crown, drops thrown
  up and out, foam). Three size tiers each (§7 item 173).
- **Also:** a hit pop per damage type, the death blast (a bigger, slower fireball with wreck
  plates) and its smoke column, three small and three large smoke puffs, three beam
  segment widths plus the burst where a beam lands, the teleport burst (both ends) and
  jd's vortex.
- **Timing** is in sim ticks (60 a second): an effect ages one tick per `Effects.step`, so it
  plays at game speed whatever the display rate. Blasts run 45 to 70 ticks, hits 13.
- **The client** (`render/effectSprites.ts`) loads the atlas at the start of a match; until it
  is in, or if it fails, or under `?sprites=pixel`, `render/effects.ts` draws its code
  effects as before (§7 item 175). `/effects` on the dev server shows every clip looping.

### 8.3 Music (2026-09-24)

The soundtrack is the Farline OST, composed by the owner for a cyberpunk visual novel about
ten years ago: 13 tracks, of which 11 are used. The fit with cartoon artillery is loose, and
accepted. Tracks were picked by ear, per map, in an audition page.

| Where | Track |
| --- | --- |
| Rolling Hills | Farline4 |
| Sunset Chasm | Farline13 |
| Cloudbreak Isles | Farline8 |
| Crystal Hollow | Farline1 |
| Frozen Peaks | Farline12 |
| Magma Forge | Farline5 |
| Jungle Temple | Farline7 |
| Rust Yard | Farline3 |
| Lobby and room | Farline6 |
| Sudden death | Farline9 |
| Results | Farline11 |

- **Files:** `client/public/music/<track>.mp3`, 112 kbps, about 16 MB together (the test
  budget is 20 MB). A player downloads only the tracks it plays.
- **Table:** `clientConstants.music`: the map-to-track table, the lobby, sudden-death and
  results tracks, a gain per track that evens out loudness (the masters differ by 11 dB), the
  music bus gain (0.2, under the effects' 0.35) and the fades (1.2 s in, 0.6 s out).
- **Code:** `audio/music.ts` (`trackFor`, `matchScene` and the `MusicPlayer`), wired from
  `main.ts` (lobby and room, the unlock), `scenes/matchView.ts` (the match, the switch) and
  `ui/soundButton.ts` (the menus). Items 178-183.
- **Adding a track:** add it to `TRACKS` in `tools/music/make_music.py`, run `pnpm music
  <masters>`, then add its id to `MusicTrack` and its printed gain to
  `clientConstants.music.tracks`. The test fails on a file nothing plays and on a track with
  no file.

---

## 9. Phase plan

Each phase ends with: tests passing, `docs/PROGRESS.md` entry, a commit, and a "how to run" note.
Coding is done by Opus 5 agents, one per phase (phases 4 and 6 split across two agents each, by
mobile group / by feature), reviewed and integrated by the orchestrator against this document.

| # | Scope | Exit criterion |
|---|---|---|
| 1 | Workspace scaffold, tsconfig, vitest, shared: prng, trig, terrain (gen `hills`), projectile, wind, damage basics, `armor`; client: canvas, camera, terrain render, sprites, **sandbox** page controlling two armors in one tab | `pnpm dev` opens `/sandbox`; fire, carve, fall, wind visibly work; tests: trajectory under wind, carve, fall, determinism hash |
| 2 | Turn system: delay ordering, timer, move gauge, slope tilt + angle range, power bar, camera follow/return, full HUD, sandbox uses turns | Sandbox plays a full armor vs armor match locally; tests: delay ordering, tilt/angle, timer skip |
| 3 | Server, rooms, lobby, mobile/map select, chat, fire echo + reconcile, reconnection, Dockerfile, deploy notes, Playwright smoke | **Two browsers on different machines play armor vs armor online.** |
| 4 | All 17 remaining mobiles, behaviour modules, damage table, sprites for all | Each mobile has a unit test of its special behaviour; sandbox can pick any mobile |
| 5 | Items, SS gauge, sudden death, item select in room | Items usable in online match; tests per item |
| 6 | Sky events, maps 2–4, parallax, audio, reconnect polish, HUD polish | Definition of done for v1 |
| M1 | Map pipeline (`tools/blender/maps/`), `mask` + `plate` integration in shared and client, `hills` remade as the reference map (§8.1) | `/sandbox?map=hills` shows the painted map; carving, spawns and fallback work; tests pass |
| M2 | The other seven maps, one module each, in parallel (§8.1) | All eight in the lobby and room pickers; playability tests pass for all eight |
| M3 | Review, map thumbnails in the room, phone check, docs | PROGRESS entry and commit |

### How to run (kept current in PROGRESS.md)

```
pnpm install
pnpm dev          # server on :8080 (ws + api) and vite on :5173 with /ws proxied
pnpm test         # vitest in shared
pnpm e2e          # playwright smoke (needs pnpm build first)
pnpm build
```

---

## 10. Testing

`packages/shared` (vitest):

- `trig.test.ts`: our sin/cos/atan2 within 1e-6 of a high-precision reference table (fixed
  literal expectations, not `Math.sin`).
- `terrain.test.ts`: carve, ground probes, slope, RLE round trip, hash changes on carve.
- `projectile.test.ts`: flat trajectory range, wind pushes left/right/up, sub-step tunnelling.
- `mobile.test.ts`: falling when ground removed, death below map, steepness block, tilt.
- `delay.test.ts`: ordering, tie-break, time cost.
- `damage.test.ts`: falloff, table multipliers, shield absorption, debuff stacking.
- `mobiles/*.test.ts`: one per behaviour module (weave offsets, burrow tunnels, orbit count, split
  count, bounce count, mine walks toward enemy, bolt lands on mark, pull impulse, satellite beam,
  shatter shards, converge crossing, crawl distance, swords count).
- `items.test.ts`, `sky.test.ts`, `suddenDeath.test.ts`.
- `determinism.test.ts`: run a scripted 12-turn match twice from the same seed, assert equal
  state hashes at every turn end; and once more with a different seed, assert different.

`e2e/` (Playwright, `pnpm build && pnpm e2e`): start the built server, open two browser contexts,
create + join the room by code, both ready, host starts, and then play **three turns** — whichever
context owns the turn walks (from the second turn on) and holds the charge key for a second. Both
pages must reach the *next* turn each time — a turn only completes on a client when the authority's
`fire` was replayed and its `turnEnd` hash agreed — with the active seat changing hands, the desync
counter at 0 (§7 item 53) and nothing on the console. The walk is not decoration: a charge-only turn
carries no `moveEcho`, which is the message most sensitive to the client's clock (§7 item 45).

`touch.spec.ts` plays the same three turns again on two emulated iPhone 13s in landscape, with
nothing but fingers: it holds a walk arrow and holds FIRE over the canvas through CDP touch events,
because the whole HUD is drawn pixels and has no DOM to click. It asserts the three things a
keyboard run cannot see — that every `move dir: ±1` on the socket is followed by a `dir: 0` (§7 item
154), that a real walk plus a pointer-driven turn-ender leaves the desync counter at 0 (§7 item
156), and that the walk arrows really are 44 CSS px on the glass — plus, on the room screen,
that `document.elementFromPoint` over every visible item button answers that button (§7 item 161).
The control rectangles come from `window.__gunbrosMatch.hudRect(name)`, which exists only with
`?debug=1`; `tests/probe.ts` is the shared type of that probe.

---

## 11. Practice against bots (2026-09-24)

So a player can try the game with nobody else online. Choices are items 186-192.

- **Shared:** `bot/planner.ts` (the search, a generator over a copied `MatchState`),
  `bot/score.ts`, `match/clone.ts` (`cloneMatchState`), `data/bots.ts` (difficulties, noise,
  think and animation times, candidate counts, per-tick budget, names). No I/O, no clock:
  testable on its own.
- **Server:** `bot.ts` (`createBot`, the per-turn driver that runs the planner inside the tick
  budget and then plays walk, re-aim, aim, charge and fire through the runner), `room.ts` (`addBot`,
  `setBot`, `removeBot`, human-only host, bots leave with the last human), `matchRunner.ts`
  (calls the driver on each tick while a bot's turn is active), `protocol.ts` parsers,
  `metrics.ts` (bot seats in the match record), `admin.html` (a bot marker), `config.ts`
  (`BOT_TIME_SCALE`).
- **Protocol:** `addBot`, `setBot`, `removeBot`, `createRoom.practice`, `PlayerInfo.bot` and
  `SeatInfo.bot` (`{ difficulty }` or absent).
- **Client:** room screen: for the host an "Add bot" button per team while seats are free, and
  on each bot row a bot badge, a difficulty picker, the mobile picker and a remove button;
  non-hosts see the badge and difficulty. The "Add bot" keys live in the empty seat cards
  ("+ Bot A", "+ Bot B"). Lobby: a "Practice vs bot" button. The match HUD marks bot names:
  `createMatchFromStart` shows a bot seat as "Name (bot)" (the nick is in neither the hash nor
  the snapshot).
- **Tests:** planner hits a stationary target on flat ground in no wind (Hard); a walled-in bot
  walks and hits; a bot never walks off a cliff or into a pit; the re-aim after a short walk
  still hits; the live state hash is unchanged by planning; a full 1v1 bot-vs-bot match runs to `matchEnd` on the server
  in a test (fake clock, with a replaying engine that must match every `turnEnd` hash), and
  another with walking forced on every turn; a 2v2 of one socket client and three walking bots
  in lockstep; a turn forfeited under a thinking bot; the room
  rules (host only, lobby only, bots leave with the last human, start with one human and one
  bot, never swept); protocol parsing; old match records still load; an e2e that presses
  Practice, starts, and sees the bot take a turn and fire.
