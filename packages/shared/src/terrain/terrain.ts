/**
 * Destructible terrain: one byte per pixel, 1 = solid, 0 = air (DESIGN §2.3).
 *
 * A byte per pixel keeps carve and probes branch-free; a 1800x1000 map is 1.8 MB, which
 * is fine. The mask is the single source of truth for collision, walking and rendering.
 */
import { atan2 } from '../math/trig.js';

export const AIR = 0;
export const SOLID = 1;

/** The circle removed by a carve. Returned so the caller can emit a `carve` SimEvent. */
export interface CarveCircle {
  x: number;
  y: number;
  r: number;
}

/** Sentinel returned by the ground probes when nothing was found. */
export const NO_GROUND = -1;

export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  private cachedHash: number | null = null;

  constructor(width: number, height: number, mask?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.mask = mask ?? new Uint8Array(width * height);
  }

  /** Index of a pixel. Caller must know the coordinate is in bounds. */
  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Solid test. Everything outside the map is air: projectiles leave the world through
   * the sides and the top, and mobiles that walk off the bottom fall to their death.
   */
  isSolid(x: number, y: number): boolean {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return false;
    return this.mask[iy * this.width + ix] === SOLID;
  }

  setSolid(x: number, y: number, solid: boolean): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    this.mask[iy * this.width + ix] = solid ? SOLID : AIR;
    this.cachedHash = null;
  }

  /** Fill a column from `yTop` (inclusive) down to the bottom of the map. */
  fillColumnFrom(x: number, yTop: number): void {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return;
    const start = Math.max(0, Math.floor(yTop));
    for (let y = start; y < this.height; y++) {
      this.mask[y * this.width + ix] = SOLID;
    }
    this.cachedHash = null;
  }

  /** Remove a solid disc. Returns the circle so the reducer can emit `carve`. */
  carve(cx: number, cy: number, r: number): CarveCircle {
    const icx = Math.floor(cx);
    const icy = Math.floor(cy);
    const ir = Math.floor(r);
    const r2 = r * r;
    const x0 = Math.max(0, icx - ir);
    const x1 = Math.min(this.width - 1, icx + ir);
    const y0 = Math.max(0, icy - ir);
    const y1 = Math.min(this.height - 1, icy + ir);
    for (let y = y0; y <= y1; y++) {
      const dy = y - icy;
      const dy2 = dy * dy;
      const row = y * this.width;
      for (let x = x0; x <= x1; x++) {
        const dx = x - icx;
        if (dx * dx + dy2 <= r2) this.mask[row + x] = AIR;
      }
    }
    this.cachedHash = null;
    return { x: cx, y: cy, r };
  }

  /**
   * First solid pixel at or below `yFrom` in column `x`, searching at most `maxDrop` px.
   * Returns {@link NO_GROUND} when the column is empty over that range.
   */
  groundBelow(x: number, yFrom: number, maxDrop: number): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return NO_GROUND;
    const start = Math.max(0, Math.floor(yFrom));
    const end = Math.min(this.height - 1, Math.floor(yFrom) + Math.floor(maxDrop));
    for (let y = start; y <= end; y++) {
      if (this.mask[y * this.width + ix] === SOLID) return y;
    }
    return NO_GROUND;
  }

  /** Topmost solid pixel of a column, or {@link NO_GROUND} for an empty column. */
  heightAt(x: number): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return NO_GROUND;
    for (let y = 0; y < this.height; y++) {
      if (this.mask[y * this.width + ix] === SOLID) return y;
    }
    return NO_GROUND;
  }

  /**
   * Surface y nearest to `yNear` in column `x`: if `yNear` is inside solid ground, walk
   * up to the top of that run; otherwise walk down to the first solid pixel. Used by
   * walking and tilt sampling, which both care about the local surface, not the map top.
   */
  surfaceNear(x: number, yNear: number, maxProbe: number): number {
    const ix = Math.floor(x);
    if (ix < 0 || ix >= this.width) return NO_GROUND;
    const iy = Math.floor(yNear);
    if (this.isSolid(ix, iy)) {
      let y = iy;
      let steps = 0;
      while (y - 1 >= 0 && steps < maxProbe && this.isSolid(ix, y - 1)) {
        y--;
        steps++;
      }
      return y;
    }
    return this.groundBelow(ix, iy, maxProbe);
  }

  /**
   * Screen-space tilt in radians of the surface under a footprint of width `w`, positive
   * = clockwise = sloping down to the right (DESIGN §2.3). The world-space aim
   * contribution is `tiltDeg = -radToDeg(tilt)`.
   */
  sampleTilt(x: number, yNear: number, w: number, maxProbe: number): number {
    const half = w / 2;
    const yl = this.surfaceNear(x - half, yNear, maxProbe);
    const yr = this.surfaceNear(x + half, yNear, maxProbe);
    if (yl === NO_GROUND || yr === NO_GROUND) return 0;
    return atan2(yr - yl, w);
  }

  /** FNV-1a 32-bit over the whole mask. Cached; every mutator invalidates the cache. */
  hash(): number {
    if (this.cachedHash !== null) return this.cachedHash;
    let h = 0x811c9dc5;
    const m = this.mask;
    for (let i = 0; i < m.length; i++) {
      h ^= m[i] as number;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    this.cachedHash = h >>> 0;
    return this.cachedHash;
  }

  /** Drop the cached hash. Only needed if the mask is mutated directly. */
  invalidateHash(): void {
    this.cachedHash = null;
  }

  clone(): Terrain {
    return new Terrain(this.width, this.height, this.mask.slice());
  }

  /** Replace the whole mask (resync path). Sizes must match. */
  replaceMask(mask: Uint8Array): void {
    if (mask.length !== this.mask.length) {
      throw new Error(
        `terrain mask size mismatch: got ${mask.length}, expected ${this.mask.length}`,
      );
    }
    this.mask.set(mask);
    this.cachedHash = null;
  }
}
