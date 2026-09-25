/**
 * App icons for the installed app (DESIGN §7 item 153).
 *
 *     pnpm icons            # writes packages/client/public/icons/*.png
 *
 * The icon is the armor sprite — the starter mobile and the art-pass reference (see
 * docs/ART.md) — on the HUD's dark blue board with a hard outline, blown up by a whole
 * number and centred. Drawn rather than exported: the sprite is palette-indexed data in
 * `packages/shared`, so the icon can never drift from the tank the player drives, and
 * regenerating it is one command rather than a round trip through an image editor.
 *
 * Node built-ins only, on the same hand-rolled PNG encoder the sprite previewer uses
 * (`tools/sprites/png.ts`). The output is committed, because a build must not need a
 * codegen step (DESIGN §1.5).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeFrame, TRANSPARENT } from '../packages/shared/src/sprites/pixelArt.js';
import type { PixelSpriteRef } from '../packages/shared/src/sprites/pixelArt.js';
import { armorSprite } from '../packages/shared/src/sprites/mobiles/armor.js';
import { Bitmap, encodePng, parseHex } from './sprites/png.js';
import type { Rgba } from './sprites/png.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'packages', 'client', 'public', 'icons');

/** The menus' board colours (index.html `--bg`, `--bg-deep`, `--accent`). */
const board = parseHex('#0b1220');
const boardDeep = parseHex('#070d18');
const accent = parseHex('#ffd23f');

/**
 * The sizes a phone actually asks for. 192 and 512 are the manifest's two required
 * icons, 180 is `apple-touch-icon` (iOS, which reads no manifest icon), and 32 is the
 * favicon for a desktop tab that has no SVG support.
 */
const SIZES = [32, 180, 192, 512];

/** A vertical wash, so the icon is not a flat rectangle at 512 px. */
function paintBackground(bmp: Bitmap): void {
  for (let y = 0; y < bmp.height; y++) {
    const t = y / Math.max(1, bmp.height - 1);
    const mix = (a: number, b: number): number => Math.round(a + (b - a) * t);
    const c: Rgba = {
      r: mix(board.r, boardDeep.r),
      g: mix(board.g, boardDeep.g),
      b: mix(board.b, boardDeep.b),
      a: 255,
    };
    bmp.fillRect(0, y, bmp.width, 1, c);
  }
}

/** A one-pixel-per-unit amber rule around the edge, thick enough to survive a 32 px icon. */
function paintBorder(bmp: Bitmap, thickness: number): void {
  const edge: Rgba = { r: accent.r, g: accent.g, b: accent.b, a: 170 };
  for (let i = 0; i < thickness; i++) {
    bmp.fillRect(i, i, bmp.width - i * 2, 1, edge);
    bmp.fillRect(i, bmp.height - 1 - i, bmp.width - i * 2, 1, edge);
    bmp.fillRect(i, i, 1, bmp.height - i * 2, edge);
    bmp.fillRect(bmp.width - 1 - i, i, 1, bmp.height - i * 2, edge);
  }
}

/**
 * The sprite's first idle frame, blown up by a whole number and centred on the tile.
 *
 * The scale is a whole number because everything else in this game is: a 56x48 sprite
 * resampled to fit exactly would be the one mushy image in an otherwise crisp app.
 */
function paintSprite(bmp: Bitmap, sprite: PixelSpriteRef, margin: number): void {
  const frame = sprite.frames.idle[0];
  if (!frame) throw new Error('armor has no idle frame');
  const indices = decodeFrame(frame, sprite.width, sprite.height);
  const palette = sprite.palette.map(parseHex);
  const room = { w: bmp.width - margin * 2, h: bmp.height - margin * 2 };
  const scale = Math.max(1, Math.floor(Math.min(room.w / sprite.width, room.h / sprite.height)));
  const originX = Math.round((bmp.width - sprite.width * scale) / 2);
  const originY = Math.round((bmp.height - sprite.height * scale) / 2);
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      const idx = indices[y * sprite.width + x] ?? TRANSPARENT;
      if (idx === TRANSPARENT) continue;
      const colour = palette[idx];
      if (!colour) continue;
      bmp.fillRect(originX + x * scale, originY + y * scale, scale, scale, colour);
    }
  }
}

function iconAt(size: number): Bitmap {
  const bmp = new Bitmap(size, size);
  paintBackground(bmp);
  paintBorder(bmp, Math.max(1, Math.round(size / 64)));
  // Enough air that a phone's rounded corner mask cannot bite the tank.
  paintSprite(bmp, armorSprite, Math.round(size * 0.11));
  return bmp;
}

/**
 * The `maskable` variant: Android crops an installed icon to whatever shape the launcher
 * uses, and only the inner 80 % circle is guaranteed to survive. So there is no border to
 * lose and a quarter of the tile is margin — the tank sits well inside the circle
 * whatever shape is cut out of the square.
 */
function maskableAt(size: number): Bitmap {
  const bmp = new Bitmap(size, size);
  paintBackground(bmp);
  paintSprite(bmp, armorSprite, Math.round(size * 0.26));
  return bmp;
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const write = (name: string, bmp: Bitmap): void => {
    const file = join(outDir, name);
    writeFileSync(file, encodePng(bmp));
    process.stdout.write(`${file}\n`);
  };
  for (const size of SIZES) write(`icon-${size}.png`, iconAt(size));
  write('icon-maskable-512.png', maskableAt(512));
}

main();
