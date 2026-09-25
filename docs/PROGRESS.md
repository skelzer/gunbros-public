# Progress log

Each phase ends with an entry here: what works, what is rough, what is next, and how to run it.

## How to run (current)

```
pnpm install
pnpm dev                    # server on :8080 (ws + static) and Vite client on :5173 (proxies /ws)
open http://localhost:5173           # lobby: nickname, create or join by code
open http://localhost:5173/sandbox   # dev-only sandbox (not in production builds)
pnpm test                   # vitest: shared simulation, client playback/clock, server rooms + headless match
pnpm build && pnpm start    # single deployable: node packages/server/dist/index.js serves the built client on :8080
pnpm e2e                    # builds, then Playwright: smoke, touch, reconnect (two browsers each)
```

Deployment: see `docs/DEPLOY.md` (one Hetzner server, Caddy + docker compose, `pnpm deploy:prod`; merges to main deploy after CI). Set `VITE_WS_URL` at build time to host
the client statically elsewhere.

Sandbox keys: control follows the active seat. Left/Right move, Up/Down aim, Space hold to charge and
release to fire (or hold the FIRE button), Tab cycles S1/S2/SS (also clickable), 1-6 item slots
(Phase 5), X skip, R reroll wind, N new map seed, F free camera, M sound (on, music off, off), Enter restart after game
over, backquote toggles free-play mode, C switches seat in free play.

## Phase 1 — scaffold, terrain, projectiles, wind, armor, sandbox (2026-09-17)

**Works**
- pnpm workspace with `packages/shared` (simulation, 100 vitest tests) and `packages/client` (Vite + Canvas 2D).
- Deterministic maths: xoshiro128** PRNG, own sin/cos/atan2, ESLint rule banning engine-dependent Math calls in `shared`.
- Destructible byte-mask terrain with carve, ground probes, slope tilt, FNV-1a hash and RLE codec; procedural hills generator with spawn points.
- Generic projectile system (4 sub-steps, wind, gravity, bounces, behaviour registry) with the `basic` behaviour; damage falloff, class × type table, shields.
- Armor mobile with S1/S2/SS in data and a hand-drawn pixel sprite (idle, move, fire, hurt, death).
- Match reducer (`createMatch`, `applyIntent`, `step`), snapshot with q8 quantisation and `hashState`.
- Client: 800×600 backbuffer with integer nearest-neighbour upscale, camera follow/return/drag, dirty-rect terrain render, sprite loader (pixel grids and PNG sheets), parallax background, explosion effects, dev-only sandbox with two armors in one tab.

**Rough**
- Some hills seeds give one spawn a steep ramp (the 900 px octave dominates); tune `terrainGen.hills.octaves` in `data/maps.ts`.
- Full-power shot into a 26 head wind carries ~550 px, less than the widest spawn separation; feel decision for Phase 2.
- A projectile leaving the world expires without an event; camera just returns.
- `hurt` animation is a recolour, not a drawn pose.
- Presentation tunables live in `packages/client/src/data/clientConstants.ts` (sim tunables stay in `shared/src/data`).

**Decisions taken during the phase**
- Aim formula corrected: `facing === 1 ? rel : 180 - rel`, then minus tilt (the design's original formula mirrored through the horizontal axis). DESIGN §2.4 updated.
- Armor shot speed raised to 14.3 px/tick so a full-power 45° shot travels ~1.6 screens; gravity kept at 0.16.
- Snapshots quantise the authoritative state too, so reconciliation converges.

**Next**: Phase 2, turn system (delay order, timer, movement gauge, power bar, HUD, camera rules).

## Phase 2 — turn system, power bar, camera, HUD (2026-09-17)

**Works**
- `rules/delay.ts`: shot/skip/time delay accounting, lowest-delay-goes-next with seat tie-break, upcoming order for the HUD.
- `rules/turn.ts`: starting → active (20 s) → resolving → ending → ended, all durations in ticks; timer expiry skips, or fires at the reported charge if the player was charging; move gauge refills only at the owner's turn start; shield regen at own turn start; wind rerolls every 2 completed turns; match ends when one team is dead; the active mobile dying ends its turn; a resolving watchdog culls stuck projectiles.
- New intents `skip` and `charging`; new events turnStart, turnEnd, timerWarning, windChange, matchEnd, projectileExpire. Snapshot and hash cover the turn machine. 141 tests.
- Client HUD: angle dial with relative and true angle, S1/S2/SS selector with SS gauge fill, power bar (4 major bars × 5 ticks, linear fill from shared data, hold at max, previous-shot marker), movement gauge, six item slot placeholders, SKIP and hold-to-charge FIRE buttons, timer with 5 s warning, wind at top centre, next-4 delay list, name/HP/shield tags, turn banner, game-over plate. Camera follows projectiles, returns on turn start, free drag and edge scroll while waiting.
- Sandbox runs a full local armor vs armor match in `turns` mode.

**Rough**
- (Audio arrived in Phase 6.)
- A charge started under 200 ms before the timer expires fires at ~0 power (DESIGN assumption 32).
- A backgrounded tab falls behind the turn timer instead of fast-forwarding; Phase 3 reconciles against the server.
- (On-screen move buttons arrived in Phase 6.)

**Next**: Phase 3, server + rooms + lobby + chat + reconnection + deployment. Milestone: armor vs armor online.

## Phase 3 — server, rooms, lobby, networked match, reconnection, deployment (2026-09-18)

**Works**
- `packages/server`: Node + ws authoritative server. Static client with SPA fallback, `/health`, `/ws`. In-memory rooms with 5-char codes, host transfer, lobby validation (team, mobile or Random, map, ready, start rules), chat with length and rate limits, per-connection message token bucket, hand-written runtime guards for every client message, hardened HTTP handling.
- Match runner drives the shared sim at 60 Hz (5 ms wake), accepts intents only from the active seat in `active`, broadcasts every authoritative message with the tick it was applied on (fire, skipEcho, moveEcho, aimEcho, shotEcho, chargingEcho, playerForfeit), sends the quantised turnEnd snapshot, answers terrain requests with the RLE mask.
- Reconnection: token in localStorage, 60 s grace, one-shot `resync` (snapshot + terrain), forfeit applied through a shared `forfeit` intent so every engine agrees; leaving mid-match forfeits immediately; `matchEnd.reason` distinguishes eliminated / forfeit / abandoned.
- Client: DOM lobby and room (code with copy link, `/r/CODE` join links, player list, team toggle for rooms > 2, mobile picker from shared data, map picker, ready, host start, chat), canvas match scene reusing the Phase 2 view via `scenes/matchView.ts`, `net/playback.ts` pure reconcile (step to tick, apply fire in §6.2 order, hash compare on turnEnd, snapshot + terrain on mismatch), `net/clock.ts` server-tick clock so the local sim never runs ahead of the authority, reconnecting overlay, debug overlay with desync counter (`?debug=1`).
- Tooling: Playwright smoke test (two contexts, room create/join, three turns with movement, zero desyncs), multi-stage Dockerfile, `fly.toml`, `docs/DEPLOY.md`, `pnpm dev` / `pnpm start`.
- Tests: shared 141, client 19 (playback, clock), server 30 (room codes, protocol guards, HTTP hardening, headless two-client match with hash equality, reconnect, forfeit).

**Rough**
- Only Armor is pickable until Phase 4; items are placeholders until Phase 5.
- A resync during `resolving` freezes the local sim until the next authoritative message.
- Chat history is not replayed on reconnect; a reconnect remounts the match scene (camera re-centres).
- The in-match countdown compares server wall clock with the browser's; a skewed clock shows a slightly off timer (the sim timer itself is tick-based and authoritative).
- `fly.toml` app name and region are placeholders marked CHANGE ME.

**Next**: Phase 4, the 17 remaining mobiles and the damage type table.

## Phase 4 — all 18 mobiles and the damage type table (2026-09-18)

**Works**
- One file per mobile under `packages/shared/src/data/mobiles/` (id and displayName separate: Sorcerer, Delver, Triclops, Stomper, Zephyr, Sapper, Tempest, Vortex, Orbital, Frostbite, Deepshell, Skipper, Herald, Shrike, Croaker, Wyvern, Paladin) and one hand-drawn 40×32 pixel sprite per mobile under `sprites/mobiles/`.
- 17 behaviour modules registered in a fixed order: weave, shieldBreak, burrow, orbit, mineDrop, markThenBolt, pull, satellite, debuff, shatter, converge, bubbleBurst, bounce, thorCall, split, crawl, markThenSwords. bigfoot, boomer and dragon are pure configuration.
- Extension points: `defenceDebuff` and `shieldDamageMultiplier` on projectiles, mobile `vx` impulses (jd pull), `mark`/`onTurnEffect` for delayed strikes, `beamStrike`, persistent walking mines with chain detonation from any blast, turn-hook registry, a minimal Thor strike in `rules/sky.ts` for aduka.
- Owner immunity is a latch (a shell is immune to its shooter until it has left the shooter's footprint), which removed all muzzle self-hits.
- Damage table covers explosive, energy, impact, fire, ice, water × mechanical, shielded, bionic.
- Room picker and server accept every non-random-only mobile; Random weights all 18 (dragon and knight weight 1). Sandbox: `/sandbox?a=<id>&b=<id>`, P cycles the mobile.
- Tests: shared 314 (per-mobile behaviour tests, roster contract, extension points, a self-hit sweep, and a determinism run for every mobile that fires S1, S2 and SS), client 19, server 30, e2e 1.

**Rough**
- Balance is first-pass by reading, not by play (DESIGN assumption 90 lists the notes: boomer into a 26 head wind, wind carrying a 70% shot off the map, bigfoot SS clipping a rising slope, ice SS fixed fuse, grub range).
- Mines do not walk in the free-play sandbox mode (turn hooks only run in `turns` mode); they work in real matches and in the sandbox's default turns mode.
- Under delay ordering a player who spends less turn time can take two turns in a row; the e2e test was relaxed accordingly. Tune `turn.delayPerSecond` if it feels wrong.
- Lightning and asate shells sit visibly on the mark while waiting for their strike.

**Next**: Phase 5, items, SS gauge gating, sudden death, item picker in the room.

## Phase 5 — items, SS gauge, sudden death (2026-09-18)

**Works**
- All eight items in `data/items.ts` (Dual, Dual+, Teleport, Bandage, Med Kit, Bunge, Power Up, Wind Change) with slots, delay and params; `rules/items.ts` validates (loadout, spent, one per turn, teleport target must be air over ground and unoccupied) and applies. Bunge and Power Up multiply by blast owner so child projectiles inherit them and other players' mines do not. Dual queues the second volley through the existing pending-spawn path; Dual+ fires S1 then S2.
- Loadout rule shared by room picker, server validation and `createMatch` (`canAddToLoadout`): 6 slots, two-slot items not repeated.
- SS gate is on in `turns` mode: SS needs the gauge (+1 per own turn, +1 per hit taken, `ss.gaugeMax` 4), resets on use, selection drops back to S1 afterwards. Free play (sandbox) leaves SS always available.
- Sudden death in `rules/suddenDeath.ts`: ×2 after 40 completed turns, ×3 after 60, with a banner event.
- Server: `useItem` validated and broadcast as `itemUsed` with the tick; error codes for not owned, spent, second item, bad target, SS not ready. Client: room loadout picker persisted in localStorage, HUD slots (two-slot items span, spent greyed), keys 1-6 and clicks, teleport targeting mode with crosshair and validity feedback, toasts for items, heals, teleports, wind change and sudden death. Sandbox seats get a default loadout.
- Tests: shared 379, client 33, server 35, e2e 1. Determinism suite includes an item-using scripted match.

**Rough**
- The SS gauge reads 1 at the end of the turn that fired it (turn gain applies after the reset); harmless.
- Dual's second volley leaves from the muzzle captured at the trigger pull.
- Wind Change replays from each engine's own PRNG rather than carrying the rng state; fine as long as nothing draws between turnEnd and the item.

**Next**: Phase 6, sky events (Thor, Tornado, Force), maps 2–4, WebAudio sound, polish. Then an art pass toward a chibi, busier look (see docs/ART.md when it exists).

## Phase 6 — sky events, maps, sound, polish (2026-09-18)

**Works**
- Sky events (`rules/sky.ts`, `data/sky.ts`): the server rolls one per match (or `SKY_EVENT` env forces it), `matchStart` carries it, every engine builds the same state. Thor: any blast near an enemy of the blast owner calls a beam from the top of the map, levels up every 3 strikes to level 5, aduka's call uses the match level. Tornado: a column placed away from spawns captures a projectile, lifts it and releases it ±25° from vertical (sign from the match PRNG), once per projectile. Force: a band that flags projectiles for ×1.5 damage, including mark-based payloads (bolts, beams, swords). Client `render/sky.ts` draws the funnel, band, satellite with level badge and strike flash; HUD label; sandbox `?sky=`.
- Four maps in `data/maps.ts`: Rolling Hills, Sunset Chasm (deep central pit), Cloudbreak Isles (floating islands with lethal gaps), Crystal Hollow (cave with ceiling and stalactites). Per-map palettes, textured crust, 4-5 layer parallax backgrounds pre-rendered once, spawn rules tested over many seeds (grounded, separated, low tilt, ceiling clearance). Sandbox `?map=`.
- WebAudio effects (`audio/synth.ts`, `audio/sfx.ts`): charge loop with bar ticks, fire, explosion scaled by carve, hit, death, turn start, timer warning, item, teleport, heal, sudden death, beam zap, wind whoosh. Unlocked on first gesture, mute with M and a HUD speaker button, persisted.
- HUD polish: on-screen move buttons, mobile portrait, chat toggle, clearer active player, H toggles the controls help, reconnecting state.
- Reconnect fix: the server resets a returning player's move/fire sequence counters; the client reports "stopped charging" before every fire so the timer can never fire a stale power.
- Tests: shared 432, client 58, server 39 (incl. forced thor/tornado/force networked matches and a refresh-then-fire regression), e2e 1.

**Rough**
- On Sunset Chasm the Force band overlaps the rims, so it is nearly a global ×1.5 there (DESIGN assumption 139).
- Sky-origin beams drill through the cave ceiling; a tornado in the cave usually sends the shot into the roof.
- Sprites are small and plain; an art pass toward a chibi, busier look follows (see `docs/ART.md`).

**How to deploy**: see `docs/DEPLOY.md`. Set `SKY_EVENT=thor|tornado|force|none` to force an event for testing.

## Art pass — chibi style (2026-09-18)

**Works**
- `docs/ART.md` style guide (56×48 canvas, up to 64×56 for big walkers; chibi proportions; 1 px outline with a 2 px sole; top-left light, 4-tone ramps; shared 24-colour base palette; animation table; barrel pivot rules).
- `pnpm sprites:render <id|all>` renders any sprite to a PNG sheet with anchor and barrel guides using only Node built-ins; `all` also writes a roster contact sheet to `.art-preview/` (git-ignored).
- All 18 mobiles redrawn to the guide with faces, real hurt and death poses, and reviewed frame by frame. Sprite tests validate every sprite against its own dimensions.
- Scenes: textured terrain crust per map (tufts, studs, roots, crystal glints, scorched crater rims), richer parallax backgrounds, chunky explosions with debris and smoke, per-damage-type trails, hit sparks, screen shake.
- HUD skin: bevelled panels, glossy power bar, pixel icons for shots and items, framed portrait, wind dial, pulsing timer, team-coloured delay list, chat bubbles; themed lobby and room with a pixel wordmark and mobile portraits in the picker.
- Tests: shared 574, client 70, server 39, e2e 1.

**Rough**
- Death smoke puffs are placed by a generic routine, so spacing is uniform across mobiles.
- Client bundle is over 500 kB (Vite advisory); fine for a hobby deploy.
- PNG spritesheets remain supported (`kind: 'png'`) for hand-drawn replacements.

## Mobile landscape support (2026-09-21)

**Works**
- Adaptive backbuffer: width fixed at 800, height `clamp(round(800 × screenH / screenW), 360, 600)`, so 20:9 phones fill the glass with no letterbox and 4:3 desktops stay 800×600 at integer scale. Safe-area insets respected; refits on resize, rotation and visual-viewport changes.
- Compact HUD variant for short views: larger FIRE, SKIP, angle and walk buttons, a drag pad on the angle dial (0.8° per px), bigger readouts, fewer captions. Desktop windows keep the full HUD.
- Pointer Events replace mouse input: per-pointer roles (fire, angle, move, aim pad, camera drag, teleport target), multi-touch (hold FIRE while adjusting the angle), no stuck keys on pointer cancel, context menu and page scroll/zoom suppressed.
- Held walk and aim intents are sent from the frame loop, so releasing an on-screen arrow always stops the mobile; a stopping `moveEcho` takes the authority's position and gauge outright (this removed a real move-gauge desync).
- Responsive lobby and room (portrait strip, item strip, 16 px inputs, share button), in-match chat that survives the virtual keyboard, rotate-your-phone overlay, Fullscreen button, wake lock during matches.
- PWA: `manifest.webmanifest` (standalone, landscape), generated 192/512 icons, apple-touch-icon; the server serves them with the right content types. "Add to Home Screen" gives a fullscreen landscape app on iPhone.
- Tests: shared 574, client 99, server 39, e2e 2 (desktop smoke + touch-only phone spec).

**Rough**
- iPhone SE landscape (667×375) scales the 800-wide HUD to 0.83, so some secondary buttons fall under 44 CSS px; FIRE and the aim pad stay comfortable.
- A 1280×720 desktop window now renders 800×450 at scale 1 (smaller than before); resize the window taller or use fullscreen.

## Projectile art (2026-09-23)

**Works**
- Every projectile has its own Blender-rendered sprite: 54 pieces (every shot key, cluster bomblets, shatter shards, bubbles and both walking mines) in one atlas, `packages/client/public/sprites/blender/projectiles.png`, through the mobiles' toon and pixel pipeline (`tools/blender/projectile_kit.py`, one module per mobile in `tools/blender/projectiles/`, `pnpm projectiles`). Before this, every shot was the same 6 px grey square.
- Three modes: `aim` pieces are pre-rendered in 16 directions and drawn along the velocity, so pixels stay crisp and the light stays top left; `spin` pieces tumble and roll the way they fly; `loop` pieces wobble or blink (slime, creepers, bubbles, mines).
- The atlas is art only: collision, trails and explosions are unchanged. Four shots got their own sprite keys so no two mobiles fire the same sprite: `vortexSlug` (Vortex s1), `sapperCharge` (Sapper s1), `carpetMissile` (Stomper ss), `beaconBarrage` (Herald ss).
- `/projectiles` on the dev server shows every key per mobile, still and in flight; missing keys are flagged. The client test fails if a roster key has no art.
- Tests: shared 583, client 126.

**Rough**
- Pieces are modelled at 10-28 px and rendered 1.3x bigger (`ZOOM` in `build_projectiles.py`), 13-36 px on screen; one number to change if they should grow again.
- The Delver's Burrow drill can read like a carrot at some angles; the Clay Lob is plain.

## Review fixes (2026-09-23)

An outside review of the whole codebase; the five most serious findings fixed, each with a regression test.

**Works**
- Mobile physics: a mobile stands on a 1 px crust instead of dropping through it (the standing check now includes the feet row). Knockback stops at ceilings (a rising mobile no longer passes through the cave roof) and airborne drift moves one pixel at a time, so a 12 px/tick throw cannot skip through a thin wall or sink into a slope; within `maxStep` it lands on top.
- Server: a socket with more than `MAX_BUFFERED_BYTES` (1 MB) unsent is terminated, and errors no longer quote client input at full length. Before, one socket that stopped reading could grow the process ~3 MB/s until the machine ran out of memory.
- Client: a player who reconnects after the match ended gets a MATCH OVER plate instead of a local sim playing on alone. Forfeiting or leaving while offline is no longer undone by the reconnect replay. In-match intents are not queued while offline (a stale `fire` could go through after the server reset its sequence numbers).
- CI: `.github/workflows/ci.yml` runs typecheck, lint, unit tests and the Playwright suite on every push to main and every PR. `pnpm e2e` builds first. `.nvmrc` pins Node 22 to match the Docker image.
- Tests: shared 588, client 129, server 42, e2e 4 (new `reconnect.spec.ts` cuts sockets with `routeWebSocket`).

**Follow-up, same day**
- `hashState` now covers the PRNG words, the projectile and mine id counters, each mobile's facing, tilt, aim and walk input, and each seat's selected shot; drift there alone used to pass the hash and never get corrected. `moveDir` travels in the snapshot, so a mid-turn resync keeps a walking mobile walking.
- Per-address limits (`server/src/limits.ts`): sockets per address and in total, room creation, and failed joins. Failed joins are checked before the lookup, so an address that has been guessing codes learns nothing more. Browsers from another origin are refused (`ALLOWED_ORIGINS` for a client hosted elsewhere; the Vite dev proxy forwards the page host). See the table in `docs/DEPLOY.md`.
- Rule fixes: the match ends as soon as one team is left, even outside a shot (a forfeit or a turn-start mine blast during `starting` or `active` no longer makes the winner sit out the timer). A mine that expires at turn start leaves the list before anything triggers, so a neighbour's blast can no longer set it off. A throw inside an intent handler or a forfeit ends the match as `abandoned` instead of leaving the authority half-updated, and a match that fails to start puts the room back in the lobby (`startFailed`) instead of stranding it in phase `match`.
- Tests: shared 593, client 129, server 53 (new `limits.test.ts`), e2e 4.

**Still open from the review** (not fixed here)
- The client sim drops ticks after a stall longer than 12 frames' worth and only catches up on the next server message.
- Deploys end every match silently (no drain, no `kill_timeout`).
- Audio needs a fresh gesture every match; iOS `interrupted` state is not resumed.
- Free-play (sandbox only) never resets Dual/Power Up/Bunge, so one use applies to every later shot there.
- Client bundle is 1.23 MB (the legacy pixel sprites still ship); rooms of 3-8 players have no tests.

## Painted maps (2026-09-24)

The map pass, M1 to M3 (DESIGN §8.1): maps stop being procedural and become fixed landscapes modelled in Blender, rendered through the mobiles' toon and pixel pipeline. What you see is what you hit.

**Works**
- Pipeline (`tools/blender/maps/`, README "Maps"): one module per map on `map_kit.py` (profiles, slabs, strata, rocks, tubes, grass lips, trees, crystals, spires …), `build_maps.py` renders the terrain and 3 to 5 backdrop plates at 4x in headless Blender, `pack_maps.py` reduces them to pixel art (majority vote to the palette, part lines from an id pass, specks and pinholes, 1 px outline), checks the budgets (48 colours terrain, 32 per plate, 1.2 MB per map, alpha 0/255) and writes `client/public/maps/<id>/` (terrain, plates, `thumb.png`) and the generated `shared/src/data/maps/masks/<id>.ts` (mask RLE, sky, plate placements).
- Shared: `MapDef.source` can be `{ kind: 'mask', rle }`; a new `plate` parallax layer; the procedural generators stay as a source. Client: the terrain picture is blitted and carved (craters rimmed with the map's `scorch`), plates drawn in one `drawImage` each, art preloaded before the first frame, band painter as the fallback.
- Eight maps, each with its own idea: Rolling Hills (two high grounds, lobs over the valley, cover to shoot away), Sunset Chasm (straight exchange across a chasm, a rope bridge one shot drops), Cloudbreak Isles (floating isles, a central crag forces lobs, every rim a drop), Crystal Hollow (a roof that takes the lob away; flat shots through windows between fangs and crystals), Frozen Peaks (shelves ending in overhangs that can be shot away, a 300 px spire mid-valley), Magma Forge (a volcano wall to lob over or tunnel through), Jungle Temple (height against cover, a covered gallery sightline), Rust Yard (an airship hull as the only bridge, lattice girder towers).
- Playability suite (`shared/test/mapPlayability.ts`) on every map, 20 seeds × 2/4/8 seats: legal spawns, no sealed pockets, nobody boxed in (an armor drives 40 px from each 2- and 4-seat spawn), every seat can hit an opponent in still air.
- Spawn rule change found by that suite (procedural maps too): the strict spawn stages refuse a site where a footprint end stands more than `spawnGen.maxEdgeRisePx` (4) above the feet or hangs more than `maxEdgeDipPx` (13) below them.
- M3: buried objects no longer cast shadows (`map_kit.settle_shadows`, automatic from the geometry, documented as a kit rule): fossils, bones, the mammoth, gears, tyres, the lost miner, geodes, ore, strata pebbles and bands on all eight maps. Masks byte-identical after re-rendering all eight. Before/after: `docs/ui/maps/shadow_fix_pit_log.png`.
- M3: `make_maps.py` aborts with a non-zero exit when the Blender step fails (`--python-exit-code 1`, plus a fresh-`meta.json` check), instead of re-packing stale renders.
- M3: the room's map picker shows the chosen map's thumbnail in a gold kit frame and swaps it when the host changes map; the lobby's New room card shows a small one. Fits a landscape phone (the lobby still fits 844×390). Screenshots: `docs/ui/maps/room_thumb_desktop.png`, `room_thumb_phone.png`; per-map phone and desktop views in `docs/ui/maps/`.
- Tests: shared 692, client 183, server 53, e2e 4.

**Rough**
- Crystal Hollow on a phone: the roof (underside 370-410) is off screen while a mobile stands on the floor; the view shows 185 px above the mobile and the roof is 240-310 px up. The fangs are in view and a lob is followed to the ceiling. Fixing it means a much lower roof (DESIGN §8.1).
- Frozen Peaks: the spire was shortened to keep the valley open, and the aurora reads as streaks rather than curtains.
- Jungle Temple: the gateway reads as a floating lintel.
- Rust Yard and Crystal Hollow: with 8 seats, some spawns stand on props.
- Crystal Hollow's palette is dark. Magma Forge's magma chamber (painted on solid rock) needs another look.
- On a phone the compact HUD covers the bottom 127 px of a 370 px view, so little ground shows under a mobile on every map.

**How to run**
```
pnpm maps <id>                                     # render + pack one map (uv); or: python3 tools/blender/make_maps.py <id>
python3 tools/blender/make_maps.py <id> --dry      # render, check and preview (work/maps/<id>/preview*.png); write nothing
python3 tools/blender/make_maps.py                 # every map (Blender from $BLENDER, PATH or /Applications)
pnpm --filter @gunbros/shared test -- maps         # playability suite
open 'http://localhost:5173/sandbox?map=temple&sky=none'
```

## Hosting (2026-09-24)

Production hosting: one Hetzner Cloud server (`cx23`, Nuremberg) running Caddy in front of the game with docker compose, deployed on every green CI run on `main`. Fly is gone (`fly.toml` removed). DEPLOY.md is rewritten around it, with the owner's one-time checklist.

**Works**
- `deploy/server/`: `bootstrap.sh` (idempotent setup of any fresh Ubuntu 24.04 over SSH: `deploy` user with every key that could log in before, Docker from Docker's apt repo, unattended security upgrades with a 04:00 UTC reboot, ufw 22/80/443, `/opt/gunbros`, keys-only SSH with no root login), `compose.yaml` (Caddy publishes 80/443, the game's 8080 stays on the compose network, `CLIENT_IP_HEADER=x-real-ip`, optional `.env`), `Caddyfile` (`GAME_DOMAIN`, `X-Real-IP` set from the peer address, HTTP/3 off since UDP 443 is closed), `deploy.sh` (buildx `linux/amd64`, `docker save | gzip | ssh | docker load`, compose up, keeps the last 3 SHA tags for rollback, waits for `/health`).
- `deploy/hetzner/`: `provision.sh` (hcloud context or `HCLOUD_TOKEN`; idempotent SSH keys, firewall, server; prints the DNS records) and a `cloud-init.yaml` that runs the same `bootstrap.sh`.
- Live at https://play.gunbros.example.com (cx23 `gunbros`, nbg1): provisioned with `provision.sh`, cloud-init finished clean (ufw, keys-only SSH, traffic guard active), Let's Encrypt certificate issued by Caddy, IPv4 and IPv6 answer, a room was created over the live socket. The splash PLAY button links there. Deploy secrets are set, so merges to `main` deploy on their own.
- Traffic cap (DEPLOY.md "Traffic cap"): `vnstat` + a 5-minute systemd timer stop Caddy and the game once the month's outgoing traffic passes `TX_CAP_BYTES` (15 TB; the plan includes 20 TB, the only thing billed beyond the fixed price), and start them on the next month. Tested in an Ubuntu 24.04 container with a tiny cap: trips, stays tripped, resets.
- `.github/workflows/deploy.yml`: `workflow_run` after CI on `main` (push, success) or by hand; checks out the tested SHA; SSH from secrets with a pinned `known_hosts`; skips cleanly while `DEPLOY_HOST` is unset. `pnpm deploy:prod` runs the same script (`pnpm deploy` is a pnpm builtin).
- Checked locally: `bootstrap.sh` run twice in a systemd Ubuntu 24.04 container (Docker up, keys merged, ufw, `sshd -T` shows no password/root login); cloud-init schema valid; shellcheck and actionlint clean; the compose stack with `GAME_DOMAIN=localhost`: `/health`, `/`, `/r/ABCD` 200 over HTTPS, `/ws` 101 through Caddy, bad origin 403, and the game's per-address limit keyed on the client's address (not Caddy's, not a forged `X-Real-IP`). 8080 not published.

**Rough**
- A deploy restarts the game and ends live matches (no drain, by choice; DESIGN §7 item 172). So does the nightly reboot when an update needs one.
- The first manual deploy from an Apple Silicon Mac builds amd64 under emulation (slow). CI builds natively.
- Cloudflare records must stay DNS only (grey cloud); proxied, the first certificate request can fail depending on the zone's SSL mode.

**How to run**
```
hcloud context create gunbros && deploy/hetzner/provision.sh    # once (docs/DEPLOY.md)
pnpm deploy:prod HOST                                           # manual deploy; merges to main deploy on their own
ssh deploy@HOST 'cd /opt/gunbros && docker compose logs -f game'
curl https://play.gunbros.example.com/health
```

## Blender effects (2026-09-24)

The VFX pass (DESIGN §8.2): explosions and the other one-shot effects are Blender flipbooks, rendered with the mobiles' toon light and reduced to pixel art like everything else.

**Works**
- Pipeline (`tools/blender/`, README "Effects"): `effects_kit.py` (metaball blobs, shards, rocks, rings, stars, arcs; heat, toon and flat looks), modules in `effects/` (blasts, hits, smoke, beams), `build_effects.py` (headless Blender at 4x, one process per module, in parallel), `pack_effects.py` (majority vote to each clip's palette, part lines, outline round the lit parts only, per-frame trim, indexed atlas, budget check), `make_effects.py` (glue, `--only` with globs, `--dry`, `--pack`). Iterations in `tools/blender/iterations/effects/`.
- 37 clips in `client/public/sprites/blender/effects.png` (181 KB, 51 colours) + `effects.json`: a blast per damage type (explosive fireball to smoke, fire bonfire, energy plasma ball with arcs, impact dust and rocks, ice shard burst, water splash crown) in three size tiers, a hit pop per damage type, the death blast, six smoke puffs, three beam segment widths and the beam burst, the teleport, the vortex.
- Client: `render/effectSprites.ts` (loader, frame by age, tier by radius, satellites past the largest tier, damage-type fallback, drawing), `render/effects.ts` draws the flipbooks when the atlas is in and the old code effects otherwise (loading, failed, `?sprites=pixel`). Ground chunks, debris, sparks, trails, marks, damage numbers and the shake stay code on top. A wreck smokes for about three seconds; big explosive and fire blasts leave smoke hanging. Tunables in `clientConstants.effects.sprites`. Dev gallery at `/effects`.
- Checked in the sandbox on hills with armor, dragon (S1 and the 88 px SS: large blast plus four satellites), frostbite, frog, turtle, mage, boomer, asate (beam), jd (vortex), bigfoot (barrage): 58 to 60 fps with the barrage, no console errors.
- Tests: client 196 (13 new in `test/effectSprites.test.ts`), shared 693, server 57, e2e 4.

**Rough**
- On a big carve the blast hangs over the new crater rather than sitting on its floor (DESIGN §7 item 177).
- The water crown's sheet shows a few flat bands from the metaball mesh; the large smoke puffs are rather uniform balls.
- One variant per clip (no mirroring, item 174); a barrage of the same shell repeats the same flipbook, offset only by timing.
- The vortex keeps the old anti-aliased code ring for the pull radius.

**How to run**
```
pnpm effects                                           # render + pack everything (uv); or: python3 tools/blender/make_effects.py
python3 tools/blender/make_effects.py blasts --only 'blast_fire_*' --dry   # look at a few (work/effects_preview.png)
pnpm --filter @gunbros/client test -- effectSprites
open http://localhost:5173/effects                     # every clip looping
open 'http://localhost:5173/sandbox?map=hills&a=dragon'   # in the game; add &sprites=pixel for the code effects
```

## Music (2026-09-24)

Per-map background music (DESIGN §8.3): the owner's own Farline OST, one track per map plus the lobby, sudden death and the results.

**Works**
- 11 tracks in `client/public/music/` (MP3, 112 kbps, about 16 MB), built from the masters by `pnpm music <dir>` (`tools/music/make_music.py`: mpg123 decode, head trim, lame encode, loudness report).
- `audio/music.ts`: `trackFor` / `matchScene` (pure, tested) and one app-wide `MusicPlayer` that streams through an `<audio>` element and a WebAudio gain, fades between tracks, starts on the first press, pauses in a background tab and never logs.
- Lobby and room play Farline6 without restarting between them; the match plays its map's track, switches at sudden death, and plays the results once the end panel is up (a forfeit included).
- One sound switch with three steps (on, music off, off): the HUD speaker (new slashed-note icon for the middle step), `M`, and a button in the lobby and the room. Stored in `gunbros.mute` + `gunbros.music`.
- Server: `.mp3` served as `audio/mpeg`, single byte ranges (206, 416) for Safari and for looping (`server/src/range.ts`).
- Checked against the production build (`node packages/server/dist/index.js`, a WebSocket bot as the second player): lobby, room, Sunset Chasm, Jungle Temple, forfeit, back to the room, each on the right track, every request 206, no console errors.
- Tests: client 209 (13 new in `test/music.test.ts`), server 62 (5 new byte-range tests).

**Rough**
- The loop point has a short gap: a media element wraps less cleanly than a decoded buffer (DESIGN §7 item 178). No track was marked as looping cleanly in the audition.
- Gains are computed from RMS, not tuned by ear yet; Farline4 (Rolling Hills) is quiet and ambient by nature and is lifted the most.
- Leaving a match for the room restarts the lobby track from the top.
- Safari was not tested on a device; the range support and the unlock inside the gesture are what it needs, by the book.

**How to run**
```
brew install mpg123 lame
pnpm music ~/Downloads/FarlineOSTDemo      # rebuild public/music from the masters, print gains
pnpm --filter @gunbros/client test -- music
pnpm dev                                  # click once anywhere: the lobby track starts; M in a match cycles the switch
```

## Admin portal (2026-09-24)

A password-protected page at `/admin` for deciding when to deploy (DESIGN §7 items 184-185, docs/DEPLOY.md).

**Works**
- A deploy verdict at the top: red while a match runs (how many, for how long, typical match length), amber when people are online outside a match, green when nobody is, with how long it has been quiet.
- Tiles: online now, in a match, rooms, today's peak, matches and sessions today.
- Every room, live: code, map, lobby or match (turn, sky, HP bar per player, whose turn), who is host, ready, dropped. Players in the lobby with address and time online.
- Players online over 6 h / 24 h / 7 d / 14 d, with a hover tooltip; a quiet-hours heatmap by hour of the week that names the quietest 3-hour stretch.
- The last 50 matches (map, players, mobiles, winner, forfeit, turns, length). Server panel: uptime, build SHA, memory, load, event-loop delay, sockets.
- Basic auth with `ADMIN_PASSWORD` (constant-time compare, 5 wrong tries a minute per address, then 429); no password means no portal. `no-store`, `noindex`, CSP, framing denied.
- History is kept across deploys in the `game_data` volume. The image carries its `GIT_SHA`.
- Password: `.admin-password` at the repo root (git-ignored and docker-ignored), read by `pnpm dev`; deploy.sh writes it (or the `ADMIN_PASSWORD` secret in CI) into the server's `.env` over stdin.
- Checked in Playwright against a local server with bots in a match and a week of generated history: desktop, dark, 390 px phone, hover; no console errors, no horizontal scroll. The image was built and inspected. Tests: server 69 (7 new in `test/admin.test.ts`).

**Rough**
- History starts empty on the first deploy; the quiet-hours grid needs about a week to mean anything.
- "Sessions" counts new identities, and everyone gets a new one after a restart, so deploy days read high.
- Addresses are shown as Caddy sees them; nothing is stored beyond the live list.

**How to run**
```
pnpm dev                                   # then http://localhost:8080/admin, password in .admin-password
pnpm --filter @gunbros/server test -- admin
```

## Practice bots (2026-09-24)

Server-side bots, so someone can try the game with nobody else online (DESIGN §11, §7 items 186-192).

**Works**
- Lobby: "Practice vs bot" beside Create room opens an unlisted room (the map and size picked there) with you on team A and a Normal bot on team B. Ready, Start.
- Room screen: the host fills any empty seat with "+ Bot A" / "+ Bot B"; a bot's card has a BOT badge, its difficulty, and for the host a difficulty picker (Easy / Normal / Hard), a mobile picker, a team swap (rooms over two) and Remove. Every key is 44 px on a phone in landscape; nothing scrolls sideways.
- Bots take any seat in any team and any room size; they are always ready and connected, never host, never swept, and leave with the last human (a bot-only match is stopped). The open-rooms list counts them as seats but not as somebody to play with.
- The bot plays through the runner's own handlers: thinks, walks if a better shot is a few steps away, turns round if needed (a `move` pair on one tick, no walk), sweeps the barrel through `aim`, selects the shot, charges at the human rate through `charging`, fires. A turn that ends under it (timer, forfeit, match end) is dropped quietly.
- Walking (DESIGN §7 item 190): positions are where it stands plus walks of ⅓, ⅔ and all of the gauge each way, each simulated on a copy with the real `move` and `step` for an exact tick count; deaths, falls (ledges, pits, the map edge) and duplicates are dropped, and walking costs a little score. The driver replays the walk tick for tick (the live hull stops bit-for-bit where the copy's did), waits for it to settle, re-aims from the live state with a quick refine, then aims and fires. Hard and Normal weigh every position; Easy only walks when nothing hits from where it stands, and misjudges the length by up to 30 %.
- The planner (`shared/src/bot/planner.ts`) fires candidate shots at a deep copy of the match (`match/clone.ts`) with the real `applyIntent`/`step` and scores the outcome; it never touches the live state or the match PRNG. Difficulty is noise from the bot's own PRNG.
- Measured cost with walking (M-series Mac, `tsx`, every mobile on all 8 maps): one candidate 0.4-0.9 ms; a whole plan 300-380 candidates, 120-340 ms on average, worst 500 ms (bigfoot; asate 368, grub and lightning ~295); the worst single step between yields 11 ms (asate). At 5 ms per tick the worst plan is ~1.7 s of ticks, so the think time went up to 1.5-2.1 s (Hard) and 1.5-2.2 s (Normal); an unfinished plan fires the best found so far (the standing grid is always done first). The slowest turn from turn start to fire was 10.8 s of the 20 s timer.
- Watched over 24 simulated bot-vs-bot matches (8 mobiles, every map, random skies), the same survey with and without walking: Hard 87 % hits (~11 turns a 1v1) either way, Normal 62 % either way, Easy 39 % → 46 % (walking unsticks it), misses a median ~60 px from the target. Of 24 opening positions the search now finds a hit in 20 (18 standing still with this grid). Of the 5 that were stuck before walking, 1 now finds a hit (scrapyard, grub); the other 4 are behind a step taller than the mobile can climb (boomer three times behind a ~90 px pillar on Sunset Chasm, aduka once behind a 57 px step on Jungle Temple), which no walk gets past.
- HUD marks bot names "Name (bot)"; the admin portal tags bots in rooms, matches and history (older records still load).
- Tests: shared 707 (14 in `test/bot.test.ts`, incl. a walled-in bot that walks and hits, never walking off a cliff or into a pit, re-aiming after a short walk), server 85 (10 in `test/bots.test.ts` incl. a whole bot-vs-bot match on a fake clock replayed hash-for-hash, the same with walking forced every turn, a 2v2 of one socket client and three walking bots, 4 protocol, 2 admin), e2e 5 (`practice.spec.ts`).

**Rough**
- Bots do not use items. A walk cannot climb a step taller than the mobile's `maxStep`, so a bot behind a tall pillar still fires at it.
- Walking only looks at 3 lengths each way; a spot between two of them is only reached by chance (Easy's misjudged walks).
- No "stand where the enemy is unlikely to hit" bonus: it would need the enemy's search too.
- The plan is timed on this machine; a slower server finishes less of it before the think time is up and fires the best so far (the standing grid always, walks and refinement if there was time). A tick can overrun the 5 ms budget by one step (11 ms at worst).
- While the only human is disconnected (grace period), the bots keep playing and the human's turns time out.
- Easy's misses come partly from "settling" for a lower-ranked candidate, which can occasionally be a different spot altogether.

**How to run**
```
pnpm dev                                   # lobby → Practice vs bot → Ready → Start match
BOT_TIME_SCALE=0.3 pnpm dev                # faster bots for a quick look
pnpm --filter @gunbros/shared test -- bot
pnpm --filter @gunbros/server test -- bots
pnpm e2e                                   # includes tests/practice.spec.ts
```
