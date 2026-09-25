/** DESIGN §10: carve, ground probes, slope, RLE round trip, hash changes on carve. */
import { describe, expect, it } from 'vitest';
import { Terrain, NO_GROUND } from '../src/terrain/terrain.js';
import { encodeRle, decodeRle } from '../src/terrain/codec.js';
import { generateHills, computeSpawnPoints } from '../src/terrain/generate.js';
import { Prng } from '../src/math/prng.js';
import { hillsMap } from '../src/data/maps.js';
import { constants } from '../src/data/constants.js';
import { RAD_TO_DEG } from '../src/math/trig.js';
import { flatTerrain, slopeTerrain } from './helpers.js';

describe('terrain', () => {
  it('treats everything outside the map as air', () => {
    const t = flatTerrain(100, 100, 50);
    expect(t.isSolid(50, 60)).toBe(true);
    expect(t.isSolid(-1, 60)).toBe(false);
    expect(t.isSolid(100, 60)).toBe(false);
    expect(t.isSolid(50, -1)).toBe(false);
    expect(t.isSolid(50, 100)).toBe(false);
  });

  it('carves a disc and nothing outside it', () => {
    const t = flatTerrain(200, 200, 100);
    const circle = t.carve(100, 120, 20);
    expect(circle).toEqual({ x: 100, y: 120, r: 20 });
    expect(t.isSolid(100, 120)).toBe(false);
    expect(t.isSolid(100, 100)).toBe(false); // top of the disc, 20 px above the centre
    expect(t.isSolid(115, 105)).toBe(true); // diagonally outside the radius
    expect(t.isSolid(100, 139)).toBe(false); // just inside the bottom
    expect(t.isSolid(100, 141)).toBe(true);
    expect(t.isSolid(121, 120)).toBe(true);
    expect(t.isSolid(119, 120)).toBe(false);
  });

  it('probes the ground below a point', () => {
    const t = flatTerrain(200, 200, 120);
    expect(t.groundBelow(50, 0, 200)).toBe(120);
    expect(t.groundBelow(50, 130, 10)).toBe(130); // already inside the ground
    expect(t.groundBelow(50, 0, 50)).toBe(NO_GROUND);
    expect(t.heightAt(50)).toBe(120);
    t.carve(50, 125, 12);
    expect(t.groundBelow(50, 0, 200)).toBe(138);
  });

  it('finds the surface nearest a point, above or below', () => {
    const t = flatTerrain(200, 200, 100);
    expect(t.surfaceNear(30, 40, 80)).toBe(100); // from the air, look down
    expect(t.surfaceNear(30, 150, 80)).toBe(100); // from inside, walk up
    expect(t.surfaceNear(30, 40, 10)).toBe(NO_GROUND);
  });

  it('samples tilt with the sign of the slope', () => {
    const flat = flatTerrain(400, 300, 150);
    expect(Math.abs(flat.sampleTilt(200, 150, 26, 64))).toBeLessThan(1e-9);

    // Ground dropping to the right: positive (clockwise, nose down to the right).
    const down = slopeTerrain(400, 300, 100, 0.5);
    const tiltDown = down.sampleTilt(200, down.heightAt(200), 26, 64);
    expect(tiltDown).toBeGreaterThan(0.4);
    expect(tiltDown).toBeLessThan(0.5);

    const up = slopeTerrain(400, 300, 200, -0.5);
    expect(up.sampleTilt(200, up.heightAt(200), 26, 64)).toBeLessThan(-0.4);
  });

  it('hashes the mask, caches it, and invalidates on carve', () => {
    const a = flatTerrain(200, 200, 100);
    const b = flatTerrain(200, 200, 100);
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).toBe(a.hash()); // cached path returns the same value

    const before = a.hash();
    a.carve(100, 110, 10);
    const after = a.hash();
    expect(after).not.toBe(before);
    expect(a.hash()).toBe(after);

    a.setSolid(5, 5, true);
    expect(a.hash()).not.toBe(after);
  });

  it('round-trips through RLE', () => {
    const original = generateHills(600, 400, Prng.seed(77));
    original.carve(300, 250, 40);
    original.carve(120, 300, 25);
    const rle = encodeRle(original);
    const restored = decodeRle(rle);

    expect(restored.width).toBe(original.width);
    expect(restored.height).toBe(original.height);
    expect(restored.hash()).toBe(original.hash());
    expect(Array.from(restored.mask)).toEqual(Array.from(original.mask));
  });

  it('round-trips an all-air and an all-solid mask', () => {
    const air = new Terrain(40, 30);
    expect(decodeRle(encodeRle(air)).hash()).toBe(air.hash());

    const solid = new Terrain(40, 30);
    solid.mask.fill(1);
    solid.invalidateHash();
    expect(decodeRle(encodeRle(solid)).hash()).toBe(solid.hash());
  });

  it('keeps the RLE payload small for a real map', () => {
    const t = generateHills(hillsMap.width, hillsMap.height, Prng.seed(1));
    const rle = encodeRle(t);
    expect(rle.length).toBeLessThan(40 * 1024);
  });

  it('generates hills deterministically with ground everywhere', () => {
    const a = generateHills(800, 600, Prng.seed(5));
    const b = generateHills(800, 600, Prng.seed(5));
    const c = generateHills(800, 600, Prng.seed(6));
    expect(a.hash()).toBe(b.hash());
    expect(a.hash()).not.toBe(c.hash());

    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < a.width; x++) {
      const h = a.heightAt(x);
      expect(h).not.toBe(NO_GROUND);
      min = Math.min(min, h);
      max = Math.max(max, h);
    }
    expect(max - min).toBeGreaterThan(40); // it is not a flat plain
  });

  it('places spawn points on the ground, spread across the map', () => {
    const t = generateHills(hillsMap.width, hillsMap.height, Prng.seed(3));
    const spawns = computeSpawnPoints(t, 4, Prng.seed(3));
    expect(spawns).toHaveLength(4);
    for (const s of spawns) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(t.width);
      expect(t.isSolid(s.x, s.y)).toBe(true);
      expect(t.isSolid(s.x, s.y - 1)).toBe(false);
    }
    for (let i = 1; i < spawns.length; i++) {
      expect((spawns[i]?.x ?? 0) - (spawns[i - 1]?.x ?? 0)).toBeGreaterThan(100);
    }
  });

  it('keeps spawn sites off the steep ramps', () => {
    // A mobile's relative aim range is only 80 degrees wide (armor: -10..70), so a spawn
    // on a 30 degree ramp can aim into the ground on one side and the sky on the other.
    // computeSpawnPoints nudges each site to the flattest nearby column for this reason.
    const probeW = constants.spawn.slopeProbeWidthPx;
    let worst = 0;
    for (const seed of [1, 2, 3, 42, 99, 1234, 4321, 777]) {
      const t = generateHills(hillsMap.width, hillsMap.height, Prng.seed(seed));
      for (const s of computeSpawnPoints(t, 2, Prng.seed(seed))) {
        const tilt = Math.abs(
          t.sampleTilt(s.x, s.y, probeW, constants.mobile.surfaceProbePx) * RAD_TO_DEG,
        );
        worst = Math.max(worst, tilt);
      }
    }
    expect(worst).toBeLessThan(20);
  });

  it('spawns under a ceiling, not on top of it', () => {
    // A cave column holds two solid runs. The probe takes the lowest one, or every seat
    // on the cave map would start on the roof.
    const t = new Terrain(600, 600);
    for (let x = 0; x < 600; x++) {
      for (let y = 0; y < 60; y++) t.setSolid(x, y, true);
      t.fillColumnFrom(x, 400);
    }
    for (const s of computeSpawnPoints(t, 2, Prng.seed(4))) {
      expect(s.y).toBe(400);
    }
  });

  it('never puts a seat in a hole, however close the hole is to its slot', () => {
    // The right half of the map is a full-height gap (the chasm, or the sky between two
    // islands): the seat that belongs there has to be moved onto solid ground instead.
    const t = flatTerrain(1000, 600, 400);
    for (let x = 520; x < 1000; x++) {
      for (let y = 0; y < 600; y++) t.setSolid(x, y, false);
    }
    const spawns = computeSpawnPoints(t, 2, Prng.seed(9));
    for (const s of spawns) {
      expect(s.x).toBeLessThan(520);
      expect(t.isSolid(s.x, s.y)).toBe(true);
      expect(t.isSolid(s.x, s.y - 1)).toBe(false);
    }
  });

  it('refuses a ledge too thin to stand a match on', () => {
    // The seat's own slot is a 4 px crust over air, which is not ground:
    // spawnGen.minThicknessPx rejects it and the search walks off it onto the rock.
    const t = flatTerrain(1000, 600, 400);
    for (let x = 400; x < 600; x++) {
      for (let y = 0; y < 600; y++) t.setSolid(x, y, false);
      for (let y = 300; y < 304; y++) t.setSolid(x, y, true);
    }
    const spawns = computeSpawnPoints(t, 1, Prng.seed(11));
    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.y).toBe(400);
    expect((spawns[0]?.x ?? 500) < 400 || (spawns[0]?.x ?? 500) >= 600).toBe(true);
  });
});
