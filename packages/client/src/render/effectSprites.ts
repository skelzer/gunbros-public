/**
 * Effects pre-rendered in Blender (tools/blender/build_effects.py): blasts per damage
 * type in three size tiers, hit pops, smoke, the death blast, beams, the teleport and
 * the vortex, as flipbooks in one atlas, `public/sprites/blender/effects.png`, described
 * by `effects.json`.
 *
 * Every clip has a canvas `size` and an `anchor` (the canvas pixel drawn on the event's
 * position), a duration in sim ticks per frame, and per frame the rect of its trimmed
 * pixels in the atlas plus where that rect sits in the canvas. Nothing is ever scaled
 * or rotated on the canvas: a bigger blast is a bigger tier, never a stretched one.
 *
 * Until the atlas has loaded (or when it failed, or under `?sprites=pixel`)
 * {@link effectSpritesReady} is false and `render/effects.ts` draws its code effects.
 * The pure pieces (tier choice, damage-type fallback, frame by age) are exported for
 * the tests.
 */
import { blenderSpritesEnabled } from './blenderSprites.js';

/** [x, y, w, h, ox, oy]: atlas rect, then its top left inside the canvas. */
export type EffectFrame = [number, number, number, number, number, number];

export interface EffectClip {
  size: [number, number];
  anchor: [number, number];
  /** Sim ticks each frame stays up (60 a second). */
  ticks: number[];
  loop: boolean;
  /** Tiled vertically (a beam segment): its top and bottom rows meet without a seam. */
  tile?: boolean;
  frames: EffectFrame[];
}

export interface EffectAtlas {
  image: string;
  size: [number, number];
  tickRate: number;
  effects: Record<string, EffectClip>;
}

export interface Tier {
  tier: string;
  /** The radius (or width) in px the tier was drawn for. */
  px: number;
}

interface Loaded {
  atlas: EffectAtlas;
  image: HTMLImageElement;
}

const ASSET_ROOT = `${import.meta.env.BASE_URL}sprites/blender/`;

let state: Loaded | 'loading' | 'failed' | null = null;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Start fetching the atlas (once). Safe to call every frame. */
export function loadEffectSprites(): void {
  if (state !== null || !blenderSpritesEnabled()) return;
  state = 'loading';
  void (async () => {
    try {
      const res = await fetch(`${ASSET_ROOT}effects.json`);
      if (!res.ok) throw new Error(`effects.json: HTTP ${res.status}`);
      const atlas = (await res.json()) as EffectAtlas;
      state = { atlas, image: await loadImage(ASSET_ROOT + atlas.image) };
    } catch (err) {
      console.warn('[effects] sprites not available, the code effects stay:', err);
      state = 'failed';
    }
  })();
}

/** True once the atlas is in and sprites should be drawn instead of the code effects. */
export function effectSpritesReady(): boolean {
  loadEffectSprites();
  return typeof state === 'object' && state !== null;
}

/** The clip for a key, once the atlas has loaded. */
export function effectClip(key: string): EffectClip | undefined {
  return typeof state === 'object' && state !== null ? state.atlas.effects[key] : undefined;
}

// --------------------------------------------------------------------------
// Pure helpers
// --------------------------------------------------------------------------

/** Total ticks a clip runs for, once through. */
export function clipLength(clip: Pick<EffectClip, 'ticks'>): number {
  let n = 0;
  for (const t of clip.ticks) n += Math.max(1, t);
  return n;
}

/**
 * The frame to show `age` ticks after the clip started: -1 before it starts and once a
 * clip that does not loop has run out, so the caller can drop it.
 */
export function clipFrameAt(clip: Pick<EffectClip, 'ticks' | 'loop'>, age: number): number {
  if (age < 0 || clip.ticks.length === 0) return -1;
  const total = clipLength(clip);
  let a = Math.floor(age);
  if (a >= total) {
    if (!clip.loop) return -1;
    a %= total;
  }
  for (let i = 0; i < clip.ticks.length; i++) {
    a -= Math.max(1, clip.ticks[i] as number);
    if (a < 0) return i;
  }
  return clip.ticks.length - 1;
}

/** The tier drawn nearest `px` (ties go to the bigger one). `tiers` in any order. */
export function nearestTier(tiers: readonly Tier[], px: number): Tier {
  let best = tiers[0] as Tier;
  for (const t of tiers) {
    const d = Math.abs(t.px - px);
    const bd = Math.abs(best.px - px);
    if (d < bd || (d === bd && t.px > best.px)) best = t;
  }
  return best;
}

/**
 * How many extra blasts a carve radius past the biggest tier gets: nothing is scaled, so
 * a dragon's 88 px carve is the large blast plus a ring of medium ones round it.
 */
export function satelliteCount(
  radiusPx: number,
  fromPx: number,
  perPx: number,
  max: number,
): number {
  if (radiusPx < fromPx) return 0;
  return Math.min(max, 1 + Math.floor((radiusPx - fromPx) / Math.max(1, perPx)));
}

/**
 * `<prefix>_<damageType><suffix>` if the atlas has it, else the explosive one, else
 * undefined: a damage type added to the game later still gets a blast.
 */
export function keyForType(
  prefix: string,
  damageType: string,
  suffix: string,
  has: (key: string) => boolean,
): string | undefined {
  const own = `${prefix}_${damageType}${suffix}`;
  if (has(own)) return own;
  const fallback = `${prefix}_explosive${suffix}`;
  return has(fallback) ? fallback : undefined;
}

/** True when the loaded atlas has `key`. */
export function hasEffect(key: string): boolean {
  return effectClip(key) !== undefined;
}

/**
 * Draw frame `frame` of `clip` with its anchor on (screenX, screenY), optionally only
 * the canvas rows above `toRow` (a beam's last tile is cut where the beam lands).
 */
export function drawEffectFrame(
  ctx: CanvasRenderingContext2D,
  clip: EffectClip,
  frame: number,
  screenX: number,
  screenY: number,
  toRow = Infinity,
): void {
  if (typeof state !== 'object' || state === null) return;
  const f = clip.frames[frame];
  if (!f) return;
  const [sx, sy, w, h, ox, oy] = f;
  if (w === 0 || h === 0) return;
  const rows = Math.min(h, Math.floor(toRow) - oy);
  if (rows <= 0) return;
  ctx.drawImage(
    state.image,
    sx,
    sy,
    w,
    rows,
    Math.round(screenX - clip.anchor[0] + ox),
    Math.round(screenY - clip.anchor[1] + oy),
    w,
    rows,
  );
}
