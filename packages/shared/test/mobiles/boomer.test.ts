/**
 * boomer — Zephyr (DESIGN §3): `windFactor: 3.0`, `gravity: 0.6`, 1 / 3 / 5 blades.
 *
 * No behaviour module — the mobile *is* its ballistics, so that is what is tested: in a
 * strong head wind a blade turns round and comes back past the muzzle it left, and in
 * dead air its light gravity carries it much further than an armor shell.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { isSettled, mobileOfSeat } from '../../src/match/match.js';
import type { MatchState } from '../../src/match/match.js';
import { boomer } from '../../src/data/mobiles/boomer.js';
import { armor } from '../../src/data/mobiles/armor.js';
import { constants } from '../../src/data/constants.js';
import type { ShotSlot } from '../../src/data/mobiles/index.js';
import { createDuel, eventsOfType, fireAndResolve, MAX_RESOLVE_TICKS } from './helpers.js';

/** Fire and follow the first blade, returning every x it passed through. */
function flightXs(state: MatchState, shot: ShotSlot, relAngle: number, power: number): number[] {
  const xs: number[] = [];
  applyIntent(state, { t: 'aim', seat: 0, relAngle });
  applyIntent(state, { t: 'fire', seat: 0, shot, relAngle, power });
  for (const p of state.projectiles) xs.push(p.x);
  for (let i = 0; i < MAX_RESOLVE_TICKS; i++) {
    step(state);
    const first = state.projectiles[0];
    if (first) xs.push(first.x);
    if (isSettled(state)) break;
  }
  return xs;
}

describe('boomer — the roster entry', () => {
  it('flies light and reads the wind on every shot (DESIGN §3)', () => {
    expect(boomer.class).toBe('bionic');
    for (const slot of ['s1', 's2', 'ss'] as const) {
      const p = boomer.shots[slot].projectile;
      expect(p.windFactor).toBeGreaterThanOrEqual(3);
      expect(p.gravity).toBeLessThanOrEqual(0.6);
      expect(p.windFactor).toBeGreaterThan(armor.shots.s1.projectile.windFactor);
    }
    expect(boomer.moveSpeed).toBeGreaterThan(armor.moveSpeed);
  });

  it('throws one blade, then three, then five larger ones', () => {
    expect(boomer.shots.s1.count ?? 1).toBe(1);
    expect(boomer.shots.s2.count).toBe(3);
    expect(boomer.shots.ss.count).toBe(5);
    expect(boomer.shots.ss.projectile.radius).toBeGreaterThan(boomer.shots.s2.projectile.radius);
    expect(boomer.shots.ss.projectile.damageRadius).toBeGreaterThan(
      boomer.shots.s2.projectile.damageRadius,
    );
    expect(boomer.shots.s1.delay).toBeLessThan(boomer.shots.s2.delay);
    expect(boomer.shots.s2.delay).toBeLessThan(boomer.shots.ss.delay);
  });

  it('puts every blade of a volley in the air', () => {
    const three = createDuel('boomer', 'armor', 41);
    const five = createDuel('boomer', 'armor', 41);
    expect(eventsOfType(fireAndResolve(three, 0, 's2', 45, 0.5), 'spawn')).toHaveLength(3);
    expect(eventsOfType(fireAndResolve(five, 0, 'ss', 45, 0.5), 'spawn')).toHaveLength(5);
  });
});

describe('boomer — the boomerang', () => {
  it('curves back past the x it was thrown from in a strong head wind', () => {
    // Full-strength wind blowing to the left (0° is right, DESIGN §2.7).
    const state = createDuel('boomer', 'armor', 41, {
      windStrength: constants.wind.maxStrength,
      windDirectionDeg: 180,
    });
    const origin = mobileOfSeat(state, 0)?.x ?? 0;
    const xs = flightXs(state, 's1', 45, 0.8);

    const furthest = Math.max(...xs);
    const nearest = Math.min(...xs);
    expect(furthest).toBeGreaterThan(origin + 50);
    // …and it came home: the blade ends its flight behind the thrower.
    expect(nearest).toBeLessThan(origin);
  });

  it('flies out and stays out when the air is still', () => {
    const state = createDuel('boomer', 'armor', 41);
    const origin = mobileOfSeat(state, 0)?.x ?? 0;
    const xs = flightXs(state, 's1', 45, 0.8);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(origin - 1);
  });

  it('outranges an armor shell of the same power on its light gravity', () => {
    const blade = createDuel('boomer', 'armor', 43, { xB: 1580 });
    const shell = createDuel('armor', 'armor', 43, { xB: 1580 });
    const bladeXs = flightXs(blade, 's1', 45, 0.6);
    const shellXs = flightXs(shell, 's1', 45, 0.6);
    expect(Math.max(...bladeXs)).toBeGreaterThan(Math.max(...shellXs) + 100);
  });

  it('still hits what it is aimed at', () => {
    const state = createDuel('boomer', 'armor', 45);
    const target = mobileOfSeat(state, 1);
    if (!target) throw new Error('no target');
    const before = target.hp;
    // Lighter gravity than armor, so the same 400 px needs a softer pull.
    fireAndResolve(state, 0, 's1', 45, 0.44);
    expect(target.hp).toBeLessThan(before);
  });
});
