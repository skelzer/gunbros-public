/**
 * Orbital (`asate`) — the satellite beams (DESIGN §3, `satellite`).
 *
 * What is asserted: the painter shell marks the point and the beam comes straight down
 * the map onto it; the S2 fans three; the SS drops one wide column; the beam carves the
 * cover it passes through and the turn waits for it.
 */
import { describe, expect, it } from 'vitest';
import { isSettled } from '../../src/match/match.js';
import { asate } from '../../src/data/mobiles/asate.js';
import { createDuel, carvedPixels, eventsOfType, fireAndResolve, hpOf, maskOf } from './helpers.js';

const HIT_ANGLE = 45;
/** Power that lands a painter shell on the ground just short of the mobile at x = 1000. */
const HIT_POWER = 0.5;

describe('asate — Orbital', () => {
  it('paints a point and answers it with a beam from the top of the map', () => {
    const state = createDuel('asate', 'armor', 61);
    const hpBefore = hpOf(state, 1);
    const before = maskOf(state);
    const events = fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);

    const marks = eventsOfType(events, 'mark');
    const beams = eventsOfType(events, 'beam');
    expect(marks).toHaveLength(1);
    expect(beams).toHaveLength(1);
    const mark = marks[0];
    const beam = beams[0];
    if (!mark || !beam) throw new Error('no strike');

    expect(mark.kind).toBe('satelliteBeam');
    expect(mark.ticksUntil).toBe(asate.shots.s1.projectile.params?.delayTicks);
    // Straight down the map, onto the painted column.
    expect(beam.y1).toBe(0);
    expect(beam.x1).toBe(beam.x2);
    expect(beam.x2).toBeCloseTo(mark.x, 6);
    expect(beam.y2).toBeCloseTo(mark.y, 6);
    expect(beam.width).toBe(asate.shots.s1.projectile.params?.beamWidth);

    expect(carvedPixels(before, maskOf(state))).toBeGreaterThan(0);
    expect(hpOf(state, 1)).toBeLessThan(hpBefore);
  });

  it('holds the turn open until the satellite has fired', () => {
    const state = createDuel('asate', 'armor', 62);
    const events = fireAndResolve(state, 0, 's1', HIT_ANGLE, HIT_POWER);
    const markAt = events.findIndex((e) => e.t === 'mark');
    const beamAt = events.findIndex((e) => e.t === 'beam');
    expect(beamAt).toBeGreaterThan(markAt);
    expect(isSettled(state)).toBe(true);
    expect(state.projectiles).toHaveLength(0);
    expect(state.turnEffects).toHaveLength(0);
  });

  it('fans three beams across the mark on the S2', () => {
    const state = createDuel('asate', 'armor', 63);
    const params = asate.shots.s2.projectile.params ?? {};
    const events = fireAndResolve(state, 0, 's2', HIT_ANGLE, 0.53);

    const beams = eventsOfType(events, 'beam');
    expect(beams).toHaveLength(params.beams ?? 0);
    const xs = beams.map((b) => b.x1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(params.spreadPx ?? 0, 3);
    for (const beam of beams) {
      expect(beam.y1).toBe(0);
      expect(beam.x1).toBe(beam.x2);
      expect(beam.width).toBe(params.beamWidth);
    }
    // Left to right, in one fixed order, all on the same row.
    expect(xs[0]).toBeLessThan(xs[1] ?? 0);
    expect(xs[1]).toBeLessThan(xs[2] ?? 0);
    expect(beams[0]?.y2).toBeCloseTo(beams[2]?.y2 ?? 0, 6);
  });

  it('drops one wide lance on the SS, which digs the deepest hole', () => {
    const wide = createDuel('asate', 'armor', 64);
    const narrow = createDuel('asate', 'armor', 64);
    const params = asate.shots.ss.projectile.params ?? {};
    expect(params.beams).toBe(1);
    expect(params.beamWidth).toBeGreaterThan(asate.shots.s2.projectile.params?.beamWidth ?? 0);
    expect(params.beamDamage).toBeGreaterThan(asate.shots.s1.projectile.params?.beamDamage ?? 0);

    const wideBefore = maskOf(wide);
    const narrowBefore = maskOf(narrow);
    const wideEvents = fireAndResolve(wide, 0, 'ss', HIT_ANGLE, 0.55);
    fireAndResolve(narrow, 0, 's1', HIT_ANGLE, HIT_POWER);

    const beams = eventsOfType(wideEvents, 'beam');
    expect(beams).toHaveLength(1);
    expect(beams[0]?.width).toBe(params.beamWidth);
    expect(carvedPixels(wideBefore, maskOf(wide))).toBeGreaterThan(
      carvedPixels(narrowBefore, maskOf(narrow)),
    );
    expect(1100 - hpOf(wide, 1)).toBeGreaterThan(1100 - hpOf(narrow, 1));
  });

  it('is a light mechanical designator whose shells barely scratch', () => {
    expect(asate.class).toBe('mechanical');
    expect(asate.shieldMax).toBe(0);
    for (const slot of ['s1', 's2', 'ss'] as const) {
      const shot = asate.shots[slot];
      expect(shot.projectile.behaviour).toBe('satellite');
      // The beam is the shot; the painter is a delivery charge.
      expect(shot.projectile.params?.beamDamage).toBeGreaterThan(shot.projectile.damage * 2);
    }
    expect(asate.shots.ss.delay).toBeGreaterThan(asate.shots.s2.delay);
    expect(asate.shots.s2.delay).toBeGreaterThan(asate.shots.s1.delay);
  });
});
