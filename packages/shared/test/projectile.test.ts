/** DESIGN §10: flat trajectory range, wind pushes, sub-step tunnelling. */
import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/terrain/terrain.js';
import { constants } from '../src/data/constants.js';
import { armor } from '../src/data/mobiles.js';
import { makeWind } from '../src/rules/wind.js';
import { createProjectile, launchVelocity, stepProjectile } from '../src/entities/projectile.js';
import type { ProjectileState } from '../src/entities/projectile.js';
import { createMatch } from '../src/match/reducer.js';
import { hillsMap } from '../src/data/maps.js';
import type { SeatSpec } from '../src/match/match.js';
import { flatTerrain, makeTestContext, makeArmor } from './helpers.js';

const GROUND_Y = 500;
const START_X = 100;
const START_Y = GROUND_Y - 20;

interface Flight {
  impactX: number;
  impactY: number;
  ticks: number;
  peakY: number;
  landed: boolean;
}

/** Fire an armor S1 shell over flat ground and report where and when it lands. */
function fly(angleDeg: number, power: number, windStrength = 0, windDirDeg = 0): Flight {
  const terrain = flatTerrain(4000, 900, GROUND_Y);
  const ctx = makeTestContext(terrain, makeWind(windStrength, windDirDeg));
  const def = armor.shots.s1.projectile;
  const v = launchVelocity(def, angleDeg, power);
  const p: ProjectileState = createProjectile(1, def, 0, START_X, START_Y, v.vx, v.vy);
  let ticks = 0;
  let peakY = p.y;
  while (p.alive && ticks < 3000) {
    stepProjectile(p, ctx);
    peakY = Math.min(peakY, p.y);
    ticks++;
  }
  const impact = ctx.explosions[0];
  return {
    impactX: impact?.x ?? p.x,
    impactY: impact?.y ?? p.y,
    ticks,
    peakY,
    landed: ctx.explosions.length > 0,
  };
}

describe('projectile', () => {
  it('flies a ballistic arc over flat ground', () => {
    const shot = fly(45, 1);
    expect(shot.landed).toBe(true);
    const range = shot.impactX - START_X;

    // Analytic range for speed 14.3 px/tick at 45 degrees under gravity 0.16 px/tick^2
    // is v^2 * sin(2a) / g = 204.49 / 0.16 = 1278 px, plus a little for the 20 px head
    // start: DESIGN §2.2's "about 1.6 screens".
    expect(range).toBeGreaterThan(1200);
    expect(range).toBeLessThan(1400);
    expect(shot.impactY).toBeGreaterThan(GROUND_Y - armor.shots.s1.projectile.radius - 1);
  });

  it('out-ranges the widest spawn separation the hills map can produce', () => {
    // DESIGN §2.2: a full-power shot has to be able to reach the other side, or the
    // opening turns are spent walking. Measured against real spawns, not an estimate.
    const shot = fly(45, 1);
    const range = shot.impactX - START_X;
    const seats: SeatSpec[] = [
      { playerId: 'p1', nick: 'one', team: 'A', mobileId: 'armor' },
      { playerId: 'p2', nick: 'two', team: 'B', mobileId: 'armor' },
    ];
    let widest = 0;
    for (const seed of [1, 2, 3, 42, 99, 1234, 4321, 777]) {
      const state = createMatch(seed, hillsMap, seats);
      const a = state.mobiles[0];
      const b = state.mobiles[1];
      if (!a || !b) throw new Error('no mobiles');
      widest = Math.max(widest, Math.abs(b.x - a.x));
    }
    expect(widest).toBeGreaterThan(400);
    expect(range).toBeGreaterThan(widest);
  });

  it('carries further the harder it is charged', () => {
    const half = fly(45, 0.5);
    const full = fly(45, 1);
    expect(full.impactX).toBeGreaterThan(half.impactX + 300);
  });

  it('reaches furthest near 45 degrees', () => {
    const low = fly(20, 1).impactX;
    const mid = fly(45, 1).impactX;
    const high = fly(70, 1).impactX;
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeGreaterThan(high);
  });

  it('lands further with a tail wind than with a head wind', () => {
    const tail = fly(45, 1, 26, 0); // blowing towards +x
    const head = fly(45, 1, 26, 180); // blowing towards -x
    const still = fly(45, 1, 0, 0);
    expect(tail.impactX).toBeGreaterThan(still.impactX);
    expect(still.impactX).toBeGreaterThan(head.impactX);
    expect(tail.impactX - head.impactX).toBeGreaterThan(100);
  });

  it('keeps even a full wind a nudge, not the whole shot', () => {
    // A 45° full-power shell in wind 26 lands within about a quarter of its still range.
    const still = fly(45, 1, 0, 0).impactX - START_X;
    for (const dir of [0, 180]) {
      const drift = Math.abs(fly(45, 1, 26, dir).impactX - START_X - still);
      expect(drift / still).toBeGreaterThan(0.15);
      expect(drift / still).toBeLessThan(0.3);
    }
  });

  it('stays airborne longer in a strong updraft', () => {
    // World +y is down, so direction 270 degrees is straight up.
    const up = fly(45, 1, 26, 270);
    const still = fly(45, 1, 0, 0);
    const down = fly(45, 1, 26, 90);
    expect(up.ticks).toBeGreaterThan(still.ticks);
    expect(still.ticks).toBeGreaterThan(down.ticks);
    expect(up.peakY).toBeLessThan(still.peakY); // it climbs higher too
  });

  it('is unaffected by wind when windFactor is 0', () => {
    const terrain = flatTerrain(4000, 900, GROUND_Y);
    const def = { ...armor.shots.s1.projectile, windFactor: 0 };
    const results: number[] = [];
    for (const dir of [0, 180]) {
      const ctx = makeTestContext(terrain.clone(), makeWind(26, dir));
      const v = launchVelocity(def, 45, 1);
      const p = createProjectile(1, def, 0, START_X, START_Y, v.vx, v.vy);
      let ticks = 0;
      while (p.alive && ticks < 3000) {
        stepProjectile(p, ctx);
        ticks++;
      }
      results.push(ctx.explosions[0]?.x ?? 0);
    }
    expect(results[0]).toBeCloseTo(results[1] as number, 9);
  });

  it('cannot tunnel through a one-pixel wall', () => {
    const terrain = new Terrain(2000, 600);
    for (let y = 0; y < 600; y++) terrain.setSolid(900, y, true);
    const ctx = makeTestContext(terrain);
    // A flat, very fast, gravity-free shot: 60 px/tick is 15 px per sub-step.
    const def = { ...armor.shots.s1.projectile, speed: 60, gravity: 0, windFactor: 0, radius: 0 };
    const v = launchVelocity(def, 0, 1);
    const p = createProjectile(1, def, 0, 100, 300, v.vx, v.vy);
    let ticks = 0;
    while (p.alive && ticks < 200) {
      stepProjectile(p, ctx);
      ticks++;
    }
    expect(ctx.explosions).toHaveLength(1);
    expect(ctx.explosions[0]?.x ?? 0).toBeGreaterThanOrEqual(899);
    expect(ctx.explosions[0]?.x ?? 0).toBeLessThanOrEqual(901);
  });

  it('hits a mobile footprint and stops there', () => {
    const terrain = flatTerrain(2000, 600, GROUND_Y);
    const target = makeArmor(1, 700, GROUND_Y);
    const ctx = makeTestContext(terrain, makeWind(0, 0), [target]);
    const def = { ...armor.shots.s1.projectile, gravity: 0, windFactor: 0 };
    const v = launchVelocity(def, 0, 1);
    const p = createProjectile(1, def, 0, 100, GROUND_Y - 10, v.vx, v.vy);
    let ticks = 0;
    while (p.alive && ticks < 300) {
      stepProjectile(p, ctx);
      ticks++;
    }
    expect(ctx.explosions).toHaveLength(1);
    const x = ctx.explosions[0]?.x ?? 0;
    expect(x).toBeGreaterThan(target.x - armor.footprint.w / 2 - def.radius - 2);
    expect(x).toBeLessThan(target.x);
  });

  it('does not hit the mobile that fired it while leaving the barrel', () => {
    const terrain = flatTerrain(2000, 600, GROUND_Y);
    const shooter = makeArmor(0, 300, GROUND_Y);
    const ctx = makeTestContext(terrain, makeWind(0, 0), [shooter]);
    const def = armor.shots.s1.projectile;
    const v = launchVelocity(def, 60, 1);
    const p = createProjectile(1, def, 0, shooter.x, shooter.y - 12, v.vx, v.vy);
    stepProjectile(p, ctx);
    expect(p.alive).toBe(true);
    expect(ctx.explosions).toHaveLength(0);
    expect(constants.projectile.ownerGraceTicks).toBeGreaterThan(0);
  });

  it('explodes on its lifetime timer when it has one', () => {
    const terrain = new Terrain(3000, 900);
    const ctx = makeTestContext(terrain);
    const def = { ...armor.shots.s1.projectile, gravity: 0, windFactor: 0, lifetimeTicks: 10 };
    const v = launchVelocity(def, 0, 1);
    const p = createProjectile(1, def, 0, 100, 300, v.vx, v.vy);
    for (let i = 0; i < 20 && p.alive; i++) stepProjectile(p, ctx);
    expect(p.alive).toBe(false);
    expect(ctx.explosions).toHaveLength(1);
    expect(p.age).toBe(10);
  });

  it('expires when it leaves the world sideways', () => {
    const terrain = flatTerrain(800, 600, GROUND_Y);
    const ctx = makeTestContext(terrain);
    const def = { ...armor.shots.s1.projectile, gravity: 0, windFactor: 0 };
    const v = launchVelocity(def, 0, 1);
    const p = createProjectile(1, def, 0, 700, 100, v.vx, v.vy);
    let ticks = 0;
    while (p.alive && ticks < 1000) {
      stepProjectile(p, ctx);
      ticks++;
    }
    expect(p.alive).toBe(false);
    expect(ctx.explosions).toHaveLength(0);
    expect(p.x).toBeGreaterThan(800);
  });
});
