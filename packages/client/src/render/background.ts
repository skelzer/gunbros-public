/**
 * Parallax background (DESIGN §1.3 render/background.ts, §8): every layer is drawn from
 * code, from the `ParallaxLayer[]` the map def carries. Nothing here is loaded from
 * disk and nothing here is random at runtime — the shapes come out of the shared PRNG
 * seeded from the map, so the same map always looks the same.
 *
 * Each layer is baked **once** into one offscreen tile as wide as its repeat period and
 * only as tall as the band it occupies; a frame then costs two or three `drawImage`
 * calls per layer plus a fill for the flat colour above or below it. That is what keeps
 * four maps' worth of mountains, mesas, sky islands and crystal caves affordable at 60
 * frames a second: no path is rebuilt while the camera moves, only blitted at an offset.
 *
 * Two things move without the camera. `params.drift` slides a layer's tile sideways by
 * a few hundredths of a pixel per frame, which is what makes clouds sail and dust blow
 * across a still screen; and a layer may bake *several* tiles and cycle them every
 * `params.frameTicks` frames, which is how birds flap and fireflies blink. Both are
 * still one blit per layer per frame — the animation is in which tile is chosen, never
 * in redrawing one.
 *
 * A painted map (DESIGN §8.1) adds `plate` layers: its scenery rendered in Blender, one
 * pre-decoded image per layer from `render/mapArt.ts`. A plate is not baked or tiled —
 * the pack step sized it to cover the view at every camera position — so it costs one
 * `drawImage` a frame, plus a flat fill under it when the camera looks past its bottom
 * edge. A plate whose picture has not arrived (or never will) is skipped, and the sky
 * and the code-drawn layers still make a background.
 *
 * This is pure presentation: no value computed in this module ever reaches MatchState.
 */
import { Prng } from '@gunbros/shared';
import type { DrawnLayer, MapDef, ParallaxLayer, PlateLayer } from '@gunbros/shared';
import type { Camera } from './camera.js';
import { parseHexColor } from './terrain.js';
import { worldShake } from './effects.js';
import { createOffscreen } from './canvas.js';
import { mapArtFor } from './mapArt.js';
import { clientConstants } from '../data/clientConstants.js';

interface PreparedLayer {
  layer: ParallaxLayer;
  /** Baked tiles, cycled for animation; empty for the sky gradient (flat bands). */
  tiles: HTMLCanvasElement[];
  /** Horizontal repeat period of the tile, px. */
  periodPx: number;
  /** View-space y of the tile's top before vertical parallax. */
  top: number;
  tileH: number;
  /** Flat colour filling the view above / below the tile once parallax moves it. */
  fillAbove: string | null;
  fillBelow: string | null;
  /** Px the tile slides left per rendered frame, on top of the camera parallax. */
  drift: number;
  /** Frames one tile is held for when there is more than one. */
  frameTicks: number;
  /** Gradient layers only. */
  bands?: string[];
}

/** A lobe of a compound blob: an ellipse in tile space. */
interface Lobe {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

/** Sample a colour ramp of arbitrary length at t in [0, 1]. */
function rampAt(colors: string[], t: number): string {
  if (colors.length === 0) return '#000000';
  if (colors.length === 1) return colors[0] as string;
  const scaled = t * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(scaled));
  return lerpColor(colors[i] as string, colors[i + 1] as string, scaled - i);
}

function colorAt(colors: string[], index: number, fallback: string): string {
  return colors[index] ?? colors[0] ?? fallback;
}

/** One period of smooth value noise, in px, seamless across the period. */
function buildSilhouette(rng: Prng, period: number, step: number, amplitude: number): Float64Array {
  const lattice = Math.max(2, Math.round(period / step));
  const values = new Float64Array(lattice);
  for (let i = 0; i < lattice; i++) values[i] = rng.nextFloat();
  const out = new Float64Array(period);
  for (let x = 0; x < period; x++) {
    const t = (x / period) * lattice;
    const i = Math.floor(t) % lattice;
    const j = (i + 1) % lattice;
    const f = smoothstep(t - Math.floor(t));
    const a = values[i] ?? 0;
    const b = values[j] ?? 0;
    out[x] = (a + (b - a) * f) * amplitude;
  }
  return out;
}

/** Add a second, finer octave. Keeps the period, so the tile still wraps. */
function addOctave(
  rng: Prng,
  field: Float64Array,
  period: number,
  step: number,
  amplitude: number,
): void {
  const fine = buildSilhouette(rng, period, step, amplitude);
  for (let x = 0; x < period; x++) field[x] = (field[x] ?? 0) + (fine[x] ?? 0);
}

/** Triangular teeth (cave rock, stalactites): the max of a handful of cones. */
function buildTeeth(
  rng: Prng,
  period: number,
  count: number,
  maxHeight: number,
  baseHeight: number,
): Float64Array {
  const out = new Float64Array(period);
  for (let x = 0; x < period; x++) out[x] = baseHeight;
  for (let i = 0; i < count; i++) {
    const cx = rng.nextRange(0, period);
    const half = rng.nextRange(period / (count * 4), period / (count * 1.4));
    const height = rng.nextRange(maxHeight * 0.35, maxHeight);
    const from = Math.floor(cx - half);
    const to = Math.ceil(cx + half);
    for (let x = from; x <= to; x++) {
      const taper = 1 - Math.abs(x - cx) / half;
      if (taper <= 0) continue;
      const wrapped = ((x % period) + period) % period;
      const h = baseHeight + height * taper * taper;
      if (h > (out[wrapped] ?? 0)) out[wrapped] = h;
    }
  }
  return out;
}

/** Fill a silhouette field into a tile: solid from the ridge down to the tile bottom. */
function fillRidge(
  ctx: CanvasRenderingContext2D,
  field: Float64Array,
  period: number,
  baselineInTile: number,
  tileH: number,
  color: string,
  shift: number,
  drop: number,
): void {
  ctx.fillStyle = color;
  for (let x = 0; x < period; x++) {
    const s = (((x + shift) % period) + period) % period;
    const top = Math.round(baselineInTile - (field[s] ?? 0) + drop);
    if (top >= tileH) continue;
    ctx.fillRect(x, Math.max(0, top), 1, tileH - Math.max(0, top));
  }
}

/** The same, hanging from the top of the tile instead of standing on its bottom. */
function fillRidgeFlipped(
  ctx: CanvasRenderingContext2D,
  field: Float64Array,
  period: number,
  baselineInTile: number,
  color: string,
  shift: number,
  drop: number,
): void {
  ctx.fillStyle = color;
  for (let x = 0; x < period; x++) {
    const s = (((x + shift) % period) + period) % period;
    const bottom = Math.round(baselineInTile + (field[s] ?? 0) - drop);
    if (bottom <= 0) continue;
    ctx.fillRect(x, 0, 1, bottom);
  }
}

/**
 * A band of a different tone along a silhouette's own edge: the grass line on a hill,
 * the wet highlight on cave rock. One pass over the field, so it costs nothing.
 */
function capRidge(
  ctx: CanvasRenderingContext2D,
  field: Float64Array,
  period: number,
  baselineInTile: number,
  tileH: number,
  color: string,
  capPx: number,
  flipped: boolean,
): void {
  if (capPx <= 0) return;
  ctx.fillStyle = color;
  for (let x = 0; x < period; x++) {
    const h = field[x] ?? 0;
    const edge = flipped ? Math.round(baselineInTile + h) - capPx : Math.round(baselineInTile - h);
    if (edge + capPx <= 0 || edge >= tileH) continue;
    ctx.fillRect(x, Math.max(0, edge), 1, capPx);
  }
}

/**
 * Fill the union of a set of ellipses column by column, in three horizontal bands: a
 * lit cap, a mid body and a shaded underside. Clouds, tree canopies and dust are all
 * this shape, and doing it per column keeps every edge a hard pixel step rather than
 * an anti-aliased arc.
 */
function fillBlob(
  ctx: CanvasRenderingContext2D,
  lobes: Lobe[],
  x0: number,
  x1: number,
  light: string,
  mid: string,
  shade: string,
  litPx: number,
  shadePx: number,
): void {
  for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < lobes.length; i++) {
      const l = lobes[i];
      if (!l) continue;
      const dx = (x - l.cx) / l.rx;
      if (dx <= -1 || dx >= 1) continue;
      const dy = l.ry * Math.sqrt(1 - dx * dx);
      if (l.cy - dy < top) top = l.cy - dy;
      if (l.cy + dy > bottom) bottom = l.cy + dy;
    }
    if (bottom <= top) continue;
    const t = Math.round(top);
    const h = Math.max(1, Math.round(bottom) - t);
    ctx.fillStyle = mid;
    ctx.fillRect(x, t, 1, h);
    ctx.fillStyle = light;
    ctx.fillRect(x, t, 1, Math.min(litPx, h));
    if (h > litPx + 1) {
      ctx.fillStyle = shade;
      ctx.fillRect(x, t + h - Math.min(shadePx, h - litPx), 1, Math.min(shadePx, h - litPx));
    }
  }
}

export class BackgroundRenderer {
  private prepared: PreparedLayer[] = [];
  private viewW = 0;
  private viewH = 0;
  /**
   * Rendered frames since the layers were baked. Drift and tile cycling read it, so a
   * still camera still has weather; it is never fed back into anything simulated.
   */
  private frame = 0;

  constructor(private map: MapDef) {}

  setMap(map: MapDef): void {
    this.map = map;
    this.prepared = [];
    this.viewH = 0;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    // The background is the first thing the world draw paints, so this is where the
    // screen shake borrows the camera; `Effects.draw`, the last, gives it back.
    worldShake.beginWorldFrame(camera);
    const viewW = camera.viewWidth;
    const viewH = camera.viewHeight;
    if (viewH !== this.viewH || viewW !== this.viewW || this.prepared.length === 0) {
      this.viewW = viewW;
      this.viewH = viewH;
      this.prepare(viewW, viewH);
    }
    this.frame++;

    for (let i = 0; i < this.prepared.length; i++) {
      const prepared = this.prepared[i];
      if (!prepared) continue;
      const { layer } = prepared;
      if (layer.kind === 'plate') {
        this.drawPlate(ctx, layer, camera, viewW, viewH);
        continue;
      }
      if (prepared.tiles.length === 0) {
        this.drawBands(ctx, prepared, viewW, viewH);
        continue;
      }
      const which =
        prepared.tiles.length === 1
          ? 0
          : Math.floor(this.frame / prepared.frameTicks) % prepared.tiles.length;
      const tile = prepared.tiles[which] ?? prepared.tiles[0];
      if (!tile) continue;
      const shiftX = camera.offsetX * layer.parallax + this.frame * prepared.drift;
      const shiftY = camera.offsetY * layer.parallax;
      const y = Math.round(prepared.top - shiftY);
      const period = prepared.periodPx;
      let x = -(((shiftX % period) + period) % period);
      while (x < viewW) {
        ctx.drawImage(tile, Math.round(x), y);
        x += period;
      }
      if (prepared.fillAbove && y > 0) {
        ctx.fillStyle = prepared.fillAbove;
        ctx.fillRect(0, 0, viewW, y);
      }
      const bottom = y + prepared.tileH;
      if (prepared.fillBelow && bottom < viewH) {
        ctx.fillStyle = prepared.fillBelow;
        ctx.fillRect(0, bottom, viewW, viewH - bottom);
      }
    }
  }

  /**
   * One plate: placed by plain parallax (`PlateLayer` in shared has the arithmetic), in
   * whole pixels, then filled past its edges. A drifting plate wraps round and costs a
   * second draw where it does.
   */
  private drawPlate(
    ctx: CanvasRenderingContext2D,
    plate: PlateLayer,
    camera: Camera,
    viewW: number,
    viewH: number,
  ): void {
    const img = mapArtFor(this.map.id)?.plates.get(plate.src);
    if (!img) return;
    const y = Math.round(plate.y - camera.offsetY * plate.parallax);
    const drift = plate.drift ?? 0;
    let x = Math.round(plate.x - camera.offsetX * plate.parallax - this.frame * drift);
    if (drift !== 0) {
      x = -(((-x % plate.width) + plate.width) % plate.width);
      for (let dx = x; dx < viewW; dx += plate.width) ctx.drawImage(img, dx, y);
    } else {
      ctx.drawImage(img, x, y);
    }
    if (plate.fillAbove && y > 0) {
      ctx.fillStyle = plate.fillAbove;
      ctx.fillRect(0, 0, viewW, y);
    }
    const bottom = y + plate.height;
    if (plate.fillBelow && bottom < viewH) {
      ctx.fillStyle = plate.fillBelow;
      ctx.fillRect(0, bottom, viewW, viewH - bottom);
    }
  }

  /** Banded sky: flat blocks of colour, never a smooth CSS gradient. */
  private drawBands(
    ctx: CanvasRenderingContext2D,
    prepared: PreparedLayer,
    viewW: number,
    viewH: number,
  ): void {
    const bands = prepared.bands ?? [];
    if (bands.length === 0) return;
    const bandHeight = Math.ceil(viewH / bands.length);
    for (let i = 0; i < bands.length; i++) {
      ctx.fillStyle = bands[i] as string;
      ctx.fillRect(0, i * bandHeight, viewW, bandHeight);
    }
  }

  // ------------------------------------------------------------------------
  // Baking
  // ------------------------------------------------------------------------

  private prepare(viewW: number, viewH: number): void {
    const bg = clientConstants.background;
    const mapSeed = this.map.source.kind === 'procedural' ? this.map.source.seed : 1;
    this.prepared = [];
    this.frame = 0;
    for (let index = 0; index < this.map.background.length; index++) {
      const layer = this.map.background[index];
      if (!layer) continue;
      const salt = bg.seedSalt[index % bg.seedSalt.length] ?? 1;
      const rng = Prng.seed((mapSeed * 0x9e3779b1 + salt + index * 0x85ebca6b) >>> 0);
      const prepared = this.bake(layer, rng, viewW, viewH);
      if (layer.kind !== 'plate') {
        prepared.drift = layer.params.drift ?? 0;
        prepared.frameTicks = Math.max(1, Math.round(layer.params.frameTicks ?? 10));
      }
      this.prepared.push(prepared);
    }
  }

  private bake(layer: ParallaxLayer, rng: Prng, viewW: number, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const blank: PreparedLayer = {
      layer,
      tiles: [],
      periodPx: viewW,
      top: 0,
      tileH: viewH,
      fillAbove: null,
      fillBelow: null,
      drift: 0,
      frameTicks: 1,
    };

    switch (layer.kind) {
      case 'plate':
        // Drawn straight from its picture every frame; nothing to bake.
        return blank;
      case 'gradient': {
        const count = Math.max(2, Math.round(layer.params.stops ?? bg.skyBands));
        const total = Math.max(count, bg.skyBands);
        const bands: string[] = [];
        for (let i = 0; i < total; i++) bands.push(rampAt(layer.colors, i / (total - 1)));
        blank.bands = bands;
        return blank;
      }
      case 'mountains':
      case 'hills':
        return this.bakeRidge(layer, rng, viewH, layer.kind === 'mountains');
      case 'mesas':
        return this.bakeMesas(layer, rng, viewH);
      case 'caveWalls':
        return this.bakeCaveWalls(layer, rng, viewH);
      case 'clouds':
        return this.bakeClouds(layer, rng);
      case 'skyIslands':
        return this.bakeSkyIslands(layer, rng);
      case 'crystals':
        return this.bakeCrystals(layer, rng);
      case 'stars':
        return this.bakeStars(layer, rng);
      case 'celestial':
        return this.bakeCelestial(layer);
      case 'trees':
        return this.bakeTrees(layer, rng, viewH);
      case 'village':
        return this.bakeVillage(layer, rng, viewH);
      case 'birds':
        return this.bakeBirds(layer, rng);
      case 'cacti':
        return this.bakeCacti(layer, rng, viewH);
      case 'dust':
        return this.bakeDust(layer, rng);
      case 'fireflies':
        return this.bakeFireflies(layer, rng);
      default:
        return blank;
    }
  }

  /** A tile with the shared defaults filled in, so each baker returns one line. */
  private tiled(
    layer: DrawnLayer,
    tiles: HTMLCanvasElement[],
    periodPx: number,
    top: number,
    tileH: number,
    fill: { above?: string | null; below?: string | null } = {},
  ): PreparedLayer {
    return {
      layer,
      tiles,
      periodPx,
      top,
      tileH,
      fillAbove: fill.above ?? null,
      fillBelow: fill.below ?? null,
      drift: 0,
      frameTicks: 1,
    };
  }

  /** Mountains (sharpened, with snow caps) and rolling hills (rounded, grass-capped). */
  private bakeRidge(
    layer: DrawnLayer,
    rng: Prng,
    viewH: number,
    sharp: boolean,
  ): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.silhouettePeriodPx;
    const peak = layer.params.peakHeight ?? 150;
    const wavelength = layer.params.wavelength ?? bg.silhouetteStepPx;
    const baseline = viewH * (layer.params.baselineFraction ?? 0.8);

    const field = buildSilhouette(rng, period, wavelength, peak);
    addOctave(rng, field, period, Math.max(8, wavelength * 0.3), peak * bg.ridgeDetail);
    if (sharp) {
      // Convex remap: valleys sink, peaks stay, which reads as rock rather than dough.
      for (let x = 0; x < period; x++) {
        const h = Math.max(0, field[x] ?? 0);
        field[x] = (h * h) / Math.max(1, peak);
      }
    } else {
      for (let x = 0; x < period; x++) field[x] = Math.max(0, field[x] ?? 0) * 0.85;
    }

    const top = Math.max(0, Math.floor(baseline - peak - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = baseline - top;

    const back = colorAt(layer.colors, 1, '#888888');
    const front = colorAt(layer.colors, 0, '#666666');
    fillRidge(ctx, field, period, baselineInTile, tileH, back, Math.round(wavelength * 0.45), bg.ridgeBackDropPx);
    fillRidge(ctx, field, period, baselineInTile, tileH, front, 0, 0);
    // The lit edge of the front ridge: grass on a hill, a pale rim on a mountain.
    if (layer.colors.length > 2) {
      capRidge(ctx, field, period, baselineInTile, tileH, layer.colors[2] as string, bg.ridgeCapPx, false);
    }

    const snowLine = layer.params.snowLine ?? 0;
    if (snowLine > 0) {
      const snow = lerpColor(front, '#ffffff', bg.snowMix);
      ctx.fillStyle = snow;
      for (let x = 0; x < period; x++) {
        const h = field[x] ?? 0;
        if (h < peak * snowLine) continue;
        const ridgeTop = Math.round(baselineInTile - h);
        const depth = Math.round((h - peak * snowLine) * bg.snowDepth) + 1;
        ctx.fillRect(x, ridgeTop, 1, depth);
      }
    }

    return this.tiled(layer, [canvas], period, top, tileH, { below: front });
  }

  /** Flat-topped desert buttes with strata lines and a talus skirt. */
  private bakeMesas(layer: DrawnLayer, rng: Prng, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.silhouettePeriodPx;
    const baseline = viewH * (layer.params.baselineFraction ?? 0.85);
    const maxHeight = layer.params.maxHeight ?? 180;
    const minHeight = layer.params.minHeight ?? 80;
    const minWidth = layer.params.minWidth ?? 120;
    const maxWidth = layer.params.maxWidth ?? 260;
    const count = Math.max(1, Math.round(layer.params.count ?? 6));
    const strata = Math.max(0, Math.round(layer.params.strata ?? 2));

    const top = Math.max(0, Math.floor(baseline - maxHeight - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = baseline - top;
    const body = colorAt(layer.colors, 0, '#666666');
    const band = colorAt(layer.colors, 1, '#777777');
    const shade = colorAt(layer.colors, 2, body);

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const w = rng.nextRange(minWidth, maxWidth);
      const h = rng.nextRange(minHeight, maxHeight);
      const skirt = w * bg.mesaSkirt;
      const capTop = baselineInTile - h;
      // Two draws so a butte straddling the tile edge still wraps.
      for (let pass = -1; pass <= 1; pass++) {
        const x = cx + pass * period;
        if (x + w / 2 + skirt < 0 || x - w / 2 - skirt > period) continue;
        // Body: a trapezoid, widening toward the ground, with the sunless right third
        // in the darker tone so a butte has a lit side and a shadow side.
        const rows = Math.max(1, Math.round(h));
        for (let r = 0; r < rows; r++) {
          const t = r / rows;
          const halfW = w / 2 + skirt * t * t;
          const y = Math.round(capTop + r);
          if (y < 0 || y >= tileH) continue;
          ctx.fillStyle = body;
          ctx.fillRect(Math.round(x - halfW), y, Math.round(halfW * 2), 1);
          ctx.fillStyle = shade;
          ctx.fillRect(Math.round(x + halfW * 0.34), y, Math.round(halfW * 0.66), 1);
        }
        // Flat cap highlight and horizontal strata.
        ctx.fillStyle = band;
        ctx.fillRect(Math.round(x - w / 2), Math.round(capTop), Math.round(w), 2);
        for (let s = 1; s <= strata; s++) {
          const t = s / (strata + 1);
          const halfW = w / 2 + skirt * t * t;
          const y = Math.round(capTop + h * t);
          if (y < 0 || y >= tileH) continue;
          ctx.fillRect(Math.round(x - halfW), y, Math.round(halfW * 2), 1);
        }
      }
    }

    // Everything below the buttes is the same rock: fill the floor of the tile.
    ctx.fillStyle = body;
    ctx.fillRect(0, Math.round(baselineInTile), period, Math.max(0, tileH - Math.round(baselineInTile)));

    return this.tiled(layer, [canvas], period, top, tileH, { below: body });
  }

  /**
   * Cave rock: triangular teeth standing off the floor (`flip: 0`) or hanging from the
   * roof (`flip: 1`), the two of them framing the playfield in darkness. A third colour
   * lights the edge of the front teeth, which is what makes a stalactite read as a
   * shape rather than as a hole in the sky.
   */
  private bakeCaveWalls(layer: DrawnLayer, rng: Prng, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.silhouettePeriodPx;
    const peak = layer.params.peakHeight ?? 140;
    const wavelength = Math.max(20, layer.params.wavelength ?? 160);
    const baseline = viewH * (layer.params.baselineFraction ?? 0.9);
    const flipped = (layer.params.flip ?? 0) > 0.5;
    const count = Math.max(2, Math.round(period / wavelength));

    const field = buildTeeth(rng, period, count, peak, peak * bg.caveBaseFraction);
    const back = colorAt(layer.colors, 1, '#2a2745');
    const front = colorAt(layer.colors, 0, '#201c36');
    const lit = layer.colors.length > 2 ? (layer.colors[2] as string) : null;

    if (flipped) {
      const tileH = Math.max(1, Math.ceil(baseline + peak + bg.tileSlackPx));
      const { canvas, ctx } = createOffscreen(period, tileH);
      fillRidgeFlipped(ctx, field, period, baseline, back, Math.round(wavelength * 0.5), bg.ridgeBackDropPx);
      fillRidgeFlipped(ctx, field, period, baseline, front, 0, 0);
      if (lit) capRidge(ctx, field, period, baseline, tileH, lit, bg.ridgeCapPx - 1, true);
      return this.tiled(layer, [canvas], period, 0, tileH, { above: front });
    }

    const top = Math.max(0, Math.floor(baseline - peak - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = baseline - top;
    fillRidge(ctx, field, period, baselineInTile, tileH, back, Math.round(wavelength * 0.5), bg.ridgeBackDropPx);
    fillRidge(ctx, field, period, baselineInTile, tileH, front, 0, 0);
    if (lit) capRidge(ctx, field, period, baselineInTile, tileH, lit, bg.ridgeCapPx - 1, false);
    return this.tiled(layer, [canvas], period, top, tileH, { below: front });
  }

  /** Chunky pixel clouds: a union of lobes with a lit top and a shaded belly. */
  private bakeClouds(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 8));
    const minW = layer.params.minWidth ?? 60;
    const maxW = layer.params.maxWidth ?? 180;
    const bandTop = layer.params.bandTop ?? 30;
    const bandHeight = layer.params.bandHeight ?? 200;
    const aspect = layer.params.aspect ?? bg.cloudAspect;
    const tileH = Math.ceil(bandHeight + maxW * aspect + bg.tileSlackPx);
    const { canvas, ctx } = createOffscreen(period, tileH);

    const light = colorAt(layer.colors, 0, '#ffffff');
    const mid = colorAt(layer.colors, 1, light);
    const shade = colorAt(layer.colors, 2, mid);

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const w = rng.nextRange(minW, maxW);
      const h = Math.max(8, w * rng.nextRange(aspect * 0.7, aspect));
      // `baseY` is the cloud's flat underside: every lobe rests its bottom on it, so
      // the silhouette is bumpy on top and cut straight off below, which is what a
      // pixel-art cloud looks like and what stops the shape reading upside down.
      const baseY = rng.nextRange(0, bandHeight) + h;
      const lobeCount = rng.nextInt(4, 5);
      const lobes: Lobe[] = [];
      for (let l = 0; l < lobeCount; l++) {
        const t = l / Math.max(1, lobeCount - 1);
        // Tallest lobe left of centre, tapering to a tail on the right.
        const bias = 1 - Math.abs(t - 0.38) * 1.15;
        const ry = Math.max(3, h * rng.nextRange(0.6, 1) * bias);
        lobes.push({
          cx: cx - w / 2 + w * t,
          cy: baseY - ry,
          rx: (w / (lobeCount - 1)) * rng.nextRange(0.62, 0.95),
          ry,
        });
      }
      // A shallow slab across the whole width welds the lobes into one cloud.
      lobes.push({ cx, cy: baseY - h * 0.3, rx: w / 2, ry: h * 0.3 });
      for (let pass = -1; pass <= 1; pass++) {
        const shift = pass * period;
        if (cx + w + shift < 0 || cx - w + shift > period) continue;
        fillBlob(
          ctx,
          lobes.map((l) => ({ ...l, cx: l.cx + shift })),
          cx - w / 2 - 2 + shift,
          cx + w / 2 + 2 + shift,
          light,
          mid,
          shade,
          bg.cloudLitPx,
          bg.cloudShadePx,
        );
      }
    }

    return this.tiled(layer, [canvas], period, bandTop, tileH);
  }

  /**
   * Distant cousins of the playfield's floating masses: grass cap, rock keel, and — on
   * a map whose whole idea is falling — a waterfall pouring off the underside into
   * nothing.
   */
  private bakeSkyIslands(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 6));
    const minW = layer.params.minWidth ?? 60;
    const maxW = layer.params.maxWidth ?? 150;
    const bandTop = layer.params.bandTop ?? 60;
    const bandHeight = layer.params.bandHeight ?? 300;
    const falls = (layer.params.waterfalls ?? 0) > 0.5;
    const tileH = Math.ceil(
      bandHeight + maxW * bg.skyIslandDepth + (falls ? bg.waterfallFallPx + bg.waterfallSprayPx : 0) + bg.tileSlackPx,
    );
    const { canvas, ctx } = createOffscreen(period, tileH);

    const grass = colorAt(layer.colors, 0, '#7fae6a');
    const rock = colorAt(layer.colors, 1, '#8e8a9c');
    const shadow = colorAt(layer.colors, 2, '#6b6779');
    const water = colorAt(layer.colors, 3, '#bfe4f7');
    const foam = colorAt(layer.colors, 4, '#e8f6ff');
    const grassLit = colorAt(layer.colors, 5, grass);

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const w = rng.nextRange(minW, maxW);
      const y = rng.nextRange(0, bandHeight);
      const keel = w * rng.nextRange(bg.skyIslandDepth * 0.6, bg.skyIslandDepth);
      const capPx = Math.max(2, Math.round(w * bg.skyIslandCapFraction));
      const hasFall = falls && rng.nextFloat() < 0.5;
      const fallOffset = rng.nextRange(-0.3, 0.3) * w;
      const fallLength = rng.nextRange(bg.waterfallFallPx * 0.4, bg.waterfallFallPx);
      for (let pass = -1; pass <= 1; pass++) {
        const centre = cx + pass * period;
        if (centre + w < 0 || centre - w > period) continue;
        const half = w / 2;
        for (let dx = -Math.ceil(half); dx <= Math.ceil(half); dx++) {
          const u = dx / half;
          const s = 1 - u * u;
          if (s <= 0) continue;
          const x = Math.round(centre + dx);
          if (x < 0 || x >= period) continue;
          const depth = Math.max(1, Math.round(keel * s * s + capPx));
          ctx.fillStyle = rock;
          ctx.fillRect(x, Math.round(y), 1, depth);
          ctx.fillStyle = shadow;
          ctx.fillRect(x, Math.round(y + depth * 0.62), 1, Math.round(depth * 0.38));
          ctx.fillStyle = grass;
          ctx.fillRect(x, Math.round(y), 1, capPx);
          // Light from the top left: the left third of the cap catches it.
          if (u < -0.15) {
            ctx.fillStyle = grassLit;
            ctx.fillRect(x, Math.round(y), 1, Math.max(1, capPx - 1));
          }
        }
        if (!hasFall) continue;
        // The fall leaves the keel where the island is still thick, and frays out.
        const fx = Math.round(centre + fallOffset);
        const u = fallOffset / half;
        const keelBottom = Math.round(y + keel * (1 - u * u) ** 2 + capPx);
        const width = bg.waterfallWidthPx;
        for (let r = 0; r < fallLength; r++) {
          const t = r / fallLength;
          const wd = Math.max(1, Math.round(width * (1 - t * 0.5)));
          ctx.fillStyle = r < fallLength * 0.15 ? foam : water;
          ctx.fillRect(fx - (wd >> 1), keelBottom + r, wd, 1);
          if (r % 7 === 0 && r > fallLength * 0.3) {
            ctx.fillStyle = foam;
            ctx.fillRect(fx - (wd >> 1), keelBottom + r, 1, 1);
          }
        }
        // Spray: the fall does not end, it disperses.
        ctx.fillStyle = foam;
        for (let s = 0; s < bg.waterfallSprayPx; s++) {
          const sy = keelBottom + fallLength + s;
          const spread = 1 + s;
          ctx.fillRect(fx - spread, sy, 1, 1);
          ctx.fillRect(fx + spread, sy, 1, 1);
        }
      }
    }

    return this.tiled(layer, [canvas], period, bandTop, tileH);
  }

  /** Glowing crystal clusters on the cave walls: the only light in that map. */
  private bakeCrystals(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 10));
    const minSize = layer.params.minSize ?? 10;
    const maxSize = layer.params.maxSize ?? 30;
    const bandTop = layer.params.bandTop ?? 60;
    const bandHeight = layer.params.bandHeight ?? 380;
    const glow = layer.params.glow ?? bg.crystalGlowPx;
    const tileH = Math.ceil(bandHeight + maxSize * 3 + glow * 2 + bg.tileSlackPx);
    const { canvas, ctx } = createOffscreen(period, tileH);

    const body = colorAt(layer.colors, 0, '#5fd8f2');
    const dark = colorAt(layer.colors, 1, '#2a8fb8');
    const core = colorAt(layer.colors, 2, '#d6fbff');

    const shard = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      // A diamond drawn as scanlines, so it stays chunky at 1x.
      for (let r = 0; r < h; r++) {
        const t = r / h;
        const halfW = (t < 0.35 ? (t / 0.35) * (w / 2) : (1 - (t - 0.35) / 0.65) * (w / 2)) || 0;
        if (halfW <= 0) continue;
        ctx.fillRect(Math.round(x - halfW), Math.round(y + r), Math.max(1, Math.round(halfW * 2)), 1);
      }
    };

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const cy = rng.nextRange(0, bandHeight);
      const size = rng.nextRange(minSize, maxSize);
      const shards = rng.nextInt(2, 3);
      for (let pass = -1; pass <= 1; pass++) {
        const x = cx + pass * period;
        if (x + maxSize * 2 < 0 || x - maxSize * 2 > period) continue;
        // Halo: the same diamonds, fatter and faint, so the light bleeds into the rock
        // instead of sitting in a visible box.
        ctx.globalAlpha = bg.crystalGlowAlpha;
        for (let s = 0; s < shards; s++) {
          const offset = (s - (shards - 1) / 2) * size * 0.7;
          const h = size * (1.6 + s * 0.25);
          shard(x + offset, cy + size * 0.2 * s - glow, size * 0.8 + glow * 2, h + glow * 2, body);
        }
        ctx.globalAlpha = 1;
        for (let s = 0; s < shards; s++) {
          const offset = (s - (shards - 1) / 2) * size * 0.7;
          const h = size * (1.6 + s * 0.25);
          shard(x + offset, cy + size * 0.2 * s, size * 0.8, h, s === 0 ? body : dark);
          shard(x + offset, cy + size * 0.2 * s, size * 0.3, h * 0.8, core);
        }
      }
    }

    return this.tiled(layer, [canvas], period, bandTop, tileH);
  }

  private bakeStars(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.starPeriodPx;
    const density = layer.params.density ?? bg.starDensity;
    const bandHeight = layer.params.bandHeight ?? 260;
    const count = Math.max(1, Math.round(density * 40));
    const tileH = Math.ceil(bandHeight + bg.tileSlackPx);
    const { canvas, ctx } = createOffscreen(period, tileH);
    ctx.fillStyle = colorAt(layer.colors, 0, '#ffffff');
    for (let i = 0; i < count; i++) {
      const x = Math.round(rng.nextRange(0, period));
      const y = Math.round(rng.nextRange(0, bandHeight));
      const size = rng.nextInt(1, 2);
      ctx.fillRect(x, y, size, size);
    }
    return this.tiled(layer, [canvas], period, layer.params.bandTop ?? 0, tileH);
  }

  /**
   * The one big thing in the sky: the hills' sun, the chasm's setting sun, the isles'
   * moon. Rings of halo, a disc, then either craters (moon), horizontal bands (a sun
   * low enough to be striped by haze) or a ring of rays.
   */
  private bakeCelestial(layer: DrawnLayer): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const radius = layer.params.radiusPx ?? 30;
    const glow = layer.params.glowPx ?? 16;
    const bandTop = layer.params.bandTop ?? 60;
    const centre = period * (layer.params.centreFraction ?? 0.5);
    const craters = Math.max(0, Math.round(layer.params.craters ?? 0));
    const bands = Math.max(0, Math.round(layer.params.bands ?? 0));
    const rays = (layer.params.rays ?? 0) > 0.5;
    const tileH = Math.ceil((radius + glow) * 2 + bg.tileSlackPx);
    const { canvas, ctx } = createOffscreen(period, tileH);
    const cy = radius + glow;

    const core = colorAt(layer.colors, 0, '#ffffff');
    const body = colorAt(layer.colors, 1, core);
    const edge = colorAt(layer.colors, 2, body);

    // Halo, painted outwards in a handful of faint rings.
    ctx.fillStyle = edge;
    for (let i = bg.celestialGlowRings; i > 0; i--) {
      // Fainter the further out, so the halo fades instead of ending on a hard circle.
      ctx.globalAlpha = (bg.celestialGlowAlpha * (bg.celestialGlowRings - i + 1)) / bg.celestialGlowRings;
      const r = radius + (glow * i) / bg.celestialGlowRings;
      ctx.beginPath();
      ctx.arc(centre, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (rays) {
      ctx.globalAlpha = bg.celestialGlowAlpha * 2;
      ctx.fillStyle = core;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rx = Math.cos(a);
        const ry = Math.sin(a);
        for (let d = radius + 2; d < radius + glow * 1.6; d++) {
          const t = (d - radius) / (glow * 1.6);
          const wdt = Math.max(1, Math.round(4 * (1 - t)));
          ctx.fillRect(Math.round(centre + rx * d), Math.round(cy + ry * d), wdt, wdt);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Disc: body, with the top-left lit and the bottom-right in the darker tone.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(centre, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(centre - radius * 0.22, cy - radius * 0.24, radius * 0.62, 0, Math.PI * 2);
    ctx.fill();

    if (bands > 0) {
      // A sun near the horizon, cut by bands of haze.
      ctx.fillStyle = edge;
      for (let i = 1; i <= bands; i++) {
        const y = Math.round(cy - radius + ((i * 2 - 0.5) * radius * 2) / (bands * 2 + 1));
        ctx.fillRect(Math.round(centre - radius), y, radius * 2, 2);
      }
    }
    for (let i = 0; i < craters; i++) {
      // Deterministic craters: a fixed spiral, not a draw, so the moon never re-rolls.
      const a = i * 2.39996;
      const d = radius * 0.62 * Math.sqrt((i + 0.5) / craters);
      const r = Math.max(2, radius * 0.16 * (1 - i / (craters * 2)));
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(centre + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }

    return this.tiled(layer, [canvas], period, bandTop, tileH);
  }

  /** A tree line: trunks under canopies of stacked lobes, on a band of ground. */
  private bakeTrees(layer: DrawnLayer, rng: Prng, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 20));
    const minH = layer.params.minHeight ?? 30;
    const maxH = layer.params.maxHeight ?? 70;
    const baseline = viewH * (layer.params.baselineFraction ?? 0.88);
    const top = Math.max(0, Math.floor(baseline - maxH - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = baseline - top;

    const dark = colorAt(layer.colors, 0, '#2f6238');
    const mid = colorAt(layer.colors, 1, dark);
    const light = colorAt(layer.colors, 2, mid);
    const trunk = colorAt(layer.colors, 3, '#3a2b1e');
    const ground = colorAt(layer.colors, 4, dark);

    const groundTop = Math.round(baselineInTile);
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundTop, period, Math.max(0, tileH - groundTop));
    ctx.fillStyle = light;
    ctx.fillRect(0, groundTop, period, 2);

    // Hedgerows: a few wandering darker lines across the pasture below the tree line,
    // so the band is fields rather than one flat plane of green.
    const rows = Math.max(0, Math.round(layer.params.hedges ?? 0));
    for (let r = 0; r < rows; r++) {
      // Near the top of the band: further down is behind the playfield's own ground.
      const y = groundTop + Math.round((0.05 + r * 0.09) * Math.max(1, tileH - groundTop));
      let wobble = 0;
      for (let x = 0; x < period; x++) {
        if (rng.nextFloat() < 0.04) wobble += rng.nextFloat() < 0.5 ? -1 : 1;
        ctx.fillStyle = r % 2 === 0 ? dark : mid;
        ctx.fillRect(x, y + wobble, 1, 1);
      }
    }

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const h = rng.nextRange(minH, maxH);
      const w = h * rng.nextRange(0.44, 0.62);
      const foot = baselineInTile + rng.nextRange(-2, 3);
      for (let pass = -1; pass <= 1; pass++) {
        const x = cx + pass * period;
        if (x + w < 0 || x - w > period) continue;
        ctx.fillStyle = trunk;
        ctx.fillRect(Math.round(x - bg.treeTrunkPx / 2), Math.round(foot - h * 0.45), bg.treeTrunkPx, Math.round(h * 0.45));
        const lobes: Lobe[] = [];
        for (let l = 0; l < bg.treeBlobs; l++) {
          const t = l / Math.max(1, bg.treeBlobs - 1);
          lobes.push({
            cx: x + (l % 2 === 0 ? -1 : 1) * w * 0.14,
            cy: foot - h * (0.42 + t * 0.44),
            rx: (w / 2) * (1 - t * 0.42),
            ry: h * 0.2 * (1 - t * 0.2),
          });
        }
        fillBlob(ctx, lobes, x - w / 2 - 1, x + w / 2 + 1, light, mid, dark, 3, 4);
      }
    }

    return this.tiled(layer, [canvas], period, top, tileH, { below: ground });
  }

  /** A village on the far ridge: gabled houses, lit windows, one church spire. */
  private bakeVillage(layer: DrawnLayer, rng: Prng, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 6));
    const minW = layer.params.minWidth ?? 20;
    const maxW = layer.params.maxWidth ?? 38;
    const spirePx = layer.params.spirePx ?? 50;
    const baseline = viewH * (layer.params.baselineFraction ?? 0.85);
    const top = Math.max(0, Math.floor(baseline - spirePx - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = Math.round(baseline - top);

    const wallDark = colorAt(layer.colors, 0, '#6b4636');
    const wallLight = colorAt(layer.colors, 1, wallDark);
    const roof = colorAt(layer.colors, 2, '#3f4a5c');
    const lamp = colorAt(layer.colors, 3, '#ffcf4d');
    const ground = colorAt(layer.colors, 4, wallDark);

    ctx.fillStyle = ground;
    ctx.fillRect(0, baselineInTile, period, Math.max(0, tileH - baselineInTile));

    // The houses cluster around one point of the tile rather than spreading evenly —
    // a village, not a terrace.
    const centre = rng.nextRange(period * 0.2, period * 0.8);
    const church = rng.nextInt(0, count - 1);
    for (let i = 0; i < count; i++) {
      const w = Math.round(rng.nextRange(minW, maxW));
      const h = Math.round(w * rng.nextRange(0.7, 1.05));
      const x = Math.round(centre + rng.nextRange(-1, 1) * period * 0.09);
      const isChurch = i === church;
      const roofH = Math.max(4, Math.round(w * 0.42));
      const bodyTop = baselineInTile - h;

      // Walls: lit on the left, in shadow on the right.
      ctx.fillStyle = wallLight;
      ctx.fillRect(x - (w >> 1), bodyTop, w, h);
      ctx.fillStyle = wallDark;
      ctx.fillRect(x + Math.round(w * 0.12), bodyTop, Math.round(w * 0.38), h);

      // Roof: a pitched triangle drawn as scanlines, apex at the ridge and widening
      // down to an overhang past the walls.
      ctx.fillStyle = roof;
      for (let r = 0; r < roofH; r++) {
        const half = Math.max(1, Math.round(((w / 2 + 2) * (r + 1)) / roofH));
        ctx.fillRect(x - half, bodyTop - roofH + r, half * 2, 1);
      }

      // One lit window, and a chimney on the taller houses.
      if (rng.nextFloat() < bg.villageLitFraction) {
        ctx.fillStyle = lamp;
        ctx.fillRect(x - (w >> 2), bodyTop + Math.round(h * 0.34), bg.villageWindowPx, bg.villageWindowPx);
      }
      if (!isChurch && h > w * 0.85) {
        ctx.fillStyle = wallDark;
        ctx.fillRect(x + Math.round(w * 0.3), bodyTop - roofH - 4, 3, 6);
      }

      if (isChurch) {
        // A spire over the gable, with a lit belfry slit.
        const spireBase = bodyTop - roofH;
        const towerW = Math.max(5, Math.round(w * 0.3));
        const towerH = Math.round(spirePx - h - roofH);
        if (towerH > 4) {
          ctx.fillStyle = wallLight;
          ctx.fillRect(x - (towerW >> 1), spireBase - towerH, towerW, towerH);
          ctx.fillStyle = roof;
          for (let r = 0; r < towerW; r++) {
            const half = Math.max(0, Math.round((towerW / 2) * ((r + 1) / towerW)));
            ctx.fillRect(x - half, spireBase - towerH - towerW + r, half * 2 + 1, 1);
          }
          ctx.fillStyle = lamp;
          ctx.fillRect(x - 1, spireBase - towerH + 3, 2, 3);
        }
      }
    }

    return this.tiled(layer, [canvas], period, top, tileH, { below: ground });
  }

  /** Two tiles of flocks, cycled: wings up, wings down. */
  private bakeBirds(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const flocks = Math.max(1, Math.round(layer.params.flocks ?? 4));
    const minBirds = Math.max(1, Math.round(layer.params.minBirds ?? 3));
    const maxBirds = Math.max(minBirds, Math.round(layer.params.maxBirds ?? 6));
    const bandTop = layer.params.bandTop ?? 60;
    const bandHeight = layer.params.bandHeight ?? 160;
    const tileH = Math.ceil(bandHeight + bg.birdSpanPx * 2 + bg.tileSlackPx);
    const ink = colorAt(layer.colors, 0, '#2f4457');

    // Both frames come off the same positions, so only the wings move.
    const birds: { x: number; y: number; span: number }[] = [];
    for (let f = 0; f < flocks; f++) {
      const fx = rng.nextRange(0, period);
      const fy = rng.nextRange(0, bandHeight);
      const n = rng.nextInt(minBirds, maxBirds);
      for (let i = 0; i < n; i++) {
        birds.push({
          x: fx + rng.nextRange(-26, 26),
          y: fy + rng.nextRange(-14, 14),
          span: Math.max(2, Math.round(bg.birdSpanPx * rng.nextRange(0.6, 1.2))),
        });
      }
    }

    const tiles: HTMLCanvasElement[] = [];
    for (let frame = 0; frame < 2; frame++) {
      const { canvas, ctx } = createOffscreen(period, tileH);
      ctx.fillStyle = ink;
      const droop = frame === 0 ? 0 : bg.birdFlapPx;
      for (const b of birds) {
        for (let pass = -1; pass <= 1; pass++) {
          const x = Math.round(b.x + pass * period);
          if (x + b.span < 0 || x - b.span > period) continue;
          const y = Math.round(b.y) + bg.birdSpanPx;
          ctx.fillRect(x, y + droop, 1, 1);
          for (let i = 1; i <= b.span; i++) {
            // Wings up is a V; wings down flattens it and drops the tips.
            const lift = frame === 0 ? i : Math.max(0, i - 2);
            ctx.fillRect(x - i, y - lift + droop, 1, 1);
            ctx.fillRect(x + i, y - lift + droop, 1, 1);
          }
        }
      }
      tiles.push(canvas);
    }

    return this.tiled(layer, tiles, period, bandTop, tileH);
  }

  /** Saguaros and rocks along the chasm's far rim, with a flower on a few. */
  private bakeCacti(layer: DrawnLayer, rng: Prng, viewH: number): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 10));
    const rocks = Math.max(0, Math.round(layer.params.rocks ?? 6));
    const minH = layer.params.minHeight ?? 30;
    const maxH = layer.params.maxHeight ?? 80;
    const baseline = viewH * (layer.params.baselineFraction ?? 0.9);
    const top = Math.max(0, Math.floor(baseline - maxH - bg.tileSlackPx));
    const tileH = Math.max(1, Math.ceil(viewH - top));
    const { canvas, ctx } = createOffscreen(period, tileH);
    const baselineInTile = Math.round(baseline - top);

    const dark = colorAt(layer.colors, 0, '#2e4433');
    const light = colorAt(layer.colors, 1, dark);
    const ground = colorAt(layer.colors, 2, dark);
    const flower = colorAt(layer.colors, 3, light);

    ctx.fillStyle = ground;
    ctx.fillRect(0, baselineInTile, period, Math.max(0, tileH - baselineInTile));

    for (let i = 0; i < rocks; i++) {
      const x = Math.round(rng.nextRange(0, period));
      const w = Math.round(rng.nextRange(7, 20));
      const h = Math.round(w * rng.nextRange(0.35, 0.6));
      ctx.fillStyle = dark;
      for (let r = 0; r < h; r++) {
        const half = Math.round((w / 2) * Math.sqrt(1 - (r / h) ** 2));
        ctx.fillRect(x - half, baselineInTile - r, half * 2, 1);
      }
    }

    const stem = (x: number, footY: number, h: number, w: number): void => {
      ctx.fillStyle = dark;
      ctx.fillRect(Math.round(x - w / 2), Math.round(footY - h), w, Math.round(h));
      ctx.fillStyle = light;
      ctx.fillRect(Math.round(x - w / 2), Math.round(footY - h), Math.max(1, Math.round(w * 0.4)), Math.round(h));
      // Rounded crown.
      ctx.fillStyle = light;
      ctx.fillRect(Math.round(x - w / 2) + 1, Math.round(footY - h) - 1, Math.max(1, w - 2), 1);
      // Ribs: one darker line every few px, which is the whole read at this size.
      ctx.fillStyle = dark;
      for (let rx = 1; rx < w; rx += bg.cactusRibPx) {
        ctx.fillRect(Math.round(x - w / 2) + rx, Math.round(footY - h) + 1, 1, Math.round(h) - 1);
      }
    };

    for (let i = 0; i < count; i++) {
      const cx = rng.nextRange(0, period);
      const h = rng.nextRange(minH, maxH);
      const w = Math.max(5, Math.round(h * 0.14));
      const armUp = rng.nextFloat() < 0.8;
      const armSide = rng.nextSign();
      const hasFlower = rng.nextFloat() < 0.3;
      for (let pass = -1; pass <= 1; pass++) {
        const x = cx + pass * period;
        if (x + bg.cactusArmPx * 2 < 0 || x - bg.cactusArmPx * 2 > period) continue;
        stem(x, baselineInTile + 1, h, w);
        if (armUp) {
          const armY = baselineInTile + 1 - h * rng.nextRange(0.42, 0.62);
          const reach = bg.cactusArmPx;
          ctx.fillStyle = dark;
          ctx.fillRect(Math.round(armSide > 0 ? x : x - reach), Math.round(armY), reach, Math.max(3, w - 1));
          stem(x + armSide * reach, armY + w, h * 0.3, Math.max(4, w - 1));
        }
        if (hasFlower) {
          ctx.fillStyle = flower;
          ctx.fillRect(Math.round(x - 1), Math.round(baselineInTile + 1 - h) - 3, 3, 2);
        }
      }
    }

    return this.tiled(layer, [canvas], period, top, tileH, { below: ground });
  }

  /** Streaks of blown sand, baked faint so they wash over the rock behind them. */
  private bakeDust(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 30));
    const minW = layer.params.minWidth ?? 12;
    const maxW = layer.params.maxWidth ?? 50;
    const bandTop = layer.params.bandTop ?? 200;
    const bandHeight = layer.params.bandHeight ?? 250;
    const tileH = Math.ceil(bandHeight + bg.tileSlackPx);
    const { canvas, ctx } = createOffscreen(period, tileH);

    const pale = colorAt(layer.colors, 0, '#e8b27f');
    const deep = colorAt(layer.colors, 1, pale);

    ctx.globalAlpha = bg.dustAlpha;
    for (let i = 0; i < count; i++) {
      const x = Math.round(rng.nextRange(0, period));
      const y = Math.round(rng.nextRange(0, bandHeight));
      const w = Math.round(rng.nextRange(minW, maxW));
      const h = rng.nextInt(1, 2);
      ctx.fillStyle = rng.nextFloat() < 0.6 ? pale : deep;
      ctx.fillRect(x, y, w, h);
      // A comma of a tail, so a streak has a direction.
      ctx.fillRect(x + w, y + (rng.nextFloat() < 0.5 ? -1 : 1), Math.round(w * 0.35), 1);
    }
    ctx.globalAlpha = 1;

    return this.tiled(layer, [canvas], period, bandTop, tileH);
  }

  /** Fireflies: the same dots in every tile, lit in a different rotating third. */
  private bakeFireflies(layer: DrawnLayer, rng: Prng): PreparedLayer {
    const bg = clientConstants.background;
    const period = bg.spritePeriodPx;
    const count = Math.max(1, Math.round(layer.params.count ?? 30));
    const bandTop = layer.params.bandTop ?? 100;
    const bandHeight = layer.params.bandHeight ?? 320;
    const tileH = Math.ceil(bandHeight + bg.fireflyGlowPx * 2 + bg.tileSlackPx);

    const core = colorAt(layer.colors, 0, '#b9ffa8');
    const mid = colorAt(layer.colors, 1, core);
    const warm = colorAt(layer.colors, 2, core);

    const flies: { x: number; y: number; phase: number; warm: boolean; wobble: number }[] = [];
    for (let i = 0; i < count; i++) {
      flies.push({
        x: rng.nextRange(0, period),
        y: rng.nextRange(0, bandHeight),
        phase: rng.nextInt(0, bg.fireflyFrames - 1),
        warm: rng.nextFloat() < 0.3,
        wobble: rng.nextInt(0, 3),
      });
    }

    const tiles: HTMLCanvasElement[] = [];
    for (let frame = 0; frame < bg.fireflyFrames; frame++) {
      const { canvas, ctx } = createOffscreen(period, tileH);
      for (const f of flies) {
        const lit = (frame + f.phase) % bg.fireflyFrames;
        if (lit > 1) continue;
        const x = Math.round(f.x + (f.wobble % 2 === 0 ? frame : -frame));
        const y = Math.round(f.y) + bg.fireflyGlowPx + (f.wobble < 2 ? frame : -frame);
        // A faint halo so the light looks like it is in the air, then the spark.
        ctx.globalAlpha = lit === 0 ? 0.34 : 0.18;
        ctx.fillStyle = f.warm ? warm : mid;
        ctx.fillRect(x - bg.fireflyGlowPx, y - bg.fireflyGlowPx, bg.fireflyGlowPx * 2 + 1, bg.fireflyGlowPx * 2 + 1);
        ctx.globalAlpha = lit === 0 ? 1 : 0.6;
        ctx.fillStyle = f.warm ? warm : core;
        const size = lit === 0 ? 2 : 1;
        ctx.fillRect(x, y, size, size);
      }
      ctx.globalAlpha = 1;
      tiles.push(canvas);
    }

    return this.tiled(layer, tiles, period, bandTop, tileH);
  }
}
