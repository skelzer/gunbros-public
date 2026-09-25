/**
 * Skipper (`grub`) — the `bounce` behaviour (DESIGN §3, §10).
 *
 * What is actually asserted here: each shot skips exactly as many times as its
 * `bounces`, it keeps running after the last skip and detonates where it comes to rest
 * rather than in mid-air, a direct hit on a mobile goes off on contact instead of
 * skipping off it, and a slug put on a slope rolls down it hugging the surface.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import { createProjectile, stepProjectile } from '../../src/entities/projectile.js';
import type { ProjectileDef } from '../../src/entities/projectile.js';
import { grub } from '../../src/data/mobiles/grub.js';
import { makeTestContext, slopeTerrain } from '../helpers.js';
import { createDuel, eventsOfType, findExplosions, hpOf, MAX_RESOLVE_TICKS } from './helpers.js';

/** Fire and resolve with the target pushed out of the slug's way. */
function skip(
  seed: number,
  shot: 's1' | 's2' | 'ss',
  relAngle: number,
  power: number,
): { bounceXs: number[]; explosions: Array<{ x: number; y: number }>; ticks: number } {
  const state = createDuel('grub', 'armor', seed, { xB: 1500 });
  applyIntent(state, { t: 'fire', seat: 0, shot, relAngle, power });
  const events = [];
  let ticks = 0;
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    ticks++;
    for (const e of step(state)) events.push(e);
    if (isSettled(state)) break;
  }
  return {
    bounceXs: eventsOfType(events, 'mark')
      .filter((e) => e.kind === 'bounce')
      .map((e) => e.x),
    explosions: findExplosions(events).map((e) => ({ x: e.x, y: e.y })),
    ticks,
  };
}

describe('grub — the skipping slug (bounce)', () => {
  it('skips exactly `bounces` times and then rolls to a stop', () => {
    const shot = skip(301, 's1', 25, 0.5);
    expect(shot.bounceXs).toHaveLength(grub.shots.s1.projectile.bounces ?? 0);
    // Each skip is shorter than the one before it: energy is going somewhere.
    const first = (shot.bounceXs[1] ?? 0) - (shot.bounceXs[0] ?? 0);
    const last =
      (shot.bounceXs[shot.bounceXs.length - 1] ?? 0) - (shot.bounceXs[shot.bounceXs.length - 2] ?? 0);
    expect(last).toBeLessThan(first);

    // It goes off past the last skip, not on it: that gap is the roll.
    expect(shot.explosions).toHaveLength(1);
    const last3 = shot.bounceXs[shot.bounceXs.length - 1] ?? 0;
    expect(shot.explosions[0]?.x ?? 0).toBeGreaterThan(last3 + 20);
    expect(shot.ticks).toBeLessThan(MAX_RESOLVE_TICKS);
  });

  it('gives S2 five skips and SS seven', () => {
    expect(skip(302, 's2', 25, 0.5).bounceXs).toHaveLength(grub.shots.s2.projectile.bounces ?? 0);
    expect(skip(303, 'ss', 25, 0.5).bounceXs).toHaveLength(grub.shots.ss.projectile.bounces ?? 0);
  });

  it('goes off on a mobile instead of skipping off it', () => {
    const state = createDuel('grub', 'armor', 304);
    // Straight into the other mobile with every bounce still in hand.
    applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle: 45, power: 0.61 });
    const events = [];
    for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
      for (const e of step(state)) events.push(e);
      if (isSettled(state)) break;
    }
    const bounces = eventsOfType(events, 'mark').filter((e) => e.kind === 'bounce');
    expect(bounces).toHaveLength(0);
    expect(findExplosions(events)).toHaveLength(1);
    expect(hpOf(state, 1)).toBeLessThan(1100);
    const hits = eventsOfType(events, 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.damageType).toBe('impact');
  });

  it('rolls down a slope hugging the ground', () => {
    const slope = 0.5;
    const groundY = 150;
    const terrain = slopeTerrain(900, 900, groundY, slope);
    const ctx = makeTestContext(terrain);
    // A spent slug — no bounces left — dropped on the hillside with a nudge.
    const def: ProjectileDef = { ...grub.shots.s1.projectile, bounces: 0 };
    const startX = 200;
    const p = createProjectile(1, def, 0, startX, groundY + startX * slope - 2, 3, 0, {});

    const xs: number[] = [];
    for (let i = 0; i < 110 && p.alive; i++) {
      stepProjectile(p, ctx);
      // The first ticks are the slug settling onto the hillside: a downhill slope
      // falls away faster than gravity brings the slug down, so it takes a moment
      // to make contact.
      if (i < 20) continue;
      xs.push(p.x);
      // From then on it stays on the hillside rather than burrowing into it or
      // sailing off it.
      const surface = groundY + p.x * slope;
      expect(p.y).toBeGreaterThan(surface - 20);
      expect(p.y).toBeLessThan(surface + 6);
    }

    // Downhill the whole way, and a long way: it is rolling, not sitting.
    expect(xs.length).toBeGreaterThan(80);
    const firstX = xs[0] ?? 0;
    const lastX = xs[xs.length - 1] ?? 0;
    expect(lastX).toBeGreaterThan(firstX + 150);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] ?? 0).toBeGreaterThanOrEqual(xs[i - 1] ?? 0);
    }
  });

  it('stops and goes off rather than rolling for ever', () => {
    const terrain = slopeTerrain(1200, 900, 400, 0);
    const ctx = makeTestContext(terrain);
    const def: ProjectileDef = { ...grub.shots.s1.projectile, bounces: 0 };
    const p = createProjectile(1, def, 0, 200, 388, 4, 0, {});
    for (let i = 0; i < 600 && p.alive; i++) stepProjectile(p, ctx);

    expect(p.alive).toBe(false);
    expect(ctx.explosions).toHaveLength(1);
    // It ran on before it stopped, and it stopped on the flat rather than in the air.
    expect(ctx.explosions[0]?.x ?? 0).toBeGreaterThan(210);
    expect(ctx.explosions[0]?.y ?? 0).toBeGreaterThan(380);
  });
});
