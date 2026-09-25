/**
 * Wyvern (`dragon`) — DESIGN §3, §7 item 10.
 *
 * dragon has no behaviour module: it is configuration, and what makes it dragon is the
 * configuration. So this is what the tests are about — that everything it throws is
 * `fire` and therefore reads the fire row of the damage table (DESIGN §2.6), that S2 is
 * three fireballs and not one, that the SS's signature is the crater, and that it stays
 * out of the hand-picked list.
 */
import { describe, expect, it } from 'vitest';
import { dragon } from '../../src/data/mobiles/dragon.js';
import { jfrog } from '../../src/data/mobiles/jfrog.js';
import { armor } from '../../src/data/mobiles/armor.js';
import { shotSlots, isPickableMobile } from '../../src/data/mobiles/index.js';
import { damageTable } from '../../src/data/damageTable.js';
import { computeDamage } from '../../src/rules/damage.js';
import { createMobile } from '../../src/entities/mobile.js';
import {
  carvedPixels,
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
  maskOf,
} from './helpers.js';

describe('dragon — Wyvern', () => {
  it('throws nothing but fire', () => {
    for (const slot of shotSlots) {
      expect(dragon.shots[slot].projectile.damageType, slot).toBe('fire');
    }
    const state = createDuel('dragon', 'armor', 61);
    const events = fireAndResolve(state, 0, 's1', 45, 0.55);
    const hits = eventsOfType(events, 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.damageType).toBe('fire');
  });

  it('resolves its damage through the fire row of the table', () => {
    const ember = dragon.shots.s1.projectile;
    // Two targets, same distance, different class: the only thing between them is the
    // table row and their own defence.
    const mech = createMobile(1, 'armor', 'B', armor, 0, 0, 1);
    const bio = createMobile(2, 'jfrog', 'A', jfrog, 0, 0, 1);
    const onMech = computeDamage(ember.damage, 0, ember.damageRadius, 'fire', armor, mech);
    const onBio = computeDamage(ember.damage, 0, ember.damageRadius, 'fire', jfrog, bio);

    expect(onMech).toBeCloseTo(ember.damage * damageTable.fire.mechanical * armor.defence, 6);
    expect(onBio).toBeCloseTo(ember.damage * damageTable.fire.bionic * jfrog.defence, 6);
    // Fire is what bionic mobiles hate (1.2 against 1.0), which is dragon's whole point.
    expect(onBio).toBeGreaterThan(onMech);
  });

  it('spits three flames on S2, staggered', () => {
    // Into open ground and off 45°, where a few degrees of fan actually move the
    // landing point (at 45° the range is stationary in the angle).
    const state = createDuel('dragon', 'armor', 62, { xB: 1400 });
    const events = fireAndResolve(state, 0, 's2', 62, 0.5);
    expect(dragon.shots.s2.count).toBe(3);
    expect(dragon.shots.s2.stagger ?? 0).toBeGreaterThan(0);
    expect(eventsOfType(events, 'spawn')).toHaveLength(3);
    expect(findExplosions(events)).toHaveLength(3);
    // Fanned, so the three do not all land in one hole.
    const xs = findExplosions(events).map((e) => e.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
  });

  it('digs its biggest hole with the SS', () => {
    const light = createDuel('dragon', 'armor', 63, { xB: 1400 });
    const lightBefore = maskOf(light);
    fireAndResolve(light, 0, 's1', 45, 0.45);
    const lightCarve = carvedPixels(lightBefore, maskOf(light));

    const heavy = createDuel('dragon', 'armor', 63, { xB: 1400 });
    const heavyBefore = maskOf(heavy);
    const events = fireAndResolve(heavy, 0, 'ss', 45, 0.45);
    const heavyCarve = carvedPixels(heavyBefore, maskOf(heavy));

    expect(findExplosions(events)[0]?.carveRadius).toBe(dragon.shots.ss.projectile.carveRadius);
    // The crater is the SS's signature, not just more damage (DESIGN §3).
    expect(heavyCarve).toBeGreaterThan(lightCarve * 3);
    expect(dragon.shots.ss.delay).toBeGreaterThan(dragon.shots.s2.delay);
  });

  it('hits harder than it is hit, and is only ever rolled', () => {
    expect(dragon.randomOnly).toBe(true);
    expect(dragon.randomWeight).toBe(1);
    expect(isPickableMobile('dragon')).toBe(false);

    const state = createDuel('dragon', 'armor', 64);
    const hpBefore = hpOf(state, 1);
    fireAndResolve(state, 0, 's1', 45, 0.55);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });
});
