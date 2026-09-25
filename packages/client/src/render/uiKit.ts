/**
 * The UI kit pre-rendered in Blender (tools/blender/build_ui_kit.py): panel frames, gem
 * buttons in four states, the angle dial face, the power bar trough and fills, the wind
 * plate and arrow, the turn banner plate, weapon card and item slot frames, and an icon
 * for every shot, item and status. One atlas, `public/ui/blender/ui_kit.png`, described
 * by `ui_kit.json`.
 *
 * Five kinds of piece:
 *
 * - `nine`: a nine-slice frame. Its edge strips and its centre are uniform along their
 *   length (the packer makes them so), so {@link drawNineSlice} stretches them to any
 *   size without seams and the same PNG works as a CSS `border-image`.
 * - `hbar`: a bar fill whose columns are all the same; {@link drawBar} stretches it.
 * - `sprite` and `icon`: drawn as they are, at a whole-pixel scale.
 * - `strip`: frames of one piece, e.g. the wind arrow turned every `stepDeg` degrees
 *   (clockwise on screen, 0 pointing right, like `WindState.directionDeg`).
 *
 * Every draw helper returns false while the atlas is still loading (or failed), so a
 * caller can fall back to the hand-drawn skin in `hud.ts` for those frames.
 */
import { itemIds, shotSlots } from '@gunbros/shared';
import type { ItemId, ShotSlot } from '@gunbros/shared';
import { createOffscreen } from './canvas.js';

export const BUTTON_STATES = ['normal', 'hover', 'pressed', 'disabled'] as const;
export const CARD_STATES = ['normal', 'hover', 'selected', 'locked'] as const;
export const SLOT_STATES = ['empty', 'filled', 'used', 'active'] as const;
export const FILL_COLOURS = ['amber', 'cyan', 'green', 'red', 'violet'] as const;
/**
 * What a mobile or a player can be marked with: shield up, frozen (the ice defence
 * debuff), boosted (Power Up), digging (Bunge), a dual shot queued, SS ready, dead,
 * disconnected, delay, hp, the three sky events, a walking mine.
 */
export const STATUS_ICONS = [
  'shield',
  'frozen',
  'boost',
  'dig',
  'dual',
  'ssReady',
  'dead',
  'offline',
  'delay',
  'heart',
  'thor',
  'tornado',
  'force',
  'mine',
] as const;

export type ButtonState = (typeof BUTTON_STATES)[number];
export type CardState = (typeof CARD_STATES)[number];
export type SlotState = (typeof SLOT_STATES)[number];
export type FillColour = (typeof FILL_COLOURS)[number];
export type StatusIcon = (typeof STATUS_ICONS)[number];

export type NinePiece =
  | 'panel'
  | 'panel-dark'
  | 'panel-bar'
  | 'recess'
  | 'frame-gold'
  | `button/${ButtonState}`
  | `button-gold/${ButtonState}`
  | 'trough'
  | 'trough-small'
  | 'banner/gold'
  | 'banner/steel'
  | `card/${CardState}`
  | `slot/${SlotState}`;
export type BarPiece = `fill/${FillColour}` | `fill-small/${FillColour}`;
export type SpritePiece = 'power-marker' | 'dial' | 'dial-small' | 'dial-hub' | 'wind-plate';
export type IconPiece = `shot/${ShotSlot}` | `item/${ItemId}` | `status/${StatusIcon}`;
export type StripPiece = 'wind-arrow';
export type UiPieceName = NinePiece | BarPiece | SpritePiece | IconPiece | StripPiece;

/** Every piece the client expects the atlas to hold, in a stable order. */
export function uiPieceNames(): UiPieceName[] {
  const names: UiPieceName[] = ['panel', 'panel-dark', 'panel-bar', 'recess', 'frame-gold'];
  for (const s of BUTTON_STATES) names.push(`button/${s}`, `button-gold/${s}`);
  names.push('trough', 'trough-small', 'banner/gold', 'banner/steel');
  for (const s of CARD_STATES) names.push(`card/${s}`);
  for (const s of SLOT_STATES) names.push(`slot/${s}`);
  for (const c of FILL_COLOURS) names.push(`fill/${c}`, `fill-small/${c}`);
  names.push('power-marker', 'dial', 'dial-small', 'dial-hub', 'wind-plate', 'wind-arrow');
  for (const s of shotSlots) names.push(`shot/${s}`);
  for (const id of itemIds) names.push(`item/${id}`);
  for (const s of STATUS_ICONS) names.push(`status/${s}`);
  return names;
}

export type PieceKind = 'nine' | 'hbar' | 'sprite' | 'icon' | 'strip';
/** x, y, w, h in atlas pixels. */
export type AtlasRect = [number, number, number, number];

export interface UiPiece {
  kind: PieceKind;
  /** The first (or only) frame. */
  rect: AtlasRect;
  /** Nine-slice insets, CSS order: top, right, bottom, left. */
  slices?: [number, number, number, number];
  /** The point to rotate or anchor about, in piece pixels (dial centre, marker tip). */
  pivot?: [number, number];
  /** Every frame of a strip, `rect` included. */
  frames?: AtlasRect[];
  /** Degrees between two frames of a turning strip. */
  stepDeg?: number;
}

export interface UiKitAtlas {
  image: string;
  size: [number, number];
  pieces: Record<string, UiPiece>;
}

export interface UiKit {
  readonly atlas: UiKitAtlas;
  readonly image: HTMLImageElement;
}

const ASSET_ROOT = `${import.meta.env.BASE_URL}ui/blender/`;

let kit: UiKit | 'loading' | 'failed' | null = null;
let pending: Promise<UiKit> | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load the UI kit: ${url}`));
    img.src = url;
  });
}

/** Load the atlas (once). Resolves with the kit; rejects if the files are missing. */
export function loadUiKit(): Promise<UiKit> {
  if (!pending) {
    kit = 'loading';
    pending = (async () => {
      const res = await fetch(`${ASSET_ROOT}ui_kit.json`);
      if (!res.ok) throw new Error(`ui_kit.json: HTTP ${res.status}`);
      const atlas = (await res.json()) as UiKitAtlas;
      const image = await loadImage(ASSET_ROOT + atlas.image);
      const loaded: UiKit = { atlas, image };
      kit = loaded;
      return loaded;
    })();
    pending.catch((err: unknown) => {
      console.warn('[ui kit] not available, the hand-drawn skin stays:', err);
      kit = 'failed';
    });
  }
  return pending;
}

/** The kit if it has loaded; otherwise starts the load and returns undefined. */
export function uiKit(): UiKit | undefined {
  if (kit === null) void loadUiKit().catch(() => undefined);
  return typeof kit === 'object' && kit !== null ? kit : undefined;
}

export function uiPiece(name: UiPieceName): UiPiece | undefined {
  return uiKit()?.atlas.pieces[name];
}

/** Size of a piece (one frame) in atlas pixels, or [0, 0] before the kit has loaded. */
export function uiPieceSize(name: UiPieceName): [number, number] {
  const p = uiPiece(name);
  return p ? [p.rect[2], p.rect[3]] : [0, 0];
}

// --------------------------------------------------------------------------
// Canvas
// --------------------------------------------------------------------------

/** One blit: source rect in the atlas, destination rect on the canvas. */
export type Blit = [number, number, number, number, number, number, number, number];

/**
 * The nine blits that draw a nine-slice piece over `w` x `h` at `x, y`, with the
 * corners at `scale`. Pure, so the arithmetic is testable without a canvas. Every
 * destination edge is a whole pixel; a box smaller than its two corners drops the
 * middle row or column rather than overlapping them.
 */
export function nineSliceBlits(
  piece: Pick<UiPiece, 'rect' | 'slices'>,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
): Blit[] {
  const [sx, sy, sw, sh] = piece.rect;
  const [t, r, b, l] = piece.slices ?? [0, 0, 0, 0];
  const dx = Math.round(x);
  const dy = Math.round(y);
  const dw = Math.round(w);
  const dh = Math.round(h);
  const cols: Array<[number, number, number, number]> = [
    // source x, source w, destination x, destination w
    [sx, l, dx, l * scale],
    [sx + l, sw - l - r, dx + l * scale, dw - (l + r) * scale],
    [sx + sw - r, r, dx + dw - r * scale, r * scale],
  ];
  const rows: Array<[number, number, number, number]> = [
    [sy, t, dy, t * scale],
    [sy + t, sh - t - b, dy + t * scale, dh - (t + b) * scale],
    [sy + sh - b, b, dy + dh - b * scale, b * scale],
  ];
  const out: Blit[] = [];
  for (const [ry, rh, ty, th] of rows) {
    if (rh <= 0 || th <= 0) continue;
    for (const [cx, cw, tx, tw] of cols) {
      if (cw <= 0 || tw <= 0) continue;
      out.push([cx, ry, cw, rh, tx, ty, tw, th]);
    }
  }
  return out;
}

/** A nine-slice piece stretched over `w` x `h` (destination pixels), corners at `scale`. */
export function drawNineSlice(
  ctx: CanvasRenderingContext2D,
  name: NinePiece,
  x: number,
  y: number,
  w: number,
  h: number,
  scale = 1,
): boolean {
  const k = uiKit();
  const p = k?.atlas.pieces[name];
  if (!k || !p) return false;
  for (const [sx, sy, sw, sh, dx, dy, dw, dh] of nineSliceBlits(p, x, y, w, h, scale)) {
    ctx.drawImage(k.image, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  return true;
}

/** A bar fill stretched to `w` px wide at its own height times `scale`. */
export function drawBar(
  ctx: CanvasRenderingContext2D,
  name: BarPiece,
  x: number,
  y: number,
  w: number,
  scale = 1,
): boolean {
  const k = uiKit();
  const p = k?.atlas.pieces[name];
  if (!k || !p) return false;
  const width = Math.round(w);
  if (width <= 0) return true;
  const [sx, sy, sw, sh] = p.rect;
  ctx.drawImage(k.image, sx, sy, sw, sh, Math.round(x), Math.round(y), width, sh * scale);
  return true;
}

/** A piece (or one frame of a strip) with its top-left at `x, y`. */
export function drawUiPiece(
  ctx: CanvasRenderingContext2D,
  name: UiPieceName,
  x: number,
  y: number,
  scale = 1,
  frame = 0,
): boolean {
  const k = uiKit();
  const p = k?.atlas.pieces[name];
  if (!k || !p) return false;
  const frames = p.frames ?? [p.rect];
  const [sx, sy, sw, sh] = frames[((frame % frames.length) + frames.length) % frames.length] ?? p.rect;
  ctx.drawImage(k.image, sx, sy, sw, sh, Math.round(x), Math.round(y), sw * scale, sh * scale);
  return true;
}

/** A piece drawn with its pivot (or its centre, if it has none) on `x, y`. */
export function drawUiPieceAt(
  ctx: CanvasRenderingContext2D,
  name: UiPieceName,
  x: number,
  y: number,
  scale = 1,
  frame = 0,
): boolean {
  const p = uiPiece(name);
  if (!p) return false;
  const [px, py] = p.pivot ?? [p.rect[2] / 2, p.rect[3] / 2];
  return drawUiPiece(ctx, name, Math.round(x - px * scale), Math.round(y - py * scale), scale, frame);
}

/** The strip frame closest to `deg` (clockwise on screen, 0 = right). */
export function stripFrameFor(name: StripPiece, deg: number): number {
  const p = uiPiece(name);
  if (!p?.stepDeg || !p.frames) return 0;
  const n = p.frames.length;
  return ((Math.round(deg / p.stepDeg) % n) + n) % n;
}

// --------------------------------------------------------------------------
// DOM
// --------------------------------------------------------------------------

const cropCache = new Map<string, HTMLCanvasElement>();

/** One frame of a piece cut out of the atlas onto its own canvas (cached). */
function cropped(k: UiKit, name: UiPieceName, frame = 0): HTMLCanvasElement | undefined {
  const key = `${name}#${frame}`;
  const hit = cropCache.get(key);
  if (hit) return hit;
  const p = k.atlas.pieces[name];
  if (!p) return undefined;
  const [sx, sy, sw, sh] = (p.frames ?? [p.rect])[frame] ?? p.rect;
  const { canvas, ctx } = createOffscreen(sw, sh);
  ctx.drawImage(k.image, sx, sy, sw, sh, 0, 0, sw, sh);
  cropCache.set(key, canvas);
  return canvas;
}

/**
 * A fresh canvas holding a piece at a whole-pixel `scale`, sized in CSS pixels, for the
 * DOM menus. Empty (but correctly sized) until the kit has loaded; it fills itself in.
 */
export function uiPieceElement(name: UiPieceName, scale = 2, frame = 0): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'uk-piece';
  canvas.style.imageRendering = 'pixelated';
  const paint = (k: UiKit): void => {
    const src = cropped(k, name, frame);
    if (!src) return;
    canvas.width = src.width * scale;
    canvas.height = src.height * scale;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  };
  const k = uiKit();
  if (k) paint(k);
  else void loadUiKit().then(paint, () => undefined);
  return canvas;
}

/** `button-gold/hover` -> `uk-button-gold-hover`. */
export function uiClassName(name: NinePiece): string {
  return `uk-${name.replace(/\//g, '-')}`;
}

function nineSliceRule(k: UiKit, name: NinePiece, selector: string): string {
  const p = k.atlas.pieces[name];
  const src = cropped(k, name);
  if (!p?.slices || !src) return '';
  const [t, r, b, l] = p.slices;
  const width = [t, r, b, l].map((n) => `calc(var(--uk-scale, 2) * ${n}px)`).join(' ');
  return (
    `${selector}{border-style:solid;border-width:${width};` +
    `border-image-source:url(${src.toDataURL('image/png')});` +
    `border-image-slice:${t} ${r} ${b} ${l} fill;border-image-width:${width};` +
    'border-image-repeat:stretch;background:none;image-rendering:pixelated;}'
  );
}

let cssInstalled: Promise<void> | null = null;

/**
 * Put every nine-slice piece in the page as a CSS class: `.uk-panel`, `.uk-card-selected`,
 * `.uk-slot-used`, … Each is a `border-image` cut from the atlas, drawn at
 * `--uk-scale` (default 2) CSS px per atlas pixel, with its centre filled. Two state
 * classes follow the pointer by themselves: `.uk-btn` and `.uk-btn-gold` are the blue
 * and gold gem keys, lit on hover, sunk while pressed and grey when `:disabled`.
 *
 * Resolves once the style sheet is in; before that the classes simply do nothing, so
 * the page keeps whatever it had.
 */
export function installUiKitCss(): Promise<void> {
  if (!cssInstalled) {
    cssInstalled = loadUiKit().then((k) => {
      const rules: string[] = [];
      for (const name of uiPieceNames()) {
        const p = k.atlas.pieces[name];
        if (p?.kind !== 'nine') continue;
        rules.push(nineSliceRule(k, name as NinePiece, `.${uiClassName(name as NinePiece)}`));
      }
      for (const [cls, base] of [
        ['uk-btn', 'button'],
        ['uk-btn-gold', 'button-gold'],
      ] as const) {
        rules.push(nineSliceRule(k, `${base}/normal`, `.${cls}`));
        // Hover only where there is a pointer to hover with: on a phone it sticks.
        const hover = nineSliceRule(k, `${base}/hover`, `.${cls}:hover:not(:disabled)`);
        if (hover) rules.push(`@media (hover:hover){${hover}}`);
        rules.push(nineSliceRule(k, `${base}/pressed`, `.${cls}:active:not(:disabled)`));
        rules.push(nineSliceRule(k, `${base}/disabled`, `.${cls}:disabled`));
      }
      const style = document.createElement('style');
      style.dataset.uiKit = '';
      style.textContent = rules.join('\n');
      document.head.appendChild(style);
    });
  }
  return cssInstalled;
}
