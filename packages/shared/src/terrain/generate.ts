/**
 * Procedural terrain generation (DESIGN §8). Every generator is driven by the shared
 * PRNG, so a map is fully described by (mapId, seed) on the wire.
 *
 * The workhorse is layered 1-D value noise: a few octaves of random lattice values,
 * smoothstep-interpolated and summed, give the surface height of each column. The four
 * styles then cut their own silhouette out of that field:
 *
 * - `hills`  rolling ground, solid all the way down.
 * - `pit`    the same, lifted into a plateau on each side of a full-height chasm; the
 *            chasm reaches the bottom of the map, so falling in is death.
 * - `islands` free-standing masses with air under them and lethal gaps between them.
 * - `cave`   a floor with bumps under a ceiling slab with stalactites, so a high lob
 *            hits rock.
 *
 * Nothing in here holds a literal: the shapes are `terrainGen` and the rules a spawn
 * site has to satisfy are `spawnGen`, both in `data/maps.ts`.
 */
import type { Prng } from '../math/prng.js';
import { constants } from '../data/constants.js';
import { spawnGen, terrainGen } from '../data/maps.js';
import type { MapDef, TerrainStyle } from '../data/maps.js';
import { Terrain, NO_GROUND, SOLID } from './terrain.js';
import { decodeRle } from './codec.js';

export interface SpawnPoint {
  x: number;
  y: number;
}

export interface GeneratedMap {
  terrain: Terrain;
  spawns: SpawnPoint[];
}

interface Octave {
  wavelength: number;
  amplitude: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** One octave of 1-D value noise sampled over [0, span). */
function noiseOctave(rng: Prng, span: number, octave: Octave, out: Float64Array): void {
  const lattice = Math.floor(span / octave.wavelength) + 3;
  const values = new Float64Array(lattice);
  for (let i = 0; i < lattice; i++) values[i] = rng.nextFloat() * 2 - 1;
  for (let x = 0; x < span; x++) {
    const t = x / octave.wavelength;
    const i = Math.floor(t);
    const f = smoothstep(t - i);
    const a = values[i] ?? 0;
    const b = values[i + 1] ?? 0;
    out[x] = (out[x] ?? 0) + (a + (b - a) * f) * octave.amplitude;
  }
}

/** Surface height (top solid y) per column. */
function heightField(
  rng: Prng,
  width: number,
  height: number,
  base: number,
  octaves: Octave[],
  minTop: number,
  maxTop: number,
): Float64Array {
  const field = new Float64Array(width);
  for (let i = 0; i < octaves.length; i++) {
    const o = octaves[i];
    if (o) noiseOctave(rng, width, o, field);
  }
  for (let x = 0; x < width; x++) {
    let y = base + (field[x] ?? 0);
    if (y < minTop) y = minTop;
    if (y > maxTop) y = maxTop;
    if (y > height) y = height;
    field[x] = y;
  }
  return field;
}

function fillFromField(terrain: Terrain, field: Float64Array): void {
  for (let x = 0; x < terrain.width; x++) {
    terrain.fillColumnFrom(x, Math.floor(field[x] ?? terrain.height));
  }
}

/** Solid run [yTop, yBottom] of one column, clipped to the map. */
function fillSpan(terrain: Terrain, x: number, yTop: number, yBottom: number): void {
  if (x < 0 || x >= terrain.width) return;
  const top = Math.max(0, Math.floor(yTop));
  const bottom = Math.min(terrain.height - 1, Math.floor(yBottom));
  const mask = terrain.mask;
  const w = terrain.width;
  for (let y = top; y <= bottom; y++) mask[y * w + x] = SOLID;
}

/** Build the terrain mask for a map definition. */
export function generateTerrain(map: MapDef, rng: Prng): Terrain {
  if (map.source.kind === 'mask') {
    return decodeRle(map.source.rle);
  }
  return generateStyle(map.source.style, map.width, map.height, rng);
}

export function generateStyle(
  style: TerrainStyle,
  width: number,
  height: number,
  rng: Prng,
): Terrain {
  switch (style) {
    case 'pit':
      return generatePit(width, height, rng);
    case 'islands':
      return generateIslands(width, height, rng);
    case 'cave':
      return generateCave(width, height, rng);
    case 'hills':
    default:
      return generateHills(width, height, rng);
  }
}

/** Flat-with-hills: one continuous surface, solid to the bottom of the map. */
export function generateHills(width: number, height: number, rng: Prng): Terrain {
  const cfg = terrainGen.hills;
  const terrain = new Terrain(width, height);
  const field = heightField(
    rng,
    width,
    height,
    height * cfg.baseFraction,
    cfg.octaves,
    height * cfg.minTopFraction,
    height * cfg.maxTopFraction,
  );
  fillFromField(terrain, field);
  return terrain;
}

/**
 * Deep central chasm: the ground is lifted into a flat-topped plateau on each side and
 * then a funnel is cut out of the middle, all the way to the bottom of the map. There
 * is no floor in it — a mobile that walks or is blasted in falls off the world.
 */
export function generatePit(width: number, height: number, rng: Prng): Terrain {
  const cfg = terrainGen.pit;
  const terrain = new Terrain(width, height);
  const field = heightField(
    rng,
    width,
    height,
    height * cfg.baseFraction,
    cfg.octaves,
    height * cfg.minTopFraction,
    height * cfg.maxTopFraction,
  );

  const centre = width / 2;
  const rimSpan = width * cfg.rimSpanFraction;
  const minTop = height * cfg.minTopFraction;
  for (let x = 0; x < width; x++) {
    const d = Math.abs(x - centre) / rimSpan;
    if (d >= 1) continue;
    const lift = cfg.rimLiftPx * smoothstep(clamp01((1 - d) * cfg.rimFlatness));
    let y = (field[x] ?? 0) - lift;
    if (y < minTop) y = minTop;
    field[x] = y;
  }
  fillFromField(terrain, field);

  // Jagged walls: one noise stream per side, drawn in a fixed order, so the two edges
  // of the chasm are not mirror images of each other.
  const wall: Octave = { wavelength: cfg.chasmWallWavelength, amplitude: cfg.chasmWallAmplitude };
  const leftWall = new Float64Array(height);
  noiseOctave(rng, height, wall, leftWall);
  const rightWall = new Float64Array(height);
  noiseOctave(rng, height, wall, rightWall);

  const half = width * cfg.chasmHalfWidthFraction;
  const mask = terrain.mask;
  for (let y = 0; y < height; y++) {
    const flare = cfg.chasmTopScale + cfg.chasmFlareFraction * (y / height);
    const x0 = Math.max(0, Math.floor(centre - half * flare + (leftWall[y] ?? 0)));
    const x1 = Math.min(width - 1, Math.ceil(centre + half * flare + (rightWall[y] ?? 0)));
    const row = y * width;
    for (let x = x0; x <= x1; x++) mask[row + x] = 0;
  }
  terrain.invalidateHash();
  return terrain;
}

/**
 * Floating islands: a handful of free-standing masses, wide and flat at the two ends of
 * the map and small stepping stones in the middle, with nothing at all between them.
 * Each mass is a lens — a parabolic underside plus a keel spike — so the gaps read as
 * sky rather than as a hole in the floor.
 */
export function generateIslands(width: number, height: number, rng: Prng): Terrain {
  const cfg = terrainGen.islands;
  const terrain = new Terrain(width, height);

  const surface = new Float64Array(width);
  noiseOctave(
    rng,
    width,
    { wavelength: cfg.surfaceWavelength, amplitude: cfg.surfaceAmplitude },
    surface,
  );
  const keel = new Float64Array(width);
  noiseOctave(rng, width, { wavelength: cfg.keelWavelength, amplitude: cfg.keelAmplitude }, keel);

  for (let i = 0; i < cfg.masses.length; i++) {
    const mass = cfg.masses[i];
    if (!mass) continue;
    const cx = width * mass.centreFraction + rng.nextRange(-cfg.jitterPx, cfg.jitterPx);
    const top = height * mass.topFraction + rng.nextRange(-cfg.jitterPx, cfg.jitterPx);
    const hw = mass.halfWidthPx;
    const x0 = Math.max(0, Math.floor(cx - hw));
    const x1 = Math.min(width - 1, Math.ceil(cx + hw));
    for (let x = x0; x <= x1; x++) {
      const u = (x - cx) / hw;
      const s = 1 - u * u;
      if (s <= 0) continue;
      // The surface dips at the shoulders, so the flat middle is the playable part.
      const surfaceY = top + (surface[x] ?? 0) * s + cfg.shoulderDropPx * (1 - s);
      let thickness = mass.thicknessPx * s * (0.5 + 0.5 * s) + (keel[x] ?? 0) * s;
      const spike = cfg.keelSpikePx * (1 - Math.abs(u) * cfg.keelSpikeSpread);
      if (spike > 0) thickness += spike;
      if (thickness < 2) continue;
      fillSpan(terrain, x, surfaceY, surfaceY + thickness);
    }
  }
  terrain.invalidateHash();
  return terrain;
}

/**
 * Cave: an open floor with bumps and stalagmites under a ceiling slab with stalactites
 * hanging off it. A tip is never allowed closer than `minClearancePx` to the floor, so
 * the corridor always stays playable, but a lazy high lob does hit rock.
 */
export function generateCave(width: number, height: number, rng: Prng): Terrain {
  const cfg = terrainGen.cave;
  const terrain = new Terrain(width, height);
  const floor = heightField(
    rng,
    width,
    height,
    height * cfg.baseFraction,
    cfg.octaves,
    height * cfg.minTopFraction,
    height * cfg.maxTopFraction,
  );
  fillFromField(terrain, floor);

  const ceiling = new Float64Array(width);
  noiseOctave(
    rng,
    width,
    { wavelength: cfg.ceilingWavelength, amplitude: cfg.ceilingAmplitude },
    ceiling,
  );
  const base = height * cfg.ceilingBaseFraction;
  for (let x = 0; x < width; x++) {
    const bottom = base + (ceiling[x] ?? 0);
    ceiling[x] = bottom;
    fillSpan(terrain, x, 0, bottom);
  }

  // Stalagmites first: they raise the floor, and the tips below have to clear whatever
  // the floor ends up being, or a bump and a tip together could seal the cave shut.
  // A stalagmite is clamped against the ceiling for the same reason from the other
  // side: `minClearancePx` is a promise about the corridor, and a tall spike on a high
  // stretch of floor squeezed it under the slab even where no stalactite hung.
  for (let i = 0; i < cfg.stalagmites; i++) {
    const cx = rng.nextRange(0, width);
    const hw = cfg.stalagmiteHalfWidthPx * rng.nextRange(0.6, 1.5);
    const length = rng.nextRange(cfg.stalagmiteMinLengthPx, cfg.stalagmiteMaxLengthPx);
    const x0 = Math.max(0, Math.floor(cx - hw));
    const x1 = Math.min(width - 1, Math.ceil(cx + hw));
    for (let x = x0; x <= x1; x++) {
      const taper = 1 - Math.abs(x - cx) / hw;
      if (taper <= 0) continue;
      const from = floor[x] ?? height;
      // +1 because both ends round outward when they are rasterised.
      const limit = (ceiling[x] ?? 0) + cfg.minClearancePx + 1;
      let top = from - length * taper;
      if (top < limit) top = limit;
      if (top >= from) continue;
      fillSpan(terrain, x, top, from);
      if (top < (floor[x] ?? height)) floor[x] = top;
    }
  }

  for (let i = 0; i < cfg.stalactites; i++) {
    const cx = rng.nextRange(0, width);
    const hw = cfg.stalactiteHalfWidthPx * rng.nextRange(0.6, 1.5);
    const length = rng.nextRange(cfg.stalactiteMinLengthPx, cfg.stalactiteMaxLengthPx);
    const x0 = Math.max(0, Math.floor(cx - hw));
    const x1 = Math.min(width - 1, Math.ceil(cx + hw));
    for (let x = x0; x <= x1; x++) {
      const taper = 1 - Math.abs(x - cx) / hw;
      if (taper <= 0) continue;
      const from = ceiling[x] ?? base;
      let tip = from + length * taper;
      // -1 because both ends round outward when they are rasterised: the promise is
      // that the *air* gap is never thinner than minClearancePx.
      const limit = (floor[x] ?? height) - cfg.minClearancePx - 1;
      if (tip > limit) tip = limit;
      if (tip <= from) continue;
      fillSpan(terrain, x, from, tip);
    }
  }

  terrain.invalidateHash();
  return terrain;
}

// ---------------------------------------------------------------------------
// Spawn placement
// ---------------------------------------------------------------------------

/**
 * Top of the *lowest* solid run in a column, or {@link NO_GROUND} for an empty one.
 *
 * "Lowest" rather than "topmost" is what makes one probe work for every style: on
 * `cave` the topmost run is the ceiling (a mobile would be placed on the roof), and on
 * `islands` a column either holds one mass or nothing at all. A column cut through by
 * the chasm or lying in a gap has no run and is rejected by the caller.
 */
function lowestSurface(terrain: Terrain, x: number): number {
  if (x < 0 || x >= terrain.width) return NO_GROUND;
  const mask = terrain.mask;
  const w = terrain.width;
  let y = terrain.height - 1;
  while (y >= 0 && mask[y * w + x] !== SOLID) y--;
  if (y < 0) return NO_GROUND;
  while (y - 1 >= 0 && mask[(y - 1) * w + x] === SOLID) y--;
  return y;
}

/** Air px directly above `y` in a column, counted no further than `cap`. */
function airAbove(terrain: Terrain, x: number, y: number, cap: number): number {
  const mask = terrain.mask;
  const w = terrain.width;
  let n = 0;
  for (let probe = y - 1; probe >= 0 && n < cap; probe--) {
    if (mask[probe * w + x] === SOLID) return n;
    n++;
  }
  return n;
}

/** Solid px from `y` downward, counted no further than `cap`. */
function solidBelow(terrain: Terrain, x: number, y: number, cap: number): number {
  const mask = terrain.mask;
  const w = terrain.width;
  let n = 0;
  for (let probe = y; probe < terrain.height && n < cap; probe++) {
    if (mask[probe * w + x] !== SOLID) return n;
    n++;
  }
  return n;
}

/**
 * How steep the surface is under a footprint at column `x`, as a plain px difference
 * (no trig): the tilt sampling in `Terrain.sampleTilt` is monotonic in this, so the
 * flattest column by this measure is the flattest column by tilt.
 */
function surfaceDropPx(terrain: Terrain, x: number, y: number, w: number): number {
  const half = w / 2;
  const probe = constants.mobile.surfaceProbePx;
  const left = terrain.surfaceNear(x - half, y, probe);
  const right = terrain.surfaceNear(x + half, y, probe);
  if (left === NO_GROUND || right === NO_GROUND) return Number.MAX_SAFE_INTEGER;
  return Math.abs(right - left);
}

/**
 * How far the ends of a footprint centred on `x` stand above (`rise`) and hang below
 * (`dip`) the feet at `y`, 0 when neither does. A mobile whose end is more than its
 * `maxStep` up cannot drive either way: walking reads that end as a wall. Both ends far
 * down is a point, not ground.
 */
function edgeOffsets(terrain: Terrain, x: number, y: number, w: number): { rise: number; dip: number } {
  const half = w / 2;
  const probe = constants.mobile.surfaceProbePx;
  const left = terrain.surfaceNear(x - half, y, probe);
  const right = terrain.surfaceNear(x + half, y, probe);
  if (left === NO_GROUND || right === NO_GROUND) {
    return { rise: Number.MAX_SAFE_INTEGER, dip: Number.MAX_SAFE_INTEGER };
  }
  return { rise: Math.max(0, y - left, y - right), dip: Math.max(0, left - y, right - y) };
}

/**
 * Is column `x` somewhere a match may start? Returns the surface y, or
 * {@link NO_GROUND}. `maxDrop` is the relaxation knob: the search runs the strict pass
 * first and only then a looser one (see {@link computeSpawnPoints}). `edges` keeps a
 * seat from starting wedged against the slope behind a shelf's lip (`rise`) or balanced
 * on a point (`dip`); the fallback stages pass `null` and skip it.
 */
function spawnSiteAt(
  terrain: Terrain,
  x: number,
  maxDrop: number,
  headroomPx: number,
  edges: { rise: number; dip: number } | null,
): number {
  const y = lowestSurface(terrain, x);
  if (y === NO_GROUND) return NO_GROUND;
  if (solidBelow(terrain, x, y, spawnGen.minThicknessPx) < spawnGen.minThicknessPx) {
    return NO_GROUND;
  }
  if (headroomPx > 0 && airAbove(terrain, x, y, headroomPx) < headroomPx) {
    return NO_GROUND;
  }
  if (surfaceDropPx(terrain, x, y, constants.spawn.slopeProbeWidthPx) > maxDrop) {
    return NO_GROUND;
  }
  if (edges) {
    const e = edgeOffsets(terrain, x, y, constants.spawn.slopeProbeWidthPx);
    if (e.rise > edges.rise || e.dip > edges.dip) return NO_GROUND;
  }
  return y;
}

/**
 * Spawn points (DESIGN §7 item 15): `count` positions spread across the usable width,
 * each dropped onto the ground, in left-to-right order — with seats alternating A, B,
 * A, B this puts team A on the left and team B on the right of a 1v1 and interleaves
 * them in a bigger room.
 *
 * Phase 1 nudged a site to the flattest column nearby, which was enough for `hills`.
 * Three of the four maps now have places a mobile must not start in — inside the chasm,
 * in a gap between two islands, on the thin shoulder of an island, under a stalactite —
 * so the nominal slot is a *suggestion*: every column within `spawnGen.searchRadiusPx`
 * is scored against `spawnGen` (ground below, thick enough, headroom above, flat
 * enough, far enough from the seats already placed) and the nearest legal one wins.
 * The scan is a fixed step with the left side tried first, so it is reproducible, and
 * it relaxes in fixed stages rather than ever returning a site inside a hole.
 */
export function computeSpawnPoints(terrain: Terrain, count: number, rng: Prng): SpawnPoint[] {
  const spawns: SpawnPoint[] = [];
  if (count <= 0) return spawns;

  const margin = terrain.width * constants.spawn.marginFraction;
  const usable = terrain.width - margin * 2;
  const slot = usable / count;

  // Every seat draws its jitter, in seat order, before any placement happens: the
  // search itself must not consume the stream, or a map change would shift it.
  const nominal: number[] = [];
  for (let i = 0; i < count; i++) {
    const jitter = rng.nextRange(-slot * spawnGen.jitterFraction, slot * spawnGen.jitterFraction);
    let x = Math.floor(margin + slot * (i + 0.5) + jitter);
    if (x < 1) x = 1;
    if (x > terrain.width - 2) x = terrain.width - 2;
    nominal.push(x);
  }

  const placed: SpawnPoint[] = [];
  const farEnough = (x: number, separation: number): boolean => {
    for (let i = 0; i < placed.length; i++) {
      const other = placed[i];
      if (other && Math.abs(other.x - x) < separation) return false;
    }
    return true;
  };

  // A full room asks for more sites than the map has room to space out: the separation
  // is the design one or most of a slot, whichever is smaller, so eight seats stand
  // shoulder to shoulder instead of on top of each other.
  const separation = Math.min(spawnGen.minSeparationPx, slot * spawnGen.slotSeparationFraction);

  // Two floors the relaxation never goes below (DESIGN §7 item 132). The first three
  // stages give up slope and then headroom; the last gives up the *design* separation
  // and any slope, but it still asks for half the headroom and for a footprint's worth
  // of space, and looks further afield instead — otherwise eight seats on `pit` piled
  // up 17 px apart and one of them ended up entombed in the chasm wall.
  const floorSeparation = Math.min(separation, spawnGen.minSeparationFloorPx);
  const floorHeadroom = Math.min(spawnGen.minHeadroomPx, spawnGen.floorHeadroomPx);

  /**
   * Stages, strictest first: max surface drop, footprint edge limits (null: none),
   * headroom px, separation, search radius.
   */
  const edges = { rise: spawnGen.maxEdgeRisePx, dip: spawnGen.maxEdgeDipPx };
  const stages: {
    drop: number;
    edges: { rise: number; dip: number } | null;
    headroom: number;
    separation: number;
    radius: number;
  }[] = [
    {
      drop: spawnGen.maxDropPx,
      edges,
      headroom: spawnGen.minHeadroomPx,
      separation,
      radius: spawnGen.searchRadiusPx,
    },
    {
      drop: spawnGen.relaxedDropPx,
      edges,
      headroom: spawnGen.minHeadroomPx,
      separation,
      radius: spawnGen.searchRadiusPx,
    },
    {
      drop: spawnGen.relaxedDropPx,
      edges,
      headroom: 0,
      separation,
      radius: spawnGen.searchRadiusPx,
    },
    {
      drop: Number.MAX_SAFE_INTEGER,
      edges: null,
      headroom: floorHeadroom,
      separation: floorSeparation,
      radius: spawnGen.wideSearchRadiusPx,
    },
    // The last resort: anything with ground under it that is not inside another seat.
    {
      drop: Number.MAX_SAFE_INTEGER,
      edges: null,
      headroom: 0,
      separation: floorSeparation,
      radius: spawnGen.wideSearchRadiusPx,
    },
  ];

  for (let i = 0; i < count; i++) {
    const from = nominal[i] ?? Math.floor(terrain.width / 2);
    let found: SpawnPoint | null = null;
    for (let s = 0; s < stages.length && !found; s++) {
      const stage = stages[s];
      if (!stage) continue;
      for (let d = 0; d <= stage.radius && !found; d += spawnGen.searchStepPx) {
        for (let sign = -1; sign <= 1 && !found; sign += 2) {
          const x = d === 0 ? from : from + sign * d;
          if (x < 1 || x > terrain.width - 2) continue;
          if (!farEnough(x, stage.separation)) continue;
          const y = spawnSiteAt(terrain, x, stage.drop, stage.headroom, stage.edges);
          if (y !== NO_GROUND) found = { x, y };
          if (d === 0) break;
        }
      }
    }
    // Nothing anywhere near: the column itself, or the map floor (a map with no ground
    // at all is a broken map, and the mobile simply falls).
    if (!found) {
      const y = lowestSurface(terrain, from);
      found = { x: from, y: y === NO_GROUND ? terrain.height : y };
    }
    placed.push(found);
  }

  // Left to right, so seat order is map order however far a site had to move.
  placed.sort((a, b) => a.x - b.x);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    if (p) spawns.push(p);
  }
  return spawns;
}

/**
 * Seat order across the map is A, B, A, B … so teams start interleaved rather than
 * with one team on each side; see DESIGN §7 item 15.
 */
export function generateMap(map: MapDef, rng: Prng, spawnCount: number): GeneratedMap {
  const terrain = generateTerrain(map, rng);
  const spawns = computeSpawnPoints(terrain, spawnCount, rng);
  return { terrain, spawns };
}
