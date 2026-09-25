/**
 * Sprite previewer for the art pass.
 *
 *     pnpm sprites:render armor                 # one sheet
 *     pnpm sprites:render all --scale 4         # every sheet + the roster contact sheet
 *     pnpm sprites:render armor --scale 6 --out /tmp/art
 *
 * Renders every animation of a mobile's `PixelSpriteRef` into a single PNG: frames left
 * to right, animations top to bottom, each frame on a checkerboard so transparent
 * pixels are obvious, with the anchor (magenta cross), the barrel pivot (cyan dot) and
 * the barrel vector drawn over it. `all` additionally writes `_roster.png`: every
 * mobile's first idle frame at 3x, baseline-aligned, so the roster can be judged as a
 * group.
 *
 * Node built-ins only — no native canvas (see ./png.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { animNames, decodeFrame, TRANSPARENT } from '../../packages/shared/src/sprites/pixelArt.js';
import type { AnimName, PixelSpriteRef } from '../../packages/shared/src/sprites/pixelArt.js';
import { mobileSprites } from '../../packages/shared/src/sprites/mobiles/index.js';
import { Bitmap, drawText, encodePng, parseHex, textWidth } from './png.js';
import type { Rgba } from './png.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ink = {
  page: { r: 0x1b, g: 0x1f, b: 0x25, a: 255 },
  checkerA: { r: 0x3b, g: 0x41, b: 0x49, a: 255 },
  checkerB: { r: 0x2c, g: 0x31, b: 0x38, a: 255 },
  cellEdge: { r: 0x55, g: 0x5d, b: 0x68, a: 255 },
  label: { r: 0xe6, g: 0xed, b: 0xf5, a: 255 },
  dim: { r: 0x93, g: 0xa1, b: 0xb0, a: 255 },
  anchor: { r: 0xff, g: 0x3d, b: 0xd8, a: 170 },
  pivot: { r: 0x36, g: 0xe0, b: 0xff, a: 200 },
  barrel: { r: 0x36, g: 0xe0, b: 0xff, a: 120 },
} satisfies Record<string, Rgba>;

const CHECKER = 8;
const PAD = 10;
const GUTTER = 48;
const GAP = 10;
const LABEL_SCALE = 2;
const LABEL_H = 5 * LABEL_SCALE;

interface Options {
  target: string;
  scale: number;
  outDir: string;
  guides: boolean;
}

function parseArgs(argv: string[]): Options {
  let target = '';
  let scale = 4;
  let outDir = join(repoRoot, '.art-preview');
  let guides = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--scale') {
      scale = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isFinite(scale) || scale < 1 || scale > 16) {
        throw new Error('--scale wants an integer in 1..16');
      }
    } else if (arg === '--out') {
      const dir = argv[++i];
      if (!dir) throw new Error('--out wants a directory');
      outDir = resolve(dir);
    } else if (arg === '--no-guides') {
      guides = false;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag ${arg}`);
    } else if (!target) {
      target = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (!target) throw new Error('usage: tsx tools/sprites/render.ts <mobileId|all> [--scale 4] [--out dir] [--no-guides]');
  return { target, scale, outDir, guides };
}

function checker(bmp: Bitmap, x: number, y: number, w: number, h: number): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const even = (Math.floor(xx / CHECKER) + Math.floor(yy / CHECKER)) % 2 === 0;
      bmp.set(x + xx, y + yy, even ? ink.checkerA : ink.checkerB);
    }
  }
}

/** Blit one frame of `sprite`, scaled, with its top-left at (x, y). */
function blitFrame(
  bmp: Bitmap,
  sprite: PixelSpriteRef,
  frame: string[],
  x: number,
  y: number,
  scale: number,
  rgb: Rgba[],
): void {
  const indices = decodeFrame(frame, sprite.width, sprite.height);
  for (let py = 0; py < sprite.height; py++) {
    for (let px = 0; px < sprite.width; px++) {
      const idx = indices[py * sprite.width + px] ?? TRANSPARENT;
      if (idx === TRANSPARENT) continue;
      const c = rgb[idx];
      if (!c) continue;
      bmp.fillRect(x + px * scale, y + py * scale, scale, scale, c);
    }
  }
}

/** Anchor cross, barrel pivot and a 45-degree barrel vector, in sprite pixel units. */
function drawGuides(bmp: Bitmap, sprite: PixelSpriteRef, x: number, y: number, scale: number): void {
  const ax = x + sprite.anchor.x * scale;
  const ay = y + sprite.anchor.y * scale;
  const arm = 5 * scale;
  bmp.fillRect(ax - arm, ay - Math.max(1, scale / 2), arm * 2, Math.max(1, scale / 2) * 2, ink.anchor);
  bmp.fillRect(ax - Math.max(1, scale / 2), ay - arm, Math.max(1, scale / 2) * 2, arm * 2, ink.anchor);

  const px = x + sprite.barrelPivot.x * scale;
  const py = y + sprite.barrelPivot.y * scale;
  // 45 degrees up and to the right: the aim the sandbox opens on.
  const k = Math.SQRT1_2 * sprite.barrelLength * scale;
  bmp.line(px, py, px + k, py - k, ink.barrel);
  bmp.fillRect(px - scale, py - scale, scale * 2, scale * 2, ink.pivot);
}

function frameRowsOf(sprite: PixelSpriteRef, name: AnimName): string[][] {
  return sprite.frames[name] ?? [];
}

/** One PNG per mobile: animations stacked, frames side by side. */
function renderSheet(id: string, sprite: PixelSpriteRef, scale: number, guides: boolean): Buffer {
  const rgb = sprite.palette.map(parseHex);
  const cellW = sprite.width * scale;
  const cellH = sprite.height * scale;
  const maxFrames = Math.max(...animNames.map((n) => frameRowsOf(sprite, n).length), 1);

  const headerH = LABEL_H + 6;
  const width = PAD + GUTTER + maxFrames * (cellW + GAP) - GAP + PAD;
  const height = PAD + headerH + animNames.length * (cellH + LABEL_H + GAP) - GAP + PAD;
  const bmp = new Bitmap(width, height, ink.page);

  const header =
    `${id.toUpperCase()}  ${sprite.width}x${sprite.height}  ` +
    `ANCHOR ${sprite.anchor.x}/${sprite.anchor.y}  ` +
    `PIVOT ${sprite.barrelPivot.x}/${sprite.barrelPivot.y}  LEN ${sprite.barrelLength}  ` +
    `SCALE ${scale}x`;
  drawText(bmp, header, PAD, PAD, ink.label, LABEL_SCALE);

  let y = PAD + headerH;
  for (const name of animNames) {
    const frames = frameRowsOf(sprite, name);
    const meta = `${name} ${frames.length}f ${sprite.frameTicks[name]}t ${sprite.loop[name] ? 'loop' : 'hold'}`;
    drawText(bmp, meta, PAD, y, ink.dim, LABEL_SCALE);
    const rowY = y + LABEL_H + 3;
    for (let f = 0; f < frames.length; f++) {
      const cellX = PAD + GUTTER + f * (cellW + GAP);
      checker(bmp, cellX, rowY, cellW, cellH);
      blitFrame(bmp, sprite, frames[f] as string[], cellX, rowY, scale, rgb);
      if (guides) drawGuides(bmp, sprite, cellX, rowY, scale);
      bmp.strokeRect(cellX - 1, rowY - 1, cellW + 2, cellH + 2, ink.cellEdge);
    }
    y = rowY + cellH + GAP;
  }
  return encodePng(bmp);
}

/** Every mobile's first idle frame, baseline aligned, so the roster reads as a set. */
function renderContactSheet(scale: number): Buffer {
  const ids = Object.keys(mobileSprites) as (keyof typeof mobileSprites)[];
  const cellW = Math.max(...ids.map((id) => mobileSprites[id].width)) * scale + 8;
  const cellH = Math.max(...ids.map((id) => mobileSprites[id].height)) * scale + 8;
  const cols = 6;
  const rows = Math.ceil(ids.length / cols);
  const labelH = LABEL_H + 4;
  const width = PAD + cols * (cellW + GAP) - GAP + PAD;
  const height = PAD + LABEL_H + 6 + rows * (cellH + labelH + GAP) - GAP + PAD;
  const bmp = new Bitmap(width, height, ink.page);
  drawText(bmp, `ROSTER  ${ids.length} MOBILES  IDLE 0  SCALE ${scale}x`, PAD, PAD, ink.label, LABEL_SCALE);

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as keyof typeof mobileSprites;
    const sprite = mobileSprites[id];
    const cx = PAD + (i % cols) * (cellW + GAP);
    const cy = PAD + LABEL_H + 6 + Math.floor(i / cols) * (cellH + labelH + GAP);
    checker(bmp, cx, cy, cellW, cellH);
    bmp.strokeRect(cx - 1, cy - 1, cellW + 2, cellH + 2, ink.cellEdge);
    const frame = (sprite.frames.idle[0] ?? []) as string[];
    // Baseline-align on the anchor row so differently sized sprites stand on one floor.
    const x = cx + Math.round((cellW - sprite.width * scale) / 2);
    const y = cy + cellH - 4 - sprite.anchor.y * scale;
    blitFrame(bmp, sprite, frame, x, y, scale, sprite.palette.map(parseHex));
    const text = `${id} ${sprite.width}x${sprite.height}`;
    drawText(bmp, text, cx + Math.max(0, Math.round((cellW - textWidth(text, LABEL_SCALE)) / 2)), cy + cellH + 3, ink.dim, LABEL_SCALE);
  }
  return encodePng(bmp);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });
  const all = Object.keys(mobileSprites) as (keyof typeof mobileSprites)[];
  const targets =
    opts.target === 'all'
      ? all
      : all.filter((id) => id === opts.target);
  if (targets.length === 0) {
    throw new Error(`unknown mobile "${opts.target}". Known: ${all.join(', ')}`);
  }
  for (const id of targets) {
    const file = join(opts.outDir, `${id}.png`);
    writeFileSync(file, renderSheet(id, mobileSprites[id], opts.scale, opts.guides));
    process.stdout.write(`${file}\n`);
  }
  if (opts.target === 'all') {
    const file = join(opts.outDir, '_roster.png');
    writeFileSync(file, renderContactSheet(3));
    process.stdout.write(`${file}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`sprites:render: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
