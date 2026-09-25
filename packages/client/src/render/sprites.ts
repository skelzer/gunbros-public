/**
 * Sprites (DESIGN §1.3 render/sprites.ts, §8).
 *
 * The simulation only carries sprite *data*: a palette-indexed pixel grid, or a PNG
 * sheet reference. This module turns either into one offscreen canvas per animation
 * frame, picks the frame for a given animation time, and draws a mobile rotated by its
 * tilt and mirrored by its facing.
 */
import { animNames, decodeFrame, TRANSPARENT } from '@gunbros/shared';
import type {
  AnimName,
  MobileState,
  PixelSpriteRef,
  PngSpriteRef,
  SpriteRef,
} from '@gunbros/shared';
import { createOffscreen } from './canvas.js';
import { parseHexColor } from './terrain.js';
import { clientConstants } from '../data/clientConstants.js';
import { drawProjectileSprite, projectilePiece } from './projectileSprites.js';

export interface SpriteSheet {
  readonly width: number;
  readonly height: number;
  readonly anchor: { x: number; y: number };
  readonly barrelPivot: { x: number; y: number };
  readonly barrelLength: number;
  readonly frameTicks: Record<AnimName, number>;
  readonly loop: Record<AnimName, boolean>;
  /** One canvas per frame, per animation. Empty until a PNG sheet has loaded. */
  readonly frames: Record<AnimName, HTMLCanvasElement[]>;
  /** Resolves once every frame canvas exists (immediately for pixel sprites). */
  readonly ready: Promise<SpriteSheet>;
  readonly loaded: boolean;
}

function emptyFrames(): Record<AnimName, HTMLCanvasElement[]> {
  const out = {} as Record<AnimName, HTMLCanvasElement[]>;
  for (const name of animNames) out[name] = [];
  return out;
}

// --------------------------------------------------------------------------
// Pixel grids
// --------------------------------------------------------------------------

function paintPixelFrame(ref: PixelSpriteRef, frame: string[]): HTMLCanvasElement {
  const { canvas, ctx } = createOffscreen(ref.width, ref.height);
  const indices = decodeFrame(frame, ref.width, ref.height);
  const image = ctx.createImageData(ref.width, ref.height);
  const data = image.data;
  const rgb = ref.palette.map(parseHexColor);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i] ?? TRANSPARENT;
    const o = i * 4;
    if (idx === TRANSPARENT) {
      data[o + 3] = 0;
      continue;
    }
    const c = rgb[idx];
    if (!c) {
      data[o + 3] = 0;
      continue;
    }
    data[o] = c.r;
    data[o + 1] = c.g;
    data[o + 2] = c.b;
    data[o + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function buildPixelSheet(ref: PixelSpriteRef): SpriteSheet {
  const frames = emptyFrames();
  for (const name of animNames) {
    const list = ref.frames[name] ?? [];
    frames[name] = list.map((frame) => paintPixelFrame(ref, frame));
  }
  let resolveReady: (sheet: SpriteSheet) => void = () => {};
  const ready = new Promise<SpriteSheet>((resolve) => {
    resolveReady = resolve;
  });
  const sheet: SpriteSheet = {
    width: ref.width,
    height: ref.height,
    anchor: ref.anchor,
    barrelPivot: ref.barrelPivot,
    barrelLength: ref.barrelLength,
    frameTicks: ref.frameTicks,
    loop: ref.loop,
    frames,
    loaded: true,
    ready,
  };
  resolveReady(sheet);
  return sheet;
}

// --------------------------------------------------------------------------
// PNG sheets
// --------------------------------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite sheet: ${url}`));
    img.src = url;
  });
}

function buildPngSheet(ref: PngSpriteRef): SpriteSheet {
  const frames = emptyFrames();
  const state = { loaded: false };
  let resolveReady: (sheet: SpriteSheet) => void = () => {};
  let rejectReady: (err: unknown) => void = () => {};
  const ready = new Promise<SpriteSheet>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const sheet: SpriteSheet = {
    width: ref.frameW,
    height: ref.frameH,
    anchor: ref.anchor,
    barrelPivot: ref.barrelPivot,
    barrelLength: ref.barrelLength,
    frameTicks: ref.frameTicks,
    loop: ref.loop,
    frames,
    get loaded() {
      return state.loaded;
    },
    ready,
  };
  loadImage(ref.url).then(
    (img) => {
      const perRow = Math.max(1, Math.floor(img.width / ref.frameW));
      for (const name of animNames) {
        const indices = ref.frames[name] ?? [];
        frames[name] = indices.map((index) => {
          const { canvas, ctx } = createOffscreen(ref.frameW, ref.frameH);
          const sx = (index % perRow) * ref.frameW;
          const sy = Math.floor(index / perRow) * ref.frameH;
          ctx.drawImage(img, sx, sy, ref.frameW, ref.frameH, 0, 0, ref.frameW, ref.frameH);
          return canvas;
        });
      }
      state.loaded = true;
      resolveReady(sheet);
    },
    (err: unknown) => rejectReady(err),
  );
  return sheet;
}

/** Build the drawable sheet for either sprite kind. */
export function createSpriteSheet(ref: SpriteRef): SpriteSheet {
  return ref.kind === 'pixels' ? buildPixelSheet(ref) : buildPngSheet(ref);
}

// --------------------------------------------------------------------------
// Playback
// --------------------------------------------------------------------------

/**
 * Which frame to show. The simulation only sets `anim.name` and counts `anim.t`
 * (DESIGN §2.4); choosing the frame is presentation, so it happens here.
 */
export function frameIndexFor(sheet: SpriteSheet, name: AnimName, t: number): number {
  const frames = sheet.frames[name];
  const count = frames ? frames.length : 0;
  if (count <= 1) return 0;
  const perFrame = Math.max(1, sheet.frameTicks[name] ?? 1);
  const raw = Math.floor(t / perFrame);
  if (sheet.loop[name]) return ((raw % count) + count) % count;
  return Math.min(count - 1, Math.max(0, raw));
}

export function frameCanvasFor(
  sheet: SpriteSheet,
  name: AnimName,
  t: number,
): HTMLCanvasElement | undefined {
  const frames = sheet.frames[name];
  if (!frames || frames.length === 0) return undefined;
  return frames[frameIndexFor(sheet, name, t)];
}

// --------------------------------------------------------------------------
// Drawing
// --------------------------------------------------------------------------

/**
 * Draw a mobile at a screen position. `tilt` is screen-space radians (positive =
 * clockwise), so it goes straight into `ctx.rotate`; the facing mirror is applied
 * *inside* the rotated frame so the hull keeps hugging the slope.
 */
export function drawMobile(
  ctx: CanvasRenderingContext2D,
  sheet: SpriteSheet,
  m: MobileState,
  screenX: number,
  screenY: number,
): void {
  const frame = frameCanvasFor(sheet, m.anim.name, m.anim.t);
  if (!frame) return;
  ctx.save();
  ctx.translate(Math.round(screenX), Math.round(screenY));
  ctx.rotate(m.tilt);
  ctx.scale(m.facing, 1);
  ctx.drawImage(frame, -sheet.anchor.x, -sheet.anchor.y);
  ctx.restore();
}

/**
 * A walking mine (DESIGN §3, raon), standing on (screenX, screenY). Drawn from the
 * projectile atlas by its sprite key; until that has loaded (or with `?sprites=pixel`)
 * a box with a blinking pip — it has to be drawn: a mine is persistent state that walks
 * toward you and detonates, and an invisible one is unplayable.
 */
export function drawMine(
  ctx: CanvasRenderingContext2D,
  spriteKey: string,
  screenX: number,
  screenY: number,
  tick: number,
): void {
  const piece = projectilePiece(spriteKey);
  const top = piece ? screenY - piece.size[1] / 2 + 1 : screenY;
  if (piece && drawProjectileSprite(ctx, spriteKey, screenX, top, 0, 0, tick)) return;
  const c = clientConstants.mines;
  const x = Math.round(screenX);
  const y = Math.round(screenY);
  ctx.fillStyle = c.body;
  ctx.fillRect(x - c.halfPx, y - c.halfPx * 2, c.halfPx * 2, c.halfPx * 2);
  if (tick % c.blinkTicks < c.blinkTicks / 2) {
    ctx.fillStyle = c.pip;
    ctx.fillRect(x - 1, y - c.halfPx * 2 - 1, 2, 2);
  }
}

/** What {@link drawProjectile} needs of a `ProjectileState`. */
export interface ProjectileLook {
  def: { sprite: string };
  vx: number;
  vy: number;
  age: number;
  data: Record<string, number>;
}

/**
 * A projectile, drawn from its sprite key: the Blender atlas pointed along its flight,
 * or a plain square while the atlas loads (and with `?sprites=pixel`). A cluster's
 * fragments draw as `<key>Fragment` when the atlas has one.
 */
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  p: ProjectileLook,
  screenX: number,
  screenY: number,
): void {
  const fragment = p.data.fragment ? `${p.def.sprite}Fragment` : undefined;
  const key = fragment && projectilePiece(fragment) ? fragment : p.def.sprite;
  if (drawProjectileSprite(ctx, key, screenX, screenY, p.vx, p.vy, p.age)) return;
  const spriteKey = p.def.sprite;
  const sizes = clientConstants.projectiles.radiusPx as Record<string, number>;
  const r = sizes[spriteKey] ?? sizes.default ?? 3;
  const x = Math.round(screenX);
  const y = Math.round(screenY);
  ctx.fillStyle = clientConstants.projectiles.body;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.fillStyle = clientConstants.projectiles.highlight;
  ctx.fillRect(x - r + 1, y - r + 1, Math.max(1, r - 1), Math.max(1, r - 1));
}
