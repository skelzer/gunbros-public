/**
 * bigfoot — Stomper (DESIGN §3): 4 / 6 / 9 missiles with spread, no behaviour module.
 *
 * Everything the mobile is lives in `count`, `spreadDeg` and `stagger`, so the test is
 * about the volley: the right number of missiles arrive, they arrive spread out rather
 * than on one point, and the whole shot moves far more dirt than a single shell does.
 */
import { describe, expect, it } from 'vitest';
import { applyIntent, step } from '../../src/match/reducer.js';
import { bigfoot } from '../../src/data/mobiles/bigfoot.js';
import { armor } from '../../src/data/mobiles/armor.js';
import type { ShotSlot } from '../../src/data/mobiles/index.js';
import {
  carvedPixels,
  createDuel,
  eventsOfType,
  fireAndResolve,
  findExplosions,
  hpOf,
  maskOf,
} from './helpers.js';

const COUNTS: Record<ShotSlot, number> = { s1: 4, s2: 6, ss: 9 };

describe('bigfoot — the roster entry', () => {
  it('is a slow, heavy machine that fires volleys', () => {
    expect(bigfoot.class).toBe('mechanical');
    expect(bigfoot.hp).toBeGreaterThan(armor.hp);
    expect(bigfoot.moveSpeed).toBeLessThan(armor.moveSpeed);
    for (const slot of ['s1', 's2', 'ss'] as const) {
      expect(bigfoot.shots[slot].count).toBe(COUNTS[slot]);
      expect(bigfoot.shots[slot].spreadDeg ?? 0).toBeGreaterThan(0);
      expect(bigfoot.shots[slot].stagger ?? 0).toBeGreaterThan(0);
      // Each missile on its own is weaker than an armor shell.
      expect(bigfoot.shots[slot].projectile.damage).toBeLessThan(armor.shots.s1.projectile.damage);
    }
  });

  it('trades accuracy for total damage as the slots go up (DESIGN §2.8)', () => {
    const total = (slot: ShotSlot): number =>
      (bigfoot.shots[slot].count ?? 1) * bigfoot.shots[slot].projectile.damage;
    expect(bigfoot.shots.s1.delay).toBeLessThan(bigfoot.shots.s2.delay);
    expect(bigfoot.shots.s2.delay).toBeLessThan(bigfoot.shots.ss.delay);
    expect(total('s1')).toBeLessThan(total('s2'));
    expect(total('s2')).toBeLessThan(total('ss'));
    // The SS out-damages armor's SS if the whole carpet lands, which is the gamble.
    expect(total('ss')).toBeGreaterThan(armor.shots.ss.projectile.damage);
    expect(bigfoot.shots.s1.spreadDeg ?? 0).toBeLessThan(bigfoot.shots.ss.spreadDeg ?? 0);
  });
});

describe('bigfoot — the volleys', () => {
  for (const slot of ['s1', 's2', 'ss'] as const) {
    it(`${slot} puts exactly ${COUNTS[slot]} missiles in the air and explodes that many times`, () => {
      const state = createDuel('bigfoot', 'armor', 29);
      const events = fireAndResolve(state, 0, slot, 45, 0.54);
      expect(eventsOfType(events, 'spawn')).toHaveLength(COUNTS[slot]);
      expect(findExplosions(events)).toHaveLength(COUNTS[slot]);
    });
  }

  it('walks the volley across the ground instead of stacking it on one point', () => {
    const state = createDuel('bigfoot', 'armor', 29);
    const events = fireAndResolve(state, 0, 'ss', 45, 0.54);
    const xs = findExplosions(events).map((e) => e.x);
    const span = Math.max(...xs) - Math.min(...xs);
    // Nine missiles over 22° of fan: a trench, not a crater.
    expect(span).toBeGreaterThan(80);
  });

  it('digs far more than a single shell of the same power', () => {
    const volley = createDuel('bigfoot', 'armor', 29);
    const single = createDuel('armor', 'armor', 29);

    const beforeVolley = maskOf(volley);
    fireAndResolve(volley, 0, 'ss', 45, 0.54);
    const dugVolley = carvedPixels(beforeVolley, maskOf(volley));

    const beforeSingle = maskOf(single);
    fireAndResolve(single, 0, 's1', 45, 0.54);
    const dugSingle = carvedPixels(beforeSingle, maskOf(single));

    expect(dugVolley).toBeGreaterThan(dugSingle * 3);
  });

  it('hurts what it lands on, several times over', () => {
    const state = createDuel('bigfoot', 'armor', 29);
    const before = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 'ss', 45, 0.54);
    const hits = eventsOfType(events, 'hit').filter((h) => h.seat === 1);
    expect(hits.length).toBeGreaterThan(1);
    expect(hpOf(state, 1)).toBeLessThan(before);
  });

  it('staggers the volley instead of firing it all on one tick', () => {
    const state = createDuel('bigfoot', 'armor', 29);
    const relAngle = 45;
    // The fire intent launches the first missile; the rest are pending spawns that
    // `step` releases `stagger` ticks apart.
    const first = eventsOfType(
      applyIntent(state, { t: 'fire', seat: 0, shot: 's2', relAngle, power: 0.54 }),
      'spawn',
    );
    expect(first).toHaveLength(1);
    expect(state.pendingSpawns).toHaveLength(5);

    const spawnTicks: number[] = [];
    for (let i = 0; i < 60 && state.pendingSpawns.length > 0; i++) {
      const tick = state.tick;
      for (const e of step(state)) if (e.t === 'spawn') spawnTicks.push(tick);
    }
    expect(spawnTicks).toHaveLength(5);
    expect(new Set(spawnTicks).size).toBe(5);
    const stagger = bigfoot.shots.s2.stagger ?? 0;
    expect((spawnTicks[1] ?? 0) - (spawnTicks[0] ?? 0)).toBe(stagger);
  });
});
