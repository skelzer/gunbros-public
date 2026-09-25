/**
 * Shared scaffolding for the per-mobile behaviour tests (DESIGN §10:
 * "`mobiles/*.test.ts`: one per behaviour module").
 *
 * Phase 4 is four agents writing `test/mobiles/<id>.test.ts` in the same tree, so
 * everything they all need lives here and nobody edits anyone else's test file. Add to
 * this file only what *every* group would otherwise duplicate; anything specific to one
 * behaviour belongs in that behaviour's own test.
 *
 * The arena is deliberately dull: a flat 1600×900 map with the ground at y = 600, no
 * wind, `freePlay` mode so any seat may fire at any time, and the two mobiles a fixed
 * distance apart. A behaviour test wants to assert "six shards were spawned", not to
 * fight the hills generator.
 */
import { createMatch, applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { MatchMode, MatchState, SeatSpec } from '../../src/match/match.js';
import type { MapDef } from '../../src/data/maps.js';
import type { MobileId, ShotSlot } from '../../src/data/mobiles/index.js';
import type { ExplosionEvent, SimEvent } from '../../src/match/events.js';
import { makeWind } from '../../src/rules/wind.js';
import { settleOnGround } from '../../src/entities/mobile.js';
import { getMobileDef } from '../../src/data/mobiles/index.js';
import { mobileOfSeat } from '../../src/match/match.js';
import { flatTestMap } from '../helpers.js';

export interface DuelOptions {
  /** `freePlay` (the default) lets either seat act at any time. */
  mode?: MatchMode;
  /** Defaults to the flat 1600×900 arena. */
  map?: MapDef;
  /** Seat 0's x. Default 600. */
  xA?: number;
  /** Seat 1's x. Default 1000. */
  xB?: number;
  /** Wind strength; 0 by default so a test's numbers are its own. */
  windStrength?: number;
  windDirectionDeg?: number;
}

/** Ticks a single shot is given to settle before a test gives up on it. */
export const MAX_RESOLVE_TICKS = 900;

/**
 * Two mobiles facing each other on flat ground. `idA` takes seat 0 (team A) and `idB`
 * seat 1 (team B).
 */
export function createDuel(
  idA: MobileId,
  idB: MobileId,
  seed: number,
  options: DuelOptions = {},
): MatchState {
  const map = options.map ?? flatTestMap();
  const seats: SeatSpec[] = [
    { playerId: 'a', nick: 'A', team: 'A', mobileId: idA },
    { playerId: 'b', nick: 'B', team: 'B', mobileId: idB },
  ];
  const state = createMatch(seed, map, seats, { mode: options.mode ?? 'freePlay' });
  state.wind = makeWind(options.windStrength ?? 0, options.windDirectionDeg ?? 0);

  // `settleOnGround` scans *down* from where the mobile already is, so moving one
  // sideways onto a hill and settling from there leaves it buried: the map's spawn y at
  // the old x can be well below the surface at the new one, and the scan never looks up.
  // Lifting it clear of solid ground first (and no further, so a mobile placed under a
  // roof stays under it) makes the placement independent of where `createMatch` put it.
  // Harmless on the flat arena every behaviour test uses, but a test that passes a
  // sloped `map:` would otherwise silently be firing from inside the hill.
  const place = (m: ReturnType<typeof mobileOfSeat>, x: number, facing: -1 | 1): void => {
    if (!m) return;
    m.x = x;
    m.facing = facing;
    while (m.y > 0 && state.terrain.isSolid(m.x, m.y - 1)) m.y--;
    settleOnGround(m, getMobileDef(m.defId), state.terrain);
  };
  place(mobileOfSeat(state, 0), options.xA ?? 600, 1);
  place(mobileOfSeat(state, 1), options.xB ?? 1000, -1);
  return state;
}

/**
 * Aim, fire and run the simulation until the shot has settled (or
 * {@link MAX_RESOLVE_TICKS} have passed). Returns every event the fire and the ticks
 * after it produced, in order — which is what a behaviour test asserts against.
 */
export function fireAndResolve(
  state: MatchState,
  seat: number,
  shot: ShotSlot,
  relAngle: number,
  power: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  applyIntent(state, { t: 'aim', seat, relAngle });
  applyIntent(state, { t: 'selectShot', seat, shot });
  for (const e of applyIntent(state, { t: 'fire', seat, shot, relAngle, power })) events.push(e);
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    for (const e of step(state)) events.push(e);
    if (isSettled(state)) break;
  }
  return events;
}

/** Run `ticks` plain steps, collecting the events (for timers, mines, marks). */
export function runTicks(state: MatchState, ticks: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    for (const e of step(state)) events.push(e);
  }
  return events;
}

/** Every explosion in an event list, in order. */
export function findExplosions(events: readonly SimEvent[]): ExplosionEvent[] {
  const out: ExplosionEvent[] = [];
  for (const e of events) if (e.t === 'explosion') out.push(e);
  return out;
}

/** Every event of one type, typed. */
export function eventsOfType<T extends SimEvent['t']>(
  events: readonly SimEvent[],
  type: T,
): Array<Extract<SimEvent, { t: T }>> {
  const out: Array<Extract<SimEvent, { t: T }>> = [];
  for (const e of events) {
    if (e.t === type) out.push(e as Extract<SimEvent, { t: T }>);
  }
  return out;
}

export function hpOf(state: MatchState, seat: number): number {
  return mobileOfSeat(state, seat)?.hp ?? 0;
}

export function shieldOf(state: MatchState, seat: number): number {
  return mobileOfSeat(state, seat)?.shield ?? 0;
}

/** A copy of the terrain mask, to be compared with a later one. */
export function maskOf(state: MatchState): Uint8Array {
  return state.terrain.mask.slice();
}

/**
 * How many solid pixels became air between two {@link maskOf} snapshots — the size of
 * the hole a shot dug, which is the honest way to test a carve without pinning pixels.
 */
export function carvedPixels(before: Uint8Array, after: Uint8Array): number {
  let carved = 0;
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    if (before[i] !== 0 && after[i] === 0) carved++;
  }
  return carved;
}
