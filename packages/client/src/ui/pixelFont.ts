/**
 * A 3x5 pixel font, and the bevelled display face the wordmark is drawn with
 * (docs/ART.md: the HUD is pixel art too, not a website laid over a game).
 *
 * The browser's own text rendering anti-aliases, hints and rounds subpixels, which on an
 * 800x600 backbuffer blown up by an integer factor turns every label into a grey smear.
 * Everything the *client* controls the wording of — SKIP, FIRE, POWER, numbers, badges —
 * is therefore drawn from these grids instead, one `fillRect` per run of lit pixels, so a
 * label is as crisp as the sprite beside it.
 *
 * Player-authored text (nicknames, chat) keeps the canvas font: it can hold letters this
 * font has never heard of, and a glyph that silently renders as nothing is worse than an
 * anti-aliased one. {@link hasGlyphs} is how a caller asks.
 *
 * Pure except for `document.createElement` in {@link pixelTextCanvas}: the grids are
 * data and the two draw helpers only ever touch the context they are handed.
 */
import { createOffscreen } from '../render/canvas.js';

/** Cell size of the body font. Glyphs are separated by `tracking` (default 1) columns. */
export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** `#` is a lit pixel, `.` is a hole. Five rows of three, top row first. */
const GLYPHS: Record<string, readonly string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  // Both stems unbroken: the diagonal that a 3-wide cell cannot hold left gaps that read as Ж.
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  ' ': ['...', '...', '...', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  _: ['...', '...', '...', '...', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '\\': ['#..', '#..', '.#.', '..#', '..#'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '"': ['#.#', '#.#', '...', '...', '...'],
  '(': ['..#', '.#.', '.#.', '.#.', '..#'],
  ')': ['#..', '.#.', '.#.', '.#.', '#..'],
  '[': ['.##', '.#.', '.#.', '.#.', '.##'],
  ']': ['##.', '.#.', '.#.', '.#.', '##.'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '=': ['...', '###', '...', '###', '...'],
  '*': ['#.#', '.#.', '#.#', '...', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '·': ['...', '...', '.#.', '...', '...'],
  '×': ['...', '#.#', '.#.', '#.#', '...'],
  '…': ['...', '...', '...', '...', '#.#'],
};

export interface PixelTextOptions {
  color?: string;
  /** Whole-pixel blow-up of the 3x5 cell. */
  scale?: number;
  align?: 'left' | 'center' | 'right';
  /** Columns of air between two glyphs, in font pixels. */
  tracking?: number;
  /** A 1 px drop shadow under the text, for labels sitting over the world. */
  shadow?: string;
  /** A 1 px hard outline all around, for text over a busy background. */
  outline?: string;
}

function glyphFor(ch: string): readonly string[] | undefined {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()];
}

/** Can every character of `text` be drawn? Nicknames and chat routinely cannot. */
export function hasGlyphs(text: string): boolean {
  for (const ch of text) {
    if (!glyphFor(ch)) return false;
  }
  return true;
}

/** Width of `text` in backbuffer pixels, including the tracking between glyphs. */
export function pixelTextWidth(text: string, scale = 1, tracking = 1): number {
  const count = [...text].length;
  if (count === 0) return 0;
  return (count * GLYPH_W + (count - 1) * tracking) * scale;
}

export function pixelTextHeight(scale = 1): number {
  return GLYPH_H * scale;
}

function drawRuns(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  tracking: number,
): void {
  let px = x;
  for (const ch of text) {
    const glyph = glyphFor(ch);
    if (glyph) {
      for (let row = 0; row < GLYPH_H; row++) {
        const line = glyph[row] ?? '';
        let col = 0;
        while (col < GLYPH_W) {
          if (line[col] !== '#') {
            col++;
            continue;
          }
          let run = 1;
          while (col + run < GLYPH_W && line[col + run] === '#') run++;
          ctx.fillRect(px + col * scale, y + row * scale, run * scale, scale);
          col += run;
        }
      }
    }
    px += (GLYPH_W + tracking) * scale;
  }
}

/**
 * Draw `text` with its top-left (or top-centre / top-right) at `x, y`. Returns the width
 * it took, so a caller can put something after it without measuring twice.
 */
export function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: PixelTextOptions = {},
): number {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const tracking = options.tracking ?? 1;
  const width = pixelTextWidth(text, scale, tracking);
  const left =
    options.align === 'center'
      ? Math.round(x - width / 2)
      : options.align === 'right'
        ? Math.round(x - width)
        : Math.round(x);
  const top = Math.round(y);

  if (options.outline) {
    ctx.fillStyle = options.outline;
    for (let dy = -scale; dy <= scale; dy += scale) {
      for (let dx = -scale; dx <= scale; dx += scale) {
        if (dx === 0 && dy === 0) continue;
        drawRuns(ctx, text, left + dx, top + dy, scale, tracking);
      }
    }
  } else if (options.shadow) {
    ctx.fillStyle = options.shadow;
    drawRuns(ctx, text, left + scale, top + scale, scale, tracking);
  }

  ctx.fillStyle = options.color ?? '#ffffff';
  drawRuns(ctx, text, left, top, scale, tracking);
  return width;
}

// --------------------------------------------------------------------------
// The display face: the wordmark, and nothing else
// --------------------------------------------------------------------------

/**
 * A 7x9 face for the logo. Only the letters "GunBros" needs, because a wordmark is a
 * drawing of one word — a full alphabet at this size would be a font project.
 */
const DISPLAY: Record<string, readonly string[]> = {
  G: [
    '.#####.',
    '##...##',
    '##.....',
    '##.....',
    '##.####',
    '##...##',
    '##...##',
    '##..###',
    '.####.#',
  ],
  B: [
    '#####..',
    '##..##.',
    '##..##.',
    '#####..',
    '#####..',
    '##..##.',
    '##..##.',
    '##..##.',
    '#####..',
  ],
  u: [
    '.......',
    '.......',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##..###',
    '.####.#',
  ],
  n: [
    '.......',
    '.......',
    '##.###.',
    '#######',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
  ],
  r: [
    '.......',
    '.......',
    '##.####',
    '#####..',
    '###....',
    '##.....',
    '##.....',
    '##.....',
    '##.....',
  ],
  o: [
    '.......',
    '.......',
    '.#####.',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '.#####.',
  ],
  s: [
    '.......',
    '.......',
    '.######',
    '##.....',
    '##.....',
    '.#####.',
    '.....##',
    '.....##',
    '######.',
  ],
};

const DISPLAY_W = 7;
const DISPLAY_H = 9;

export interface WordmarkOptions {
  /** Whole-pixel blow-up of the 7x9 cell. */
  scale?: number;
  /** Four tones, light to dark: the face is banded top to bottom (docs/ART.md §4). */
  ramp?: readonly [string, string, string, string];
  outline?: string;
  shadow?: string;
}

const DEFAULT_RAMP: readonly [string, string, string, string] = [
  '#fff3c4',
  '#ffd23f',
  '#f0a020',
  '#b4620e',
];

/**
 * "GunBros" in pixel letters: a 1 px near-black outline, a four-band vertical ramp
 * lit from the top and a hard drop shadow. Drawn into its own canvas so the lobby and
 * the room can put it in the DOM with `image-rendering: pixelated`.
 */
export function drawWordmark(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  options: WordmarkOptions = {},
): { width: number; height: number } {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const ramp = options.ramp ?? DEFAULT_RAMP;
  const outline = options.outline ?? '#10141c';
  const letters = [...text];
  const width = letters.length * (DISPLAY_W + 1) * scale - scale;
  const height = DISPLAY_H * scale;

  const paint = (dx: number, dy: number, colorAt: (row: number) => string): void => {
    let px = x + dx;
    for (const ch of letters) {
      const glyph = DISPLAY[ch] ?? DISPLAY[ch.toUpperCase()] ?? DISPLAY[ch.toLowerCase()];
      if (glyph) {
        for (let row = 0; row < DISPLAY_H; row++) {
          const line = glyph[row] ?? '';
          ctx.fillStyle = colorAt(row);
          for (let col = 0; col < DISPLAY_W; col++) {
            if (line[col] === '#') ctx.fillRect(px + col * scale, y + dy + row * scale, scale, scale);
          }
        }
      }
      px += (DISPLAY_W + 1) * scale;
    }
  };

  if (options.shadow) {
    const shadow = options.shadow;
    paint(scale * 2, scale * 2, () => shadow);
  }
  // The outline is the glyph painted once per neighbouring offset, which is cheap and
  // gives the same hard 1 px edge the sprites have.
  for (let oy = -scale; oy <= scale; oy += scale) {
    for (let ox = -scale; ox <= scale; ox += scale) {
      if (ox === 0 && oy === 0) continue;
      paint(ox, oy, () => outline);
    }
  }
  paint(0, 0, (row) => {
    if (row <= 1) return ramp[0] as string;
    if (row <= 4) return ramp[1] as string;
    if (row <= 6) return ramp[2] as string;
    return ramp[3] as string;
  });

  return { width, height };
}

/** The wordmark as a canvas element, ready to drop into the DOM. */
export function wordmarkCanvas(text: string, options: WordmarkOptions = {}): HTMLCanvasElement {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const pad = scale * 3;
  const width = [...text].length * (DISPLAY_W + 1) * scale - scale + pad * 2;
  const height = DISPLAY_H * scale + pad * 2;
  const { canvas, ctx } = createOffscreen(width, height);
  drawWordmark(ctx, text, pad, pad, options);
  canvas.style.imageRendering = 'pixelated';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return canvas;
}

/** A short run of body text as a canvas, for DOM captions that want the pixel face. */
export function pixelTextCanvas(text: string, options: PixelTextOptions = {}): HTMLCanvasElement {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const tracking = options.tracking ?? 1;
  const pad = scale;
  const width = pixelTextWidth(text, scale, tracking) + pad * 2;
  const height = GLYPH_H * scale + pad * 2;
  const { canvas, ctx } = createOffscreen(width, height);
  drawPixelText(ctx, text, pad, pad, { ...options, align: 'left' });
  canvas.style.imageRendering = 'pixelated';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  return canvas;
}
