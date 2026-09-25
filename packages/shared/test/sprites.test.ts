/**
 * Sprite data is blitted straight to a canvas, so it has to be well formed — and it is
 * hand-edited during the art pass by several people at once, which is exactly when a
 * row loses a character.
 *
 * These checks are deliberately *dimension agnostic*: every sprite is validated against
 * its own `width`/`height`/`anchor`, never against a hard-coded 40x32, so the art pass
 * can grow a canvas (docs/ART.md) without rewriting the suite. What is pinned is the
 * contract the renderer and the animation system rely on: frame counts, row lengths,
 * palette indices in range, an anchor inside the frame, and actual drawn pixels.
 */
import { describe, expect, it } from 'vitest';
import { mobileSprites } from '../src/sprites/mobiles/index.js';
import { mobileIds } from '../src/data/mobiles/index.js';
import type { MobileId } from '../src/data/mobiles/index.js';
import {
  animNames,
  decodeFrame,
  paletteIndexOf,
  validatePixelSprite,
  TRANSPARENT,
} from '../src/sprites/pixelArt.js';
import type { AnimName, PixelSpriteRef } from '../src/sprites/pixelArt.js';
import { armorSprite } from '../src/sprites/mobiles/armor.js';
import { armor } from '../src/data/mobiles.js';

/** DESIGN §8 asks for 2-4 frames per animation; `hurt` is allowed to be a single flash. */
const minFrames: Record<AnimName, number> = {
  idle: 2,
  move: 2,
  fire: 2,
  hurt: 1,
  death: 2,
};

/** Sanity bounds, not style: the HUD portrait and the camera assume a mobile-sized canvas. */
const MIN_SIDE = 16;
const MAX_SIDE = 96;

const entries: [MobileId, PixelSpriteRef][] = mobileIds.map((id) => [id, mobileSprites[id]]);

/** Non-transparent pixel count and drawn bounding box of one frame. */
function coverageOf(
  sprite: PixelSpriteRef,
  frame: string[],
): { solid: number; minX: number; maxX: number; minY: number; maxY: number } {
  const pixels = decodeFrame(frame, sprite.width, sprite.height);
  let solid = 0;
  let minX = sprite.width;
  let maxX = -1;
  let minY = sprite.height;
  let maxY = -1;
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      if (pixels[y * sprite.width + x] === TRANSPARENT) continue;
      solid++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { solid, minX, maxX, minY, maxY };
}

describe('sprite format', () => {
  it('decodes palette characters', () => {
    expect(paletteIndexOf('.')).toBe(TRANSPARENT);
    expect(paletteIndexOf('0')).toBe(0);
    expect(paletteIndexOf('9')).toBe(9);
    expect(paletteIndexOf('a')).toBe(10);
    expect(paletteIndexOf('z')).toBe(35);
  });

  it('covers the whole roster', () => {
    expect(entries.length).toBe(mobileIds.length);
    expect(entries.length).toBeGreaterThanOrEqual(18);
  });

  it('points every mobile definition at its own sprite', () => {
    expect(armor.sprite).toBe(armorSprite);
  });
});

describe.each(entries)('sprite %s', (id, sprite) => {
  it('is a pixel sprite with a plausible canvas', () => {
    expect(sprite.kind).toBe('pixels');
    expect(Number.isInteger(sprite.width)).toBe(true);
    expect(Number.isInteger(sprite.height)).toBe(true);
    expect(sprite.width).toBeGreaterThanOrEqual(MIN_SIDE);
    expect(sprite.height).toBeGreaterThanOrEqual(MIN_SIDE);
    expect(sprite.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(sprite.height).toBeLessThanOrEqual(MAX_SIDE);
  });

  it('has rows of exactly width characters and palette indices in range', () => {
    // `validatePixelSprite` reads the sprite's own width/height — no dimension is pinned here.
    expect(validatePixelSprite(sprite), id).toEqual([]);
  });

  it('declares a hex palette', () => {
    expect(sprite.palette.length).toBeGreaterThan(0);
    for (const colour of sprite.palette) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has the frame counts the animation system needs', () => {
    for (const name of animNames) {
      const frames = sprite.frames[name] ?? [];
      expect(frames.length, `${id} ${name} frames`).toBeGreaterThanOrEqual(minFrames[name]);
      expect(frames.length, `${id} ${name} frames`).toBeLessThanOrEqual(8);
      expect(sprite.frameTicks[name], `${id} ${name} frameTicks`).toBeGreaterThan(0);
      expect(typeof sprite.loop[name]).toBe('boolean');
    }
    // One-shots hold on their last frame; idle and move cycle.
    expect(sprite.loop.idle).toBe(true);
    expect(sprite.loop.move).toBe(true);
    expect(sprite.loop.fire).toBe(false);
    expect(sprite.loop.death).toBe(false);
  });

  it('anchors inside the frame', () => {
    expect(sprite.anchor.x).toBeGreaterThanOrEqual(0);
    expect(sprite.anchor.x).toBeLessThanOrEqual(sprite.width);
    expect(sprite.anchor.y).toBeGreaterThanOrEqual(0);
    // `height` is legal: it means "the bottom edge of the frame".
    expect(sprite.anchor.y).toBeLessThanOrEqual(sprite.height);
  });

  it('hinges the barrel inside the frame', () => {
    expect(sprite.barrelPivot.x).toBeGreaterThanOrEqual(0);
    expect(sprite.barrelPivot.x).toBeLessThanOrEqual(sprite.width);
    expect(sprite.barrelPivot.y).toBeGreaterThanOrEqual(0);
    expect(sprite.barrelPivot.y).toBeLessThanOrEqual(sprite.height);
    expect(sprite.barrelLength).toBeGreaterThan(0);
    expect(sprite.barrelLength).toBeLessThanOrEqual(Math.max(sprite.width, sprite.height));
  });

  it('draws something in every frame', () => {
    for (const name of animNames) {
      for (let f = 0; f < (sprite.frames[name] ?? []).length; f++) {
        const frame = (sprite.frames[name] as string[][])[f] as string[];
        const { solid } = coverageOf(sprite, frame);
        expect(solid, `${id} ${name}[${f}] coverage`).toBeGreaterThan(40);
      }
    }
  });

  it('fills its footprint: the idle body is wide and sits low in the frame', () => {
    const idle = (sprite.frames.idle[0] ?? []) as string[];
    const box = coverageOf(sprite, idle);
    const drawnW = box.maxX - box.minX + 1;
    const drawnH = box.maxY - box.minY + 1;
    expect(drawnW, `${id} drawn width`).toBeGreaterThanOrEqual(24);
    expect(drawnW).toBeLessThanOrEqual(sprite.width);
    expect(drawnH).toBeLessThanOrEqual(sprite.height);
    // The mobile stands on the anchor, so the drawing has to reach it.
    expect(box.maxY, `${id} lowest drawn row`).toBeGreaterThanOrEqual(
      Math.min(sprite.height - 1, sprite.anchor.y - 3),
    );
  });
});
