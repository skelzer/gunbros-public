/**
 * The map pool (DESIGN §8, §8.1): shape, palette, art and — the part that decides
 * whether a map is playable at all — spawn placement.
 *
 * Every map in the pool runs the playability suite in `mapPlayability.ts` (legal
 * spawns, no sealed pockets, every seat can hit an opponent, over twenty seeds and
 * rooms of 2, 4 and 8), so a map added to the registry is covered without writing a
 * test for it. The blocks further down are what is particular to one map: the chasm
 * of `pit`, the gaps of `islands`, the roof of `cave`, and the painted ground of
 * `hills`.
 */
import { describe, expect, it } from 'vitest';
import { Prng } from '../src/math/prng.js';
import { constants } from '../src/data/constants.js';
import { maps, mapOrder, getMapDef, spawnGen } from '../src/data/maps.js';
import type { MapDef, PlateLayer } from '../src/data/maps.js';
import { computeSpawnPoints, generateTerrain } from '../src/terrain/generate.js';
import { NO_GROUND } from '../src/terrain/terrain.js';
import type { Terrain } from '../src/terrain/terrain.js';
import { RAD_TO_DEG } from '../src/math/trig.js';
import { describeMapPlayability } from './mapPlayability.js';

const SEEDS: number[] = [];
for (let i = 0; i < 20; i++) SEEDS.push((i * 2654435761 + 12345) >>> 0);

function build(map: MapDef, seed: number): Terrain {
  return generateTerrain(map, Prng.seed(seed));
}

function spawnsFor(map: MapDef, seed: number, count = 2): { x: number; y: number }[] {
  const terrain = build(map, seed);
  return computeSpawnPoints(terrain, count, Prng.seed((seed ^ 0x5bf03635) >>> 0));
}

/** Air px directly above a point, counted no further than `cap`. */
function headroom(terrain: Terrain, x: number, y: number, cap: number): number {
  let n = 0;
  for (let probe = y - 1; probe >= 0 && n < cap; probe--) {
    if (terrain.isSolid(x, probe)) return n;
    n++;
  }
  return n;
}

function columnIsEmpty(terrain: Terrain, x: number): boolean {
  for (let y = 0; y < terrain.height; y++) if (terrain.isSolid(x, y)) return false;
  return true;
}

/** View sizes the client can have (viewSize.ts): width fixed, height 360 to 600. */
const VIEW_W = 800;
const VIEW_H_MAX = 600;

describe('map definitions', () => {
  it('lists the pool in the pickers\' fixed order', () => {
    const ids = maps.map((m) => m.id);
    expect(ids.slice(0, 4)).toEqual(['hills', 'pit', 'islands', 'cave']);
    const ranks = ids.map((id) => mapOrder.indexOf(id));
    expect(ranks.every((r) => r >= 0)).toBe(true);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every map a display name, a size in range and a background', () => {
    const seen = new Set<string>();
    for (const map of maps) {
      expect(map.displayName.length).toBeGreaterThan(3);
      expect(seen.has(map.displayName)).toBe(false);
      seen.add(map.displayName);
      // DESIGN §2.2: roughly 1600-2000 x 900-1200.
      expect(map.width).toBeGreaterThanOrEqual(1600);
      expect(map.width).toBeLessThanOrEqual(2000);
      expect(map.height).toBeGreaterThanOrEqual(900);
      expect(map.height).toBeLessThanOrEqual(1200);
      // A sky and at least two parallax layers over it.
      expect(map.background.length).toBeGreaterThanOrEqual(3);
      expect(map.background[0]?.kind).toBe('gradient');
      const moving = map.background.filter((l) => l.parallax > 0);
      expect(moving.length).toBeGreaterThanOrEqual(2);
      for (const layer of map.background) {
        if (layer.kind !== 'plate') expect(layer.colors.length).toBeGreaterThan(0);
        expect(layer.parallax).toBeGreaterThanOrEqual(0);
        expect(layer.parallax).toBeLessThanOrEqual(1);
      }
      // Own palette, four tones deep: on a painted map it is the fallback.
      for (const tone of [
        map.palette.outline,
        map.palette.crust,
        map.palette.crustDark,
        map.palette.soil,
        map.palette.soilDark,
        map.palette.deep,
        map.palette.deepDark,
      ]) {
        expect(tone).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    // No two maps share a palette.
    const crusts = new Set(maps.map((m) => m.palette.crust));
    expect(crusts.size).toBe(maps.length);
  });

  it('only gives the cave a ceiling palette', () => {
    expect(getMapDef('cave').palette.ceiling).toBeDefined();
    expect(getMapDef('hills').palette.ceiling).toBeUndefined();
    expect(getMapDef('pit').palette.ceiling).toBeUndefined();
    expect(getMapDef('islands').palette.ceiling).toBeUndefined();
  });

  it('builds the same terrain from the same seed on every map', () => {
    for (const map of maps) {
      expect(build(map, 7).hash()).toBe(build(map, 7).hash());
    }
  });

  it('shapes a procedural map with the seed, and never a painted one', () => {
    for (const map of maps) {
      const same = build(map, 7).hash() === build(map, 8).hash();
      expect(same, map.id).toBe(map.source.kind === 'mask');
    }
  });

  it('still moves the spawns about with the seed on a painted map', () => {
    for (const map of maps.filter((m) => m.source.kind === 'mask')) {
      const layouts = new Set(SEEDS.map((seed) => JSON.stringify(spawnsFor(map, seed))));
      expect(layouts.size, map.id).toBeGreaterThan(SEEDS.length / 2);
    }
  });
});

describe('painted maps (DESIGN §8.1)', () => {
  const painted = maps.filter((m) => m.art !== undefined);

  it('includes the reference map', () => {
    expect(painted.map((m) => m.id)).toContain('hills');
  });

  for (const map of painted) {
    it(`${map.id}: a mask the size of the map, and art to draw it with`, () => {
      expect(map.source.kind).toBe('mask');
      const terrain = build(map, 1);
      expect(terrain.width).toBe(map.width);
      expect(terrain.height).toBe(map.height);
      expect(map.art?.terrain).toMatch(/\.png$/);
      expect(map.art?.thumb).toMatch(/\.png$/);
    });

    it(`${map.id}: three to five plates that cover every view without tiling`, () => {
      const plates = map.background.filter((l): l is PlateLayer => l.kind === 'plate');
      expect(plates.length).toBeGreaterThanOrEqual(3);
      expect(plates.length).toBeLessThanOrEqual(5);
      expect(new Set(plates.map((p) => p.src)).size).toBe(plates.length);
      for (const p of plates) {
        expect(p.src).toMatch(/^[a-z0-9_-]+\.png$/);
        expect(p.parallax).toBeGreaterThan(0);
        expect(p.parallax).toBeLessThan(1);
        // Across: the left edge at the first camera, the right edge at the last.
        expect(p.x).toBeLessThanOrEqual(0);
        expect(p.x + p.width - (map.width - VIEW_W) * p.parallax).toBeGreaterThanOrEqual(VIEW_W);
        // Down: the tallest view with the camera as low as it goes is the worst case.
        if (!p.fillBelow) {
          expect(p.y + p.height - (map.height - VIEW_H_MAX) * p.parallax).toBeGreaterThanOrEqual(VIEW_H_MAX);
        }
        for (const c of [p.fillAbove, p.fillBelow]) if (c) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  }
});

/**
 * Checks the procedural maps fail today, found when this suite first ran over them
 * (DESIGN §8.1). On the procedural `pit` the "lowest surface" rule could drop a seat of
 * a 2v2 into the cave under a rim ledge, where it was wedged and closer than the design
 * separation to its neighbour; on `cave` one duel start was found that no reference
 * shot gets out of.
 * (Seats wedged on the lip of a slope were the other finding; `spawnGen.maxEdgeRisePx`
 * fixed those on every map.) Each of these maps is remade as a painted map in M2 and
 * its entry goes with the generator it describes. A painted map never gets one.
 */
const KNOWN_GAPS: Record<string, readonly string[]> = {};

for (const map of maps) {
  if (map.source.kind === 'mask') expect(KNOWN_GAPS[map.id]).toBeUndefined();
  describeMapPlayability(map, KNOWN_GAPS[map.id] ?? []);
}

describe('hills', () => {
  const map = getMapDef('hills');

  it('has ground in every column and real relief', () => {
    for (const seed of SEEDS) {
      const terrain = build(map, seed);
      let min = Infinity;
      let max = -Infinity;
      for (let x = 0; x < terrain.width; x += 3) {
        const h = terrain.heightAt(x);
        expect(h).not.toBe(NO_GROUND);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      expect(max - min).toBeGreaterThan(50);
    }
  });

  it('rarely starts a seat on a ramp steeper than 25 degrees', () => {
    let worst = 0;
    for (const seed of SEEDS) {
      const terrain = build(map, seed);
      for (const s of computeSpawnPoints(terrain, 2, Prng.seed((seed ^ 0x5bf03635) >>> 0))) {
        worst = Math.max(
          worst,
          Math.abs(
            terrain.sampleTilt(
              s.x,
              s.y,
              constants.spawn.slopeProbeWidthPx,
              constants.mobile.surfaceProbePx,
            ) * RAD_TO_DEG,
          ),
        );
      }
    }
    expect(worst).toBeLessThan(25);
  });
});

describe('pit', () => {
  const map = getMapDef('pit');
  const terrain = build(map, 1);
  /** Columns the chasm is open in at every depth below the bridge (pit.py). */
  const CHASM = { left: 846, right: 1006 };

  /** The lowest solid row in a column that is part of the bridge, or -1. */
  function bridgeBottom(x: number): number {
    let last = -1;
    for (let y = 0; y < 560; y++) if (terrain.isSolid(x, y)) last = y;
    return last;
  }

  it('cuts a chasm through the middle that goes all the way down, under a thin bridge', () => {
    for (let x = CHASM.left; x <= CHASM.right; x += 4) {
      const bottom = bridgeBottom(x);
      // The bridge spans the gap, a few px of plank and rope and nothing more.
      expect(bottom, `column ${x}`).toBeGreaterThan(490);
      let solid = 0;
      for (let y = 0; y < terrain.height; y++) if (terrain.isSolid(x, y)) solid++;
      expect(solid, `column ${x}`).toBeLessThan(spawnGen.minThicknessPx);
      // Under it, open air to the bottom of the map: a fall is a fall.
      for (let y = bottom + 1; y < terrain.height; y++) expect(terrain.isSolid(x, y)).toBe(false);
    }
  });

  it('never starts a seat on the bridge or in the chasm, whatever the room', () => {
    for (const seed of SEEDS) {
      for (const count of [2, 4, 8]) {
        for (const s of computeSpawnPoints(build(map, seed), count, Prng.seed((seed ^ 0x5bf03635) >>> 0))) {
          expect(s.x < CHASM.left - 10 || s.x > CHASM.right + 10, `seed ${seed}, ${count} seats, x ${s.x}`).toBe(true);
        }
      }
    }
  });

  it('puts a duel on the two mesas, one each side of the gap, on high ground', () => {
    for (const seed of SEEDS) {
      const spawns = computeSpawnPoints(build(map, seed), 2, Prng.seed((seed ^ 0x5bf03635) >>> 0));
      expect(spawns[0]?.x ?? 0).toBeLessThan(CHASM.left);
      expect(spawns[1]?.x ?? 0).toBeGreaterThan(CHASM.right);
      // High ground: both stand well above the desert floor at the map's edges.
      for (const s of spawns) expect(s.y).toBeLessThan(terrain.heightAt(10) - 120);
    }
  });
});

describe('forge', () => {
  const map = getMapDef('forge');
  const terrain = build(map, 1);

  it('stands a volcano between the two halves that a duel has to lob over', () => {
    let peak = Infinity;
    for (let x = 860; x <= 940; x++) peak = Math.min(peak, terrain.heightAt(x));
    for (const seed of SEEDS) {
      const spawns = computeSpawnPoints(build(map, seed), 2, Prng.seed((seed ^ 0x5bf03635) >>> 0));
      expect(spawns[0]?.x ?? 0).toBeLessThan(780);
      expect(spawns[1]?.x ?? 0).toBeGreaterThan(1020);
      for (const s of spawns) expect(s.y - peak).toBeGreaterThan(200);
    }
  });

  it('floats on the lava: open air under the cliffs at both ends, down to the bottom', () => {
    for (const x of [20, 50, 1760, 1790]) expect(columnIsEmpty(terrain, x), `column ${x}`).toBe(true);
  });
});

describe('islands', () => {
  const map = getMapDef('islands');
  const terrain = build(map, 1);
  // The isles as tools/blender/maps/islands.py lays them out: the two home isles and
  // the three stones between them, left to right.
  const homeLeft = { from: 142, to: 644 };
  const homeRight = { from: 1254, to: 1776 };
  const gaps = [
    { from: 650, to: 676 },
    { from: 834, to: 868 },
    { from: 1024, to: 1048 },
    { from: 1206, to: 1244 },
  ];

  it('floats every mass: nothing reaches the bottom of the map', () => {
    for (let x = 0; x < terrain.width; x++) {
      expect(terrain.isSolid(x, terrain.height - 1)).toBe(false);
      expect(terrain.isSolid(x, terrain.height - 120), `column ${x}`).toBe(false);
    }
  });

  it('opens a full-height lethal gap between every pair of isles', () => {
    for (const gap of gaps) {
      for (let x = gap.from; x <= gap.to; x++) expect(columnIsEmpty(terrain, x), `column ${x}`).toBe(true);
    }
    // And past both ends of the chain.
    expect(columnIsEmpty(terrain, 100)).toBe(true);
    expect(columnIsEmpty(terrain, 1810)).toBe(true);
  });

  it('hangs nothing loose under an isle, so no dangling bit hides its top', () => {
    // A spawn stands on the top of the *lowest* solid run in its column (generate.ts):
    // a root or a drip hanging free under a shelf would put the seat under the isle.
    // Every isle top is above y = 720, so the lowest run in any column must start there.
    for (let x = homeLeft.from; x <= homeRight.to; x++) {
      let y = terrain.height - 1;
      while (y >= 0 && !terrain.isSolid(x, y)) y--;
      if (y < 0) continue;
      while (y > 0 && terrain.isSolid(x, y - 1)) y--;
      expect(y, `column ${x}`).toBeLessThan(720);
    }
  });

  it('starts a duel on the two home isles, facing each other across the crag', () => {
    for (const seed of SEEDS) {
      const spawns = spawnsFor(map, seed);
      const a = spawns[0]?.x ?? 0;
      const b = spawns[1]?.x ?? 0;
      expect(a).toBeGreaterThanOrEqual(homeLeft.from);
      expect(a).toBeLessThanOrEqual(homeLeft.to);
      expect(b).toBeGreaterThanOrEqual(homeRight.from);
      expect(b).toBeLessThanOrEqual(homeRight.to);
    }
    // The crag's crown stands well above both home isles: no flat shot gets across.
    const crown = terrain.heightAt(916);
    expect(terrain.heightAt(570) - crown).toBeGreaterThan(100);
    expect(terrain.heightAt(1330) - crown).toBeGreaterThan(100);
  });
});

describe('cave', () => {
  const map = getMapDef('cave');
  const terrain = build(map, 1);
  /** First air px from the top of a column: the underside of the roof. */
  const roofBottom = (x: number): number => {
    let y = 0;
    while (y < terrain.height && terrain.isSolid(x, y)) y++;
    return y;
  };
  /** Top of the lowest solid run in a column: the floor a mobile stands on. */
  const floorTop = (x: number): number => {
    let y = terrain.height - 1;
    while (y >= 0 && !terrain.isSolid(x, y)) y--;
    while (y > 0 && terrain.isSolid(x, y - 1)) y--;
    return y;
  };

  it('roofs the whole map and keeps a corridor open under it, tunnel mouth to tunnel mouth', () => {
    for (let x = 0; x < terrain.width; x++) {
      expect(terrain.isSolid(x, 0), `column ${x}`).toBe(true);
      expect(terrain.isSolid(x, terrain.height - 1), `column ${x}`).toBe(true);
      // Where a fang and a stalagmite meet the window between them is narrowest; it
      // stays wide enough to walk through and to shoot through.
      expect(floorTop(x) - roofBottom(x), `column ${x}`).toBeGreaterThanOrEqual(60);
    }
    // The tunnels run off both edges, which is how the open air reaches the hall.
    expect(terrain.isSolid(0, 650)).toBe(false);
    expect(terrain.isSolid(terrain.width - 1, 650)).toBe(false);
  });

  it('hangs the roof where the camera shows it', () => {
    // The camera stops at height - viewHeight; the underside is below that everywhere,
    // so on a desktop the roof is always on screen over a mobile on the floor.
    for (let x = 0; x < terrain.width; x++) {
      expect(roofBottom(x), `column ${x}`).toBeGreaterThan(map.height - VIEW_H_MAX);
    }
  });

  it('starts every duel on the floor with room to aim, under a roof that stops a lob', () => {
    for (const seed of SEEDS) {
      for (const s of spawnsFor(map, seed)) {
        expect(s.y).toBeGreaterThan(terrain.height * 0.6);
        expect(headroom(terrain, s.x, s.y, spawnGen.minHeadroomPx)).toBe(spawnGen.minHeadroomPx);
        // A shell fired at 45 degrees and full power climbs about 320 px: the roof is
        // lower than that over every duel start.
        expect(headroom(terrain, s.x, s.y, 400)).toBeLessThan(320);
      }
    }
  });
});
