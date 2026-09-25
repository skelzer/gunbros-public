/** DESIGN §2.7: wind strength, direction and the acceleration vector it produces. */
import { describe, expect, it } from 'vitest';
import { generateWind, makeWind, windVector, windChangesOnTurn } from '../src/rules/wind.js';
import { constants } from '../src/data/constants.js';
import { Prng } from '../src/math/prng.js';

describe('wind', () => {
  it('points the way the angle says, with world +y down', () => {
    const scale = constants.wind.scale * 10;
    const right = windVector(10, 0);
    expect(right.x).toBeCloseTo(scale, 12);
    expect(right.y).toBeCloseTo(0, 12);

    const down = windVector(10, 90);
    expect(down.y).toBeCloseTo(scale, 12);

    const left = windVector(10, 180);
    expect(left.x).toBeCloseTo(-scale, 12);

    const up = windVector(10, 270);
    expect(up.y).toBeCloseTo(-scale, 12);

    const calm = windVector(0, 123);
    expect(calm.x).toBeCloseTo(0, 15);
    expect(calm.y).toBeCloseTo(0, 15);
  });

  it('caches the vector on the state', () => {
    const w = makeWind(13, 45);
    const v = windVector(13, 45);
    expect(w.x).toBe(v.x);
    expect(w.y).toBe(v.y);
  });

  it('generates strengths in range, weighted toward calm', () => {
    const rng = Prng.seed(4242);
    let calm = 0;
    let strong = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const w = generateWind(rng);
      expect(w.strength).toBeGreaterThanOrEqual(0);
      expect(w.strength).toBeLessThanOrEqual(constants.wind.maxStrength);
      expect(Number.isInteger(w.strength)).toBe(true);
      expect(w.directionDeg).toBeGreaterThanOrEqual(0);
      expect(w.directionDeg).toBeLessThan(360);
      if (w.strength <= 10) calm++;
      if (w.strength >= 20) strong++;
    }
    expect(calm / n).toBeGreaterThan(0.55);
    expect(strong / n).toBeGreaterThan(0.02);
    expect(strong / n).toBeLessThan(0.1);
  });

  it('is reproducible from the seed', () => {
    const a = Prng.seed(7);
    const b = Prng.seed(7);
    for (let i = 0; i < 20; i++) expect(generateWind(a)).toEqual(generateWind(b));
  });

  it('changes every other completed turn', () => {
    expect(windChangesOnTurn(0)).toBe(false);
    expect(windChangesOnTurn(1)).toBe(false);
    expect(windChangesOnTurn(2)).toBe(true);
    expect(windChangesOnTurn(3)).toBe(false);
    expect(windChangesOnTurn(4)).toBe(true);
  });
});
