/**
 * Tempest (`lightning`) — mark, then the sky answers (DESIGN §3, `markThenBolt`).
 *
 * What is asserted: the shell marks where it lands and the bolt comes down on that
 * exact column a fixed number of ticks later; the turn does not resolve in between; the
 * S2 bolt arrives at an angle instead of straight down; the SS drops three, fanned and
 * staggered; and a bolt reaches a mobile standing under a roof, burning through it.
 */
import { describe, expect, it } from 'vitest';
import { step } from '../../src/match/reducer.js';
import { isSettled } from '../../src/match/match.js';
import type { MapDef } from '../../src/data/maps.js';
import { lightning } from '../../src/data/mobiles/lightning.js';
import { flatTerrain, maskMap } from '../helpers.js';
import { createDuel, eventsOfType, fireAndResolve, hpOf } from './helpers.js';

/** Power that carries a Tempest seed shell the 400 px between the two mobiles. */
const HIT_POWER = 0.56;
const HIT_ANGLE = 45;

/** Flat ground at y = 600 with a solid slab roofing the mobile at x = 1000. */
function roofedMap(): MapDef {
  const terrain = flatTerrain(1600, 900, 600);
  for (let x = 950; x <= 1050; x++) {
    for (let y = 515; y <= 525; y++) terrain.setSolid(x, y, true);
  }
  return maskMap('testRoof', terrain);
}

describe('lightning — Tempest', () => {
  it('marks the impact point and strikes that column from the sky', () => {
    const state = createDuel('lightning', 'armor', 41);
    const hpBefore = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);

    const marks = eventsOfType(events, 'mark');
    const beams = eventsOfType(events, 'beam');
    expect(marks).toHaveLength(1);
    expect(beams).toHaveLength(1);
    const mark = marks[0];
    const beam = beams[0];
    if (!mark || !beam) throw new Error('no strike');

    expect(mark.kind).toBe('bolt');
    expect(mark.ticksUntil).toBe(lightning.shots.s1.projectile.params?.delayTicks);
    // The bolt lands on the marked column, and comes from the top of the map.
    expect(beam.x2).toBeCloseTo(mark.x, 6);
    expect(beam.y2).toBeCloseTo(mark.y, 6);
    expect(beam.y1).toBe(0);
    expect(beam.x1).toBeCloseTo(beam.x2, 6); // S1 falls straight down
    expect(beam.width).toBe(lightning.shots.s1.projectile.params?.boltWidth);
    expect(beam.ownerSeat).toBe(0);

    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });

  it('holds the turn open between the mark and the bolt', () => {
    const state = createDuel('lightning', 'armor', 42);
    const events = fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    const markAt = events.findIndex((e) => e.t === 'mark');
    const beamAt = events.findIndex((e) => e.t === 'beam');
    expect(markAt).toBeGreaterThanOrEqual(0);
    expect(beamAt).toBeGreaterThan(markAt);
    // `fireAndResolve` stops at `isSettled`, so reaching the beam at all proves the
    // wait blocked resolution; and once it has struck, nothing is left in flight.
    expect(isSettled(state)).toBe(true);
    expect(state.projectiles).toHaveLength(0);
    expect(state.turnEffects).toHaveLength(0);
  });

  it('brings the S2 bolt in at an angle instead of straight down', () => {
    const state = createDuel('lightning', 'armor', 43);
    const events = fireAndResolve(state, 0, 's2', HIT_ANGLE, 0.58);
    const beams = eventsOfType(events, 'beam');
    expect(beams).toHaveLength(1);
    const beam = beams[0];
    if (!beam) throw new Error('no beam');
    expect(beam.y1).toBe(0);
    // angleDeg 30 tilts the descent: it enters the sky well to the left of where it
    // lands, by tan(30) x the height it falls.
    const drift = beam.x2 - beam.x1;
    expect(drift).toBeGreaterThan(0.5 * beam.y2);
    expect(drift).toBeLessThan(0.7 * beam.y2);
  });

  it('drops three staggered, fanned bolts on the SS', () => {
    const state = createDuel('lightning', 'armor', 44);
    const params = lightning.shots.ss.projectile.params ?? {};
    const hpBefore = hpOf(state, 1);
    const events = fireAndResolve(state, 0, 'ss', HIT_ANGLE, 0.6);

    const beams = eventsOfType(events, 'beam');
    expect(beams).toHaveLength(params.bolts ?? 0);
    const xs = beams.map((b) => b.x2);
    const spread = Math.max(...xs) - Math.min(...xs);
    expect(spread).toBeCloseTo(params.spreadPx ?? 0, 3);
    // Left to right, one fixed order.
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
    // Three separate strikes hurt more than one.
    expect(hpBefore - hpOf(state, 1)).toBeGreaterThan(300);
  });

  it('reaches a mobile under a roof, burning the roof out of the way', () => {
    const state = createDuel('lightning', 'armor', 45, { map: roofedMap() });
    const hpBefore = hpOf(state, 1);
    // A flat 20° shot flies under the slab instead of into it.
    const events = fireAndResolve(state, 0, 's1', 20, 0.66);
    const marks = eventsOfType(events, 'mark');
    const beams = eventsOfType(events, 'beam');
    expect(marks).toHaveLength(1);
    expect(beams).toHaveLength(1);
    const mark = marks[0];
    if (!mark) throw new Error('no mark');
    // The shell stopped under the roof, not on top of it.
    expect(mark.y).toBeGreaterThan(540);
    expect(mark.x).toBeGreaterThan(950);
    expect(mark.x).toBeLessThan(1050);

    // The bolt came through the slab: the column above the mark is air now.
    expect(state.terrain.isSolid(mark.x, 520)).toBe(false);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
    // Two hits land on the sheltered mobile — the seed shell, then the bolt, which is
    // the bigger of the two even though there was a roof in the way.
    const hits = eventsOfType(events, 'hit').filter((h) => h.seat === 1);
    expect(hits).toHaveLength(2);
    expect(hits[1]?.amount).toBeGreaterThan(hits[0]?.amount ?? 0);
  });

  it('does most of its damage with the bolt, not the seed shell', () => {
    const params = lightning.shots.s1.projectile.params ?? {};
    expect(params.boltDamage).toBeGreaterThan(lightning.shots.s1.projectile.damage * 2);
    expect(lightning.shots.ss.delay).toBeGreaterThan(lightning.shots.s2.delay);
    expect(lightning.shots.s2.delay).toBeGreaterThan(lightning.shots.s1.delay);
    // A shielded mobile with a real shield to regenerate (DESIGN §2.4).
    expect(lightning.class).toBe('shielded');
    expect(lightning.shieldMax).toBeGreaterThan(0);
    expect(lightning.shieldRegen).toBeGreaterThan(0);
  });

  it('leaves nothing behind once the storm has passed', () => {
    const state = createDuel('lightning', 'armor', 46);
    fireAndResolve(state, 0, 'ss', HIT_ANGLE, 0.6);
    expect(state.projectiles).toHaveLength(0);
    expect(state.mines).toHaveLength(0);
    for (let i = 0; i < 5; i++) step(state);
    expect(isSettled(state)).toBe(true);
  });
});
