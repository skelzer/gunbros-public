/**
 * trico — Triclops (DESIGN §3): `orbit` on S2.
 *
 * The claim the behaviour makes is geometric: three shards, always `radiusPx` from a
 * shared centre of mass, and that centre is the plain ballistic path the single-body
 * shots would have followed. Both halves are checked here, plus the ring actually
 * turning (a ring that never rotates would satisfy the first half).
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import { trico } from '../../src/data/mobiles/trico.js';
import { constants } from '../../src/data/constants.js';
import { createDuel, eventsOfType, fireAndResolve, findExplosions, hpOf, MAX_RESOLVE_TICKS } from './helpers.js';

const ORBIT = trico.shots.s2.projectile;

interface Sample {
  id: number;
  x: number;
  y: number;
}

/** One entry per tick: every live projectile's position. */
function trackOrbit(seed: number, relAngle: number, power: number): Sample[][] {
  const state = createDuel('trico', 'armor', seed);
  const frames: Sample[][] = [];
  applyIntent(state, { t: 'aim', seat: 0, relAngle });
  applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle, power });
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    step(state);
    frames.push(state.projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y })));
    if (isSettled(state)) break;
  }
  return frames;
}

describe('trico — the roster entry', () => {
  it('is a heavy bionic walker with a blunt, impact-typed arsenal', () => {
    expect(trico.class).toBe('bionic');
    expect(trico.hp).toBeGreaterThan(1100);
    expect(trico.moveSpeed).toBeLessThan(0.9);
    for (const slot of ['s1', 's2', 'ss'] as const) {
      expect(trico.shots[slot].projectile.damageType).toBe('impact');
    }
  });

  it('orders its delays S1 < S2 < SS and saves the weight for the SS', () => {
    expect(trico.shots.s1.delay).toBeLessThan(trico.shots.s2.delay);
    expect(trico.shots.s2.delay).toBeLessThan(trico.shots.ss.delay);
    expect(trico.shots.ss.projectile.damage).toBeGreaterThan(trico.shots.s1.projectile.damage);
    expect(trico.shots.ss.projectile.carveRadius).toBeGreaterThan(
      trico.shots.s1.projectile.carveRadius,
    );
  });

  it('keeps the ring shape in data', () => {
    expect(ORBIT.behaviour).toBe('orbit');
    expect(trico.shots.s2.count).toBe(3);
    expect(ORBIT.params?.count).toBe(3);
    expect(ORBIT.params?.radiusPx).toBeGreaterThan(0);
    expect(ORBIT.params?.spinDegPerSubStep).toBeGreaterThan(0);
  });
});

describe('trico — Orbit (S2)', () => {
  it('puts three shards in the air at once', () => {
    const state = createDuel('trico', 'armor', 17);
    const events = fireAndResolve(state, 0, 's2', 45, 0.54);
    expect(eventsOfType(events, 'spawn')).toHaveLength(3);
  });

  it('opens the ring from a point and then holds it at the ring radius', () => {
    const frames = trackOrbit(17, 60, 0.6);
    const radius = ORBIT.params?.radiusPx ?? 0;
    /** Sub-steps the ring takes to open; `constants.subSteps` of them per tick. */
    const rampTicks = Math.ceil((ORBIT.params?.rampSubSteps ?? 0) / constants.subSteps);
    expect(rampTicks).toBeGreaterThan(0);

    const spread = (frame: Sample[]): number => {
      const cx = frame.reduce((s, p) => s + p.x, 0) / frame.length;
      const cy = frame.reduce((s, p) => s + p.y, 0) / frame.length;
      let max = 0;
      for (const p of frame) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        max = Math.max(max, Math.sqrt(dx * dx + dy * dy));
      }
      return max;
    };

    // It leaves the barrel as one ball: the shot may not part while the muzzle is still
    // inside trico's own hull, which is what used to blow the shard up in its face.
    const first = frames[0];
    if (!first) throw new Error('no frames');
    expect(spread(first)).toBeLessThan(radius / 2);

    // Once open it is a rigid ring: every shard sits exactly `radiusPx` from the centre.
    let checked = 0;
    for (let i = rampTicks; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame || frame.length !== 3) continue;
      const cx = frame.reduce((s, p) => s + p.x, 0) / 3;
      const cy = frame.reduce((s, p) => s + p.y, 0) / 3;
      for (const p of frame) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(radius, 4);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('flies that centre of mass along the plain ballistic path', () => {
    const frames = trackOrbit(17, 60, 0.6);
    const centres: Array<{ x: number; y: number }> = [];
    for (const frame of frames) {
      if (frame.length !== 3) continue;
      centres.push({
        x: frame.reduce((s, p) => s + p.x, 0) / 3,
        y: frame.reduce((s, p) => s + p.y, 0) / 3,
      });
    }
    expect(centres.length).toBeGreaterThan(20);
    for (let i = 2; i < centres.length; i++) {
      const p0 = centres[i - 2];
      const p1 = centres[i - 1];
      const p2 = centres[i];
      if (!p0 || !p1 || !p2) continue;
      // No wind in the arena: sideways acceleration 0, downward acceleration gravity.
      expect(p2.x - 2 * p1.x + p0.x).toBeCloseTo(0, 6);
      expect(p2.y - 2 * p1.y + p0.y).toBeCloseTo(constants.gravity, 6);
    }
  });

  it('turns the ring as it flies', () => {
    const frames = trackOrbit(17, 60, 0.6);
    const first = frames.find((f) => f.length === 3);
    if (!first) throw new Error('no full ring');
    const tracked = first[0]?.id ?? 0;

    // The tracked shard's offset from the centre should swing through both signs.
    let above = 0;
    let below = 0;
    for (const frame of frames) {
      if (frame.length !== 3) continue;
      const cy = frame.reduce((s, p) => s + p.y, 0) / 3;
      const shard = frame.find((p) => p.id === tracked);
      if (!shard) continue;
      if (shard.y < cy - 1) above++;
      if (shard.y > cy + 1) below++;
    }
    expect(above).toBeGreaterThan(3);
    expect(below).toBeGreaterThan(3);
  });

  it('lands its shards and hurts what they land on', () => {
    const state = createDuel('trico', 'armor', 17);
    const before = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's2', 45, 0.54);
    expect(findExplosions(events).length).toBeGreaterThanOrEqual(3);
    expect(hpOf(state, 1)).toBeLessThan(before);
  });
});
