/**
 * nak — Delver (DESIGN §3): `burrow` on S2 and SS.
 *
 * The arena here is the flat duel arena with one wall dropped between the two mobiles,
 * because the whole mobile is about what a wall is worth: the S1 lob stops at the face
 * of it, the burrowing shells chew a tunnel through it and detonate on the far side.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { MatchState } from '../../src/match/match.js';
import type { MapDef } from '../../src/data/maps.js';
import { nak } from '../../src/data/mobiles/nak.js';
import type { CarveEvent, SimEvent } from '../../src/match/events.js';
import { constants } from '../../src/data/constants.js';
import { mobileOfSeat } from '../../src/match/match.js';
import { flatTerrain, maskMap } from '../helpers.js';
import {
  createDuel,
  eventsOfType,
  fireAndResolve,
  findExplosions,
  hpOf,
  MAX_RESOLVE_TICKS,
} from './helpers.js';

const WALL_X0 = 700;
const WALL_X1 = 732;
const WALL_TOP = 470;

/** The flat arena with a solid slab from `WALL_X0` to `WALL_X1` standing on it. */
function wallMap(): MapDef {
  const terrain = flatTerrain(1600, 900, 600);
  for (let x = WALL_X0; x < WALL_X1; x++) terrain.fillColumnFrom(x, WALL_TOP);
  return maskMap('testWall', terrain);
}

function duelAcrossWall(id: 'nak' | 'armor', seed: number): MatchState {
  return createDuel(id, 'armor', seed, { map: wallMap(), xA: 600, xB: 764 });
}

/** Carves inside the wall's own columns — i.e. the tunnel, not the entry crater. */
function carvesInsideWall(events: readonly SimEvent[]): CarveEvent[] {
  return eventsOfType(events, 'carve').filter((c) => c.x > WALL_X0 && c.x < WALL_X1);
}

describe('nak — the roster entry', () => {
  it('is a bionic digger that can aim below the horizon', () => {
    expect(nak.class).toBe('bionic');
    expect(nak.angleMin).toBeLessThan(0);
  });

  it('orders its delays S1 < S2 < SS, and digs deeper on the SS', () => {
    expect(nak.shots.s1.delay).toBeLessThan(nak.shots.s2.delay);
    expect(nak.shots.s2.delay).toBeLessThan(nak.shots.ss.delay);

    const s2 = nak.shots.s2.projectile.params ?? {};
    const ss = nak.shots.ss.projectile.params ?? {};
    expect(nak.shots.s2.projectile.behaviour).toBe('burrow');
    expect(nak.shots.ss.projectile.behaviour).toBe('burrow');
    expect(ss.tunnelRadius).toBeGreaterThan(s2.tunnelRadius ?? 0);
    expect(ss.ticks).toBeGreaterThan(s2.ticks ?? 0);
    expect(nak.shots.ss.projectile.damage).toBeGreaterThan(nak.shots.s2.projectile.damage);
  });
});

describe('nak — Burrow (S2)', () => {
  it('keeps going inside solid terrain and carves a tunnel along the way', () => {
    const state = duelAcrossWall('nak', 5);
    const events = fireAndResolve(state, 0, 's2', 45, 0.36);

    const tunnel = carvesInsideWall(events);
    // A shell that merely exploded on the face carves one crater; a tunnel is a
    // string of circles marching into the rock.
    expect(tunnel.length).toBeGreaterThan(2);

    let entry = Number.POSITIVE_INFINITY;
    let deepest = Number.NEGATIVE_INFINITY;
    for (const c of tunnel) {
      entry = Math.min(entry, c.x);
      deepest = Math.max(deepest, c.x);
    }
    const tunnelRadius = nak.shots.s2.projectile.params?.tunnelRadius ?? 0;
    expect(deepest - entry).toBeGreaterThan(tunnelRadius);

    // And the slab is pierced: some row of it is air from face to face.
    let pierced = -1;
    for (let y = WALL_TOP; y < 600 && pierced < 0; y++) {
      let open = true;
      for (let x = WALL_X0; x < WALL_X1 && open; x++) {
        if (state.terrain.isSolid(x, y)) open = false;
      }
      if (open) pierced = y;
    }
    expect(pierced).toBeGreaterThanOrEqual(WALL_TOP);
  });

  it('detonates once, past the face it went in through', () => {
    const state = duelAcrossWall('nak', 5);
    const events = fireAndResolve(state, 0, 's2', 45, 0.36);
    const explosions = findExplosions(events);
    expect(explosions).toHaveLength(1);
    expect(explosions[0]?.x).toBeGreaterThan(WALL_X0);
  });

  it('reaches a mobile standing behind the wall, which the plain lob cannot', () => {
    const burrowed = duelAcrossWall('nak', 5);
    const lobbed = duelAcrossWall('nak', 5);

    fireAndResolve(burrowed, 0, 's2', 45, 0.36);
    fireAndResolve(lobbed, 0, 's1', 45, 0.36);

    expect(hpOf(burrowed, 1)).toBeLessThan(1100);
    expect(hpOf(lobbed, 1)).toBe(1100);
  });

  it('stops on a mobile instead of tunnelling through it', () => {
    // No wall: the shell flies the open arena and hits seat 1 like any other shot.
    const state = createDuel('nak', 'armor', 7);
    const before = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's2', 45, 0.54);
    expect(findExplosions(events)).toHaveLength(1);
    expect(hpOf(state, 1)).toBeLessThan(before);
  });

  it('gives up near the surface when the rock never ends', () => {
    // Straight down into the floor: nothing to break out of and no far side to reach,
    // so `maxDepthPx` decides. Digging on to the tick budget would put the crater a few
    // hundred px below anything it could hurt.
    const state = createDuel('nak', 'armor', 9);
    const params = nak.shots.s2.projectile.params ?? {};
    const maxDepth = params.maxDepthPx ?? 0;
    expect(maxDepth).toBeGreaterThan(0);
    applyIntent(state, { t: 'aim', seat: 0, relAngle: -30 });
    const fired = applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: -30, power: 0.7 });
    const events: SimEvent[] = [...fired];
    for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
      for (const e of step(state)) events.push(e);
      if (isSettled(state)) break;
    }
    const explosions = findExplosions(events);
    expect(explosions).toHaveLength(1);
    // It did dig — a string of tunnel circles, not a single crater on the face…
    expect(eventsOfType(events, 'carve').length).toBeGreaterThan(3);
    // …and it stopped within one depth cap of the surface it went in through, so the
    // crater still reaches daylight.
    const entry = eventsOfType(events, 'carve')[0];
    if (!entry) throw new Error('no entry carve');
    const blast = explosions[0];
    if (!blast) throw new Error('no explosion');
    expect(blast.y - entry.y).toBeLessThanOrEqual(maxDepth + (params.digSpeed ?? 0));
    expect(blast.y).toBeGreaterThan(entry.y);
  });

  it('still hurts a mobile standing on open ground when it lands short', () => {
    // The flat arena, no wall: the shell goes into the floor 40 px short of seat 1.
    // A drill that kept diving on the tick budget detonated ~290 px down, for nothing.
    const state = createDuel('nak', 'armor', 13);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    const before = hpOf(state, 1);
    const shooter = mobileOfSeat(state, 0);
    if (!shooter) throw new Error('no shooter');
    // Aim so the shell lands ~40 px short: solve the flat-ground range for the power.
    const range = target.x - shooter.x - 40;
    const speed = nak.shots.s2.projectile.speed;
    const gravity = constants.gravity * nak.shots.s2.projectile.gravity;
    // 45°: range = v² / g, so v = sqrt(range * g) and power = v / speed.
    const power = Math.sqrt(range * gravity) / speed;
    fireAndResolve(state, 0, 's2', 45, power);
    expect(hpOf(state, 1)).toBeLessThan(before);
  });
});

describe('nak — Deep Drill (SS)', () => {
  it('bores a wider tunnel than the S2 and moves more dirt', () => {
    const small = duelAcrossWall('nak', 11);
    const big = duelAcrossWall('nak', 11);

    const smallEvents = fireAndResolve(small, 0, 's2', 45, 0.36);
    const bigEvents = fireAndResolve(big, 0, 'ss', 45, 0.36);

    const smallR = smallEvents
      .filter((e): e is CarveEvent => e.t === 'carve')
      .reduce((max, c) => Math.max(max, c.r), 0);
    const bigR = bigEvents
      .filter((e): e is CarveEvent => e.t === 'carve')
      .reduce((max, c) => Math.max(max, c.r), 0);
    expect(bigR).toBeGreaterThan(smallR);
    expect(carvesInsideWall(bigEvents).length).toBeGreaterThan(1);
  });
});
