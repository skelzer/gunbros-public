/**
 * Sprite data format (DESIGN §8). This module is *data only*: the simulation never
 * draws anything. `client/render/sprites.ts` turns either variant into offscreen
 * canvases, one per animation frame.
 *
 * A pixel frame is an array of row strings. Each character is a palette index in
 * base 36 ('0'-'9', then 'a'-'z'), and '.' means transparent.
 */

export type AnimName = 'idle' | 'move' | 'fire' | 'hurt' | 'death';

export const animNames: AnimName[] = ['idle', 'move', 'fire', 'hurt', 'death'];

/** One frame: `height` strings of `width` characters. */
export type PixelFrame = string[];

export interface SpriteAnchor {
  /** Column of the mobile's x (feet centre) inside a frame. */
  x: number;
  /** Row of the mobile's y (ground contact). `height` means "bottom edge of the frame". */
  y: number;
}

export interface PixelSpriteRef {
  kind: 'pixels';
  width: number;
  height: number;
  anchor: SpriteAnchor;
  /** Where the barrel is hinged, for drawing the aim line and muzzle effects. */
  barrelPivot: SpriteAnchor;
  /** Distance from the pivot to the muzzle in px. */
  barrelLength: number;
  /** CSS colours; character 'c' maps to `palette[parseInt(c, 36)]`. */
  palette: string[];
  frames: Record<AnimName, PixelFrame[]>;
  /** Ticks each frame is held. */
  frameTicks: Record<AnimName, number>;
  /** Whether the animation repeats or holds on its last frame. */
  loop: Record<AnimName, boolean>;
}

export interface PngSpriteRef {
  kind: 'png';
  url: string;
  frameW: number;
  frameH: number;
  anchor: SpriteAnchor;
  barrelPivot: SpriteAnchor;
  barrelLength: number;
  /** Frame indices into the sheet, per animation. */
  frames: Record<AnimName, number[]>;
  frameTicks: Record<AnimName, number>;
  loop: Record<AnimName, boolean>;
}

export type SpriteRef = PixelSpriteRef | PngSpriteRef;

export const TRANSPARENT = -1;

/** How long a full pass of an animation takes, in ticks. */
export function animDurationTicks(sprite: SpriteRef, name: AnimName): number {
  const frames = sprite.frames[name];
  const perFrame = sprite.frameTicks[name];
  return (frames ? frames.length : 1) * perFrame;
}

/** Palette index of a frame character, or {@link TRANSPARENT}. */
export function paletteIndexOf(ch: string): number {
  if (ch === '.') return TRANSPARENT;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48; // '0'-'9'
  if (code >= 97 && code <= 122) return code - 87; // 'a'-'z'
  if (code >= 65 && code <= 90) return code - 55; // 'A'-'Z'
  return TRANSPARENT;
}

/** Decode a frame into one palette index per pixel, row-major. */
export function decodeFrame(frame: PixelFrame, width: number, height: number): Int16Array {
  const out = new Int16Array(width * height).fill(TRANSPARENT);
  for (let y = 0; y < height && y < frame.length; y++) {
    const row = frame[y] as string;
    for (let x = 0; x < width && x < row.length; x++) {
      out[y * width + x] = paletteIndexOf(row[x] as string);
    }
  }
  return out;
}

/**
 * Structural check used by the sprite tests: every frame is `height` rows of exactly
 * `width` characters and every non-transparent character exists in the palette.
 * Returns the list of problems; empty means the sprite is well formed.
 */
export function validatePixelSprite(sprite: PixelSpriteRef): string[] {
  const problems: string[] = [];
  for (let a = 0; a < animNames.length; a++) {
    const name = animNames[a] as AnimName;
    const frames = sprite.frames[name];
    if (!frames || frames.length === 0) {
      problems.push(`${name}: no frames`);
      continue;
    }
    for (let f = 0; f < frames.length; f++) {
      const frame = frames[f] as PixelFrame;
      if (frame.length !== sprite.height) {
        problems.push(`${name}[${f}]: ${frame.length} rows, expected ${sprite.height}`);
      }
      for (let y = 0; y < frame.length; y++) {
        const row = frame[y] as string;
        if (row.length !== sprite.width) {
          problems.push(`${name}[${f}] row ${y}: ${row.length} chars, expected ${sprite.width}`);
          continue;
        }
        for (let x = 0; x < row.length; x++) {
          const idx = paletteIndexOf(row[x] as string);
          if (idx !== TRANSPARENT && (idx < 0 || idx >= sprite.palette.length)) {
            problems.push(`${name}[${f}] (${x},${y}): palette index ${idx} out of range`);
          }
        }
      }
    }
  }
  return problems;
}
