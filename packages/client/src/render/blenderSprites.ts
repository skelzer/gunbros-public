/**
 * Mobiles pre-rendered in Blender (tools/blender), the default renderer.
 *
 * Every mobile with an atlas is drawn from two registered sprite sheets instead of its
 * pixel grid: a body layer rotated to the terrain slope exactly as `drawMobile` does
 * it, and a barrel layer rotated about the atlas pivot to the aim angle. Open the
 * client with `?sprites=pixel` to see the hand-drawn pixel grids instead; then nothing
 * in this file runs and no asset is fetched.
 */
import type { AnimName, MobileId, MobileState } from '@gunbros/shared';

interface AtlasFrame {
  rect: [number, number, number, number];
  /** False once the barrel has been blown off (late death frames). */
  barrel: boolean;
  /** Barrel pivot in body-frame pixels; moves with recoil kicks and jolts. */
  pivot: [number, number];
  muzzle: [number, number];
}

interface AtlasState {
  frameTicks: number;
  loop: boolean;
  frames: AtlasFrame[];
}

interface Atlas {
  frameSize: [number, number];
  anchor: [number, number];
  barrelLength: number;
  tickRate: number;
  sheets: { body: string; barrel: string };
  /** `charge` is optional: a looping wind-up shown while the player holds the fire key. */
  states: Record<AnimName, AtlasState> & { charge?: AtlasState };
}

interface Playback {
  /** The state on screen, which may outlive the simulation's (see `frameFor`). */
  name: AnimName;
  simName: AnimName;
  startMs: number;
}

export interface BlenderSheet {
  readonly atlas: Atlas;
  readonly body: HTMLImageElement;
  readonly barrel: HTMLImageElement;
  readonly playback: Map<number, Playback>;
}

/** Atlas name per mobile. Mobiles without an entry keep their pixel sprite. */
const ATLASES: Partial<Record<MobileId, string>> = {
  armor: 'tank',
  bigfoot: 'walker',
  raon: 'sapper',
  turtle: 'turtle',
  kalsiddon: 'shrike',
  jfrog: 'frog',
  jd: 'vortex',
  lightning: 'tempest',
  boomer: 'zephyr',
  mage: 'sorcerer',
  aduka: 'herald',
  knight: 'paladin',
  grub: 'skipper',
  nak: 'delver',
  ice: 'frostbite',
  trico: 'triclops',
  asate: 'orbital',
  dragon: 'wyvern',
};
const ASSET_ROOT = `${import.meta.env.BASE_URL}sprites/blender/`;

let enabledCache: boolean | null = null;

export function blenderSpritesEnabled(): boolean {
  if (enabledCache === null) {
    enabledCache =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('sprites') !== 'pixel';
  }
  return enabledCache;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load sprite sheet: ${url}`));
    img.src = url;
  });
}

const sheets = new Map<MobileId, BlenderSheet | 'loading' | 'failed'>();
const loads = new Map<MobileId, Promise<BlenderSheet | undefined>>();

/**
 * Load a mobile's Blender sheet (once). Resolves with undefined when the toggle is off,
 * the mobile has no atlas, or the assets failed to load.
 */
export function loadBlenderSheet(id: MobileId): Promise<BlenderSheet | undefined> {
  if (!blenderSpritesEnabled()) return Promise.resolve(undefined);
  const name = ATLASES[id];
  if (!name) return Promise.resolve(undefined);
  const known = loads.get(id);
  if (known) return known;
  sheets.set(id, 'loading');
  const load = (async (): Promise<BlenderSheet | undefined> => {
    try {
      const res = await fetch(`${ASSET_ROOT}${name}.json`);
      if (!res.ok) throw new Error(`atlas ${name}: HTTP ${res.status}`);
      const atlas = (await res.json()) as Atlas;
      const [body, barrel] = await Promise.all([
        loadImage(ASSET_ROOT + atlas.sheets.body),
        loadImage(ASSET_ROOT + atlas.sheets.barrel),
      ]);
      const sheet: BlenderSheet = { atlas, body, barrel, playback: new Map() };
      sheets.set(id, sheet);
      return sheet;
    } catch (err) {
      console.warn('[blender sprites] falling back to the pixel sprite:', err);
      sheets.set(id, 'failed');
      return undefined;
    }
  })();
  loads.set(id, load);
  return load;
}

/**
 * The Blender sheet for a mobile, or undefined while the toggle is off, the mobile has
 * no atlas, or the assets are still loading. Callers fall back to the pixel sprite.
 */
export function blenderSheetFor(id: MobileId): BlenderSheet | undefined {
  if (!blenderSpritesEnabled() || !ATLASES[id]) return undefined;
  const known = sheets.get(id);
  if (known) return typeof known === 'string' ? undefined : known;
  void loadBlenderSheet(id);
  return undefined;
}

/**
 * Which state and frame to show. The simulation ends `fire` and `hurt` after the
 * *pixel* sprite's duration, which is shorter than these animations, so a one-shot
 * that has started plays to its end on a local clock before the mobile goes back to
 * whatever the simulation says. Looping states and death follow the simulation's own
 * counter, so they stay in step with everything else.
 */
function frameFor(
  sheet: BlenderSheet,
  m: MobileState,
  nowMs: number,
  charging: boolean,
): AtlasFrame | undefined {
  const { atlas, playback } = sheet;
  const tickMs = 1000 / atlas.tickRate;
  const sim = m.anim.name;
  let p = playback.get(m.seat);
  if (!p) {
    p = { name: sim, simName: sim, startMs: nowMs - m.anim.t * tickMs };
    playback.set(m.seat, p);
  }
  const oneShot = (name: AnimName): boolean => !atlas.states[name].loop && name !== 'death';
  const length = (name: AnimName): number =>
    atlas.states[name].frames.length * atlas.states[name].frameTicks * tickMs;

  if (sim !== p.simName) {
    p.simName = sim;
    const busy = oneShot(p.name) && nowMs - p.startMs < length(p.name);
    if (oneShot(sim) || sim === 'death' || !busy) {
      p.name = sim;
      p.startMs = nowMs - m.anim.t * tickMs;
    }
  } else if (p.name !== sim && nowMs - p.startMs >= length(p.name)) {
    p.name = sim;
  }

  // Winding up: only from a resting state, so it never cuts a fire, hurt or death short.
  const charge = atlas.states.charge;
  if (charging && charge && (p.name === 'idle' || p.name === 'move')) {
    const step = Math.floor(nowMs / (Math.max(1, charge.frameTicks) * tickMs));
    return charge.frames[step % charge.frames.length];
  }

  const state = atlas.states[p.name];
  const elapsedTicks = oneShot(p.name) ? (nowMs - p.startMs) / tickMs : m.anim.t;
  const raw = Math.floor(elapsedTicks / Math.max(1, state.frameTicks));
  const count = state.frames.length;
  const index = state.loop ? ((raw % count) + count) % count : Math.min(count - 1, Math.max(0, raw));
  return state.frames[index];
}

/**
 * Draw a mobile from its Blender sheets. Same transform as `drawMobile` for the body;
 * `relAngleDeg` is the aim relative to the hull, so inside the tilted, mirrored frame
 * the barrel simply turns anticlockwise by it. `charging` is true while this mobile's
 * player is holding the fire key.
 */
export function drawBlenderMobile(
  ctx: CanvasRenderingContext2D,
  sheet: BlenderSheet,
  m: MobileState,
  relAngleDeg: number,
  screenX: number,
  screenY: number,
  charging = false,
): void {
  const frame = frameFor(sheet, m, performance.now(), charging);
  if (!frame) return;
  const [sx, sy, w, h] = frame.rect;
  const [ax, ay] = sheet.atlas.anchor;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(screenX), Math.round(screenY));
  ctx.rotate(m.tilt);
  ctx.scale(m.facing, 1);
  ctx.drawImage(sheet.body, sx, sy, w, h, -ax, -ay, w, h);
  if (frame.barrel) {
    const [px, py] = frame.pivot;
    ctx.translate(px - ax, py - ay);
    ctx.rotate((-relAngleDeg * Math.PI) / 180);
    ctx.drawImage(sheet.barrel, sx, sy, w, h, -px, -py, w, h);
  }
  ctx.restore();
}

/** How long one idle frame shows, in ms, and how many there are. */
export function blenderIdleTiming(sheet: BlenderSheet): { count: number; frameMs: number } {
  const idle = sheet.atlas.states.idle;
  return {
    count: idle.frames.length,
    frameMs: (Math.max(1, idle.frameTicks) * 1000) / sheet.atlas.tickRate,
  };
}

/**
 * One idle frame, standing level and facing right with the barrel raised
 * `relAngleDeg`, its anchor (the feet) on `x, y`. The menus' portraits are built from
 * this: no simulation state, just the pose.
 */
export function drawBlenderIdleFrame(
  ctx: CanvasRenderingContext2D,
  sheet: BlenderSheet,
  index: number,
  x: number,
  y: number,
  relAngleDeg: number,
): void {
  const frames = sheet.atlas.states.idle.frames;
  const frame = frames[((index % frames.length) + frames.length) % frames.length];
  if (!frame) return;
  const [sx, sy, w, h] = frame.rect;
  const [ax, ay] = sheet.atlas.anchor;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(x), Math.round(y));
  ctx.drawImage(sheet.body, sx, sy, w, h, -ax, -ay, w, h);
  if (frame.barrel) {
    const [px, py] = frame.pivot;
    ctx.translate(px - ax, py - ay);
    ctx.rotate((-relAngleDeg * Math.PI) / 180);
    ctx.drawImage(sheet.barrel, sx, sy, w, h, -px, -py, w, h);
  }
  ctx.restore();
}
