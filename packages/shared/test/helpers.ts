/** Small builders shared by the unit tests. */
import { Prng } from '../src/math/prng.js';
import { Terrain } from '../src/terrain/terrain.js';
import { encodeRle } from '../src/terrain/codec.js';
import { hillsMap } from '../src/data/maps.js';
import type { MapDef } from '../src/data/maps.js';
import { makeWind } from '../src/rules/wind.js';
import type { WindState } from '../src/rules/wind.js';
import { armor } from '../src/data/mobiles.js';
import { createMobile } from '../src/entities/mobile.js';
import type { MobileState } from '../src/entities/mobile.js';
import { createProjectile } from '../src/entities/projectile.js';
import type { ProjectileState } from '../src/entities/projectile.js';
import type { BehaviourContext } from '../src/entities/behaviours/index.js';
import type { MineState } from '../src/entities/mines.js';
import type { SimEvent } from '../src/match/events.js';

export function flatTerrain(width: number, height: number, groundY: number): Terrain {
  const t = new Terrain(width, height);
  for (let x = 0; x < width; x++) t.fillColumnFrom(x, groundY);
  return t;
}

/**
 * A map whose mask is a fixed test terrain, so a test can talk about exact positions
 * instead of whatever the hills generator produced this seed.
 */
export function maskMap(id: string, terrain: Terrain): MapDef {
  return {
    ...hillsMap,
    id: id as MapDef['id'],
    displayName: id,
    width: terrain.width,
    height: terrain.height,
    source: { kind: 'mask', rle: encodeRle(terrain) },
  };
}

/** The standard flat arena: 1600x900 with ground at y = 600. */
export function flatTestMap(width = 1600, height = 900, groundY = 600): MapDef {
  return maskMap('testFlat', flatTerrain(width, height, groundY));
}

/** Ground that steps up by `rise` px at `atX`. */
export function stepTerrain(
  width: number,
  height: number,
  groundY: number,
  atX: number,
  rise: number,
): Terrain {
  const t = new Terrain(width, height);
  for (let x = 0; x < width; x++) t.fillColumnFrom(x, x < atX ? groundY : groundY - rise);
  return t;
}

/** Ground sloping down to the right by `dy` px per `dx` px. */
export function slopeTerrain(
  width: number,
  height: number,
  groundY: number,
  slope: number,
): Terrain {
  const t = new Terrain(width, height);
  for (let x = 0; x < width; x++) t.fillColumnFrom(x, Math.floor(groundY + x * slope));
  return t;
}

export interface TestContext extends BehaviourContext {
  events: SimEvent[];
  explosions: Array<{ x: number; y: number }>;
  projectiles: ProjectileState[];
  /** Every `beamStrike` call, for the beam behaviours' tests. */
  beams: Array<{ x: number; y: number; fromY: number; width: number }>;
  /** Every `mark` call, for the mark-then-something behaviours' tests. */
  marks: Array<{ x: number; y: number; ticksUntil: number; behaviour: string }>;
  /** Every `applyImpulse` call, for `pull`. */
  impulses: Array<{ seat: number; dx: number; dy: number }>;
}

/** A BehaviourContext backed by plain arrays, for testing entities in isolation. */
export function makeTestContext(terrain: Terrain, wind?: WindState, mobiles: MobileState[] = []): TestContext {
  const events: SimEvent[] = [];
  const explosions: Array<{ x: number; y: number }> = [];
  const projectiles: ProjectileState[] = [];
  const mines: MineState[] = [];
  const beams: TestContext['beams'] = [];
  const marks: TestContext['marks'] = [];
  const impulses: TestContext['impulses'] = [];
  let nextId = 1;
  let nextMineId = 1;
  const ctx: TestContext = {
    tick: 0,
    rng: Prng.seed(7),
    wind: wind ?? makeWind(0, 0),
    terrain,
    bounds: { width: terrain.width, height: terrain.height },
    mobiles,
    mines,
    activeSeat: 0,
    events,
    explosions,
    projectiles,
    beams,
    marks,
    impulses,
    defOf: () => armor,
    spawn: (def, x, y, vx, vy, ownerSeat, data) => {
      const p = createProjectile(nextId++, def, ownerSeat, x, y, vx, vy, data);
      projectiles.push(p);
      return p;
    },
    explode: (p, x, y) => {
      explosions.push({ x, y });
      ctx.carve(x, y, p.def.carveRadius);
    },
    // No sky in an isolated behaviour test: the band is a match-level fact, and
    // `sky.test.ts` covers it against a real `MatchState`.
    forceMultiplier: () => 1,
    carve: (x, y, r) => {
      const c = terrain.carve(x, y, r);
      events.push({ t: 'carve', x: c.x, y: c.y, r: c.r });
    },
    damageArea: () => {},
    beamStrike: (x, y, fromY, width) => {
      beams.push({ x, y, fromY, width });
    },
    applyImpulse: (seat, dx, dy) => {
      impulses.push({ seat, dx, dy });
    },
    mark: (x, y, ticksUntil, payload) => {
      marks.push({ x, y, ticksUntil, behaviour: payload.behaviour });
    },
    addMine: (mine) => {
      mine.id = nextMineId++;
      mines.push(mine);
    },
    emit: (e) => events.push(e),
    scheduleTurnEffect: () => {},
  };
  return ctx;
}

export function makeArmor(seat: number, x: number, y: number): MobileState {
  return createMobile(seat, 'armor', seat % 2 === 0 ? 'A' : 'B', armor, x, y, 1);
}
