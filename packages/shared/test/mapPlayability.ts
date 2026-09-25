/**
 * The playability suite every map runs (DESIGN §8.1). `describeMapPlayability(map)`
 * registers it for one map; `maps.test.ts` calls it for every map in the pool, so a
 * map added to the registry is covered the moment it exists and nobody writes tests for
 * it by hand.
 *
 * Over twenty seeds and rooms of 2, 4 and 8 seats it asserts, per seat:
 *
 * 1. **Legal spawns**, the rules `spawnGen` promises: on the ground (solid under the
 *    feet, air right above them), on rock rather than a crust (`minThicknessPx`), not
 *    on a ramp the aim range cannot cope with (under 30°), with `minHeadroomPx` of air
 *    over the head in rooms of 2 and 4 (a full room of 8 may relax that to
 *    `floorHeadroomPx`, which is what the last spawn stage keeps), and far enough from
 *    the seat beside it.
 * 2. **No sealed pockets.** Air flood-filled from the top and both sides of the map
 *    reaches the pixel over every seat's head, so nobody starts walled into a cave
 *    their own shells burst in.
 * 3. **Nobody is boxed in.** In rooms of 2 and 4, an armor (whose `maxStep` is near
 *    the bottom of the roster) set down on each spawn can drive `WALK_PX` at least one
 *    way. A wall on one side is terrain; a wall on both within a few px is a tuft or a
 *    pebble that every mobile snags on (map_kit.WALK_BUMP_PX), which is what this
 *    catches. Walking off a ledge counts as walking.
 * 4. **Every seat can hit an opponent.** With zero wind, the reference shell (armor's
 *    S1, the shot every range in DESIGN §2.2 is quoted against) is fired from the real
 *    muzzle of an armor settled on the spawn, over a spread of angles inside armor's
 *    aim range and powers from 20 to 100 %, stepped with the shared `stepProjectile`
 *    against the real mask. At least one shot must land a direct hit on a seat of the
 *    other team or burst within half the shell's damage radius of one. This is the
 *    simulation itself, not a parabola, so a tree in the way counts as in the way.
 *
 * Seats alternate teams left to right (A, B, A, B …), as `generateMap` deals them.
 */
import { describe, expect, it } from 'vitest';
import { Prng } from '../src/math/prng.js';
import { constants } from '../src/data/constants.js';
import { spawnGen } from '../src/data/maps.js';
import type { MapDef } from '../src/data/maps.js';
import { armor } from '../src/data/mobiles.js';
import { computeSpawnPoints, generateTerrain } from '../src/terrain/generate.js';
import type { SpawnPoint } from '../src/terrain/generate.js';
import type { Terrain } from '../src/terrain/terrain.js';
import { RAD_TO_DEG } from '../src/math/trig.js';
import { createMobile, setMoveDir, settleOnGround, stepMobile, worldAngleDeg } from '../src/entities/mobile.js';
import type { MobileState } from '../src/entities/mobile.js';
import { createProjectile, launchVelocity, stepProjectile } from '../src/entities/projectile.js';
import { muzzlePosition } from '../src/match/reducer.js';
import { makeTestContext } from './helpers.js';

export const PLAYABILITY_SEEDS: number[] = [];
for (let i = 0; i < 20; i++) PLAYABILITY_SEEDS.push((i * 2654435761 + 12345) >>> 0);

/** The seat counts a room can have: a duel, 2v2 and a full room. */
export const SEAT_COUNTS = [2, 4, 8] as const;

/** Aim and power sweep of the reachability check: every `ANGLE_STEP`° and `POWER_STEP`. */
const ANGLE_STEP = 3;
const POWER_STEP = 0.025;
const MIN_POWER = 0.2;
/** A shell that bursts this close to a target, as a share of its damage radius, counts. */
const NEAR_MISS = 0.5;
/** Ticks a test shell may fly before the sweep gives up on it. */
const MAX_TICKS = 900;
/** Px an armor must be able to drive each way from a spawn. */
export const WALK_PX = 40;

/** Terrain and spawns exactly as `generateMap` would build them for this seed. */
export function spawnsFor(map: MapDef, seed: number, count: number): { terrain: Terrain; spawns: SpawnPoint[] } {
  const rng = Prng.seed(seed);
  const terrain = generateTerrain(map, rng);
  return { terrain, spawns: computeSpawnPoints(terrain, count, rng) };
}

function headroom(terrain: Terrain, x: number, y: number, cap: number): number {
  let n = 0;
  for (let probe = y - 1; probe >= 0 && n < cap; probe--) {
    if (terrain.isSolid(x, probe)) return n;
    n++;
  }
  return n;
}

/**
 * Air reachable from the open sky: a 4-connected flood from every air pixel on the top
 * row and the two side columns. Cached per terrain hash, since a painted map has the
 * same ground on every seed.
 */
const openAirCache = new Map<number, Uint8Array>();

export function openAir(terrain: Terrain): Uint8Array {
  const key = terrain.hash();
  const cached = openAirCache.get(key);
  if (cached) return cached;
  const w = terrain.width;
  const h = terrain.height;
  const mask = terrain.mask;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (i: number): void => {
    if (seen[i] === 1 || mask[i] === 1) return;
    seen[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) push(x);
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++] as number;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i + w < w * h) push(i + w);
  }
  openAirCache.set(key, seen);
  return seen;
}

/** An armor set down on a spawn exactly the way `createMatch` does it. */
function armorAt(seat: number, spawn: SpawnPoint, terrain: Terrain, facing: -1 | 1): MobileState {
  const m = createMobile(seat, 'armor', seat % 2 === 0 ? 'A' : 'B', armor, spawn.x, spawn.y, facing);
  settleOnGround(m, armor, terrain);
  return m;
}

/** How far an armor set down at `spawn` gets driving in `dir` (capped at WALK_PX). */
export function walkDistance(terrain: Terrain, spawn: SpawnPoint, dir: -1 | 1): number {
  const m = armorAt(0, spawn, terrain, dir);
  const ctx = { terrain, mapHeight: terrain.height, emit: (): void => {}, refillGauge: true };
  setMoveDir(m, dir);
  const x0 = m.x;
  for (let t = 0; t < 400 && Math.abs(m.x - x0) < WALK_PX && m.alive; t++) stepMobile(m, armor, ctx);
  return Math.abs(m.x - x0);
}

/**
 * Can `shooter` hit any of `targets` with the reference shell in still air? Returns the
 * first (angle, power) that does, or null. Nothing is carved: each shot flies over the
 * untouched map.
 */
export function findHittingShot(
  terrain: Terrain,
  spawns: SpawnPoint[],
  shooterSeat: number,
): { targetSeat: number; relAngle: number; power: number } | null {
  const me = spawns[shooterSeat];
  if (!me) return null;
  const shell = armor.shots.s1.projectile;
  const reach = shell.damageRadius * NEAR_MISS;
  const targets: MobileState[] = [];
  spawns.forEach((s, seat) => {
    if (seat % 2 !== shooterSeat % 2) targets.push(armorAt(seat, s, terrain, 1));
  });
  for (const target of targets) {
    const facing: -1 | 1 = target.x >= me.x ? 1 : -1;
    const shooter = armorAt(shooterSeat, me, terrain, facing);
    const ctx = makeTestContext(terrain, undefined, [shooter, target]);
    let burst: { x: number; y: number } | null = null;
    ctx.explode = (p, x, y): void => {
      burst = { x, y };
      p.alive = false;
    };
    const cx = target.x;
    const cy = target.y - armor.footprint.h / 2;
    for (let rel = armor.angleMin; rel <= armor.angleMax; rel += ANGLE_STEP) {
      const world = worldAngleDeg(shooter, rel);
      const muzzle = muzzlePosition(shooter, armor, world);
      for (let power = MIN_POWER; power <= 1.0001; power += POWER_STEP) {
        const v = launchVelocity(shell, world, power);
        const p = createProjectile(1, shell, shooter.seat, muzzle.x, muzzle.y, v.vx, v.vy);
        burst = null;
        // A direct hit on the target's box also ends in `explode`, at a point inside
        // the box, so one distance test covers both.
        for (let t = 0; t < MAX_TICKS && p.alive; t++) stepProjectile(p, ctx);
        const b = burst as { x: number; y: number } | null;
        if (b && (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy) <= reach * reach) {
          return { targetSeat: target.seat, relAngle: rel, power };
        }
      }
    }
  }
  return null;
}

/**
 * Register the whole suite for one map. `knownGaps` names checks (by the start of their
 * title, e.g. `'4 seats: nobody is boxed in'`) that are skipped rather than run: it
 * exists for the procedural maps still waiting for their painted remake, and a painted
 * map must never need it.
 */
export function describeMapPlayability(map: MapDef, knownGaps: readonly string[] = []): void {
  const check = (title: string, fn: () => void, timeout?: number): void => {
    const gap = knownGaps.some((g) => title.startsWith(g));
    (gap ? it.skip : it)(gap ? `${title} (known gap until ${map.id} is remade)` : title, fn, timeout);
  };
  describe(`${map.id}: playability over ${PLAYABILITY_SEEDS.length} seeds (DESIGN §8.1)`, () => {
    for (const count of SEAT_COUNTS) {
      check(`${count} seats: legal spawns`, () => {
        // Rooms of 2 and 4 keep the design separation on any map 1600 px or wider; a
        // full room may close up to the floor the last spawn stage keeps.
        const separation = count >= 8 ? spawnGen.minSeparationFloorPx : spawnGen.minSeparationPx;
        const needHeadroom = count >= 8 ? spawnGen.floorHeadroomPx : spawnGen.minHeadroomPx;
        for (const seed of PLAYABILITY_SEEDS) {
          const { terrain, spawns } = spawnsFor(map, seed, count);
          expect(spawns).toHaveLength(count);
          for (let i = 0; i < spawns.length; i++) {
            const s = spawns[i] as SpawnPoint;
            const where = `${map.id} seed ${seed} seat ${i} at (${s.x}, ${s.y})`;
            expect(terrain.isSolid(s.x, s.y), `${where}: solid underfoot`).toBe(true);
            expect(terrain.isSolid(s.x, s.y - 1), `${where}: air overhead`).toBe(false);
            let thickness = 0;
            while (thickness < spawnGen.minThicknessPx && terrain.isSolid(s.x, s.y + thickness)) thickness++;
            expect(thickness, `${where}: rock, not a crust`).toBe(spawnGen.minThicknessPx);
            if (count < 8) {
              const tilt = Math.abs(
                terrain.sampleTilt(s.x, s.y, constants.spawn.slopeProbeWidthPx, constants.mobile.surfaceProbePx) *
                  RAD_TO_DEG,
              );
              expect(tilt, `${where}: slope`).toBeLessThan(30);
            }
            expect(headroom(terrain, s.x, s.y, needHeadroom), `${where}: headroom`).toBe(needHeadroom);
            if (i > 0) {
              const gap = s.x - (spawns[i - 1] as SpawnPoint).x;
              expect(gap, `${where}: separation`).toBeGreaterThanOrEqual(separation);
            }
          }
        }
      });

      check(`${count} seats: nobody starts in a sealed pocket`, () => {
        for (const seed of PLAYABILITY_SEEDS) {
          const { terrain, spawns } = spawnsFor(map, seed, count);
          const air = openAir(terrain);
          spawns.forEach((s, i) => {
            expect(air[(s.y - 1) * terrain.width + s.x], `${map.id} seed ${seed} seat ${i} at (${s.x}, ${s.y})`).toBe(1);
          });
        }
      });

      if (count < 8) {
        check(`${count} seats: nobody is boxed in (drives ${WALK_PX} px one way or the other)`, () => {
          for (const seed of PLAYABILITY_SEEDS) {
            const { terrain, spawns } = spawnsFor(map, seed, count);
            spawns.forEach((s, i) => {
              const left = walkDistance(terrain, s, -1);
              const right = walkDistance(terrain, s, 1);
              expect(
                Math.max(left, right),
                `${map.id} seed ${seed} seat ${i} at (${s.x}, ${s.y}) drives ${left.toFixed(1)} left, ${right.toFixed(1)} right`,
              ).toBeGreaterThanOrEqual(WALK_PX);
            });
          }
        });
      }

      check(`${count} seats: every seat can hit an opponent in still air`, () => {
        // Spawns repeat across seeds on a painted map; each distinct layout is checked once.
        const seen = new Set<string>();
        for (const seed of PLAYABILITY_SEEDS) {
          const { terrain, spawns } = spawnsFor(map, seed, count);
          const key = `${terrain.hash()}:${spawns.map((s) => `${s.x},${s.y}`).join(';')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          for (let seat = 0; seat < spawns.length; seat++) {
            const s = spawns[seat] as SpawnPoint;
            const shot = findHittingShot(terrain, spawns, seat);
            expect(shot, `${map.id} seed ${seed} seat ${seat} at (${s.x}, ${s.y}) cannot reach anyone`).not.toBeNull();
          }
        }
      }, 60_000);
    }
  });
}
