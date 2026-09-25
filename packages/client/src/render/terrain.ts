/**
 * Terrain rendering (DESIGN §1.3 render/terrain.ts): the Uint8Array mask is baked once
 * into a full-size offscreen canvas and then blitted per frame as a single source-rect
 * draw. Carves repaint only their own dirty rect.
 *
 * Banding follows the map palette: a 1 px lit highlight on top of every solid run, then
 * a crust band, a soil band and deep soil, each of them an ordered 4x4 dither between a
 * light and a dark tone so the ground has texture instead of three flat stripes. Deep
 * soil is speckled and cave rock is cracked from a hash of the pixel's own coordinates,
 * which is what stops a 200 px slab reading as a painted rectangle.
 *
 * On top of the bands sit the map's own decorations (`palette.detail`): grass tufts on
 * the hills, rock studs in the chasm, grass and hanging roots under the isles, crystal
 * glints in the cave. They are *planted*, not scattered — a hash of the column and of
 * the surface height at that column decides both — so repainting a dirty rect puts back
 * exactly what was there, no decoration list is kept, and nothing has to be re-sorted
 * when the ground changes shape.
 *
 * A carve flags every pixel it touches as charred (`scorch`), and an exposed edge
 * inside the flag is drawn in the map's ember rim over a charred core and grows
 * nothing: a fresh hole looks blasted rather than freshly landscaped.
 *
 * A painted map (DESIGN §8.1) skips all of that: its ground is a picture,
 * `public/maps/<id>/terrain.png`, whose alpha is exactly the mask, and a solid pixel is
 * simply that picture's pixel. A carve clears the pixels it removed (they are air in the
 * mask now) and draws the same ember rim and charred core on the new edge, measured as
 * the distance to the nearest air along the four axes so a crater's walls burn as well
 * as its floor. Nothing ever adds ground, so the picture only ever needs clearing. Until
 * the picture arrives, or if it never does, the map is painted with bands like any other.
 *
 * A map with a ceiling (DESIGN §8: `cave`) is banded from the *underside* of the
 * hanging slab and painted with `palette.ceiling`, which is why a column is scanned run
 * by run rather than pixel by pixel: a run's tones depend on which of its two ends is
 * the exposed one. Because a carve gives the pixels below it fresh air above them,
 * their banding restarts — so the dirty rect is grown by `repaintMarginPx`, which is
 * more than the full band height.
 */
import type { Terrain, TerrainPalette } from '@gunbros/shared';
import { createOffscreen } from './canvas.js';
import type { Camera } from './camera.js';
import { clientConstants } from '../data/clientConstants.js';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The six tones (three light/dark pairs) plus the highlight a run is drawn with. */
interface Tones {
  highlight: Rgb;
  crust: Rgb;
  crustDark: Rgb;
  soil: Rgb;
  soilDark: Rgb;
  deep: Rgb;
  deepDark: Rgb;
}

/** What `palette.detail` declares: a decoration kind, its three tones and a density. */
type TerrainDetail = NonNullable<TerrainPalette['detail']>;

/** The same, with the tones resolved to bytes once per map. */
interface DetailTones {
  kind: TerrainDetail['kind'];
  light: Rgb;
  mid: Rgb;
  dark: Rgb;
  density: number;
}

/** '#rgb' or '#rrggbb' into bytes. Unknown formats fall back to mid grey. */
export function parseHexColor(hex: string): Rgb {
  const raw = hex.trim().replace('#', '');
  if (raw.length === 3) {
    const r = Number.parseInt(raw.slice(0, 1).repeat(2), 16);
    const g = Number.parseInt(raw.slice(1, 2).repeat(2), 16);
    const b = Number.parseInt(raw.slice(2, 3).repeat(2), 16);
    return { r, g, b };
  }
  if (raw.length >= 6) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
    };
  }
  return { r: 128, g: 128, b: 128 };
}

function darken(c: Rgb, factor: number): Rgb {
  return {
    r: Math.max(0, Math.round(c.r * factor)),
    g: Math.max(0, Math.round(c.g * factor)),
    b: Math.max(0, Math.round(c.b * factor)),
  };
}

/**
 * A stable hash of two integers into [0, 1). Decoration placement runs off this and
 * never off a generator, so the same column of the same surface always grows the same
 * tuft however many times its dirty rect is repainted.
 */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 12)) >>> 0;
  return h / 4294967296;
}

/** A palette written before the texture pass has no dark tones; derive them. */
function tonesFrom(
  source: {
    outline: string;
    crust: string;
    crustDark?: string;
    soil: string;
    soilDark?: string;
    deep: string;
    deepDark?: string;
  },
  shade: number,
): Tones {
  const crust = parseHexColor(source.crust);
  const soil = parseHexColor(source.soil);
  const deep = parseHexColor(source.deep);
  return {
    highlight: parseHexColor(source.outline),
    crust,
    crustDark: source.crustDark ? parseHexColor(source.crustDark) : darken(crust, shade),
    soil,
    soilDark: source.soilDark ? parseHexColor(source.soilDark) : darken(soil, shade),
    deep,
    deepDark: source.deepDark ? parseHexColor(source.deepDark) : darken(deep, shade),
  };
}

function detailTonesFrom(detail: TerrainDetail): DetailTones {
  const light = parseHexColor(detail.colors[0] ?? '#ffffff');
  return {
    kind: detail.kind,
    light,
    mid: detail.colors[1] ? parseHexColor(detail.colors[1]) : darken(light, 0.8),
    dark: detail.colors[2] ? parseHexColor(detail.colors[2]) : darken(light, 0.55),
    density: detail.density,
  };
}

const AIR = 0;
const GROUND = 1;
const CEILING = 2;

/** `scorch` byte: 0 is untouched rock, this is rock a blast has been through. */
const BURNT = 1;

export class TerrainRenderer {
  private surface: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };
  private ground: Tones;
  private ceiling: Tones;
  private hasCeiling = false;
  private ceilingSplitY = 0;
  private detail: DetailTones | null = null;
  private scorchRim: Rgb | null = null;
  private scorchCore: Rgb | null = null;
  /** One byte per map pixel: has a blast been through here? */
  private scorch: Uint8Array;
  /** Per-column scratch: what each pixel of the column is and how deep into its run. */
  private kind: Uint8Array;
  private depth: Uint16Array;
  private readonly highlightEnd: number;
  private readonly crustEnd: number;
  private readonly soilEnd: number;
  /** A painted map's picture (map sized), or null to paint bands. */
  private art: ImageData | null = null;

  constructor(
    private terrain: Terrain,
    palette: TerrainPalette,
    art: ImageData | null = null,
  ) {
    const t = clientConstants.terrain;
    this.highlightEnd = t.outlinePx;
    this.crustEnd = t.outlinePx + t.crustPx;
    this.soilEnd = t.outlinePx + t.crustPx + t.soilPx;
    this.ground = tonesFrom(palette, t.deriveShade);
    this.ceiling = this.ground;
    this.kind = new Uint8Array(terrain.height);
    this.depth = new Uint16Array(terrain.height);
    this.scorch = new Uint8Array(terrain.width * terrain.height);
    this.surface = createOffscreen(terrain.width, terrain.height);
    this.art = this.fits(art) ? art : null;
    this.applyPalette(palette);
    this.repaintAll();
  }

  /** Is `art` a picture of this terrain? A stale or mis-sized export is ignored. */
  private fits(art: ImageData | null): art is ImageData {
    return art !== null && art.width === this.terrain.width && art.height === this.terrain.height;
  }

  /**
   * The painted picture arrived (or went away): repaint everything from it. Carves made
   * in the meantime are already in the mask and the scorch flags, so they survive.
   */
  setArt(art: ImageData | null): void {
    const next = this.fits(art) ? art : null;
    if (next === this.art) return;
    this.art = next;
    this.repaintAll();
  }

  get hasArt(): boolean {
    return this.art !== null;
  }

  /** Swap in a freshly generated map (the sandbox's N key, or a new match). */
  setTerrain(terrain: Terrain, palette: TerrainPalette, art: ImageData | null = null): void {
    const sameSize = terrain.width === this.terrain.width && terrain.height === this.terrain.height;
    this.terrain = terrain;
    if (!sameSize) {
      this.surface = createOffscreen(terrain.width, terrain.height);
      this.kind = new Uint8Array(terrain.height);
      this.depth = new Uint16Array(terrain.height);
    }
    // A new map is unburnt whatever the old one looked like.
    this.scorch = new Uint8Array(terrain.width * terrain.height);
    this.art = this.fits(art) ? art : null;
    this.applyPalette(palette);
    this.repaintAll();
  }

  private applyPalette(palette: TerrainPalette): void {
    const t = clientConstants.terrain;
    this.ground = tonesFrom(palette, t.deriveShade);
    this.hasCeiling = palette.ceiling !== undefined;
    this.ceiling = palette.ceiling ? tonesFrom(palette.ceiling, t.deriveShade) : this.ground;
    this.ceilingSplitY = this.terrain.height * t.ceilingSplitFraction;
    this.detail = palette.detail ? detailTonesFrom(palette.detail) : null;
    this.scorchRim = palette.scorch ? parseHexColor(palette.scorch.rim) : null;
    this.scorchCore = palette.scorch ? parseHexColor(palette.scorch.core) : null;
  }

  get width(): number {
    return this.terrain.width;
  }

  get height(): number {
    return this.terrain.height;
  }

  repaintAll(): void {
    this.paintRect(0, 0, this.terrain.width, this.terrain.height);
  }

  /** Repaint around a carve circle (driven by the `carve` SimEvent). */
  patchCircle(cx: number, cy: number, r: number): void {
    this.burnCircle(cx, cy, r);
    const margin = r + clientConstants.terrain.repaintMarginPx;
    const x0 = Math.floor(cx - margin);
    const y0 = Math.floor(cy - margin);
    const x1 = Math.ceil(cx + margin);
    const y1 = Math.ceil(cy + margin);
    this.paintRect(x0, y0, x1, y1);
  }

  /** Flag the rock a blast has been through, so its new edges are drawn charred. */
  private burnCircle(cx: number, cy: number, r: number): void {
    const w = this.terrain.width;
    const h = this.terrain.height;
    const reach = r + clientConstants.terrain.scorch.marginPx;
    const left = Math.max(0, Math.floor(cx - reach));
    const right = Math.min(w - 1, Math.ceil(cx + reach));
    const top = Math.max(0, Math.floor(cy - reach));
    const bottom = Math.min(h - 1, Math.ceil(cy + reach));
    const reachSq = reach * reach;
    for (let y = top; y <= bottom; y++) {
      const dy = y - cy;
      for (let x = left; x <= right; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy <= reachSq) this.scorch[y * w + x] = BURNT;
      }
    }
  }

  /**
   * Walk one column top to bottom, splitting it into solid runs. A run that starts at
   * the very top of the map — or, on a map with a ceiling palette, one that ends in its
   * upper part — is a hanging slab and is measured from its bottom edge up; everything
   * else is ground and is measured from its top edge down.
   */
  private scanColumn(x: number): void {
    const w = this.terrain.width;
    const h = this.terrain.height;
    const mask = this.terrain.mask;
    const kind = this.kind;
    const depth = this.depth;
    let y = 0;
    while (y < h) {
      if (mask[y * w + x] !== 1) {
        kind[y] = AIR;
        y++;
        continue;
      }
      const start = y;
      while (y < h && mask[y * w + x] === 1) y++;
      const end = y - 1;
      const hanging = this.isHangingRun(start, end);
      if (hanging) {
        for (let yy = end; yy >= start; yy--) {
          kind[yy] = CEILING;
          depth[yy] = Math.min(0xffff, end - yy);
        }
      } else {
        for (let yy = start; yy <= end; yy++) {
          kind[yy] = GROUND;
          depth[yy] = Math.min(0xffff, yy - start);
        }
      }
    }
  }

  private isHangingRun(start: number, end: number): boolean {
    return this.hasCeiling && (start === 0 || end < this.ceilingSplitY);
  }

  private isSolid(x: number, y: number): boolean {
    const w = this.terrain.width;
    if (x < 0 || y < 0 || x >= w || y >= this.terrain.height) return false;
    return this.terrain.mask[y * w + x] === 1;
  }

  /** The tone a pixel at `depth` into its run takes, dithered against its dark twin. */
  private toneAt(tones: Tones, d: number, dither: number): Rgb {
    if (d < this.highlightEnd) return tones.highlight;
    const t = clientConstants.terrain;
    if (d < this.crustEnd) {
      const f = (d - this.highlightEnd) / Math.max(1, t.crustPx);
      return dither < f ? tones.crustDark : tones.crust;
    }
    if (d < this.soilEnd) {
      const f = (d - this.crustEnd) / Math.max(1, t.soilPx);
      return dither < f ? tones.soilDark : tones.soil;
    }
    return dither < t.deepMottle ? tones.deepDark : tones.deep;
  }

  /** Repaint [x0, x1) x [y0, y1), clipped to the map. */
  paintRect(x0: number, y0: number, x1: number, y1: number): void {
    const w = this.terrain.width;
    const h = this.terrain.height;
    const left = Math.max(0, Math.floor(x0));
    const top = Math.max(0, Math.floor(y0));
    const right = Math.min(w, Math.ceil(x1));
    const bottom = Math.min(h, Math.ceil(y1));
    const rectW = right - left;
    const rectH = bottom - top;
    if (rectW <= 0 || rectH <= 0) return;
    if (this.art) {
      this.paintArtRect(this.art, left, top, rectW, rectH);
      return;
    }

    const image = this.surface.ctx.createImageData(rectW, rectH);
    const data = image.data;
    const t = clientConstants.terrain;
    const bayer = t.bayer4;
    const tex = t.texture;
    const sc = t.scorch;
    const kind = this.kind;
    const depth = this.depth;
    const scorch = this.scorch;
    const rim = this.scorchRim;
    const core = this.scorchCore;

    for (let x = left; x < right; x++) {
      this.scanColumn(x);
      const col = (x & 3) * 4;
      for (let y = top; y < bottom; y++) {
        const o = ((y - top) * rectW + (x - left)) * 4;
        const k = kind[y];
        if (k === AIR) {
          data[o + 3] = 0;
          continue;
        }
        const d = depth[y] ?? 0;
        const dither = (bayer[col + (y & 3)] ?? 0) / 16;
        const isCeiling = k === CEILING;
        let c = this.toneAt(isCeiling ? this.ceiling : this.ground, d, dither);

        // Charred edge: the ember rim sits where the highlight and crust would be.
        if (rim && core && scorch[y * w + x] === BURNT && d < sc.rimPx + sc.corePx) {
          c = d < sc.rimPx ? rim : core;
        } else if (isCeiling) {
          // Cave rock: cracks in the body, a wet glint just under the exposed edge.
          const n = hash2(x, y);
          if (d > this.crustEnd && n < tex.crackChance) c = darken(c, tex.crackShade);
          else if (d >= this.highlightEnd && d < this.crustEnd && n > 1 - tex.ceilingGlintChance) {
            c = this.ceiling.highlight;
          }
        } else if (d >= this.soilEnd && hash2(x, y) < tex.speckleChance) {
          // Deep soil: the odd embedded stone, so the fill is not one flat tone.
          c = this.ground.soilDark;
        }

        data[o] = c.r;
        data[o + 1] = c.g;
        data[o + 2] = c.b;
        data[o + 3] = 255;
      }
    }

    this.plantDetail(data, left, top, rectW, rectH);
    this.surface.ctx.putImageData(image, left, top);
  }

  /**
   * A painted map's rect: the picture where the mask is solid, clear where it is air,
   * and the scorch treatment on burnt pixels near a fresh edge. A solid pixel the
   * picture has no colour for (a mask resynced from somewhere the picture never saw)
   * takes the deep band tone rather than a hole.
   */
  private paintArtRect(art: ImageData, left: number, top: number, rectW: number, rectH: number): void {
    const w = this.terrain.width;
    const mask = this.terrain.mask;
    const src = art.data;
    const image = this.surface.ctx.createImageData(rectW, rectH);
    const data = image.data;
    const scorch = this.scorch;
    const rim = this.scorchRim;
    const core = this.scorchCore;
    const sc = clientConstants.terrain.scorch;
    const reach = sc.rimPx + sc.corePx;
    const deep = this.ground.deep;
    for (let ly = 0; ly < rectH; ly++) {
      const y = top + ly;
      for (let lx = 0; lx < rectW; lx++) {
        const x = left + lx;
        const i = y * w + x;
        const o = (ly * rectW + lx) * 4;
        if (mask[i] !== 1) {
          data[o + 3] = 0;
          continue;
        }
        const s4 = i * 4;
        if (rim && core && scorch[i] === BURNT) {
          const d = this.airDistance(x, y, reach);
          if (d <= reach) {
            const c = d <= sc.rimPx ? rim : core;
            data[o] = c.r;
            data[o + 1] = c.g;
            data[o + 2] = c.b;
            data[o + 3] = 255;
            continue;
          }
        }
        if (src[s4 + 3] === 0) {
          data[o] = deep.r;
          data[o + 1] = deep.g;
          data[o + 2] = deep.b;
        } else {
          data[o] = src[s4] as number;
          data[o + 1] = src[s4 + 1] as number;
          data[o + 2] = src[s4 + 2] as number;
        }
        data[o + 3] = 255;
      }
    }
    this.surface.ctx.putImageData(image, left, top);
  }

  /**
   * Px from (x, y) to the nearest air along the four axes, up to `max` (max + 1 when
   * there is none that close). Outside the map counts as rock here: the floor and the
   * sides of the map are not an exposed edge, so a crater that reaches them does not
   * burn a line along the border.
   */
  private airDistance(x: number, y: number, max: number): number {
    const w = this.terrain.width;
    const h = this.terrain.height;
    const mask = this.terrain.mask;
    for (let k = 1; k <= max; k++) {
      if (x - k >= 0 && mask[y * w + x - k] !== 1) return k;
      if (x + k < w && mask[y * w + x + k] !== 1) return k;
      if (y - k >= 0 && mask[(y - k) * w + x] !== 1) return k;
      if (y + k < h && mask[(y + k) * w + x] !== 1) return k;
    }
    return max + 1;
  }

  // ------------------------------------------------------------------------
  // Decoration
  // ------------------------------------------------------------------------

  /** Write one pixel into the rect's buffer, ignoring anything outside it. */
  private plot(data: Uint8ClampedArray, lx: number, ly: number, rectW: number, rectH: number, c: Rgb): void {
    if (lx < 0 || ly < 0 || lx >= rectW || ly >= rectH) return;
    const o = (ly * rectW + lx) * 4;
    data[o] = c.r;
    data[o + 1] = c.g;
    data[o + 2] = c.b;
    data[o + 3] = 255;
  }

  /**
   * Plant the map's decorations on every exposed edge that crosses the rect. Columns
   * either side of the rect are walked too, because a tuft rooted just outside it still
   * has blades inside it; `plot` throws away everything that lands off the rect.
   */
  private plantDetail(data: Uint8ClampedArray, left: number, top: number, rectW: number, rectH: number): void {
    const detail = this.detail;
    if (!detail) return;
    const cfg = clientConstants.terrain.detail;
    const w = this.terrain.width;
    const h = this.terrain.height;
    const mask = this.terrain.mask;
    const from = Math.max(0, left - cfg.marginPx);
    const to = Math.min(w, left + rectW + cfg.marginPx);
    const scorch = this.scorch;

    for (let x = from; x < to; x++) {
      // One decoration per spacing cell, on a column the cell's own hash picks.
      const cell = Math.floor(x / cfg.spacingPx);
      const pick = cell * cfg.spacingPx + Math.floor(hash2(cell, 0x51ed) * cfg.spacingPx);
      if (pick !== x) continue;

      let y = 0;
      while (y < h) {
        if (mask[y * w + x] !== 1) {
          y++;
          continue;
        }
        const start = y;
        while (y < h && mask[y * w + x] === 1) y++;
        const end = y - 1;
        const hanging = this.isHangingRun(start, end);
        // A run has to be thick enough to be rock rather than a sliver of crust.
        if (end - start >= cfg.reachPx) {
          if (!hanging && start > 0 && scorch[start * w + x] !== BURNT) {
            this.growTop(data, x, start, left, top, rectW, rectH, detail, cfg);
          }
          if (end < h - 1 && scorch[end * w + x] !== BURNT) {
            this.growUnder(data, x, end, left, top, rectW, rectH, detail, cfg, hanging);
          }
        }
      }
    }
  }

  /** Is the edge at (x, y) level enough over `probe` px either side to carry weight? */
  private levelTop(x: number, y: number, probe: number): boolean {
    return (
      this.isSolid(x - probe, y + 1) &&
      this.isSolid(x + probe, y + 1) &&
      !this.isSolid(x - probe, y - 1) &&
      !this.isSolid(x + probe, y - 1)
    );
  }

  /**
   * The underside test is deliberately looser than the top one: an island's keel and a
   * cave roof are sloped almost everywhere, and a root or a shard hanging off a slope
   * is right — what has to be excluded is a 1 px spike with nothing to hang from. So
   * the rock only has to continue sideways above the edge, and the air below it only
   * has to be air directly under the point itself.
   */
  private levelUnder(x: number, y: number, probe: number): boolean {
    return this.isSolid(x - probe, y - 1) && this.isSolid(x + probe, y - 1) && !this.isSolid(x, y + 2);
  }

  /** Whatever the map grows on a surface it can stand on. */
  private growTop(
    data: Uint8ClampedArray,
    x: number,
    surfaceY: number,
    left: number,
    top: number,
    rectW: number,
    rectH: number,
    detail: DetailTones,
    cfg: typeof clientConstants.terrain.detail,
  ): void {
    if (hash2(x, surfaceY) > detail.density) return;
    if (!this.levelTop(x, surfaceY, cfg.maxSlopePx)) return;
    const lx = x - left;
    const ly = surfaceY - top;
    const roll = hash2(x * 3 + 1, surfaceY);
    const roll2 = hash2(x, surfaceY * 3 + 7);

    if (detail.kind === 'studs') {
      // A rock lump: wide at the base, lit on its top left, dark on its lower right.
      const height = cfg.studHeightPx + (roll < 0.4 ? 1 : 0);
      for (let r = 0; r < height; r++) {
        const half = Math.max(0, cfg.studHalfPx - Math.floor((r * cfg.studHalfPx) / height));
        for (let dx = -half; dx <= half; dx++) {
          const lit = r === height - 1 || dx < 0;
          this.plot(data, lx + dx, ly - r, rectW, rectH, lit ? detail.light : detail.mid);
        }
      }
      this.plot(data, lx + cfg.studHalfPx, ly, rectW, rectH, detail.dark);
      return;
    }

    if (detail.kind === 'glints') {
      // A crystal shard standing on the rock: dark foot, body, bright core.
      const height = cfg.glintMinPx + Math.floor(roll * (cfg.glintMaxPx - cfg.glintMinPx + 1));
      const lean = roll2 < 0.4 ? 1 : roll2 > 0.75 ? -1 : 0;
      for (let r = 0; r < height; r++) {
        const tip = r > height - 3;
        const dx = Math.round((lean * r) / 3);
        this.plot(data, lx + dx - (tip ? 0 : 1), ly - r, rectW, rectH, detail.mid);
        this.plot(data, lx + dx, ly - r, rectW, rectH, r > 1 && !tip ? detail.light : detail.mid);
      }
      this.plot(data, lx - 1, ly, rectW, rectH, detail.dark);
      this.plot(data, lx + 1, ly, rectW, rectH, detail.dark);
      return;
    }

    // 'tufts' and the top half of 'roots': a clump of leaning blades.
    const blades = cfg.tuftBlades;
    for (let b = 0; b < blades; b++) {
      const dx = b - (blades - 1) / 2;
      const hRoll = hash2(x * 7 + b, surfaceY * 5 + 3);
      const height = Math.round(cfg.tuftMinPx + hRoll * (cfg.tuftMaxPx - cfg.tuftMinPx));
      const lean = dx === 0 ? 0 : dx > 0 ? 1 : -1;
      for (let r = 0; r < height; r++) {
        const bend = Math.round((lean * r * r) / Math.max(1, height * 1.6));
        const c = r >= height - 2 ? detail.light : r === 0 ? detail.dark : detail.mid;
        this.plot(data, lx + Math.round(dx) + bend, ly - r, rectW, rectH, c);
      }
    }
  }

  /** Roots and ceiling shards hang from the underside of a slab. */
  private growUnder(
    data: Uint8ClampedArray,
    x: number,
    edgeY: number,
    left: number,
    top: number,
    rectW: number,
    rectH: number,
    detail: DetailTones,
    cfg: typeof clientConstants.terrain.detail,
    hanging: boolean,
  ): void {
    if (detail.kind !== 'roots' && !(detail.kind === 'glints' && hanging)) return;
    if (hash2(x + 0x9e37, edgeY) > detail.density) return;
    if (!this.levelUnder(x, edgeY, cfg.maxSlopePx)) return;
    const lx = x - left;
    const ly = edgeY - top;
    const roll = hash2(x * 5 + 2, edgeY);

    if (detail.kind === 'glints') {
      // A shard pointing down out of the roof, bright at its tip.
      const height = cfg.glintMinPx + Math.floor(roll * (cfg.glintMaxPx - cfg.glintMinPx + 1));
      for (let r = 0; r < height; r++) {
        const tip = r > height - 3;
        this.plot(data, lx - (tip ? 0 : 1), ly + r, rectW, rectH, detail.mid);
        this.plot(data, lx, ly + r, rectW, rectH, r > 1 && !tip ? detail.light : detail.mid);
      }
      return;
    }

    // A root: one wandering pixel column with a pale tip.
    const length = cfg.rootMinPx + Math.floor(roll * (cfg.rootMaxPx - cfg.rootMinPx + 1));
    let wander = 0;
    for (let r = 0; r < length; r++) {
      if (hash2(x * 11 + r, edgeY) > 0.72) wander += hash2(x, edgeY * 13 + r) < 0.5 ? -1 : 1;
      const c = r > length - 3 ? detail.light : r < 2 ? detail.dark : detail.mid;
      this.plot(data, lx + wander, ly + r, rectW, rectH, c);
    }
  }

  /** Blit the visible slice of the map. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const sx = Math.max(0, Math.min(camera.offsetX, this.terrain.width));
    const sy = Math.max(0, Math.min(camera.offsetY, this.terrain.height));
    const sw = Math.min(camera.viewWidth, this.terrain.width - sx);
    const sh = Math.min(camera.viewHeight, this.terrain.height - sy);
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(this.surface.canvas, sx, sy, sw, sh, sx - camera.offsetX, sy - camera.offsetY, sw, sh);
  }
}
