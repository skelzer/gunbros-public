/**
 * Mobile portraits for the menu screens: the mobile's idle animation, playing.
 *
 * The room's mobile picker is a wall of faces rather than a dropdown, because a mobile
 * is a *character* (docs/ART.md) and nobody picks a character from a list of words. The
 * art is the same sprite data the match draws, through the same loaders — the Blender
 * sheets by default, the hand-drawn pixel grids with `?sprites=pixel` — so a picker
 * tile can never disagree with what lands on the map.
 *
 * Each mobile's idle loop is rendered once into a strip of frames cropped to the union
 * of their lit pixels, and cached by mobile id: the room is rebuilt on every
 * `roomState` (DESIGN §6.2 — full state, no partial updates), and re-rendering
 * eighteen sheets each time would be real work. The canvas elements are not cached: a
 * DOM node can only be in one place at a time, so handing the same element to two
 * callers would silently move the first one.
 *
 * One `requestAnimationFrame` loop drives every portrait on the page. A portrait that
 * has left the document is dropped from it, so a scene never has to unregister
 * anything; with none left the loop stops.
 */
import { constants, getMobileDef } from '@gunbros/shared';
import type { MobileId } from '@gunbros/shared';
import { createOffscreen } from '../render/canvas.js';
import { createSpriteSheet } from '../render/sprites.js';
import {
  blenderIdleTiming,
  drawBlenderIdleFrame,
  loadBlenderSheet,
} from '../render/blenderSprites.js';
import { clientConstants } from '../data/clientConstants.js';

/** An idle loop, every frame the same size and cropped tight. */
interface IdleStrip {
  frames: HTMLCanvasElement[];
  frameMs: number;
  width: number;
  height: number;
}

const strips = new Map<MobileId, Promise<IdleStrip>>();

/** The box holding every lit pixel of every frame, or null if all are empty. */
function litBounds(frames: HTMLCanvasElement[]): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const frame of frames) {
    const ctx = frame.getContext('2d');
    if (!ctx) continue;
    const { data, width, height } = ctx.getImageData(0, 0, frame.width, frame.height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

function cropStrip(frames: HTMLCanvasElement[], frameMs: number): IdleStrip {
  const box = litBounds(frames);
  if (!box) return { frames, frameMs, width: frames[0]?.width ?? 1, height: frames[0]?.height ?? 1 };
  const [x, y, w, h] = box;
  const cropped = frames.map((frame) => {
    const { canvas, ctx } = createOffscreen(w, h);
    ctx.drawImage(frame, x, y, w, h, 0, 0, w, h);
    return canvas;
  });
  return { frames: cropped, frameMs, width: w, height: h };
}

async function buildStrip(id: MobileId): Promise<IdleStrip> {
  const blender = await loadBlenderSheet(id);
  if (blender) {
    const [fw, fh] = blender.atlas.frameSize;
    const { count, frameMs } = blenderIdleTiming(blender);
    // The barrel may swing outside the body's frame, so each frame gets room to spare
    // on every side before the crop takes it back.
    const pad = blender.atlas.barrelLength;
    const [ax, ay] = blender.atlas.anchor;
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const { canvas, ctx } = createOffscreen(fw + pad * 2, fh + pad * 2);
      drawBlenderIdleFrame(ctx, blender, i, ax + pad, ay + pad, clientConstants.ui.portrait.aimDeg);
      frames.push(canvas);
    }
    return cropStrip(frames, frameMs);
  }
  const sheet = createSpriteSheet(getMobileDef(id).sprite);
  await sheet.ready;
  const frameMs = Math.max(1, sheet.frameTicks.idle) * constants.tickMs;
  return cropStrip(sheet.frames.idle, frameMs);
}

function stripFor(id: MobileId): Promise<IdleStrip> {
  let strip = strips.get(id);
  if (!strip) {
    strip = buildStrip(id);
    strips.set(id, strip);
  }
  return strip;
}

// --------------------------------------------------------------------------
// The one animation loop
// --------------------------------------------------------------------------

interface Live {
  canvas: HTMLCanvasElement;
  strip: IdleStrip;
  scale: number;
  /** Offset into the loop (see `phaseFor`). */
  phaseMs: number;
  lastFrame: number;
  /** Has the canvas been in the document yet? Only then does leaving it mean "gone". */
  seen: boolean;
  /** When it was tracked: one that never makes it into the document is let go too. */
  bornMs: number;
}

/** Portraits never attached within this long are assumed thrown away. */
const ORPHAN_MS = 2000;

const live = new Set<Live>();
let rafId = 0;

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function paint(p: Live, index: number): void {
  const ctx = p.canvas.getContext('2d');
  const frame = p.strip.frames[index];
  if (!ctx || !frame) return;
  const { width, height } = p.canvas;
  const dw = Math.round(p.strip.width * p.scale);
  const dh = Math.round(p.strip.height * p.scale);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = false;
  // Stood on the bottom edge, centred: a row of tiles shares one baseline.
  ctx.drawImage(frame, Math.floor((width - dw) / 2), height - dh, dw, dh);
  p.lastFrame = index;
}

function tick(now: number): void {
  rafId = 0;
  const still = reducedMotion();
  for (const p of live) {
    if (p.canvas.isConnected) p.seen = true;
    else if (p.seen || now - p.bornMs > ORPHAN_MS) {
      live.delete(p);
      continue;
    }
    const count = p.strip.frames.length;
    const index = still || count <= 1 ? 0 : Math.floor((now + p.phaseMs) / p.strip.frameMs) % count;
    if (index !== p.lastFrame) paint(p, index);
  }
  if (live.size > 0) rafId = window.requestAnimationFrame(tick);
}

function track(p: Live): void {
  live.add(p);
  paint(p, 0);
  if (!rafId) rafId = window.requestAnimationFrame(tick);
}

/**
 * A fixed offset into the loop per mobile: the neighbours in a row do not bob in
 * unison, and a portrait rebuilt by the next `roomState` carries on where it was.
 */
function phaseFor(id: MobileId, strip: IdleStrip): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return (hash % strip.frames.length) * strip.frameMs;
}

export interface PortraitOptions {
  /** Box size in CSS px. The canvas is exactly this big, one backing pixel per CSS px. */
  width?: number;
  height?: number;
  /** Largest whole-pixel blow-up to try; the biggest one that fits the box is used. */
  maxScale?: number;
}

/**
 * The mobile's idle loop, playing, stood on the bottom of a box of a fixed size so a
 * row of portraits shares one baseline whatever each sprite's own size is.
 *
 * The sprite is drawn at the largest *whole* scale that fits (never a fraction: a
 * half-pixel sprite is mush), and shrunk by a whole divisor in the rare case that even
 * 1x does not. Empty until the strip has loaded; it fills itself in.
 */
export function mobilePortraitCanvas(
  id: MobileId,
  options: PortraitOptions = {},
): HTMLCanvasElement {
  const p = clientConstants.ui.portrait;
  const width = Math.round(options.width ?? p.widthPx);
  const height = Math.round(options.height ?? p.heightPx);
  const maxScale = Math.max(1, Math.round(options.maxScale ?? p.maxScale));
  const { canvas } = createOffscreen(width, height);
  canvas.className = 'portrait';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.setAttribute('aria-hidden', 'true');

  void stripFor(id).then((strip) => {
    let scale = 1;
    while (
      scale < maxScale &&
      strip.width * (scale + 1) <= width &&
      strip.height * (scale + 1) <= height
    ) {
      scale++;
    }
    let divisor = 1;
    while (divisor < 8 && (strip.width / divisor > width || strip.height / divisor > height)) {
      divisor++;
    }
    track({
      canvas,
      strip,
      scale: divisor > 1 ? 1 / divisor : scale,
      phaseMs: phaseFor(id, strip),
      lastFrame: -1,
      seen: false,
      bornMs: performance.now(),
    });
  });
  return canvas;
}
