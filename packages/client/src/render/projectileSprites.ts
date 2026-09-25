/**
 * Projectiles and mines pre-rendered in Blender (tools/blender/build_projectiles.py).
 * One atlas, `public/sprites/blender/projectiles.png`, described by `projectiles.json`,
 * keyed by the sprite key the simulation puts on every projectile def and mine.
 *
 * Three modes of piece:
 *
 * - `aim`: `dirs` directions, frame `d * anim + a` points d * 360 / dirs degrees
 *   counter-clockwise from right. Drawn in the direction of flight, never rotated on
 *   the canvas, so the pixels stay crisp and the light stays top-left.
 * - `spin`: frames turning clockwise, played by age; reversed when the shot flies left
 *   so a boulder rolls the way it travels.
 * - `loop`: frames played by age as they are.
 *
 * A key the atlas does not have (or a load that failed, or `?sprites=pixel`) makes
 * {@link drawProjectileSprite} return false and the caller draws its plain fallback.
 */
import { blenderSpritesEnabled } from './blenderSprites.js';

export type ProjectileMode = 'aim' | 'spin' | 'loop';

/**
 * Sprite keys the atlas must hold beside the ones named on a shot: what behaviours spawn
 * (cluster fragments, shatter shards, bubbles) and the walking mines.
 */
export const EXTRA_SPRITE_KEYS: {
  key: string;
  note: string;
  mine?: boolean;
}[] = [
  { key: 'clusterPodFragment', note: 'shrike cluster pod bomblet' },
  { key: 'iceShard', note: 'frostbite Shatter shards' },
  { key: 'bubble', note: 'deepshell Bubble Burst bubbles' },
  { key: 'mine', note: 'sapper mine (walking)', mine: true },
  { key: 'mineHeavy', note: 'sapper siege mine (walking)', mine: true },
];

export interface ProjectilePiece {
  mode: ProjectileMode;
  size: [number, number];
  dirs: number;
  anim: number;
  frameTicks: number;
  frames: [number, number, number, number][];
}

export interface ProjectileAtlas {
  image: string;
  size: [number, number];
  pieces: Record<string, ProjectilePiece>;
}

interface Loaded {
  atlas: ProjectileAtlas;
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
export function loadProjectileSprites(): void {
  if (state !== null || !blenderSpritesEnabled()) return;
  state = 'loading';
  void (async () => {
    try {
      const res = await fetch(`${ASSET_ROOT}projectiles.json`);
      if (!res.ok) throw new Error(`projectiles.json: HTTP ${res.status}`);
      const atlas = (await res.json()) as ProjectileAtlas;
      state = { atlas, image: await loadImage(ASSET_ROOT + atlas.image) };
    } catch (err) {
      console.warn('[projectiles] not available, the plain shells stay:', err);
      state = 'failed';
    }
  })();
}

/** The piece for a sprite key, once the atlas has loaded. */
export function projectilePiece(key: string): ProjectilePiece | undefined {
  loadProjectileSprites();
  return typeof state === 'object' && state !== null ? state.atlas.pieces[key] : undefined;
}

/**
 * Which frame of `piece` to show for a shot moving at (vx, vy) (world +y is down) that
 * is `ageTicks` old. Pure, so it is tested without an atlas.
 */
export function projectileFrame(
  piece: ProjectilePiece,
  vx: number,
  vy: number,
  ageTicks: number,
): number {
  const n = piece.frames.length;
  const step = Math.floor(Math.max(0, ageTicks) / Math.max(1, piece.frameTicks));
  if (piece.mode === 'aim') {
    const dirs = Math.max(1, piece.dirs);
    const anim = Math.max(1, piece.anim);
    const deg = vx === 0 && vy === 0 ? 0 : (Math.atan2(-vy, vx) * 180) / Math.PI;
    const d = (((Math.round((deg * dirs) / 360) % dirs) + dirs) % dirs) | 0;
    return Math.min(n - 1, d * anim + (step % anim));
  }
  if (piece.mode === 'spin' && vx < 0) return (n - (step % n)) % n;
  return step % n;
}

/**
 * Draw `key` centred on (screenX, screenY). Returns false when there is nothing to draw
 * it with yet, so the caller can fall back.
 */
export function drawProjectileSprite(
  ctx: CanvasRenderingContext2D,
  key: string,
  screenX: number,
  screenY: number,
  vx: number,
  vy: number,
  ageTicks: number,
): boolean {
  const piece = projectilePiece(key);
  if (!piece || typeof state !== 'object' || state === null) return false;
  const rect = piece.frames[projectileFrame(piece, vx, vy, ageTicks)];
  if (!rect) return false;
  const [sx, sy, w, h] = rect;
  ctx.drawImage(
    state.image,
    sx,
    sy,
    w,
    h,
    Math.round(screenX - w / 2),
    Math.round(screenY - h / 2),
    w,
    h,
  );
  return true;
}
