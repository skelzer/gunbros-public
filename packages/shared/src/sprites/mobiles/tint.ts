/**
 * Placeholder sprites for the mobiles that have not been drawn yet.
 *
 * Every Phase 4 mobile ships with a stub sprite so the client can render it from day
 * one: the armor frames with the palette rotated around the colour wheel, which reads
 * as "a different machine" at 800×600 without anybody having drawn one. Group agents
 * replace their `sprites/mobiles/<id>.ts` wholesale with real pixel art (DESIGN §8:
 * ≈40×32, 2–4 frames per animation).
 *
 * The rotation is the standard luminance-preserving hue matrix, evaluated with the
 * simulation's own `cosDeg`/`sinDeg` — `Math.cos` is banned in this package and a
 * sprite palette, although it never reaches `MatchState`, is data every engine builds.
 */
import { cosDeg, sinDeg } from '../../math/trig.js';
import { armorSprite } from './armor.js';
import type { PixelSpriteRef } from '../pixelArt.js';

function channel(hex: string, at: number): number {
  const v = Number.parseInt(hex.slice(at, at + 2), 16);
  return Number.isNaN(v) ? 0 : v;
}

function byte(v: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(v)));
  return (clamped < 16 ? '0' : '') + clamped.toString(16);
}

/** Rotate one `#rrggbb` colour around the hue wheel, keeping its luminance. */
export function rotateHue(colour: string, deg: number): string {
  if (colour.length !== 7 || colour[0] !== '#') return colour;
  const r = channel(colour, 1);
  const g = channel(colour, 3);
  const b = channel(colour, 5);
  const c = cosDeg(deg);
  const s = sinDeg(deg);
  const nr = r * (0.213 + c * 0.787 - s * 0.213) + g * (0.715 - c * 0.715 - s * 0.715) + b * (0.072 - c * 0.072 + s * 0.928);
  const ng = r * (0.213 - c * 0.213 + s * 0.143) + g * (0.715 + c * 0.285 + s * 0.14) + b * (0.072 - c * 0.072 - s * 0.283);
  const nb = r * (0.213 - c * 0.213 - s * 0.787) + g * (0.715 - c * 0.715 + s * 0.715) + b * (0.072 + c * 0.928 + s * 0.072);
  return `#${byte(nr)}${byte(ng)}${byte(nb)}`;
}

/**
 * The armor frames with a rotated palette. The frame data itself is shared (it is
 * read-only), so a stub costs nothing.
 */
export function tintedArmorSprite(hueDeg: number): PixelSpriteRef {
  return {
    ...armorSprite,
    palette: armorSprite.palette.map((colour) => rotateHue(colour, hueDeg)),
  };
}
