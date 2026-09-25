/**
 * Paladin (`knight`) — DESIGN §3, §10: "swords count".
 *
 * Three shots, one idea: the shell marks the ground and does nothing else, and 3 / 5 / 9
 * swords then fall on the mark as vertical beams. What is worth pinning is the count per
 * slot, that the mark really precedes the sword, that the swords land on the marked
 * ground, and that the spotter itself never explodes.
 */
import { describe, expect, it } from 'vitest';
import { knight } from '../../src/data/mobiles/knight.js';
import { shotSlots } from '../../src/data/mobiles/index.js';
import type { ShotSlot } from '../../src/data/mobiles/index.js';
import {
  createDuel,
  eventsOfType,
  findExplosions,
  fireAndResolve,
  hpOf,
  maskOf,
  carvedPixels,
} from './helpers.js';

const swordsOf = (slot: ShotSlot): number => knight.shots[slot].projectile.params?.swords ?? 0;

describe('knight — Paladin', () => {
  it('drops 3, 5 and 9 swords, one beam each, exactly as its data says', () => {
    expect(shotSlots.map(swordsOf)).toEqual([3, 5, 9]);
    for (const slot of shotSlots) {
      const state = createDuel('knight', 'armor', 51);
      const events = fireAndResolve(state, 0, slot, 45, 0.55);
      expect(eventsOfType(events, 'beam'), slot).toHaveLength(swordsOf(slot));
      expect(eventsOfType(events, 'mark'), slot).toHaveLength(swordsOf(slot));
    }
  });

  it('marks first and strikes after, on the marked columns', () => {
    const state = createDuel('knight', 'armor', 52);
    const events = fireAndResolve(state, 0, 's2', 45, 0.55);

    const marks = eventsOfType(events, 'mark');
    const beams = eventsOfType(events, 'beam');
    expect(marks).toHaveLength(5);
    expect(beams).toHaveLength(5);
    // Every mark is laid down before the first sword falls.
    expect(events.indexOf(marks[4] as never)).toBeLessThan(events.indexOf(beams[0] as never));

    for (let i = 0; i < beams.length; i++) {
      const beam = beams[i];
      const mark = marks[i];
      if (!beam || !mark) throw new Error('missing beam or mark');
      expect(beam.x1).toBeCloseTo(mark.x, 6);
      expect(beam.x2).toBeCloseTo(mark.x, 6);
      expect(mark.kind).toBe('sword');
      expect(beam.kind).toBe('sword');
      expect(mark.ownerSeat).toBe(0);
      expect(beam.ownerSeat).toBe(0);
      expect(beam.width).toBe(knight.shots.s2.projectile.params?.swordWidthPx);
      // The sword falls out of the sky onto the mark, not up out of the ground.
      expect(beam.y1).toBeLessThan(beam.y2);
      const params = knight.shots.s2.projectile.params ?? {};
      expect(beam.y2 - beam.y1).toBeCloseTo(
        (params.fallHeightPx ?? 0) + (params.biteDepthPx ?? 0),
        6,
      );
      // And it sticks into the ground it landed on rather than stopping on top of it.
      expect(beam.y2).toBeCloseTo(mark.y + (params.biteDepthPx ?? 0), 6);
    }
  });

  it('spreads the rank across spreadPx and widens it with the slot', () => {
    const widths: number[] = [];
    for (const slot of shotSlots) {
      const state = createDuel('knight', 'armor', 53);
      const events = fireAndResolve(state, 0, slot, 45, 0.55);
      const xs = eventsOfType(events, 'beam').map((b) => b.x1);
      widths.push(Math.max(...xs) - Math.min(...xs));
    }
    for (let i = 0; i < shotSlots.length; i++) {
      const slot = shotSlots[i] as ShotSlot;
      const spread = knight.shots[slot].projectile.params?.spreadPx ?? 0;
      const jitter = knight.shots[slot].projectile.params?.jitterPx ?? 0;
      expect(widths[i] ?? 0, slot).toBeGreaterThan(spread - 2 * jitter);
      expect(widths[i] ?? 0, slot).toBeLessThanOrEqual(spread + 2 * jitter);
    }
    expect(widths[2] ?? 0).toBeGreaterThan(widths[0] ?? 0);
  });

  it('never explodes the spotter: all of the damage is the swords', () => {
    const state = createDuel('knight', 'armor', 54);
    const hpBefore = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's1', 45, 0.55);

    expect(findExplosions(events)).toHaveLength(0);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
    for (const hit of eventsOfType(events, 'hit')) expect(hit.damageType).toBe('impact');
  });

  it('cuts the swords into the ground they land on', () => {
    // Short of the enemy, so the rank comes down on open terrain.
    const state = createDuel('knight', 'armor', 56);
    const before = maskOf(state);
    const events = fireAndResolve(state, 0, 's1', 45, 0.42);

    expect(findExplosions(events)).toHaveLength(0);
    // Three narrow slots rather than one crater, but a real hole all the same.
    expect(carvedPixels(before, maskOf(state))).toBeGreaterThan(100);
  });

  it('makes the SS the big swing', () => {
    const light = createDuel('knight', 'armor', 55);
    fireAndResolve(light, 0, 's1', 45, 0.55);
    const heavy = createDuel('knight', 'armor', 55);
    fireAndResolve(heavy, 0, 'ss', 45, 0.55);

    const lightLost = 1100 - hpOf(light, 1);
    const heavyLost = 1100 - hpOf(heavy, 1);
    expect(lightLost).toBeGreaterThan(0);
    expect(heavyLost).toBeGreaterThan(lightLost);
    expect(knight.shots.ss.delay).toBeGreaterThan(knight.shots.s2.delay);
    expect(knight.shots.s2.delay).toBeGreaterThan(knight.shots.s1.delay);
  });
});
