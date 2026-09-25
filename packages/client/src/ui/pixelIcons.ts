/**
 * The HUD's pixel icons: the shot selector, the eight items, and the small furniture
 * (speaker, chat, help, wind, timer, hp).
 *
 * Drawn as palette-indexed grids, exactly like a mobile sprite (docs/ART.md §5 — same
 * outline colour, same four-tone ramps, same light from the top left), so the bar reads
 * as part of the same game rather than as a toolbar. {@link iconCanvas} bakes one into an
 * offscreen canvas at a whole-pixel scale and caches it, because an icon is redrawn on
 * every frame of the bar and a `fillRect` per pixel per frame is not free.
 *
 * The grids themselves are plain data with no imports, so a preview script can render
 * them outside the browser.
 */
import { createOffscreen } from '../render/canvas.js';

/**
 * One palette for every icon, so a red is the same red everywhere. Indices 0-4 are the
 * outline and the metal ramp of docs/ART.md §5; the rest are the accent colours the
 * items need.
 */
export const ICON_PALETTE: Record<string, string> = {
  '0': '#10141c', // outline
  '1': '#3b4652', // metal shadow
  '2': '#6d7c8c', // metal mid
  '3': '#a8b8c6', // metal light
  '4': '#dfe9f2', // metal highlight
  '5': '#96271f', // red shadow
  '6': '#d84b3a', // red
  '7': '#ffd23f', // amber
  '8': '#fff0b0', // flash core
  '9': '#2e7d3a', // green shadow
  a: '#7cc45a', // green
  b: '#7fd8ff', // cyan
  c: '#2f6fa8', // blue
  d: '#ff8a2b', // orange
  e: '#b06ad8', // purple
  f: '#ffffff', // white
  g: '#c9a06a', // tan (bandage)
  h: '#5b6775', // dim metal
};

export type IconName =
  // shot selector
  | 's1'
  | 's2'
  | 'ss'
  // items (the ids of DESIGN §4)
  | 'dual'
  | 'dualPlus'
  | 'teleport'
  | 'healSmall'
  | 'healLarge'
  | 'bunge'
  | 'powerUp'
  | 'windChange'
  // furniture
  | 'sound'
  | 'muted'
  | 'musicOff'
  | 'help'
  | 'chat'
  | 'clock'
  | 'skull';

/** Every icon is 12x12: one size means one plate, one inset and one cache key. */
export const ICON_SIZE = 12;

const ICONS: Record<IconName, readonly string[]> = {
  // The light shell: small, with a stub of flame behind it.
  s1: [
    '............',
    '............',
    '............',
    '............',
    '............',
    '..0000000...',
    '.0d7886660..',
    '..0000000...',
    '............',
    '............',
    '............',
    '............',
  ],
  // The heavy shell: the same silhouette, bigger, with a shaded belly.
  s2: [
    '............',
    '............',
    '............',
    '...0000000..',
    '..078886660.',
    '.0d788866660',
    '..077866650.',
    '...0000000..',
    '............',
    '............',
    '............',
    '............',
  ],
  // The special: a shell's core inside a burst.
  ss: [
    '............',
    '.....8......',
    '..8..0..8...',
    '...07770....',
    '..07888870..',
    '8.07868870.8',
    '..07888870..',
    '...07770....',
    '..8..0..8...',
    '.....8......',
    '............',
    '............',
  ],
  // Two shells, offset: one shot that leaves as two.
  dual: [
    '............',
    '.0000000....',
    '0d7886660...',
    '.0000000....',
    '............',
    '............',
    '....0000000.',
    '...0d7886660',
    '....0000000.',
    '............',
    '............',
    '............',
  ],
  dualPlus: [
    '............',
    '.0000000....',
    '0d7886660...',
    '.0000000....',
    '............',
    '............',
    '....0000000.',
    '...0d7886660',
    '....0000000.',
    '.0a0........',
    '0aaa0.......',
    '.0a0........',
  ],
  teleport: [
    '............',
    '....000.....',
    '..00eee00...',
    '.0ebbbbbe0..',
    '0ebb000bbe0.',
    '0eb0f8f0be0.',
    '0ebb000bbe0.',
    '.0ebbbbbe0..',
    '..00eee00...',
    '....000.....',
    '............',
    '............',
  ],
  healSmall: [
    '............',
    '............',
    '............',
    '..00000000..',
    '.0gg4ff4gg0.',
    '0g4ffffff4g0',
    '0g4ff44ff4g0',
    '.0gg4ff4gg0.',
    '..00000000..',
    '............',
    '............',
    '............',
  ],
  healLarge: [
    '............',
    '....0000....',
    '...0h00h0...',
    '.0000000000.',
    '.0ffffffff0.',
    '.0fff66fff0.',
    '.0f666666f0.',
    '.0f666666f0.',
    '.0fff66fff0.',
    '.0ffffffff0.',
    '.0000000000.',
    '............',
  ],
  // A coil: three rings stacked and stepped to the right, so it reads as a spring
  // seen at an angle rather than as three bars.
  bunge: [
    '.00000000...',
    '0344444430..',
    '0300000030..',
    '.00000000...',
    '..00000000..',
    '.0344444430.',
    '.0300000030.',
    '..00000000..',
    '...00000000.',
    '..0344444430',
    '..0300000030',
    '...00000000.',
  ],
  powerUp: [
    '.....00.....',
    '....0880....',
    '...088880...',
    '..08877880..',
    '.0887777880.',
    '008877778800',
    '.0007777000.',
    '...077770...',
    '...077770...',
    '...000000...',
    '............',
    '............',
  ],
  windChange: [
    '............',
    '..0000000...',
    '.0bbbbbbb0..',
    '..0000000...',
    '............',
    '....0000000.',
    '...0bbbbbbb0',
    '....0000000.',
    '............',
    '..00000.....',
    '.0bbbbb0....',
    '..00000.....',
  ],
  sound: [
    '............',
    '............',
    '......00....',
    '.....0330...',
    '..0003330.b.',
    '.033333330bb',
    '.033333330bb',
    '..0003330.b.',
    '.....0330...',
    '......00....',
    '............',
    '............',
  ],
  muted: [
    '............',
    '............',
    '......00..6.',
    '.....03306..',
    '..0003336...',
    '.033333630..',
    '.033336330..',
    '..0006330...',
    '....60330...',
    '...6..00....',
    '............',
    '............',
  ],
  // The speaker, quiet, beside a slashed note: the effects play, the music does not.
  musicOff: [
    '............',
    '.........00.',
    '....0....0b0',
    '...0306..0b0',
    '.00330.6.0b0',
    '033330..60b0',
    '033330.006b0',
    '.00330.0bb60',
    '...030.0bbb6',
    '....0...000.',
    '............',
    '............',
  ],
  help: [
    '............',
    '............',
    '...00000....',
    '..0344430...',
    '..0340043...',
    '.....0430...',
    '....0430....',
    '....000.....',
    '............',
    '....000.....',
    '....040.....',
    '....000.....',
  ],
  chat: [
    '............',
    '..00000000..',
    '.0ffffffff0.',
    '0ffffffffff0',
    '0f1ff1ff1ff0',
    '0ffffffffff0',
    '.0ffffffff0.',
    '..0fff0000..',
    '..0ff0......',
    '..0f0.......',
    '..00........',
    '............',
  ],
  clock: [
    '............',
    '...000000...',
    '..03333330..',
    '.0331113 30.',
    '.0311f11130.',
    '03111f111130',
    '03111ff11130',
    '.0311111130.',
    '.0331113330.',
    '..03333330..',
    '...000000...',
    '............',
  ],
  skull: [
    '............',
    '...000000...',
    '..04444440..',
    '.0444444440.',
    '.0400440044 ',
    '.0400440044 ',
    '.0444444440.',
    '..04404440..',
    '..04040404..',
    '...000000...',
    '............',
    '............',
  ],
};

/** The grid of an icon, for a caller that wants to rasterise it itself. */
export function iconRows(name: IconName): readonly string[] {
  return ICONS[name];
}

export function iconNames(): IconName[] {
  return Object.keys(ICONS) as IconName[];
}

/** The icon for an item id, or null for an id with no art yet. */
export function itemIconName(itemId: string): IconName | null {
  return (iconNames() as string[]).includes(itemId) ? (itemId as IconName) : null;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * An icon baked into a canvas at `scale`, cached by name and scale. `tint` replaces every
 * lit pixel with one colour, which is how a disabled slot greys its icon without a second
 * grid.
 */
export function iconCanvas(name: IconName, scale = 1, tint?: string): HTMLCanvasElement {
  const key = `${name}@${scale}${tint ? `:${tint}` : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = ICONS[name];
  const size = ICON_SIZE * scale;
  const { canvas, ctx } = createOffscreen(size, size);
  for (let y = 0; y < ICON_SIZE; y++) {
    const line = rows[y] ?? '';
    for (let x = 0; x < ICON_SIZE; x++) {
      const ch = line[x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const color = tint && ch !== '0' ? tint : ICON_PALETTE[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  cache.set(key, canvas);
  return canvas;
}

/**
 * A *fresh* canvas element holding the icon, sized in CSS pixels and ready to drop into
 * the DOM. {@link iconCanvas} hands back the cached one, and a DOM node can only be in
 * one place at a time — appending the cache to a second parent silently moves the first.
 */
export function iconElement(name: IconName, scale = 1, tint?: string): HTMLCanvasElement {
  const size = ICON_SIZE * scale;
  const { canvas, ctx } = createOffscreen(size, size);
  ctx.drawImage(iconCanvas(name, scale, tint), 0, 0);
  canvas.style.imageRendering = 'pixelated';
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  return canvas;
}

/** Blit an icon with its top-left at `x, y`. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  x: number,
  y: number,
  scale = 1,
  tint?: string,
): void {
  ctx.drawImage(iconCanvas(name, scale, tint), Math.round(x), Math.round(y));
}

/** Blit an icon centred on `cx, cy`. */
export function drawIconCentred(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  scale = 1,
  tint?: string,
): void {
  const half = (ICON_SIZE * scale) / 2;
  drawIcon(ctx, name, Math.round(cx - half), Math.round(cy - half), scale, tint);
}
